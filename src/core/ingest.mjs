import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { chunkText } from './chunking.mjs';

const execFileAsync = promisify(execFile);
const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log']);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);

export function toolExecutable(name, platform = process.platform) {
  if (platform === 'win32' && name === 'soffice') return 'soffice.com';
  return platform === 'win32' ? `${name}.exe` : name;
}

export function resolveTool(name) {
  const executable = toolExecutable(name);
  const candidates = [
    process.env[`${name.toUpperCase()}_PATH`],
    path.join(process.cwd(), '.justicekz', 'tools', 'Tesseract-OCR', executable),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Tesseract-OCR', executable),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Tesseract-OCR', executable),
    name === 'soffice' && process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', 'program', executable),
    name === 'soffice' && process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', executable),
    name === 'soffice' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'LibreOffice', 'program', executable),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? name;
}

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeXmlEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, value) => {
    if (value === 'amp') return '&';
    if (value === 'lt') return '<';
    if (value === 'gt') return '>';
    if (value === 'quot') return '"';
    if (value === 'apos') return "'";
    if (value.startsWith('#x')) return String.fromCodePoint(Number.parseInt(value.slice(2), 16));
    if (value.startsWith('#')) return String.fromCodePoint(Number.parseInt(value.slice(1), 10));
    return entity;
  });
}

function readZipEntry(buffer, targetName) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const entries = buffer.readUInt16LE(offset + 10);
      const centralOffset = buffer.readUInt32LE(offset + 16);
      let cursor = centralOffset;
      for (let index = 0; index < entries; index += 1) {
        if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid DOCX central directory');
        const method = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const nameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
        const localOffset = buffer.readUInt32LE(cursor + 42);
        if (name === targetName) {
          const localNameLength = buffer.readUInt16LE(localOffset + 26);
          const localExtraLength = buffer.readUInt16LE(localOffset + 28);
          const start = localOffset + 30 + localNameLength + localExtraLength;
          const compressed = buffer.subarray(start, start + compressedSize);
          if (method === 0) return compressed;
          if (method === 8) return zlib.inflateRawSync(compressed);
          throw new Error(`Unsupported DOCX compression method: ${method}`);
        }
        cursor += 46 + nameLength + extraLength + commentLength;
      }
      return null;
    }
  }
  return null;
}

export function extractDocxText(buffer) {
  const xmlBytes = readZipEntry(buffer, 'word/document.xml');
  if (!xmlBytes) throw new Error('DOCX document.xml is missing');
  const xml = xmlBytes.toString('utf8');
  const text = xml
    .replace(/<w:tab[^>]*\/?>(?:<\/w:tab>)?/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeDate(day, month, year) {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) return null;
  return date;
}

export function extractSuggestedEvents(text, { fileName = 'документ' } = {}) {
  const events = [];
  const pages = String(text ?? '').split(/\f/g);
  const datePattern = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;
  const nonCaseDateLine = /(?:дата\s+рождения|г\.?\s*р\.?|удостоверени[ея]\s+личности|паспорт|свидетельств[оа]\s+(?:о\s+рождении|личности)|лицензи(?:я|и)|дата\s+выдачи|выдан(?:о|а|ы)?|срок\s+действия|действует\s+до|регистраци(?:я|и)|кредитн\p{L}*\s+истор|кодекс|закон\p{L}*\s+(?:республики\s+казахстан|рк)|нормативн\p{L}*\s+акт|\(\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}\s*г\.?\s*\)|\b\d{9}\b.*\d{1,2}[./-]\d{1,2}[./-]\d{4}.*\d{1,2}[./-]\d{1,2}[./-]\d{4})/iu;
  const bareDateLine = /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}\s*[,.;:]?\s*$/u;
  const identifierDateLine = /(?:идентификационн(?:ый|ого|ым)\s+номер|\b(?:иин|бин)\b)/iu;
  pages.forEach((page, pageIndex) => {
    page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
      if (nonCaseDateLine.test(line) || bareDateLine.test(line) || identifierDateLine.test(line)) return;
      datePattern.lastIndex = 0;
      const match = datePattern.exec(line);
      if (!match) return;
      const eventDate = match[4]
        ? normalizeDate(Number(match[6]), Number(match[5]), Number(match[4]))
        : normalizeDate(Number(match[1]), Number(match[2]), Number(match[3]));
      if (!eventDate) return;
      events.push({
        eventDate,
        eventDatePrecision: 'day',
        title: line.slice(0, 160) || fileName,
        description: line.slice(0, 1000),
        sourcePage: pageIndex + 1,
        status: 'suggested',
      });
    });
  });
  return events;
}

