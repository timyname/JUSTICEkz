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
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      status TEXT NOT NULL,
      checksum TEXT NOT NULL,
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

  function addDocument({ caseId, stageId = null, originalName, storedPath, mimeType = null, status, checksum }) {
    const id = `document-${randomUUID()}`;
    database.prepare(`INSERT INTO documents
      (id, case_id, stage_id, original_name, stored_path, mime_type, status, checksum, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, caseId, stageId, originalName, storedPath, mimeType, status, checksum, now(),
    );
    return rowToObject(database.prepare('SELECT * FROM documents WHERE id = ?').get(id));
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
    addDocument,
    listMemories,
    listLegalMemories,
    addMessage,
    listMessages,
    addTask,
    listTasks,
    addParty,
    listParties,
    close: () => database.close(),
  };
}
