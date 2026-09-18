import test from 'node:test';
import assert from 'node:assert/strict';

test('config uses a local data directory and stable default port', async () => {
  const { config } = await import('../src/config.mjs');

  assert.equal(config.port, 4317);
  assert.match(config.dataDir, /\.justicekz/);
  assert.equal(config.modelUrl, process.env.JUSTICE_MODEL_URL?.trim() || null);
});
