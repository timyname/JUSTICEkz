import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();
const portValue = Number.parseInt(process.env.JUSTICE_PORT ?? '4317', 10);

export const config = Object.freeze({
  port: Number.isFinite(portValue) ? portValue : 4317,
  host: process.env.JUSTICE_HOST ?? '127.0.0.1',
  dataDir: path.resolve(process.env.JUSTICE_DATA_DIR ?? path.join(process.cwd(), '.justicekz', 'data')),
  modelUrl: process.env.JUSTICE_MODEL_URL?.trim() || null,
  modelName: process.env.JUSTICE_MODEL_NAME?.trim() || null,
  sourceDir: path.resolve(process.env.JUSTICE_SOURCE_DIR ?? path.join(process.cwd(), 'data', 'seed')),
});
