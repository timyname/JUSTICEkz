import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { chunkText } from '../src/core/chunking.mjs';
import { extractDocxText, extractSuggestedEvents, ingestDocument, resolveTool, toolExecutable } from '../src/core/ingest.mjs';
import { createDocumentQueue } from '../src/core/processing.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-ingest-'));
}

test('text document is stored, chunked, and added to the active case memory', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Импорт' });
  const stage = db.listStages(caseItem.id)[0];
  const result = await ingestDocument({
    db, dataDir, caseId: caseItem.id, stageId: stage.id,
    fileName: 'notice.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Дата постановления: 14.08.2026\nСумма взыскания: 1000 тенге', 'utf8'),
  });

  assert.equal(result.status, 'text_extracted');
  assert.equal(result.chunks, 1);
  assert.equal(db.listMemories({ scope: 'case', caseId: caseItem.id }).length, 1);
  assert.ok(fs.existsSync(result.storedPath));
  db.close();
});

test('chunker preserves page boundaries and keeps chunks bounded', () => {
  const chunks = chunkText('Первая страница\fВторая страница с деталями', { maxChars: 40, overlap: 5 });

  assert.deepEqual(chunks.map((chunk) => chunk.pageNumber), [1, 2]);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 40));
});

test('unsupported binary file remains pending instead of being treated as readable', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Скан' });
  const result = await ingestDocument({
    db, dataDir, caseId: caseItem.id, fileName: 'scan.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]),
  });

  assert.equal(result.status, 'ocr_pending');
  assert.equal(result.chunks, 0);
  assert.equal(db.listMemories({ scope: 'case', caseId: caseItem.id }).length, 0);
  db.close();
});

test('docx text extraction reads paragraph text from a local Office package', () => {
  const docx = createMinimalDocx(['Постановление ЧСИ', '14.08.2026 сумма 1000 тенге']);
  assert.match(extractDocxText(docx), /Постановление ЧСИ/);
  assert.match(extractDocxText(docx), /14\.08\.2026/);
});

test('chronology extraction suggests dated events with source pages', () => {
  const events = extractSuggestedEvents('Постановление вынесено 14.08.2026 на первой странице\fОплата 20.08.2026', { fileName: 'notice.txt' });
  assert.deepEqual(events.map((event) => event.eventDate), ['2026-08-14', '2026-08-20']);
  assert.deepEqual(events.map((event) => event.sourcePage), [1, 2]);
  assert.ok(events.every((event) => event.status === 'suggested'));
});

test('chronology ignores personal document dates and generic legal references', () => {
  const text = [
    'Дата рождения: 30.12.1993',
    'БЕШИНКЕНОВ ТИМ КУРМАНГАЛИЕВИЧ (30.12.1993 г.)',
    'кредитной истории Бешинкенов Тим Курмангалиевич Резидент 30.12.1993 Казахстан Мужской',
    'Удостоверение личности выдано 03.04.2020',
    'Пасткелтражпенинанқ 033095704 07.03.2012 16.03.2015',
    'Закон Республики Казахстан от 01.01.2015',
    'ст.35 Закона РК от 02.04.2010г.',
    '08.10.2013,',
    'идентификационный номер 931230350073 28.10.2014',
    'Постановление ЧСИ вынесено 14.08.2026',
  ].join('\n');
  const events = extractSuggestedEvents(text, { fileName: 'case.txt' });

  assert.deepEqual(events.map((event) => event.eventDate), ['2026-08-14']);
});

test('tool resolution honors an explicit local converter path', () => {
  const previous = process.env.SOFFICE_PATH;
  process.env.SOFFICE_PATH = process.execPath;
  assert.equal(resolveTool('soffice'), process.execPath);
  if (previous === undefined) delete process.env.SOFFICE_PATH;
  else process.env.SOFFICE_PATH = previous;
});

test('Windows LibreOffice resolution uses the console launcher', () => {
  assert.equal(toolExecutable('soffice', 'win32'), 'soffice.com');
  assert.equal(toolExecutable('tesseract', 'win32'), 'tesseract.exe');
});

test('document queue processes a batch sequentially and keeps each case isolated', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const first = db.createCase({ title: 'Пачка документов' });
  const second = db.createCase({ title: 'Другое дело' });
  const queue = createDocumentQueue({ db, dataDir });
  const jobs = queue.enqueueBatch({
    caseId: first.id,
    stageId: db.listStages(first.id)[0].id,
    documents: [
      { fileName: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('Дата 01.09.2026') },
      { fileName: 'two.txt', mimeType: 'text/plain', buffer: Buffer.from('Дата 02.09.2026') },
    ],
  });
  assert.equal(jobs.length, 2);
  await queue.idle();
  assert.equal(db.listDocuments(first.id).length, 2);
  assert.equal(db.listDocuments(first.id).every((document) => document.status === 'text_extracted'), true);
  assert.equal(db.listEvents(first.id).length, 2);
  assert.equal(db.listDocuments(second.id).length, 0);
  db.close();
});

test('document queue exposes durable batch phases and counters', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Статус обработки' });
  const phases = [];
  const queue = createDocumentQueue({
    db, dataDir,
    reviewService: { run: async ({ batchId }) => { db.updateBatch(batchId, { status: 'complete', phase: 'complete', progress: 100 }); } },
    onProgress: (update) => phases.push(update.phase),
  });
  const jobs = queue.enqueueBatch({
    caseId: caseItem.id,
    stageId: db.listStages(caseItem.id)[0].id,
    documents: [
      { fileName: 'one.txt', buffer: Buffer.from('Дата 01.09.2026') },
      { fileName: 'two.txt', buffer: Buffer.from('Дата 02.09.2026') },
    ],
  });
  await queue.idle();
  const batch = db.getBatch(jobs.batchId);
  assert.equal(batch.completed, 2);
  assert.equal(batch.status, 'complete');
  assert.ok(phases.includes('text_extraction'));
  assert.ok(phases.includes('memory'));
  assert.ok(phases.includes('chronology'));
  db.close();
});

function createMinimalDocx(paragraphs) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const fileName = 'word/document.xml';
  const fileBytes = Buffer.from(xml, 'utf8');
  const nameBytes = Buffer.from(fileName, 'utf8');
  const local = Buffer.alloc(30 + nameBytes.length + fileBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(fileBytes.length, 18);
  local.writeUInt32LE(fileBytes.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  fileBytes.copy(local, 30 + nameBytes.length);
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(fileBytes.length, 20);
  central.writeUInt32LE(fileBytes.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}
