import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { createModelAdapter } from '../src/core/model.mjs';
import { createChatService } from '../src/core/chat.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-chat-'));
}

test('offline chat stays grounded and never calls an unconfigured model', async () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const caseItem = db.createCase({ title: 'ЧСИ' });
  db.addMemory({ scope: 'case', caseId: caseItem.id, title: 'Постановление', content: 'Срок исполнения 10 дней' });
  db.addMemory({ scope: 'law', title: 'ГПК РК', content: 'Порядок обжалования постановления', effectiveFrom: '2020-01-01' });
  const model = createModelAdapter({ modelUrl: null, fetchImpl: () => { throw new Error('must not call'); } });
  const chat = createChatService({ db, model });

  const response = await chat.ask({ caseId: caseItem.id, message: 'постановление', asOf: '2026-01-01' });
  assert.equal(response.mode, 'offline');
  assert.match(response.text, /локальной модели/i);
  assert.equal(response.sources.length, 1);
  assert.equal(db.listMessages(caseItem.id).length, 2);
  db.close();
});

test('configured local model receives only the selected case context', async () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const current = db.createCase({ title: 'Текущее' });
  const other = db.createCase({ title: 'Чужое' });
  db.addMemory({ scope: 'case', caseId: current.id, title: 'Текущий документ', content: 'Сведения текущего дела' });
  db.addMemory({ scope: 'case', caseId: other.id, title: 'Чужой документ', content: 'Секретные сведения другого дела' });
  let payload;
  const model = createModelAdapter({
    modelUrl: 'http://127.0.0.1:9999/v1/chat/completions', modelName: 'tiny',
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Проверенный локальный ответ' } }] }) };
    },
  });
  const response = await createChatService({ db, model }).ask({ caseId: current.id, message: 'сведения', asOf: '2026-01-01' });

  assert.equal(response.mode, 'local-model');
  assert.match(response.text, /Проверенный/);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Сведения текущего дела/);
  assert.equal(serialized.includes('Секретные сведения другого дела'), false);
  db.close();
});
