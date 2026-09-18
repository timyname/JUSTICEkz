import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as defaultConfig } from '../config.mjs';
import { createDatabase } from '../core/db.mjs';
import { ingestDocument } from '../core/ingest.mjs';
import { createDocumentQueue } from '../core/processing.mjs';
import { createRedactor } from '../core/redaction.mjs';
import { createModelAdapter } from '../core/model.mjs';
import { createChatService } from '../core/chat.mjs';
import { buildContext } from '../core/context.mjs';
import { buildDraftMarkdown, buildPrintableHtml, buildDocx } from '../core/export.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../public');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 64 * 1024 * 1024) throw new Error('Request is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function dateOrToday(value) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function requireCase(db, caseId) {
  const caseItem = db.getCase(caseId);
  if (!caseItem) throw Object.assign(new Error('Case not found'), { statusCode: 404 });
  return caseItem;
}

function buildCaseQuestions(documents, events) {
  const questions = [];
  if (documents.some((document) => ['queued', 'processing'].includes(document.status))) {
    questions.push('Дождаться завершения обработки документов, которые ещё находятся в очереди.');
  }
  if (documents.some((document) => ['ocr_pending', 'converter_pending', 'unsupported'].includes(document.status))) {
    questions.push('Проверить документы, для которых на компьютере пока нет нужного OCR или конвертера.');
  }
  if (documents.length && !events.length) {
    questions.push('Уточнить даты ключевых событий: пока в документах не найдено ни одного датированного события.');
  }
  if (events.some((event) => event.status === 'suggested')) {
    questions.push('Проверить предложенные даты и отметить события как подтверждённые или отклонённые.');
  }
  return questions;
}

function safeStaticPath(urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const full = path.resolve(publicDir, relative);
  if (!full.startsWith(publicDir)) return null;
  return full;
}

