import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'data', 'seed', 'official-sources.json');

test('official source manifest covers the local civil and administrative legal baseline', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.jurisdiction, 'KZ');
  assert.ok(Array.isArray(manifest.sources));

  const byId = new Map(manifest.sources.map((source) => [source.id, source]));
  const required = [
    ['K2000000350', 'official_code'],
    ['P03000002S_', 'supreme_court_normative'],
    ['P03000005S_', 'supreme_court_normative'],
    ['P06000009S_', 'supreme_court_normative'],
    ['P170000001S', 'supreme_court_normative'],
    ['P220000006S', 'supreme_court_normative'],
    ['P160000001S', 'supreme_court_normative'],
    ['P240000005S', 'supreme_court_normative'],
    ['P260000002S', 'supreme_court_normative'],
    ['P09000002S_', 'supreme_court_normative'],
    ['P170000012S', 'supreme_court_normative'],
    ['P08000002S_', 'supreme_court_normative'],
    ['P09000008S_', 'supreme_court_normative'],
  ];

  for (const [id, kind] of required) {
    assert.equal(byId.get(id)?.kind, kind, `missing source ${id}`);
    assert.match(byId.get(id)?.effectiveFrom ?? '', /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('official source ids are valid Adilet document identifiers', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const source of manifest.sources) {
    assert.match(source.id, /^[A-Z]\d+[A-Z0-9_]*$/);
    assert.match(source.title, /\S/);
  }
});
