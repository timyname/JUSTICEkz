import fs from 'node:fs';
import path from 'node:path';

const supportedExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log', '.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);

export function isSupportedCaseFile(filePath) {
  return supportedExtensions.has(path.extname(filePath).toLocaleLowerCase('ru-RU'));
}

export function collectCaseFiles(folderPath) {
  const root = path.resolve(folderPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Папка дела не найдена');
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && isSupportedCaseFile(fullPath)) files.push({
        fileName: path.relative(root, fullPath),
        mimeType: null,
        buffer: fs.readFileSync(fullPath),
        sourcePath: fullPath,
      });
    }
  }
  walk(root);
  return files.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ru-RU'));
}

export { supportedExtensions };
