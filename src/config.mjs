import path from 'node:path';

const portValue = Number.parseInt(process.env.JUSTICE_PORT ?? '4317', 10);

export const config = Object.freeze({
  port: Number.isFinite(portValue) ? portValue : 4317,
  host: process.env.JUSTICE_HOST ?? '127.0.0.1',
  dataDir: path.resolve(process.env.JUSTICE_DATA_DIR ?? path.join(process.cwd(), '.justicekz', 'data')),
  modelUrl: process.env.JUSTICE_MODEL_URL?.trim() || null,
  modelName: process.env.JUSTICE_MODEL_NAME?.trim() || null,
  sourceDir: path.resolve(process.env.JUSTICE_SOURCE_DIR ?? path.join(process.cwd(), 'data', 'seed')),
});
