import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('chat does not render a user message before the server accepts it', () => {
  assert.doesNotMatch(appSource, /class="message user"/);
});

test('upload status uses a Russian document-count formatter', () => {
  assert.match(appSource, /formatDocumentCount/);
});

test('large case lists keep a bounded visible window', () => {
  assert.match(appSource, /VISIBLE_DOCUMENT_LIMIT/);
  assert.match(appSource, /VISIBLE_EVENT_LIMIT/);
});

test('compact case workspace has a briefing, goal gate, and grouped document warnings', () => {
  assert.match(appSource, /case-briefing/);
  assert.match(appSource, /goal-panel/);
  assert.match(appSource, /warningDocuments/);
  assert.match(appSource, /compact-disclosure/);
});

test('chat exposes concise evidence status instead of hidden reasoning', () => {
  assert.match(appSource, /Краткая карта дела/);
  assert.doesNotMatch(appSource, /цепочк|chain.of.thought/i);
});