export function createApplication({ dataDir = defaultConfig.dataDir, modelUrl = defaultConfig.modelUrl, modelName = defaultConfig.modelName } = {}) {
  const db = createDatabase({ dataDir });
  const redactor = createRedactor({ db, dataDir });
  const model = createModelAdapter({ modelUrl, modelName });
  const chat = createChatService({ db, model });
  const documentQueue = createDocumentQueue({ db, dataDir });

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const { pathname } = requestUrl;
      if (request.method === 'GET' && pathname === '/api/health') {
        return sendJson(response, 200, { status: 'ok', modelConfigured: model.configured, modelName: modelName ?? null, version: '0.2.0' });
      }
      if (pathname.startsWith('/api/')) {
        const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (request.method === 'GET' && parts.length === 2 && parts[1] === 'cases') {
          return sendJson(response, 200, { cases: db.listCases() });
        }
        if (request.method === 'POST' && parts.length === 2 && parts[1] === 'cases') {
          const body = await readJson(request);
          if (!body.title?.trim()) return sendError(response, 400, 'title is required');
          const created = db.createCase({ title: body.title.trim(), number: body.number, actionDate: body.actionDate ?? null });
          return sendJson(response, 201, { case: db.getCase(created.id), stages: db.listStages(created.id) });
        }
        if (parts.length >= 3 && parts[1] === 'cases') {
          const caseId = parts[2];
          const caseItem = requireCase(db, caseId);
          if (request.method === 'GET' && parts.length === 3) {
            const documents = db.listDocuments(caseId);
            const events = db.listEvents(caseId);
            return sendJson(response, 200, {
              case: caseItem, stages: db.listStages(caseId), tasks: db.listTasks(caseId), messages: db.listMessages(caseId),
              documents, events, questions: buildCaseQuestions(documents, events), queueRunning: documentQueue.running,
            });
          }
          if (request.method === 'POST' && parts[3] === 'stages' && parts[4] === 'current') {
            const body = await readJson(request);
            return sendJson(response, 200, { case: db.setCurrentStage(caseId, body.stageId), stages: db.listStages(caseId) });
          }
          if (request.method === 'GET' && parts[3] === 'documents') {
            const documents = db.listDocuments(caseId);
            const events = db.listEvents(caseId);
            return sendJson(response, 200, { documents, events, questions: buildCaseQuestions(documents, events), queueRunning: documentQueue.running });
          }
          if (request.method === 'POST' && parts[3] === 'documents' && parts[4] === 'batch') {
            const body = await readJson(request);
            if (!Array.isArray(body.documents) || !body.documents.length) return sendError(response, 400, 'documents must be a non-empty array');
            const documents = body.documents.map((item) => ({
              fileName: item.fileName,
              mimeType: item.mimeType,
              buffer: item.contentBase64 ? Buffer.from(item.contentBase64, 'base64') : null,
            }));
            if (documents.some((item) => !item.fileName || !item.buffer)) return sendError(response, 400, 'every document needs fileName and contentBase64');
            const jobs = documentQueue.enqueueBatch({ caseId, stageId: body.stageId ?? caseItem.current_stage_id, documents });
            const storedDocuments = db.listDocuments(caseId);
            const events = db.listEvents(caseId);
            return sendJson(response, 202, {
              jobs: jobs.map((job) => ({ documentId: job.documentId, error: job.error?.message ?? null })),
              documents: storedDocuments, events, questions: buildCaseQuestions(storedDocuments, events),
            });
          }
          if (request.method === 'POST' && parts[3] === 'documents') {
            const body = await readJson(request);
            if (!body.fileName || !body.contentBase64) return sendError(response, 400, 'fileName and contentBase64 are required');
            const result = await ingestDocument({
              db, dataDir, caseId, stageId: body.stageId ?? caseItem.current_stage_id,
              fileName: body.fileName, mimeType: body.mimeType, buffer: Buffer.from(body.contentBase64, 'base64'),
            });
            return sendJson(response, 201, result);
          }
          if (request.method === 'POST' && parts[3] === 'chat') {
            const body = await readJson(request);
            if (!body.message?.trim()) return sendError(response, 400, 'message is required');
            const result = await chat.ask({ caseId, message: body.message, asOf: dateOrToday(body.asOf ?? caseItem.action_date) });
            return sendJson(response, 200, result);
          }
          if (request.method === 'POST' && parts[3] === 'parties') {
            const body = await readJson(request);
            if (!body.value?.trim()) return sendError(response, 400, 'value is required');
            return sendJson(response, 201, { token: redactor.registerParty({ caseId, value: body.value, kind: body.kind }) });
          }
          if (request.method === 'POST' && parts[3] === 'redact') {
            const body = await readJson(request);
            return sendJson(response, 200, redactor.redactText({ caseId, text: body.text ?? '' }));
          }
          if (request.method === 'GET' && parts[3] === 'export') {
            const format = requestUrl.searchParams.get('format') ?? 'html';
            const stage = db.listStages(caseId).find((item) => item.id === caseItem.current_stage_id);
            const messages = db.listMessages(caseId);
            const lastUser = [...messages].reverse().find((item) => item.role === 'user');
            const context = lastUser ? buildContext({ db, caseId, message: lastUser.content, asOf: dateOrToday(requestUrl.searchParams.get('asOf') ?? caseItem.action_date) }) : { legalSources: [], caseDocuments: [] };
            const draft = {
              caseTitle: caseItem.title, caseNumber: caseItem.number, stageTitle: stage?.title,
              asOf: dateOrToday(requestUrl.searchParams.get('asOf') ?? caseItem.action_date), messages,
              sources: context.legalSources, caseDocuments: db.listMemories({ scope: 'case', caseId }),
            };
            if (format === 'docx') {
              const body = buildDocx(draft);
              response.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': `attachment; filename="justicekz-${caseId}.docx"` });
              return response.end(body);
            }
            if (format === 'md') {
              response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="justicekz-${caseId}.md"` });
              return response.end(buildDraftMarkdown(draft));
            }
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `inline; filename="justicekz-${caseId}.html"` });
            return response.end(buildPrintableHtml(draft));
          }
        }
        return sendError(response, 404, 'API route not found');
      }
      if (request.method !== 'GET') return sendError(response, 405, 'Method not allowed');
      const filePath = safeStaticPath(pathname);
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendError(response, 404, 'File not found');
      response.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath).toLocaleLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      const status = error.statusCode ?? 500;
      if (!response.headersSent) sendError(response, status, status === 500 ? 'Internal server error' : error.message);
      else response.end();
    }
  });

  return { server, db, redactor, chat };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApplication();
  app.server.listen(defaultConfig.port, defaultConfig.host, () => {
    console.log(`JUSTICEkz running at http://${defaultConfig.host}:${defaultConfig.port}`);
  });
}
