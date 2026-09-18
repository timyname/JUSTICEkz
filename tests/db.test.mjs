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
