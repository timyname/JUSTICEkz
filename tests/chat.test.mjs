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

test('offline chat returns a compact digest instead of dumping full memory excerpts', async () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const caseItem = db.createCase({ title: 'Компактный ответ' });
  db.addMemory({ scope: 'case', caseId: caseItem.id, title: 'Материалы дела', content: `Постановление ЧСИ от 10.08.2026. ${'Длинный повторяющийся фрагмент. '.repeat(220)}` });
  db.addMemory({ scope: 'law', title: 'ГПК РК', content: `Порядок обжалования. ${'Длинная выдержка из нормативного акта. '.repeat(220)}`, effectiveFrom: '2020-01-01' });
  const model = createModelAdapter({ modelUrl: null, fetchImpl: () => { throw new Error('must not call'); } });
  const response = await createChatService({ db, model }).ask({ caseId: caseItem.id, message: 'обжалование постановления', asOf: '2026-01-01' });

  assert.ok(response.text.length < 1800);
  assert.match(response.text, /Кратко|Коротко/i);
  assert.match(response.text, /ГПК РК/);
  assert.equal(response.text.includes('Длинная выдержка из нормативного акта. Длинная выдержка из нормативного акта. Длинная выдержка из нормативного акта.'), false);
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
  assert.equal(payload.max_tokens, 128);
  assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: false });
  assert.match(payload.messages[0].content, /не переписывай|без длинных выдержек/i);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Сведения текущего дела/);
  assert.equal(serialized.includes('Секретные сведения другого дела'), false);
  db.close();
});

test('a stalled local model falls back without keeping the chat request open', async () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const caseItem = db.createCase({ title: 'Тайм-аут модели' });
  db.addMemory({ scope: 'law', title: 'ГПК РК', content: 'Срок обжалования', effectiveFrom: '2020-01-01' });
  let signalProvided = false;
  const model = createModelAdapter({
    modelUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      signalProvided = Boolean(options.signal);
      if (!options.signal) return reject(new Error('missing abort signal'));
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
    timeoutMs: 10,
  });
  const response = await createChatService({ db, model }).ask({ caseId: caseItem.id, message: 'обжалование', asOf: '2026-01-01' });

  assert.equal(response.mode, 'offline');
  assert.equal(signalProvided, true);
  assert.match(response.warnings.join(' '), /модель недоступна/i);
  db.close();
});
