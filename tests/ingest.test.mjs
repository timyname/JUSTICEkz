import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { chunkText } from '../src/core/chunking.mjs';
import { ingestDocument } from '../src/core/ingest.mjs';

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
