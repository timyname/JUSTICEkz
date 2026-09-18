export function chunkText(text, { maxChars = 900, overlap = 120 } = {}) {
  const pages = String(text ?? '').split(/\f/g);
  const chunks = [];
  pages.forEach((page, pageIndex) => {
    const normalized = page.replaceAll('\r\n', '\n').trim();
    if (!normalized) return;
    if (normalized.length <= maxChars) {
      chunks.push({ content: normalized, pageNumber: pageIndex + 1 });
      return;
    }
    const safeOverlap = Math.min(Math.max(0, overlap), Math.floor(maxChars / 3));
    let start = 0;
    while (start < normalized.length) {
      const end = Math.min(normalized.length, start + maxChars);
      chunks.push({ content: normalized.slice(start, end), pageNumber: pageIndex + 1 });
      if (end === normalized.length) break;
      start = end - safeOverlap;
    }
  });
  return chunks;
}
