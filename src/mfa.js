import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { hash, token } from './domain.js';

export const createMfaSecret = () => new Secret({ size: 20 }).base32;
export const mfaTotp = (secret, email = '') => new TOTP({ issuer: 'BezReszty', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret });
const encryptionKey = config => {
  const value = config.mfaEncryptionKey || config.bankWebhookSecret;
  if (!value || value.length < 32) throw Object.assign(new Error('MFA encryption is not configured'), { code: 'MFA_NOT_CONFIGURED' });
  return Buffer.from(hkdfSync('sha256', value, 'BezReszty MFA', 'totp-secret-v1', 32));
};
export function encryptMfaSecret(config, userId, secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(config), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function decryptMfaSecret(config, userId, encrypted) {
  const bytes = Buffer.from(encrypted, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(config), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
export function mfaStep(secret, code, timestamp = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = mfaTotp(secret).validate({ token: code, window: 1, timestamp });
  return delta === null ? null : Math.floor(timestamp / 30000) + delta;
}
export function createRecoveryCodes(db, userId) {
  db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=?').run(userId);
  return Array.from({ length: 10 }, () => {
    const code = token(10).toUpperCase();
    db.prepare('INSERT INTO mfa_recovery_codes(user_id,hash) VALUES (?,?)').run(userId, hash(code));
    return code.match(/.{4}/g).join('-');
  });
}
// Call inside the same transaction that grants access or changes MFA settings.
export function consumeMfaCode(db, config, user, input) {
  if (!user.mfa_secret) return false;
  const code = String(input || '').replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-F0-9]{20}$/.test(code)) return db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=? AND hash=?').run(user.id, hash(code)).changes === 1;
  const step = mfaStep(decryptMfaSecret(config, user.id, user.mfa_secret), code);
  if (step === null) return false;
  return db.prepare('UPDATE users SET mfa_last_step=? WHERE id=? AND mfa_secret=? AND (mfa_last_step IS NULL OR mfa_last_step<?)').run(step, user.id, user.mfa_secret, step).changes === 1;
}
