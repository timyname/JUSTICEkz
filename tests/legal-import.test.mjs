import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateLegalRecord, ingestLawRecord } from '../scripts/ingest-law.mjs';
import { createDatabase } from '../src/core/db.mjs';

test('legal importer requires source and effective date metadata', () => {
  assert.throws(() => validateLegalRecord({ title: 'ГПК РК', content: 'Текст' }), /sourceUrl/);
  assert.throws(() => validateLegalRecord({ title: 'ГПК РК', content: 'Текст', sourceUrl: 'https://adilet.zan.kz/' }), /effectiveFrom/);
});

test('legal importer stores a law outside all case memories', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-law-'));
  const db = createDatabase({ dataDir });
  const item = ingestLawRecord({ db, record: { title: 'Тестовый НПА', content: 'Редакция нормы', sourceUrl: 'https://adilet.zan.kz/', effectiveFrom: '2025-01-01' } });
  assert.equal(item.scope, 'law');
  assert.equal(db.listMemories({ scope: 'case' }).length, 0);
  assert.equal(db.listLegalMemories({ asOf: '2026-01-01' }).length, 1);
  db.close();
});
