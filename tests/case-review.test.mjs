import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { createCaseReviewService } from '../src/core/case-review.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-review-'));
}

test('case review produces findings, gaps, tasks, and permanent memory', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Оспаривание действий ЧСИ' });
  const stage = db.listStages(caseItem.id)[0];
  const batch = db.addBatch({ caseId: caseItem.id, stageId: stage.id, total: 2 });
  db.addDocument({ caseId: caseItem.id, stageId: stage.id, batchId: batch.id, originalName: 'иск.txt', storedPath: 'isk.txt', status: 'text_extracted', checksum: 'a', progress: 100 });
  db.addDocument({ caseId: caseItem.id, stageId: stage.id, batchId: batch.id, originalName: 'постановление ЧСИ.txt', storedPath: 'post.txt', status: 'text_extracted', checksum: 'b', progress: 100 });
  db.addMemory({ scope: 'case', caseId: caseItem.id, title: 'иск.txt', content: 'Административный иск подан 14.08.2026.' });
  const reviewService = createCaseReviewService({ db, model: null });
  const result = await reviewService.run({ caseId: caseItem.id, batchId: batch.id, stageId: stage.id });
  assert.equal(result.status, 'complete');
  assert.ok(result.report.findings.length);
  assert.match(result.report.findings[1], /датированных предложений/);
  assert.ok(result.report.gaps.length);
  assert.ok(result.report.nextTasks.length);
  assert.ok(db.listMemories({ scope: 'case', caseId: caseItem.id }).some((item) => item.kind === 'case_review'));
  assert.ok(db.listTasks(caseItem.id).length);
  db.close();
});

test('case review uses singular wording for one failed document', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Один непрочитанный файл' });
  const stage = db.listStages(caseItem.id)[0];
  const batch = db.addBatch({ caseId: caseItem.id, stageId: stage.id, total: 1 });
  db.addDocument({
    caseId: caseItem.id,
    stageId: stage.id,
    batchId: batch.id,
    originalName: 'скан.jpg',
    storedPath: 'скан.jpg',
    status: 'ocr_pending',
    checksum: 'scan',
    progress: 100,
  });
  const result = await createCaseReviewService({ db, model: null }).run({ caseId: caseItem.id, batchId: batch.id, stageId: stage.id });

  assert.match(result.report.findings[0], /^Проверено 1 документ:/);
  assert.ok(result.report.gaps.some((item) => item.startsWith('Проверить 1 файл, который')));
  assert.match(db.getBatch(batch.id).message, /1 файл требует/);
  db.close();
});
