import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { createRedactor } from '../src/core/redaction.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-redaction-'));
}

test('registered case identifiers are replaced consistently and restored locally', () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Обезличивание' });
  const redactor = createRedactor({ db, dataDir });
  const token = redactor.registerParty({ caseId: caseItem.id, value: 'ТОО Рога и копыта', kind: 'company' });

  const redacted = redactor.redactText({ caseId: caseItem.id, text: 'Истец: ТОО Рога и копыта. Повтор: ТОО Рога и копыта.' });
  assert.equal(redacted.text.includes('ТОО Рога и копыта'), false);
  assert.equal(redacted.text.split(token).length - 1, 2);
  assert.equal(redactor.restoreText({ caseId: caseItem.id, text: redacted.text }), 'Истец: ТОО Рога и копыта. Повтор: ТОО Рога и копыта.');
  db.close();
});

test('twelve-digit identifiers are masked without a pre-registered party', () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Идентификатор' });
  const redactor = createRedactor({ db, dataDir });

  const result = redactor.redactText({ caseId: caseItem.id, text: 'БИН 965555555555, второй раз 965555555555' });
  assert.equal(result.text.includes('965555555555'), false);
  assert.equal(result.text.split('Идентификатор').length - 1, 2);
  assert.equal(redactor.restoreText({ caseId: caseItem.id, text: result.text }), 'БИН 965555555555, второй раз 965555555555');
  assert.ok(fs.existsSync(path.join(dataDir, 'redaction.key')));
  db.close();
});
