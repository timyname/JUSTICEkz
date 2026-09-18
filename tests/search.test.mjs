import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { searchMemories } from '../src/core/search.mjs';
import { buildContext } from '../src/core/context.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-search-'));
}

test('search respects case scope and legal effective dates', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const caseOne = db.createCase({ title: 'ЧСИ', actionDate: '2025-08-01' });
  const caseTwo = db.createCase({ title: 'Договор', actionDate: '2025-08-01' });
  db.addMemory({ scope: 'case', caseId: caseOne.id, title: 'Постановление ЧСИ', content: 'Срок исполнения и уведомление должника' });
  db.addMemory({ scope: 'case', caseId: caseTwo.id, title: 'Договор', content: 'Срок оплаты по договору' });
  db.addMemory({ scope: 'law', title: 'Норма взыскания', content: 'Старый срок исполнения', effectiveFrom: '2020-01-01', effectiveTo: '2024-12-31' });
  db.addMemory({ scope: 'law', title: 'Норма взыскания', content: 'Новый срок исполнения', effectiveFrom: '2025-01-01' });

  const result = searchMemories({ db, query: 'срок исполнения', caseId: caseOne.id, asOf: '2025-08-01' });
  assert.equal(result.caseDocuments.length, 1);
  assert.equal(result.caseDocuments[0].title, 'Постановление ЧСИ');
  assert.equal(result.legalSources.length, 1);
  assert.equal(result.legalSources[0].content, 'Новый срок исполнения');
  db.close();
});

test('context is separated into legal sources and case documents', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const current = db.createCase({ title: 'Текущее дело' });
  const other = db.createCase({ title: 'Другое дело' });
  db.addMemory({ scope: 'case', caseId: current.id, title: 'Иск', content: 'Оспариваем постановление' });
  db.addMemory({ scope: 'case', caseId: other.id, title: 'Чужой документ', content: 'Оспариваем постановление' });
  db.addMemory({ scope: 'law', title: 'ГПК РК', content: 'Постановление проверяют по законности действия', effectiveFrom: '2020-01-01' });

  const context = buildContext({ db, caseId: current.id, message: 'проверить постановление', asOf: '2026-01-01' });
  assert.equal(context.caseDocuments.length, 1);
  assert.equal(context.caseDocuments[0].title, 'Иск');
  assert.equal(context.legalSources.length, 1);
  assert.equal(context.legalSources[0].title, 'ГПК РК');
  assert.equal(context.caseDocuments.some((item) => item.title === 'Чужой документ'), false);
  db.close();
});
