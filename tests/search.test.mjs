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

test('search returns a bounded relevant excerpt while full law stays in storage', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const caseItem = db.createCase({ title: 'Ограничение контекста' });
  const longContent = `${'Общие положения и служебный текст. '.repeat(150)} Срок предъявления исполнительного документа определяется законом. ${'Дополнительный текст. '.repeat(150)}`;
  db.addMemory({ scope: 'law', title: 'Закон об исполнительном производстве', content: longContent, effectiveFrom: '2010-01-01' });
  for (let index = 0; index < 9; index += 1) {
    db.addMemory({ scope: 'law', title: `Связанная норма ${index}`, content: longContent, effectiveFrom: '2010-01-01' });
  }

  const result = searchMemories({ db, query: 'срок предъявления исполнительного документа', caseId: caseItem.id, asOf: '2026-01-01' });
  assert.equal(result.legalSources.length, 8);
  assert.ok(result.legalSources.every((source) => source.content.length <= 1800));
  assert.ok(result.legalSources.some((source) => /срок предъявления исполнительного документа/i.test(source.content)));
  assert.equal(db.listLegalMemories({ asOf: '2026-01-01' })[0].content.length > 5000, true);
  const context = buildContext({ db, caseId: caseItem.id, message: 'срок предъявления исполнительного документа', asOf: '2026-01-01' });
  assert.ok(context.promptContext.length <= 600);
  db.close();
});
