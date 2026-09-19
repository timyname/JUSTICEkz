import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { rebuildCaseAnalysis } from '../scripts/rebuild-case-analysis.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-rebuild-'));
}

test('case analysis rebuild replaces derived chronology and review without touching document memory', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Пересборка дела' });
  const stage = db.listStages(caseItem.id)[0];
  const batch = db.addBatch({ caseId: caseItem.id, stageId: stage.id, total: 1 });
  const document = db.addDocument({
    caseId: caseItem.id,
    stageId: stage.id,
    batchId: batch.id,
    originalName: 'материалы.txt',
    storedPath: 'материалы.txt',
    status: 'text_extracted',
    checksum: 'text',
    progress: 100,
  });
  db.addMemory({ scope: 'case', caseId: caseItem.id, stageId: stage.id, documentId: document.id, kind: 'document_chunk', title: 'материалы.txt', content: 'Дата рождения: 30.12.1993\nПостановление ЧСИ от 14.08.2026.' });
  db.addEvent({ caseId: caseItem.id, stageId: stage.id, documentId: document.id, eventDate: '1993-12-30', title: 'Старая дата', description: 'Старая дата' });
  const oldReview = db.addReview({ caseId: caseItem.id, batchId: batch.id });
  db.updateReview(oldReview.id, { status: 'complete', report: { findings: ['устаревший отчёт'] } });
  db.addMemory({ scope: 'case', caseId: caseItem.id, kind: 'case_review', title: 'Старый отчёт', content: 'устаревший отчёт' });
  db.addTask({ caseId: caseItem.id, stageId: stage.id, title: 'Устаревшая задача', source: `review:${batch.id}` });

  const result = await rebuildCaseAnalysis({ db, caseId: caseItem.id });

  assert.deepEqual(result.events.map((event) => event.event_date), ['2026-08-14']);
  assert.equal(db.listMemories({ scope: 'case', caseId: caseItem.id }).filter((memory) => memory.kind === 'document_chunk').length, 1);
  assert.equal(db.getLatestReview(caseItem.id).report.findings[0], 'Проверено 1 документ: текст извлечён из 1, OCR выполнен для 0.');
  assert.equal(db.listTasks(caseItem.id).some((task) => task.title === 'Устаревшая задача'), false);
  db.close();
});
