import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApplication } from '../src/server/server.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-api-'));
}

async function withServer(callback) {
  const app = createApplication({ dataDir: tempDataDir() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
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
