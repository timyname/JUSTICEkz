import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const labels = {
  company: 'Юрлицо',
  address: 'Адрес',
  person: 'Лицо',
  phone: 'Телефон',
  email: 'Email',
  identifier: 'Идентификатор',
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureKey(dataDir) {
  const keyPath = path.join(dataDir, 'redaction.key');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: 'wx' });
  return { keyPath, key: fs.readFileSync(keyPath) };
}

function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value, key) {
  const [ivText, tagText, ciphertextText] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

export function createRedactor({ db, dataDir }) {
  const { key } = ensureKey(dataDir);

  function decryptedParties(caseId) {
    return db.listParties(caseId).map((party) => ({ ...party, value: decrypt(party.encrypted_value, key) }));
  }

  function registerParty({ caseId, value, kind = 'identifier' }) {
    const normalized = String(value).trim();
    if (!normalized) throw new Error('Party value cannot be empty');
    const existing = decryptedParties(caseId).find((party) => party.value === normalized);
    if (existing) return existing.token;
    const label = labels[kind] ?? labels.identifier;
    const number = decryptedParties(caseId).filter((party) => party.token.startsWith(`${label} `)).length + 1;
    const token = `${label} ${number}`;
    db.addParty({ caseId, token, encryptedValue: encrypt(normalized, key), kind });
    return token;
  }

  function redactText({ caseId, text }) {
    let output = String(text ?? '');
    const tokens = [];
    for (const party of decryptedParties(caseId).sort((a, b) => b.value.length - a.value.length)) {
      const pattern = new RegExp(escapeRegExp(party.value), 'g');
      if (pattern.test(output)) {
        output = output.replace(pattern, party.token);
        tokens.push(party.token);
      }
    }
    const patterns = [
      { regex: /(?<!\d)\d{12}(?!\d)/g, kind: 'identifier' },
      { regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, kind: 'email' },
      { regex: /(?<!\d)(?:\+?7|8)[\s()-]*\d[\d\s()-]{8,}\d(?!\d)/g, kind: 'phone' },
    ];
    for (const { regex, kind } of patterns) {
      output = output.replace(regex, (match) => {
        const token = registerParty({ caseId, value: match, kind });
        tokens.push(token);
        return token;
      });
    }
    return { text: output, tokens: [...new Set(tokens)] };
  }

  function restoreText({ caseId, text }) {
    let output = String(text ?? '');
    for (const party of decryptedParties(caseId).sort((a, b) => b.token.length - a.token.length)) {
      output = output.replace(new RegExp(escapeRegExp(party.token), 'g'), party.value);
    }
    return output;
  }

  return { registerParty, redactText, restoreText, keyPath: path.join(dataDir, 'redaction.key') };
}
