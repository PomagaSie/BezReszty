import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { hash } from './domain.js';
import { now, transaction } from './db.js';

const lifetime = 60 * 60 * 1000;
const key = config => Buffer.from(hkdfSync('sha256', config.bankWebhookSecret, 'BezReszty bank mail', 'diagnostic-quarantine-v1', 32));

export function pruneBankQuarantine(db) {
  db.prepare('DELETE FROM bank_mail_quarantine WHERE expires_at<=?').run(now());
}

export function recordRejectedBankMail(db, config, raw, event) {
  const fingerprint = hash(raw);
  transaction(db, () => {
    db.prepare("INSERT OR IGNORE INTO bank_messages(id,fingerprint,status,reason,received_at) VALUES (?,?,'rejected',?,?)").run(randomUUID(), fingerprint, event.rejected, now());
    if (event.rejected === 'dkim_not_authenticated') preserveOriginal(db, config, raw);
  });
}

function preserveOriginal(db, config, raw) {
  pruneBankQuarantine(db);
  if (config.bankWebhookSecret?.length >= 32 && raw.length <= 256 * 1024) {
    const fingerprint = hash(raw);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(config), iv);
    cipher.setAAD(Buffer.from(fingerprint));
    const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
    const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    db.prepare('INSERT OR IGNORE INTO bank_mail_quarantine(fingerprint,encrypted,created_at,expires_at) VALUES (?,?,?,?)').run(fingerprint, encrypted, now(), new Date(Date.now() + lifetime).toISOString());
    db.exec('DELETE FROM bank_mail_quarantine WHERE fingerprint IN (SELECT fingerprint FROM bank_mail_quarantine ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 20)');
  }
}

export function preserveQuarantinedBankMail(db, config, raw) {
  transaction(db, () => preserveOriginal(db, config, raw));
}

export function readBankQuarantine(db, config) {
  pruneBankQuarantine(db);
  return db.prepare('SELECT * FROM bank_mail_quarantine ORDER BY created_at').all().map(row => {
    const encrypted = Buffer.from(row.encrypted);
    const decipher = createDecipheriv('aes-256-gcm', key(config), encrypted.subarray(0, 12));
    decipher.setAuthTag(encrypted.subarray(12, 28));
    decipher.setAAD(Buffer.from(row.fingerprint));
    return { fingerprint: row.fingerprint, raw: Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]) };
  });
}
