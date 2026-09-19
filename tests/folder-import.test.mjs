import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectCaseFiles } from '../src/core/folder-import.mjs';

test('folder collector keeps supported relative files and skips unsupported files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-folder-'));
  fs.mkdirSync(path.join(root, 'Приложения'));
  fs.writeFileSync(path.join(root, 'иск.pdf'), 'pdf');
  fs.writeFileSync(path.join(root, 'служебный.py'), 'print(1)');
  fs.writeFileSync(path.join(root, 'Приложения', 'фото.jpg'), 'jpg');
  const files = collectCaseFiles(root);
  assert.deepEqual(files.map((file) => file.fileName), ['иск.pdf', path.join('Приложения', 'фото.jpg')]);
  assert.equal(files.every((file) => Buffer.isBuffer(file.buffer)), true);
});
