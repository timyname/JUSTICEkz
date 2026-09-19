import { prepareDocument, processPreparedDocument } from './ingest.mjs';

export function createDocumentQueue({ db, dataDir, reviewService = null, onProgress = null }) {
  const pending = [];
  let running = false;
  let drainPromise = Promise.resolve();

  function refreshBatch(batchId, { phase = null, progress = null, message = null, currentDocumentId = null, currentFileName = null } = {}) {
    const batch = db.getBatch(batchId);
    if (!batch) return null;
    const documents = db.listBatchDocuments(batchId);
    const terminal = new Set(['text_extracted', 'ocr_extracted', 'ocr_pending', 'converter_pending', 'unsupported', 'extraction_failed']);
    const completed = documents.filter((document) => terminal.has(document.status));
    const failed = documents.filter((document) => ['ocr_pending', 'converter_pending', 'unsupported', 'extraction_failed'].includes(document.status));
    const processing = documents.filter((document) => document.status === 'processing');
    const queued = documents.filter((document) => document.status === 'queued');
    const ocrCount = documents.filter((document) => document.status === 'ocr_extracted').length;
    const textCount = documents.filter((document) => document.status === 'text_extracted').length;
    const activeDocumentProgress = processing.length ? (Number(progress) || 0) / 100 : 0;
    const documentProgress = batch.total ? Math.round(((completed.length + activeDocumentProgress) / batch.total) * 75) : 0;
    return db.updateBatch(batchId, {
      queued: queued.length,
      processing: processing.length,
      completed: completed.length,
      failed: failed.length,
      ocrCount,
      textCount,
      progress: batch.status === 'extracting' ? documentProgress : Math.max(batch.progress, documentProgress),
      ...(phase ? { phase } : {}),
      ...(message ? { message } : {}),
      ...(currentDocumentId ? { currentDocumentId } : {}),
      ...(currentFileName ? { currentFileName } : {}),
    });
  }

  function notify(update) {
    if (typeof onProgress === 'function') onProgress(update);
  }

  async function drain() {
    running = true;
    while (pending.length) {
      const job = pending.shift();
      try {
        db.updateBatch(job.batchId, {
          status: 'extracting', phase: 'inventory', startedAt: db.getBatch(job.batchId)?.started_at ?? new Date().toISOString(),
          currentDocumentId: job.documentId, currentFileName: job.prepared.fileName,
          message: `Подготовка документа ${job.prepared.fileName}`,
        });
        job.result = await processPreparedDocument(job.prepared, {
          onProgress: (update) => {
            refreshBatch(job.batchId, { ...update, currentDocumentId: job.documentId, currentFileName: job.prepared.fileName });
            notify({ batchId: job.batchId, ...update, documentId: job.documentId, fileName: job.prepared.fileName });
          },
        });
        job.documentId = job.result.id;
      } catch (error) {
        job.error = error;
      }
      const current = refreshBatch(job.batchId, { currentDocumentId: job.documentId, currentFileName: job.prepared.fileName });
      notify({ batchId: job.batchId, phase: current?.phase, progress: current?.progress, message: current?.message, documentId: job.documentId, fileName: job.prepared.fileName });
      if (!pending.some((item) => item.batchId === job.batchId)) {
        await finishBatch(job.batchId, job.prepared.stageId);
      }
    }
    running = false;
  }

  async function finishBatch(batchId, stageId) {
    const batch = refreshBatch(batchId, { phase: 'review', message: 'Документы разобраны. Проверяю полноту материалов и строю рабочую позицию.' });
    db.updateBatch(batchId, { status: 'reviewing', phase: 'review', progress: Math.max(batch?.progress ?? 0, 76), message: 'Документы разобраны. Проверяю полноту материалов и строю рабочую позицию.' });
    if (reviewService?.run) {
      try {
        await reviewService.run({ caseId: batch.case_id, batchId, stageId: stageId ?? batch.stage_id });
      } catch (error) {
        db.updateBatch(batchId, { status: 'failed', phase: 'review', message: `Первичный анализ не завершён: ${error.message}`, completedAt: new Date().toISOString() });
        notify({ batchId, phase: 'review', progress: batch.progress, message: error.message });
      }
    } else {
      db.updateBatch(batchId, { status: batch.failed ? 'complete_with_errors' : 'complete', phase: 'complete', progress: 100, message: 'Обработка документов завершена.', completedAt: new Date().toISOString() });
    }
    notify({ batchId, status: db.getBatch(batchId)?.status, phase: db.getBatch(batchId)?.phase, progress: db.getBatch(batchId)?.progress, message: db.getBatch(batchId)?.message });
  }

  function enqueueBatch({ caseId, stageId = null, documents }) {
    if (!caseId || !Array.isArray(documents) || !documents.length) throw new Error('caseId and documents are required');
    const batch = db.addBatch({ caseId, stageId, total: documents.length });
    const jobs = documents.map((document) => {
      const prepared = prepareDocument({ db, dataDir, caseId, stageId, batchId: batch.id, fileName: document.fileName, mimeType: document.mimeType ?? null, buffer: document.buffer });
      return { prepared, batchId: batch.id, documentId: prepared.document.id };
    });
    pending.push(...jobs);
    if (!running) drainPromise = drain();
    jobs.batchId = batch.id;
    jobs.batch = batch;
    return jobs;
  }

  async function idle() {
    await drainPromise;
    if (pending.length) return idle();
    return true;
  }

  return { enqueueBatch, idle, get running() { return running; } };
}
