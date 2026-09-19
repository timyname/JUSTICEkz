import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { config } from '../src/config.mjs';
import { createDatabase } from '../src/core/db.mjs';
import { extractSuggestedEvents } from '../src/core/ingest.mjs';
import { createCaseReviewService } from '../src/core/case-review.mjs';

function rebuildEvents({ db, caseId, documents, memories }) {
  db.raw.prepare('DELETE FROM case_events WHERE case_id = ?').run(caseId);
  for (const document of documents) {
    const pages = new Map();
    for (const memory of memories.filter((item) => item.document_id === document.id)) {
      const page = memory.page_number || 1;
      pages.set(page, `${pages.get(page) ?? ''}${pages.has(page) ? '\n' : ''}${memory.content}`);
    }
    const text = [...pages.entries()].sort(([left], [right]) => left - right).map(([, content]) => content).join('\f');
    for (const event of extractSuggestedEvents(text, { fileName: document.original_name })) {
      db.addEvent({ caseId, stageId: document.stage_id, documentId: document.id, ...event });
    }
  }
}

export async function rebuildCaseAnalysis({ db, caseId }) {
  const caseItem = db.getCase(caseId);
  if (!caseItem) throw new Error(`Дело не найдено: ${caseId}`);
  const documents = db.listDocuments(caseId);
  const memories = db.listMemories({ scope: 'case', caseId });

  const oldReviewMemoryIds = memories.filter((memory) => memory.kind === 'case_review').map((memory) => memory.id);
  db.raw.exec('BEGIN');
  try {
    rebuildEvents({ db, caseId, documents, memories });
    for (const memoryId of oldReviewMemoryIds) db.raw.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(memoryId);
    db.raw.prepare("DELETE FROM memories WHERE scope = 'case' AND case_id = ? AND kind = 'case_review'").run(caseId);
    db.raw.prepare('DELETE FROM case_reviews WHERE case_id = ?').run(caseId);
    db.deleteTasksBySourcePrefix(caseId, 'review:');
    db.raw.exec('COMMIT');
  } catch (error) {
    db.raw.exec('ROLLBACK');
    throw error;
  }

  const batch = db.listBatches(caseId)[0];
  const review = batch
    ? await createCaseReviewService({ db, model: null }).run({ caseId, batchId: batch.id, stageId: batch.stage_id })
    : null;
  return { events: db.listEvents(caseId), review };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const caseId = process.argv[2];
  if (!caseId) throw new Error('Использование: node scripts/rebuild-case-analysis.mjs case-id');
  const db = createDatabase({ dataDir: config.dataDir });
  try {
    const result = await rebuildCaseAnalysis({ db, caseId });
    console.log(`Хронология пересобрана: ${result.events.length} событий`);
    console.log(result.review ? `Первичный разбор обновлён: ${result.review.status}` : 'Пакет документов для повторного разбора не найден');
  } finally {
    db.close();
  }
}
