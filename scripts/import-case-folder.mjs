import process from 'node:process';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const folder = option('--folder');
const title = option('--title') ?? 'Импортированное дело';
const base = option('--url') ?? 'http://127.0.0.1:4317';
if (!folder) throw new Error('Использование: node scripts/import-case-folder.mjs --folder "C:\\путь\\к\\папке" [--title "Название"]');

async function request(route, options = {}) {
  const response = await fetch(`${base}${route}`, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

const created = await request('/api/cases', { method: 'POST', body: JSON.stringify({ title }) });
const caseId = created.case.id;
const imported = await request(`/api/cases/${encodeURIComponent(caseId)}/documents/folder`, {
  method: 'POST', body: JSON.stringify({ folderPath: folder, stageId: created.case.current_stage_id }),
});
console.log(`Дело: ${caseId}`);
console.log(`Batch: ${imported.batchId}`);
console.log(`Найдено поддерживаемых файлов: ${imported.fileCount}`);

let lastMessage = '';
for (;;) {
  const status = await request(`/api/cases/${encodeURIComponent(caseId)}/document-batches/${encodeURIComponent(imported.batchId)}`);
  const batch = status.batch;
  if (batch.message !== lastMessage || ['complete', 'complete_with_errors', 'failed'].includes(batch.status)) {
    lastMessage = batch.message;
    const progress = ['complete', 'complete_with_errors'].includes(batch.status)
      ? 100
      : batch.status === 'reviewing'
        ? Math.max(76, batch.progress || 0)
        : Math.min(75, Math.floor((batch.completed / Math.max(1, batch.total)) * 75));
    console.log(`[${progress}%] ${batch.completed}/${batch.total} · ${batch.message}`);
  }
  if (['complete', 'complete_with_errors', 'failed'].includes(batch.status)) {
    const documents = status.documents;
    const errors = documents.filter((document) => document.extraction_error);
    console.log(`Готово: ${batch.status}; OCR: ${batch.ocr_count}; обычный текст: ${batch.text_count}; ошибок: ${errors.length}`);
    if (status.review?.report) {
      console.log(`Задач первичного разбора: ${status.review.report.nextTasks.length}`);
      console.log(`Пробелов для проверки: ${status.review.report.gaps.length}`);
    }
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
