function decodeHtmlEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, value) => {
    if (value.toLowerCase() === 'amp') return '&';
    if (value.toLowerCase() === 'lt') return '<';
    if (value.toLowerCase() === 'gt') return '>';
    if (value.toLowerCase() === 'quot') return '"';
    if (value.toLowerCase() === 'apos') return "'";
    if (value.toLowerCase() === 'nbsp') return ' ';
    if (value.startsWith('#x')) return String.fromCodePoint(Number.parseInt(value.slice(2), 16));
    if (value.startsWith('#')) return String.fromCodePoint(Number.parseInt(value.slice(1), 10));
    return entity;
  });
}

export function htmlToLegalText(html) {
  const article = String(html ?? '').match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (!article) throw new Error('Adilet text_content does not contain an article');
  return decodeHtmlEntities(article
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r?\n{3,}/g, '\n\n'))
    .trim();
}

export function normalizeOfficialDocument(document, source, metadata = {}) {
  if (!document?.text_content || !String(document.text_content).trim()) {
    throw new Error(`Adilet document ${source?.id ?? document?.id ?? 'unknown'} has no text_content`);
  }
  const content = htmlToLegalText(document.text_content);
  if (!content) throw new Error(`Adilet document ${source?.id ?? document?.id ?? 'unknown'} has empty legal text`);
  const downloadedAt = metadata.downloadedAt ?? new Date().toISOString();
  return {
    title: document.title_ru || source.title,
    kind: source.kind,
    content,
    sourceUrl: `https://adilet.zan.kz/rus/docs/${source.id}`,
    sourceId: source.id,
    effectiveFrom: source.effectiveFrom,
    sourceSha256: metadata.sourceSha256 ?? null,
    downloadedAt,
    sourceNote: `${source.title}. Official consolidated Adilet snapshot downloaded on ${downloadedAt}; import a separately dated snapshot for historical analysis.`,
  };
}
