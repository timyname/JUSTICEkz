function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function escapeHtml(value) {
  return escapeXml(value);
}

export function buildDraftMarkdown({ caseTitle, caseNumber, stageTitle, asOf, messages = [], sources = [], caseDocuments = [] }) {
  const lines = [
    `# ${caseTitle}`,
    '',
    `- Номер: ${caseNumber || 'не указан'}`,
    `- Этап: ${stageTitle || 'не указан'}`,
    `- Дата правового анализа: ${asOf}`,
    '',
    '> ЧЕРНОВИК. Проверьте факты, даты, редакции норм и процессуальные сроки перед использованием.',
    '',
    '## Вопросы и сообщения',
    ...messages.map((message) => `- **${message.role === 'user' ? 'Пользователь' : 'JUSTICEkz'}:** ${message.content}`),
    '',
    '## Материалы дела',
    ...caseDocuments.map((item) => `- **${item.title}:** ${item.content}`),
    '',
    '## Источники права',
    ...sources.map((source) => `- **${source.title}:** ${source.content}${source.source_url ? ` (${source.source_url})` : ''}`),
  ];
  return lines.join('\n');
}

export function buildPrintableHtml(draft) {
  const markdown = buildDraftMarkdown(draft);
  const paragraphs = markdown.split('\n').map((line) => {
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith('- ')) return `<p>${escapeHtml(line.slice(2))}</p>`;
    if (line.startsWith('> ')) return `<div class="notice">${escapeHtml(line.slice(2))}</div>`;
    return line ? `<p>${escapeHtml(line)}</p>` : '<div class="space"></div>';
  }).join('\n');
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${escapeHtml(draft.caseTitle)}</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;line-height:1.55;color:#202820}h1{font-size:28px}h2{font-size:18px;border-bottom:1px solid #ccd8ce;padding-bottom:6px;margin-top:30px}.notice{padding:12px;background:#fff6df;border:1px solid #dfc98f}.space{height:8px}</style><body>${paragraphs}</body></html>`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function writeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28); name.copy(local, 30);
    localParts.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const localBuffer = Buffer.concat(localParts);
  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(localBuffer.length, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([localBuffer, centralBuffer, end]);
}

export function buildDocx(draft) {
  const markdown = buildDraftMarkdown(draft);
  const paragraphs = markdown.split('\n').map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line || ' ')}</w:t></w:r></w:p>`).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
  return writeZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rels },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: documentRels },
  ]);
}
