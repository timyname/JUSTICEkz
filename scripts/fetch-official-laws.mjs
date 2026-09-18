import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { normalizeOfficialDocument } from '../src/core/legal-source.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'user-agent': 'JUSTICEkz', accept: 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return response.json();
}

async function findCurrentDocument(source) {
  const body = {
    query: source.title,
    filters: { is_actual: true, language: 'rus', in_force: true },
    page: 1,
    page_size: 100,
    enable_fuzzy: false,
  };
  const result = await requestJson('https://adilet.zan.kz/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const match = (result.results ?? []).find((item) => item.group_number === source.id && item.is_actual && item.in_force);
  if (!match?.id) throw new Error(`No current Russian Adilet document found for ${source.id} (${source.title})`);
  return requestJson(`https://adilet.zan.kz/api/documents/${match.id}`);
}

async function main() {
  const dataDir = path.resolve(projectRoot, argument('--data-dir', '.justicekz/data'));
  const manifestPath = path.resolve(projectRoot, argument('--manifest', 'data/seed/official-sources.json'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const sourceDir = path.join(dataDir, 'legal', 'official');
  const rawDir = path.join(sourceDir, 'raw');
  const recordDir = path.join(sourceDir, 'records');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(recordDir, { recursive: true });

  for (const source of manifest.sources ?? []) {
    const apiResponse = await findCurrentDocument(source);
    const raw = JSON.stringify(apiResponse, null, 2);
    const sourceSha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const downloadedAt = new Date().toISOString();
    const rawPath = path.join(rawDir, `${source.slug}.api.json`);
    const recordPath = path.join(recordDir, `${source.slug}.json`);
    const metaPath = path.join(sourceDir, `${source.slug}.source.json`);
    fs.writeFileSync(rawPath, `${raw}\n`, 'utf8');
    const document = apiResponse.document ?? apiResponse;
    const record = normalizeOfficialDocument(document, source, { downloadedAt, sourceSha256 });
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.writeFileSync(metaPath, `${JSON.stringify({
      slug: source.slug,
      id: source.id,
      kind: source.kind,
      title: source.title,
      sourceUrl: record.sourceUrl,
      apiDocumentId: document.id,
      downloadedAt,
      sha256: sourceSha256,
      rawFile: rawPath,
      recordFile: recordPath,
      effectiveFrom: source.effectiveFrom,
      currentRevisionDate: document.updated_at ?? null,
      currentStatus: document.status ?? null,
      snapshotNote: 'Current Russian consolidated text from the official Adilet API. Import a separately dated snapshot for historical analysis.',
    }, null, 2)}\n`, 'utf8');
    console.log(`${source.slug}: ${source.id} ${sourceSha256}`);
  }
  console.log(`Official sources downloaded: ${manifest.sources?.length ?? 0}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
