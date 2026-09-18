import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOfficialDocument } from '../src/core/legal-source.mjs';

test('normalizes the full text returned by the Adilet document API', () => {
  const record = normalizeOfficialDocument({
    id: 'uuid-1',
    group_number: 'P03000005S_',
    title_ru: 'О судебном решении по гражданским делам',
    text_content: '<!DOCTYPE html><article><p id="z1">&nbsp;1. Судебный акт <a href="/rus/docs/K1500000377">обязателен</a>.</p></article>',
  }, {
    id: 'P03000005S_',
    slug: 'supreme-court-civil-judgment',
    kind: 'supreme_court_normative',
    title: 'О судебном решении по гражданским делам',
    effectiveFrom: '2003-07-11',
  }, { downloadedAt: '2026-09-19T00:00:00.000Z', sourceSha256: 'abc123' });

  assert.equal(record.sourceId, 'P03000005S_');
  assert.equal(record.kind, 'supreme_court_normative');
  assert.equal(record.effectiveFrom, '2003-07-11');
  assert.match(record.content, /1\. Судебный акт обязателен/);
  assert.doesNotMatch(record.content, /<article|<a |&nbsp;/);
  assert.equal(record.sourceSha256, 'abc123');
});

test('rejects an Adilet response without a legal text payload', () => {
  assert.throws(() => normalizeOfficialDocument({ id: 'uuid-2' }, {
    id: 'K2000000350', slug: 'appk', kind: 'official_code', title: 'АППК', effectiveFrom: '2020-06-29',
  }), /text_content/);
});
