import { prepareDocument, processPreparedDocument } from './ingest.mjs';

export function createDocumentQueue({ db, dataDir }) {
  const pending = [];
  let running = false;
  let drainPromise = Promise.resolve();

  async function drain() {
    running = true;
    while (pending.length) {
      const job = pending.shift();
      try {
        job.result = await processPreparedDocument(job.prepared);
        job.documentId = job.result.id;
      } catch (error) {
        job.error = error;
      }
    }
    running = false;
  }

  function enqueueBatch({ caseId, stageId = null, documents }) {
    if (!caseId || !Array.isArray(documents) || !documents.length) throw new Error('caseId and documents are required');
    const jobs = documents.map((document) => {
      const prepared = prepareDocument({ db, dataDir, caseId, stageId, fileName: document.fileName, mimeType: document.mimeType ?? null, buffer: document.buffer });
      return { prepared, documentId: prepared.document.id };
    });
    pending.push(...jobs);
    if (!running) drainPromise = drain();
    return jobs;
  }

  async function idle() {
    await drainPromise;
    if (pending.length) return idle();
    return true;
  }

  return { enqueueBatch, idle, get running() { return running; } };
}
