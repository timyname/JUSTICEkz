import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { chunkText } from './chunking.mjs';

const execFileAsync = promisify(execFile);
const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log']);

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function extractText({ storedPath, extension, buffer }) {
  if (textExtensions.has(extension)) return { status: 'text_extracted', text: buffer.toString('utf8') };
  if (extension === '.pdf') {
    try {
      const result = await execFileAsync('pdftotext', [storedPath, '-'], { encoding: 'utf8', windowsHide: true });
      return { status: 'text_extracted', text: result.stdout };
    } catch {
      return { status: 'ocr_pending', text: '' };
    }
  }
  if (['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp'].includes(extension)) {
    try {
      const result = await execFileAsync('tesseract', [storedPath, 'stdout', '-l', 'rus+kaz'], { encoding: 'utf8', windowsHide: true });
      return { status: 'ocr_extracted', text: result.stdout };
    } catch {
      return { status: 'ocr_pending', text: '' };
    }
  }
  return { status: 'ocr_pending', text: '' };
}

export async function ingestDocument({ db, dataDir, caseId, stageId = null, fileName, mimeType = null, buffer }) {
  if (!caseId || !fileName || !Buffer.isBuffer(buffer)) throw new Error('caseId, fileName, and buffer are required');
  const safeName = path.basename(fileName).replace(/[^\p{L}\p{N}._-]+/gu, '_');
  const caseDir = path.join(dataDir, 'cases', caseId, 'documents');
  fs.mkdirSync(caseDir, { recursive: true });
  const storedPath = path.join(caseDir, `${Date.now()}-${safeName || 'document'}`);
  fs.writeFileSync(storedPath, buffer);
  const extension = path.extname(safeName).toLocaleLowerCase('ru-RU');
  const extracted = await extractText({ storedPath, extension, buffer });
  const document = db.addDocument({
    caseId, stageId, originalName: fileName, storedPath, mimeType,
    status: extracted.status, checksum: checksum(buffer),
  });
  let chunks = [];
  if (extracted.text.trim()) {
    chunks = chunkText(extracted.text);
    for (const [index, chunk] of chunks.entries()) {
      db.addMemory({
        scope: 'case', caseId, stageId, documentId: document.id, kind: 'document_chunk',
        title: `${fileName} · фрагмент ${index + 1}`, content: chunk.content, pageNumber: chunk.pageNumber,
      });
    }
  }
  return { ...document, status: extracted.status, storedPath, chunks: chunks.length, text: extracted.text };
}
