import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { createCaseReviewService } from '../src/core/case-review.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-briefing-'));
}

test('review creates a dated case briefing and cautious possible violations', async () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const caseItem = db.createCase({ title: 'ЭКСПЕРТ ПЛЮС · спор с ЧСИ' });
  const stage = db.listStages(caseItem.id)[0];
  const batch = db.addBatch({ caseId: caseItem.id, stageId: stage.id, total: 2 });
  db.addDocument({ caseId: caseItem.id, stageId: stage.id, batchId: batch.id, originalName: 'постановление ЧСИ.txt', storedPath: 'one.txt', status: 'text_extracted', checksum: 'one', progress: 100 });
  db.addDocument({ caseId: caseItem.id, stageId: stage.id, batchId: batch.id, originalName: 'инкассовое распоряжение.txt', storedPath: 'two.txt', status: 'text_extracted', checksum: 'two', progress: 100 });
  db.addMemory({ scope: 'case', caseId: caseItem.id, title: 'Материалы', content: 'Постановление ЧСИ о взыскании долга. Инкассовое распоряжение. Получение документа не подтверждено.' });
  db.addEvent({ caseId: caseItem.id, stageId: stage.id, eventDate: '2026-08-10', title: 'Постановление вынесено', description: 'Постановление ЧСИ', status: 'suggested' });

  const result = await createCaseReviewService({ db, model: null }).run({ caseId: caseItem.id, batchId: batch.id, stageId: stage.id });

  assert.equal(result.status, 'complete');
  assert.equal(result.report.briefing.caseType, 'Спор об исполнительном производстве и оспаривании долга');
  assert.ok(result.report.briefing.parties.length);
  assert.ok(result.report.briefing.obligations.length);
  assert.ok(result.report.briefing.requests.length);
  assert.equal(result.report.dateAnchors[0].status, 'proposal');
  assert.ok(result.report.violations.some((item) => /уведом|получен/i.test(item.title)));
  assert.ok(result.report.draftPlan.some((item) => item.id === 'debt_challenge'));
  db.close();
});
