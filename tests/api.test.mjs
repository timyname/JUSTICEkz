import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApplication } from '../src/server/server.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-api-'));
}

async function withServer(callback, options = {}) {
  const app = createApplication({ dataDir: tempDataDir(), reviewModel: null, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`, app);
  } finally {
    app.db.close();
    await new Promise((resolve) => app.server.close(resolve));
  }
}

async function jsonRequest(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    headers: { 'content-type': 'application/json' }, ...options,
  });
  return { status: response.status, body: await response.json() };
}

test('API creates a case, imports text, and returns grounded chat sources', async () => {
  await withServer(async (base) => {
    const health = await jsonRequest(base, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');

    const created = await jsonRequest(base, '/api/cases', { method: 'POST', body: JSON.stringify({ title: 'Спор с ЧСИ' }) });
    assert.equal(created.status, 201);
    const caseId = created.body.case.id;
    const stageId = created.body.stages[0].id;

    const imported = await jsonRequest(base, `/api/cases/${caseId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ fileName: 'notice.txt', mimeType: 'text/plain', stageId, contentBase64: Buffer.from('Постановление ЧСИ. Срок исполнения 10 дней', 'utf8').toString('base64') }),
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.chunks, 1);

    const chat = await jsonRequest(base, `/api/cases/${caseId}/chat`, {
      method: 'POST', body: JSON.stringify({ message: 'постановление', asOf: '2026-01-01' }),
    });
    assert.equal(chat.status, 200);
    assert.match(chat.body.text, /локальной модели|Постановление/i);
    assert.equal(chat.body.caseDocuments.length, 1);

    const exported = await fetch(`${base}/api/cases/${caseId}/export?format=docx`);
    assert.equal(exported.status, 200);
    assert.equal((await exported.arrayBuffer()).byteLength > 100, true);
    assert.match(exported.headers.get('content-type'), /wordprocessingml/);
  });
});

test('API redaction preview does not leak a registered company name', async () => {
  await withServer(async (base) => {
    const created = await jsonRequest(base, '/api/cases', { method: 'POST', body: JSON.stringify({ title: 'Защищённое дело' }) });
    const caseId = created.body.case.id;
    await jsonRequest(base, `/api/cases/${caseId}/parties`, { method: 'POST', body: JSON.stringify({ value: 'ТОО Рога и копыта', kind: 'company' }) });
    const preview = await jsonRequest(base, `/api/cases/${caseId}/redact`, { method: 'POST', body: JSON.stringify({ text: 'Истец: ТОО Рога и копыта' }) });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.text.includes('ТОО Рога и копыта'), false);
    assert.match(preview.body.text, /Юрлицо/);
  });
});

test('API saves a client goal and returns a case-specific draft plan', async () => {
  await withServer(async (base) => {
    const created = await jsonRequest(base, '/api/cases', { method: 'POST', body: JSON.stringify({ title: 'ЭКСПЕРТ ПЛЮС' }) });
    const caseId = created.body.case.id;
    const saved = await jsonRequest(base, `/api/cases/${caseId}/goal`, {
      method: 'POST',
      body: JSON.stringify({ goal: 'debt_challenge', customGoal: 'Оспорить долг' }),
    });

    assert.equal(saved.status, 200);
    assert.equal(saved.body.goal.code, 'debt_challenge');
    assert.match(saved.body.draft.documentType, /иск/i);

    const detail = await jsonRequest(base, `/api/cases/${caseId}`);
    assert.equal(detail.body.goal.goal.code, 'debt_challenge');
  });
});

test('API accepts a batch, lists document states, and exposes chronology', async () => {
  await withServer(async (base) => {
    const created = await jsonRequest(base, '/api/cases', { method: 'POST', body: JSON.stringify({ title: 'Пачка' }) });
    const caseId = created.body.case.id;
    const stageId = created.body.stages[0].id;
    const documents = [
      { fileName: 'first.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Постановление 14.08.2026').toString('base64') },
      { fileName: 'second.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Оплата 20.08.2026').toString('base64') },
    ];
    const batch = await jsonRequest(base, `/api/cases/${caseId}/documents/batch`, { method: 'POST', body: JSON.stringify({ stageId, documents }) });
    assert.equal(batch.status, 202);
    assert.equal(batch.body.documents.length, 2);
    assert.match(batch.body.batchId, /^batch-/);

    const initialBatch = await jsonRequest(base, `/api/cases/${caseId}/document-batches/${batch.body.batchId}`);
    assert.equal(initialBatch.status, 200);
    assert.equal(initialBatch.body.batch.total, 2);
    assert.equal(initialBatch.body.documents.length, 2);

    let detail;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      detail = await jsonRequest(base, `/api/cases/${caseId}/document-batches/${batch.body.batchId}`);
      if (['complete', 'complete_with_errors'].includes(detail.body.batch.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(detail.status, 200);
    assert.equal(detail.body.batch.status, 'complete');
    assert.equal(detail.body.batch.completed, 2);
    assert.equal(detail.body.review.status, 'complete');
    assert.ok(detail.body.review.report.nextTasks.length);
  });
});

test('API blocks chat while the case workup is still running and opens it after review', async () => {
  let releaseReview;
  const reviewHold = new Promise((resolve) => { releaseReview = resolve; });
  let app;
  const reviewService = {
    run: async ({ batchId }) => {
      await reviewHold;
      app.db.updateBatch(batchId, { status: 'complete', phase: 'complete', progress: 100, message: 'Готово' });
      return null;
    },
  };
  await withServer(async (base, serverApp) => {
    app = serverApp;
    const created = await jsonRequest(base, '/api/cases', { method: 'POST', body: JSON.stringify({ title: 'Блокировка чата' }) });
    const caseId = created.body.case.id;
    const batch = await jsonRequest(base, `/api/cases/${caseId}/documents/batch`, {
      method: 'POST',
      body: JSON.stringify({ documents: [{ fileName: 'one.txt', contentBase64: Buffer.from('Дата 01.09.2026').toString('base64') }] }),
    });
    const blocked = await jsonRequest(base, `/api/cases/${caseId}/chat`, { method: 'POST', body: JSON.stringify({ message: 'что в деле?' }) });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /дождитесь|разбор|обработ/i);
    assert.equal(blocked.body.batchId, batch.body.batchId);

    releaseReview();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await jsonRequest(base, `/api/cases/${caseId}/document-batches/${batch.body.batchId}`);
      if (['complete', 'complete_with_errors'].includes(status.body.batch.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const ready = await jsonRequest(base, `/api/cases/${caseId}/chat`, { method: 'POST', body: JSON.stringify({ message: 'что в деле?' }) });
    assert.equal(ready.status, 200);
  }, { reviewService });
});
