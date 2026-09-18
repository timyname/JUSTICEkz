import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDraftMarkdown, buildPrintableHtml, buildDocx } from '../src/core/export.mjs';

const draft = {
  caseTitle: 'Спор с ЧСИ',
  caseNumber: '2026-001',
  stageTitle: 'Досудебка',
  asOf: '2026-08-14',
  messages: [{ role: 'user', content: 'Проверить постановление' }],
  sources: [{ title: 'ГПК РК', content: 'Порядок обжалования', source_url: 'https://adilet.zan.kz/' }],
  caseDocuments: [{ title: 'Постановление ЧСИ', content: 'Срок исполнения 10 дней' }],
};

test('draft markdown and printable HTML contain the case boundary and disclaimer', () => {
  const markdown = buildDraftMarkdown(draft);
  const html = buildPrintableHtml(draft);
  assert.match(markdown, /Спор с ЧСИ/);
  assert.match(markdown, /ГПК РК/);
  assert.match(markdown, /черновик/i);
  assert.match(html, /Постановление ЧСИ/);
  assert.match(html, /Проверить постановление/);
});

test('DOCX export is a readable ZIP package with document text', () => {
  const docx = buildDocx(draft);
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  assert.match(docx.toString('utf8'), /Спор с ЧСИ/);
  assert.match(docx.toString('utf8'), /ГПК РК/);
});