async function extractDocWithConverter(storedPath, extension) {
  const converter = extension === '.doc' ? resolveTool('soffice') : null;
  if (!converter) return { status: 'converter_pending', text: '', error: 'Для этого формата нужен локальный конвертер' };
  const outputDir = fs.mkdtempSync(path.join(path.dirname(storedPath), 'convert-'));
  try {
    await execFileAsync(converter, ['--headless', '--convert-to', 'txt:Text', '--outdir', outputDir, storedPath], { encoding: 'utf8', windowsHide: true });
    const outputPath = path.join(outputDir, `${path.basename(storedPath, extension)}.txt`);
    if (!fs.existsSync(outputPath)) return { status: 'converter_pending', text: '', error: 'LibreOffice не создал текстовый файл' };
    return { status: 'text_extracted', text: fs.readFileSync(outputPath, 'utf8') };
  } catch (error) {
    return { status: 'converter_pending', text: '', error: `Не найден локальный конвертер DOC: ${error.message}` };
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function extractPdfWithOcr(storedPath) {
  const outputDir = fs.mkdtempSync(path.join(path.dirname(storedPath), 'pdf-ocr-'));
  const prefix = path.join(outputDir, 'page');
  try {
    await execFileAsync(resolveTool('pdftoppm'), ['-png', '-r', '150', storedPath, prefix], { encoding: 'utf8', windowsHide: true });
    const images = fs.readdirSync(outputDir).filter((file) => file.startsWith('page-') && file.endsWith('.png')).sort();
    const pages = [];
    for (const image of images) {
      const result = await execFileAsync(resolveTool('tesseract'), [path.join(outputDir, image), 'stdout', '-l', 'rus+kaz'], { encoding: 'utf8', windowsHide: true });
      pages.push(result.stdout.trim());
    }
    if (!pages.some(Boolean)) return { status: 'ocr_pending', text: '', error: 'OCR не извлёк текст из PDF' };
    return { status: 'ocr_extracted', text: pages.join('\f') };
  } catch (error) {
    return { status: 'ocr_pending', text: '', error: `Не удалось обработать скан PDF: ${error.message}` };
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

async function extractText({ storedPath, extension, buffer }) {
  if (textExtensions.has(extension)) return { status: 'text_extracted', text: buffer.toString('utf8') };
  if (extension === '.docx') {
    try { return { status: 'text_extracted', text: extractDocxText(buffer) }; } catch (error) { return { status: 'extraction_failed', text: '', error: error.message }; }
  }
  if (extension === '.doc') return extractDocWithConverter(storedPath, extension);
  if (extension === '.pdf') {
    try {
      const result = await execFileAsync(resolveTool('pdftotext'), [storedPath, '-'], { encoding: 'utf8', windowsHide: true });
      if (result.stdout.trim()) return { status: 'text_extracted', text: result.stdout };
    } catch {
      // A scanned PDF may need the optional page renderer and OCR path.
    }
    return extractPdfWithOcr(storedPath);
  }
  if (imageExtensions.has(extension)) {
    try {
      const result = await execFileAsync(resolveTool('tesseract'), [storedPath, 'stdout', '-l', 'rus+kaz'], { encoding: 'utf8', windowsHide: true });
      if (result.stdout.trim()) return { status: 'ocr_extracted', text: result.stdout };
      return { status: 'ocr_pending', text: '', error: 'OCR не вернул текст' };
    } catch (error) {
      return { status: 'ocr_pending', text: '', error: `Tesseract недоступен или не распознал изображение: ${error.message}` };
    }
  }
  return { status: 'unsupported', text: '', error: 'Формат не поддерживается на этом этапе' };
}

export function prepareDocument({ db, dataDir, caseId, stageId = null, batchId = null, fileName, mimeType = null, buffer }) {
  if (!caseId || !fileName || !Buffer.isBuffer(buffer)) throw new Error('caseId, fileName, and buffer are required');
  const safeName = path.basename(fileName).replace(/[^\p{L}\p{N}._-]+/gu, '_');
  const caseDir = path.join(dataDir, 'cases', caseId, 'documents');
  fs.mkdirSync(caseDir, { recursive: true });
  const storedPath = path.join(caseDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName || 'document'}`);
  fs.writeFileSync(storedPath, buffer);
  const extension = path.extname(safeName).toLocaleLowerCase('ru-RU');
  const document = db.addDocument({
    caseId, stageId, batchId, originalName: fileName, storedPath, mimeType,
    status: 'queued', checksum: checksum(buffer), progress: 0,
  });
  return { db, caseId, stageId, fileName, buffer, storedPath, extension, document };
}

export async function processPreparedDocument(prepared, { onProgress = () => {} } = {}) {
  const { db, caseId, stageId, fileName, buffer, storedPath, extension, document } = prepared;
  db.updateDocument(document.id, { status: 'processing', progress: 10, startedAt: new Date().toISOString(), extractionError: null });
  onProgress({ phase: ['.pdf', ...imageExtensions].includes(extension) ? 'ocr' : 'text_extraction', progress: 10, message: `Извлечение текста: ${fileName}` });
  try {
    const extracted = await extractText({ storedPath, extension, buffer });
    onProgress({ phase: 'memory', progress: 55, message: `Сохраняю фрагменты в память дела: ${fileName}` });
    const chunks = extracted.text.trim() ? chunkText(extracted.text) : [];
    for (const [index, chunk] of chunks.entries()) {
      db.addMemory({
        scope: 'case', caseId, stageId, documentId: document.id, kind: 'document_chunk',
        title: `${fileName} · фрагмент ${index + 1}`, content: chunk.content, pageNumber: chunk.pageNumber,
      });
    }
    onProgress({ phase: 'chronology', progress: 82, message: `Проверяю даты и события: ${fileName}` });
    const suggestedEvents = extractSuggestedEvents(extracted.text, { fileName });
    for (const event of suggestedEvents) db.addEvent({ caseId, stageId, documentId: document.id, ...event });
    const pageCount = chunks.length ? Math.max(...chunks.map((chunk) => chunk.pageNumber)) : (extracted.text.trim() ? 1 : 0);
    const processed = db.updateDocument(document.id, {
      status: extracted.status, progress: 100, pageCount,
      extractionError: extracted.error ?? null, processedAt: new Date().toISOString(),
    });
    onProgress({ phase: 'chronology', progress: 100, message: `Документ разобран: ${fileName}` });
    return { ...processed, storedPath, chunks: chunks.length, events: suggestedEvents.length, text: extracted.text };
  } catch (error) {
    const failed = db.updateDocument(document.id, { status: 'extraction_failed', progress: 100, extractionError: error.message, processedAt: new Date().toISOString() });
    return { ...failed, storedPath, chunks: 0, events: 0, text: '', error: error.message };
  }
}

export async function ingestDocument(input) {
  return processPreparedDocument(prepareDocument(input));
}
