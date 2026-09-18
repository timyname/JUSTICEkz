function normalizeTokens(text) {
  return String(text ?? '')
    .toLocaleLowerCase('ru-RU')
    .replace(/[.,;:!?()[\]{}"'«»/\\]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function toFtsQuery(text) {
  return [...new Set(normalizeTokens(text))]
    .filter((token) => token.length > 1)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' OR ');
}

function excerptContent(content, query, maxChars = 1800) {
  const source = String(content ?? '');
  if (source.length <= maxChars) return source;
  const lower = source.toLocaleLowerCase('ru-RU');
  const hit = normalizeTokens(query)
    .filter((token) => token.length > 2)
    .map((token) => lower.indexOf(token))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const radius = 500;
  const start = Math.max(0, Math.min(hit - radius, source.length - maxChars));
  const prefix = start > 0 ? '…' : '';
  const suffix = start + maxChars < source.length ? '…' : '';
  const windowSize = Math.max(1, maxChars - prefix.length - suffix.length);
  const adjustedStart = Math.min(start, source.length - windowSize);
  const end = Math.min(source.length, adjustedStart + windowSize);
  return `${prefix}${source.slice(adjustedStart, end)}${suffix}`;
}

function withExcerpts(rows, query) {
  return rows.map((row) => ({ ...row, content: excerptContent(row.content, query) }));
}

function scopedSearch({ db, query, scope, caseId, asOf, limit }) {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  const clauses = ['memory_fts MATCH ?', 'm.scope = ?'];
  const params = [ftsQuery, scope];
  if (scope === 'case') {
    clauses.push('m.case_id = ?');
    params.push(caseId);
  }
  if (scope === 'law') {
    clauses.push('(m.effective_from IS NULL OR m.effective_from <= ?)');
    clauses.push('(m.effective_to IS NULL OR m.effective_to >= ?)');
    params.push(asOf, asOf);
  }
  params.push(limit);
  const ftsRows = db.raw.prepare(`SELECT m.*, bm25(memory_fts) AS rank
    FROM memory_fts JOIN memories AS m ON m.id = memory_fts.memory_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY rank, m.created_at DESC LIMIT ?`).all(...params);
  if (ftsRows.length) return withExcerpts(ftsRows, query);

  // SQLite builds on small Windows installations may not tokenize Cyrillic consistently.
  // Keep a deterministic in-process fallback so Russian/Kazakh text remains searchable.
  const tokens = normalizeTokens(query);
  const searchForms = tokens.flatMap((token) => token.length > 6 ? [token, token.slice(0, -2)] : [token]);
  const candidates = scope === 'law'
    ? db.listLegalMemories({ asOf })
    : db.listMemories({ scope: 'case', caseId });
  const results = candidates.map((item) => {
    const haystack = `${item.title} ${item.content}`.toLocaleLowerCase('ru-RU');
    const score = searchForms.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
    return { ...item, rank: -score };
  }).filter((item) => item.rank < 0).sort((a, b) => a.rank - b.rank).slice(0, limit);
  return withExcerpts(results, query);
}

export function searchMemories({ db, query, caseId, asOf, limit = 8 }) {
  return {
    caseDocuments: scopedSearch({ db, query, scope: 'case', caseId, asOf, limit }),
    legalSources: scopedSearch({ db, query, scope: 'law', asOf, limit }),
  };
}
