import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-db-'));
}

test('case memories stay isolated and a new case receives process stages', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const first = db.createCase({ title: 'Спор с ЧСИ', actionDate: '2026-08-14' });
  const second = db.createCase({ title: 'Договорный спор', actionDate: '2026-08-15' });

  assert.ok(db.listStages(first.id).length >= 6);
  db.addMemory({ scope: 'case', caseId: first.id, title: 'Постановление', content: 'Сумма взыскания' });
  db.addMemory({ scope: 'case', caseId: second.id, title: 'Договор', content: 'Срок оплаты' });

  assert.equal(db.listMemories({ scope: 'case', caseId: first.id }).length, 1);
  assert.equal(db.listMemories({ scope: 'case', caseId: second.id }).length, 1);
  assert.equal(db.listMemories({ scope: 'case', caseId: first.id })[0].title, 'Постановление');
  db.close();
});

test('legal memory exposes only the version valid on the requested date', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  db.addMemory({
    scope: 'law', title: 'Норма A', content: 'Старая редакция',
    sourceUrl: 'https://adilet.zan.kz/', effectiveFrom: '2020-01-01', effectiveTo: '2024-12-31',
  });
  db.addMemory({
    scope: 'law', title: 'Норма A', content: 'Новая редакция',
    sourceUrl: 'https://adilet.zan.kz/', effectiveFrom: '2025-01-01',
  });

  assert.deepEqual(db.listLegalMemories({ asOf: '2024-06-01' }).map((row) => row.content), ['Старая редакция']);
  assert.deepEqual(db.listLegalMemories({ asOf: '2026-06-01' }).map((row) => row.content), ['Новая редакция']);
  db.close();
});

test('documents expose processing state and chronology stays case-scoped', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const first = db.createCase({ title: 'Первое дело' });
  const second = db.createCase({ title: 'Второе дело' });
  const stage = db.listStages(first.id)[0];
  const document = db.addDocument({
    caseId: first.id,
    stageId: stage.id,
    originalName: 'notice.txt',
    storedPath: 'cases/notice.txt',
    mimeType: 'text/plain',
    status: 'queued',
    checksum: 'abc',
  });

  assert.equal(document.progress, 0);
  const updated = db.updateDocument(document.id, { status: 'text_extracted', progress: 100, pageCount: 2 });
  assert.equal(updated.status, 'text_extracted');
  assert.equal(updated.progress, 100);
  assert.equal(updated.page_count, 2);

  const event = db.addEvent({
    caseId: first.id,
    documentId: document.id,
    eventDate: '2026-08-14',
    eventDatePrecision: 'day',
    title: 'Постановление ЧСИ',
    description: 'Вынесено постановление',
    sourcePage: 1,
  });
  const duplicate = db.addEvent({
    caseId: first.id,
    documentId: document.id,
    eventDate: '2026-08-14',
    eventDatePrecision: 'day',
    title: 'Постановление ЧСИ',
    description: 'Вынесено постановление',
    sourcePage: 1,
  });
  assert.equal(duplicate.id, event.id);
  assert.equal(db.listDocuments(first.id).length, 1);
  assert.equal(db.listEvents(first.id).length, 1);
  assert.equal(db.listEvents(second.id).length, 0);
  assert.equal(event.status, 'suggested');
  db.close();
});
