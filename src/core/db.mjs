import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_STAGES = [
  ['pretrial', 'Досудебка'],
  ['bailiff-complaint', 'Жалоба на ЧСИ'],
  ['claim', 'Исковое заявление'],
  ['hearing-prep', 'Подготовка к заседанию'],
  ['decision', 'Решение'],
  ['appeal', 'Апелляция'],
];

const now = () => new Date().toISOString();

function rowToObject(row) {
  return row ? { ...row } : null;
}

export function createDatabase({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(path.join(dataDir, 'justicekz.sqlite'));
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      title TEXT NOT NULL,
      action_date TEXT,
      current_stage_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      UNIQUE(case_id, code)
    );
    CREATE TABLE IF NOT EXISTS document_batches (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      total INTEGER NOT NULL DEFAULT 0,
      queued INTEGER NOT NULL DEFAULT 0,
      processing INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      ocr_count INTEGER NOT NULL DEFAULT 0,
      text_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'inventory',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      current_document_id TEXT,
      current_file_name TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS document_batches_case_idx ON document_batches(case_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      batch_id TEXT REFERENCES document_batches(id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      status TEXT NOT NULL,
      checksum TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER NOT NULL DEFAULT 0,
      extraction_error TEXT,
      started_at TEXT,
      processed_at TEXT,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('law', 'case')),
      case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      page_number INTEGER,
      source_url TEXT,
      effective_from TEXT,
      effective_to TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_scope_idx ON memories(scope, case_id);
    CREATE INDEX IF NOT EXISTS memories_effective_idx ON memories(effective_from, effective_to);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      memory_id UNINDEXED,
      title,
      content,
      scope UNINDEXED,
      case_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 0'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(case_id, token)
    );
    CREATE TABLE IF NOT EXISTS case_events (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      event_date TEXT,
      event_date_precision TEXT NOT NULL DEFAULT 'unknown',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      source_page INTEGER,
      status TEXT NOT NULL DEFAULT 'suggested',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS case_events_case_idx ON case_events(case_id, event_date, created_at);
    CREATE TABLE IF NOT EXISTS case_reviews (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL REFERENCES document_batches(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'inventory',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      summary TEXT,
      report_json TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS case_reviews_case_idx ON case_reviews(case_id, created_at DESC);
  `);

  const existingColumns = new Set(database.prepare('PRAGMA table_info(documents)').all().map((column) => column.name));
  const documentMigrations = [
    ['batch_id', 'TEXT REFERENCES document_batches(id) ON DELETE SET NULL'],
    ['progress', 'INTEGER NOT NULL DEFAULT 0'],
    ['page_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['extraction_error', 'TEXT'],
    ['started_at', 'TEXT'],
    ['processed_at', 'TEXT'],
  ];
  for (const [column, definition] of documentMigrations) {
    if (!existingColumns.has(column)) database.exec(`ALTER TABLE documents ADD COLUMN ${column} ${definition}`);
  }
  database.exec('CREATE INDEX IF NOT EXISTS documents_batch_idx ON documents(batch_id, imported_at)');
  database.exec(`
    UPDATE documents SET progress = 100
      WHERE progress = 0 AND status IN ('text_extracted', 'ocr_extracted');
    UPDATE documents SET page_count = COALESCE(
      (SELECT MAX(COALESCE(page_number, 1)) FROM memories WHERE memories.document_id = documents.id),
      page_count
    ) WHERE page_count = 0;
  `);

  function createCase({ title, number = '', actionDate = null }) {
    const id = `case-${randomUUID()}`;
    const timestamp = now();
    database.prepare(`INSERT INTO cases (id, number, title, action_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, number || id.slice(-8), title, actionDate, timestamp, timestamp);
    const insertStage = database.prepare(`INSERT INTO stages
      (id, case_id, code, title, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const stages = DEFAULT_STAGES.map(([code, stageTitle], position) => {
      const stage = { id: `stage-${randomUUID()}`, caseId: id, code, title: stageTitle, position, status: 'open' };
      insertStage.run(stage.id, id, code, stageTitle, position, timestamp);
      return stage;
    });
    database.prepare('UPDATE cases SET current_stage_id = ? WHERE id = ?').run(stages[0].id, id);
    return { id, number: number || id.slice(-8), title, actionDate, currentStageId: stages[0].id, stages };
  }

  function listCases() {
    return database.prepare('SELECT * FROM cases ORDER BY updated_at DESC').all().map(rowToObject);
  }

  function getCase(caseId) {
    return rowToObject(database.prepare('SELECT * FROM cases WHERE id = ?').get(caseId));
  }

  function listStages(caseId) {
    return database.prepare('SELECT * FROM stages WHERE case_id = ? ORDER BY position').all(caseId).map(rowToObject);
  }

  function setCurrentStage(caseId, stageId) {
    const stage = database.prepare('SELECT id FROM stages WHERE id = ? AND case_id = ?').get(stageId, caseId);
    if (!stage) throw new Error('Stage does not belong to this case');
    database.prepare('UPDATE cases SET current_stage_id = ?, updated_at = ? WHERE id = ?').run(stageId, now(), caseId);
    return getCase(caseId);
  }

  function addMemory({ scope, caseId = null, stageId = null, documentId = null, kind = 'note', title, content,
    pageNumber = null, sourceUrl = null, effectiveFrom = null, effectiveTo = null }) {
    if (!['law', 'case'].includes(scope)) throw new Error('Unknown memory scope');
    if (scope === 'case' && !caseId) throw new Error('Case memory requires caseId');
    if (scope === 'law' && caseId) throw new Error('Legal memory cannot belong to a case');
    const id = `memory-${randomUUID()}`;
    database.prepare(`INSERT INTO memories
      (id, scope, case_id, stage_id, document_id, kind, title, content, page_number, source_url, effective_from, effective_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, scope, caseId, stageId, documentId, kind, title, content, pageNumber, sourceUrl, effectiveFrom, effectiveTo, now(),
    );
    database.prepare('INSERT INTO memory_fts (memory_id, title, content, scope, case_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, title, content, scope, caseId ?? '');
    return rowToObject(database.prepare('SELECT * FROM memories WHERE id = ?').get(id));
  }

  function addBatch({ caseId, stageId = null, total = 0 }) {
    const id = `batch-${randomUUID()}`;
    const timestamp = now();
    database.prepare(`INSERT INTO document_batches
      (id, case_id, stage_id, total, queued, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, caseId, stageId, total, total, timestamp, timestamp);
    return getBatch(id);
  }

  function getBatch(batchId) {
    return rowToObject(database.prepare('SELECT * FROM document_batches WHERE id = ?').get(batchId));
  }

  function updateBatch(batchId, updates = {}) {
    const allowed = new Map([
      ['total', 'total'], ['queued', 'queued'], ['processing', 'processing'], ['completed', 'completed'],
      ['failed', 'failed'], ['ocrCount', 'ocr_count'], ['textCount', 'text_count'], ['status', 'status'],
      ['phase', 'phase'], ['progress', 'progress'], ['message', 'message'],
      ['currentDocumentId', 'current_document_id'], ['currentFileName', 'current_file_name'],
      ['startedAt', 'started_at'], ['completedAt', 'completed_at'], ['updatedAt', 'updated_at'],
    ]);
    const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
    if (!entries.length) return getBatch(batchId);
    entries.push(['updatedAt', 'updated_at']);
    const assignments = entries.map(([key]) => `${allowed.get(key)} = ?`).join(', ');
    const values = entries.map(([key, value]) => key === 'updatedAt' ? now() : value);
    database.prepare(`UPDATE document_batches SET ${assignments} WHERE id = ?`).run(...values, batchId);
    return getBatch(batchId);
  }

  function listBatches(caseId) {
    return database.prepare('SELECT * FROM document_batches WHERE case_id = ? ORDER BY created_at DESC').all(caseId).map(rowToObject);
  }

  function getActiveBatch(caseId) {
    return rowToObject(database.prepare(`SELECT * FROM document_batches
      WHERE case_id = ? AND status IN ('queued', 'extracting', 'reviewing')
      ORDER BY created_at DESC LIMIT 1`).get(caseId));
  }

  function listBatchDocuments(batchId) {
    return database.prepare('SELECT * FROM documents WHERE batch_id = ? ORDER BY imported_at, rowid').all(batchId).map(rowToObject);
  }

  function addReview({ caseId, batchId }) {
    const id = `review-${randomUUID()}`;
    const timestamp = now();
    database.prepare(`INSERT INTO case_reviews
      (id, case_id, batch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, caseId, batchId, timestamp, timestamp);
    return getReview(id);
  }

  function getReview(reviewId) {
    const row = rowToObject(database.prepare('SELECT * FROM case_reviews WHERE id = ?').get(reviewId));
    if (!row) return null;
    return { ...row, report: row.report_json ? JSON.parse(row.report_json) : null };
  }

  function updateReview(reviewId, updates = {}) {
    const allowed = new Map([
      ['status', 'status'], ['phase', 'phase'], ['progress', 'progress'], ['message', 'message'],
      ['summary', 'summary'], ['report', 'report_json'], ['completedAt', 'completed_at'], ['updatedAt', 'updated_at'],
    ]);
    const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
    if (!entries.length) return getReview(reviewId);
    entries.push(['updatedAt', 'updated_at']);
    const assignments = entries.map(([key]) => `${allowed.get(key)} = ?`).join(', ');
    const values = entries.map(([key, value]) => {
      if (key === 'updatedAt') return now();
      if (key === 'report') return value == null ? null : JSON.stringify(value);
      return value;
    });
    database.prepare(`UPDATE case_reviews SET ${assignments} WHERE id = ?`).run(...values, reviewId);
    return getReview(reviewId);
  }

  function getLatestReview(caseId) {
    const row = rowToObject(database.prepare('SELECT * FROM case_reviews WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').get(caseId));
    if (!row) return null;
    return { ...row, report: row.report_json ? JSON.parse(row.report_json) : null };
  }

  function addDocument({ caseId, stageId = null, batchId = null, originalName, storedPath, mimeType = null, status, checksum,
    progress = 0, pageCount = 0, extractionError = null, startedAt = null, processedAt = null }) {
    const id = `document-${randomUUID()}`;
    database.prepare(`INSERT INTO documents
      (id, case_id, stage_id, batch_id, original_name, stored_path, mime_type, status, checksum, progress, page_count,
       extraction_error, started_at, processed_at, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, caseId, stageId, batchId, originalName, storedPath, mimeType, status, checksum, progress, pageCount,
      extractionError, startedAt, processedAt, now(),
    );
    return rowToObject(database.prepare('SELECT * FROM documents WHERE id = ?').get(id));
  }

  function updateDocument(documentId, updates = {}) {
    const allowed = new Map([
      ['status', 'status'], ['progress', 'progress'], ['pageCount', 'page_count'],
      ['extractionError', 'extraction_error'], ['startedAt', 'started_at'], ['processedAt', 'processed_at'],
    ]);
    const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
    if (!entries.length) return rowToObject(database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId));
    const assignments = entries.map(([key]) => `${allowed.get(key)} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    database.prepare(`UPDATE documents SET ${assignments} WHERE id = ?`).run(...values, documentId);
    return rowToObject(database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId));
  }

  function getDocument(documentId) {
    return rowToObject(database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId));
  }

  function listDocuments(caseId) {
    return database.prepare('SELECT * FROM documents WHERE case_id = ? ORDER BY imported_at, rowid').all(caseId).map(rowToObject);
  }

  function addEvent({ caseId, documentId = null, stageId = null, eventDate = null, eventDatePrecision = 'unknown',
    title, description, sourcePage = null, status = 'suggested' }) {
    const existing = database.prepare(`SELECT * FROM case_events
      WHERE case_id = ? AND document_id IS ? AND event_date IS ? AND description = ?`).get(caseId, documentId, eventDate, description);
    if (existing) return rowToObject(existing);
    const id = `event-${randomUUID()}`;
    database.prepare(`INSERT INTO case_events
      (id, case_id, document_id, stage_id, event_date, event_date_precision, title, description, source_page, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, caseId, documentId, stageId, eventDate, eventDatePrecision, title, description, sourcePage, status, now(),
    );
    return rowToObject(database.prepare('SELECT * FROM case_events WHERE id = ?').get(id));
  }

  function listEvents(caseId) {
    return database.prepare(`SELECT case_events.*, documents.original_name
      FROM case_events LEFT JOIN documents ON documents.id = case_events.document_id
      WHERE case_events.case_id = ? ORDER BY event_date IS NULL, event_date, source_page IS NULL, source_page, created_at`).all(caseId).map(rowToObject);
  }

  function listMemories({ scope, caseId = null } = {}) {
    const clauses = [];
    const params = [];
    if (scope) { clauses.push('scope = ?'); params.push(scope); }
    if (caseId) { clauses.push('case_id = ?'); params.push(caseId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return database.prepare(`SELECT * FROM memories ${where} ORDER BY created_at`).all(...params).map(rowToObject);
  }

  function listLegalMemories({ asOf = now().slice(0, 10) } = {}) {
    return database.prepare(`SELECT * FROM memories
      WHERE scope = 'law'
        AND (effective_from IS NULL OR effective_from <= ?)
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY title, effective_from DESC`).all(asOf, asOf).map(rowToObject);
  }

  function addMessage({ caseId, role, content }) {
    const id = `message-${randomUUID()}`;
    database.prepare('INSERT INTO messages (id, case_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, caseId, role, content, now());
    return rowToObject(database.prepare('SELECT * FROM messages WHERE id = ?').get(id));
  }

  function listMessages(caseId) {
    return database.prepare('SELECT * FROM messages WHERE case_id = ? ORDER BY created_at, rowid').all(caseId).map(rowToObject);
  }

  function addTask({ caseId, stageId = null, title, status = 'open', source = null }) {
    const id = `task-${randomUUID()}`;
    database.prepare('INSERT INTO tasks (id, case_id, stage_id, title, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, caseId, stageId, title, status, source, now());
    return rowToObject(database.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  }

  function listTasks(caseId) {
    return database.prepare('SELECT * FROM tasks WHERE case_id = ? ORDER BY status, created_at').all(caseId).map(rowToObject);
  }

  function deleteTasksBySourcePrefix(caseId, prefix) {
    database.prepare('DELETE FROM tasks WHERE case_id = ? AND source LIKE ?').run(caseId, `${prefix}%`);
  }

  function addParty({ caseId, token, encryptedValue, kind = 'identifier' }) {
    const id = `party-${randomUUID()}`;
    database.prepare(`INSERT INTO parties (id, case_id, token, encrypted_value, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id, token) DO UPDATE SET encrypted_value = excluded.encrypted_value, kind = excluded.kind`)
      .run(id, caseId, token, encryptedValue, kind, now());
    return rowToObject(database.prepare('SELECT * FROM parties WHERE case_id = ? AND token = ?').get(caseId, token));
  }

  function listParties(caseId) {
    return database.prepare('SELECT * FROM parties WHERE case_id = ? ORDER BY token').all(caseId).map(rowToObject);
  }

  return {
    raw: database,
    createCase,
    listCases,
    getCase,
    listStages,
    setCurrentStage,
    addMemory,
    addBatch,
    updateBatch,
    getBatch,
    listBatches,
    getActiveBatch,
    listBatchDocuments,
    addReview,
    updateReview,
    getReview,
    getLatestReview,
    addDocument,
    updateDocument,
    getDocument,
    listDocuments,
    addEvent,
    listEvents,
    listMemories,
    listLegalMemories,
    addMessage,
    listMessages,
    addTask,
    listTasks,
    deleteTasksBySourcePrefix,
    addParty,
    listParties,
    close: () => database.close(),
  };
}
