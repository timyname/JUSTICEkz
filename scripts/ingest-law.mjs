import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.mjs';
import { createDatabase } from '../src/core/db.mjs';

export function validateLegalRecord(record) {
  for (const field of ['title', 'content', 'sourceUrl', 'effectiveFrom']) {
    if (!record?.[field] || !String(record[field]).trim()) throw new Error(`${field} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.effectiveFrom)) throw new Error('effectiveFrom must be YYYY-MM-DD');
  if (record.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(record.effectiveTo)) throw new Error('effectiveTo must be YYYY-MM-DD');
  return record;
}

export function ingestLawRecord({ db, record }) {
  const valid = validateLegalRecord(record);
  const existing = db.listMemories({ scope: 'law' }).find((memory) => (
    memory.source_url === valid.sourceUrl
    && memory.effective_from === valid.effectiveFrom
    && memory.content === valid.content
  ));
  if (existing) return existing;
  return db.addMemory({
    scope: 'law', kind: valid.kind ?? 'legal_act', title: valid.number ? `${valid.number} · ${valid.title}` : valid.title,
    content: valid.content, sourceUrl: valid.sourceUrl, effectiveFrom: valid.effectiveFrom, effectiveTo: valid.effectiveTo ?? null,
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: npm run ingest:law -- path/to/law.json');
  const record = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8').replace(/^\uFEFF/, ''));
  const db = createDatabase({ dataDir: config.dataDir });
  try {
    const item = ingestLawRecord({ db, record });
    console.log(`Imported legal memory ${item.id}: ${item.title}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
