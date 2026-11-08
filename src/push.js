import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { encryptionKey } from './mfa.js';
import { transaction } from './db.js';

// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291), on node:crypto only.
//
// Events never call a push service directly. They write rows to `push_outbox` inside the transaction that caused the
// event (so a notification exists exactly when the donation/campaign change does, also when the change was made by a
// script in another process), and the server process drains the outbox: immediately after a request (`kick`) and on a
// timer. Payloads are encrypted for one browser; the push service only relays ciphertext.

export const MAX_SUBSCRIPTIONS_PER_USER = 10;
const OUTBOX_TTL_MS = 60 * 60 * 1000, MAX_ATTEMPTS = 5, TTL_SECONDS = 3600;
const base64 = value => Buffer.from(value).toString('base64url');
const strictBase64 = /^[A-Za-z0-9_-]+$/;

export class PushError extends Error {}

// Subscriptions are supplied by the browser, so the endpoint is attacker-controlled input that the server later POSTs to.
// Only the push services of the browsers themselves are accepted (no other hosts, ports, credentials or IP literals).
export function isPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return host === 'fcm.googleapis.com' || ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'].some(suffix => host.endsWith(suffix));
}

// ---- Event helpers (plain DB writes; safe to call inside a transaction) ---------------------------------------------

const insertOutbox = db => db.prepare('INSERT INTO push_outbox(subscription_id,kind,title,body,url,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?)');
const clip = (value, length) => { const text = String(value); return text.length > length ? `${text.slice(0, length - 1)}…` : text; };
function enqueue(db, subscriptionIds, { kind, title, body, url }) {
  const insert = insertOutbox(db), current = Date.now();
  for (const id of subscriptionIds) insert.run(id, kind, clip(title, 80), clip(body, 160), url, current, current);
  return subscriptionIds.length;
}
export const queuePush = (db, userId, message) => enqueue(db, db.prepare('SELECT id FROM push_subscriptions WHERE user_id=?').all(userId).map(row => row.id), message);
export const queueAdminPush = (db, message) => enqueue(db, db.prepare("SELECT s.id FROM push_subscriptions s JOIN users u ON u.id=s.user_id WHERE u.role='admin'").all().map(row => row.id), message);

// ---- VAPID key pair, generated on first use and stored encrypted next to the subscriptions it belongs to ----------------

function sealVapid(config, jwk) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(config, 'vapid-key-v1'), iv);
  cipher.setAAD(Buffer.from('vapid'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(jwk), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function openVapid(config, sealed) {
  const bytes = Buffer.from(sealed, 'base64url'), decipher = createDecipheriv('aes-256-gcm', encryptionKey(config, 'vapid-key-v1'), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from('vapid')); decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}
const uncompressed = jwk => Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);

function loadVapid(db, config) {
  encryptionKey(config, 'vapid-key-v1'); // a missing/short key must fail here, never be mistaken for an unreadable stored pair
  const read = () => db.prepare("SELECT value FROM app_secrets WHERE name='vapid'").get();
  let row = read();
  if (row) {
    try { const jwk = openVapid(config, row.value); return { publicKey: base64(uncompressed(jwk)), key: createPrivateKey({ key: jwk, format: 'jwk' }) }; }
    catch { /* The encryption key changed: the old pair is unreadable and its subscriptions can never be served again. */
      console.warn('Klucz VAPID jest nieczytelny (zmieniony klucz szyfrowania?). Generuję nowy; urządzenia muszą ponownie włączyć powiadomienia.');
      transaction(db, () => { db.prepare("DELETE FROM app_secrets WHERE name='vapid'").run(); db.prepare('DELETE FROM push_subscriptions').run(); });
    }
  }
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  db.prepare("INSERT OR IGNORE INTO app_secrets(name,value,created_at) VALUES ('vapid',?,?)").run(sealVapid(config, jwk), new Date().toISOString());
  row = read(); // Another process may have won the race; use whatever was stored first.
  const stored = openVapid(config, row.value);
  return { publicKey: base64(uncompressed(stored)), key: createPrivateKey({ key: stored, format: 'jwk' }) };
}

// ---- Protocol -------------------------------------------------------------------------------------------------------

export function vapidAuthorization(vapid, endpoint, subject, current = Date.now()) {
  const header = base64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(current / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapid.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${base64(signature)}, k=${vapid.publicKey}`;
}

// RFC 8291 §3: ECDH with the browser's key, mixed with its 16-byte auth secret, then a single aes128gcm record (RFC 8188).
const ephemeralKeys = () => { const keys = createECDH('prime256v1'); keys.generateKeys(); return keys; };
export function encryptPayload(plaintext, p256dh, authSecret, { ephemeral = ephemeralKeys(), salt = randomBytes(16) } = {}) {
  const receiver = Buffer.from(p256dh, 'base64url'), sender = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(receiver);
  const ikm = hkdfSync('sha256', shared, Buffer.from(authSecret, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), receiver, sender]), 32);
  const cek = Buffer.from(hkdfSync('sha256', Buffer.from(ikm), salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', Buffer.from(ikm), salt, 'Content-Encoding: nonce\0', 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21 + sender.length); // salt(16) | record size(4) | key id length(1) | key id
  salt.copy(header); header.writeUInt32BE(4096, 16); header[20] = sender.length; sender.copy(header, 21);
  return Buffer.concat([header, record]);
}

// ---- Service ---------------------------------------------------------------------------------------------------------

export function createPush(config, db, { fetchImpl = globalThis.fetch } = {}) {
  let vapid = null, failed = false;
  // Without an encryption key (or in demo mode, which has no real accounts) the feature is simply absent.
  const enabled = () => {
    if (config.demo || failed || !config.mfaEncryptionKey) return false;
    if (vapid) return true;
    try { vapid = loadVapid(db, config); return true; }
    catch (error) { failed = true; console.error('Powiadomienia push wyłączone:', error.code || error.name); return false; }
  };
  const subject = config.operatorEmail ? `mailto:${config.operatorEmail}` : config.baseUrl;
  const publicKey = () => enabled() ? vapid.publicKey : null;
  const authorization = (endpoint, current) => vapidAuthorization(vapid, endpoint, subject, current);

  function subscribe(userId, input) {
    if (!enabled()) throw new PushError('Powiadomienia są wyłączone na tym serwerze.');
    const endpoint = input?.endpoint, p256dh = input?.keys?.p256dh, auth = input?.keys?.auth;
    if (!isPushEndpoint(endpoint)) throw new PushError('Ta przeglądarka używa nieobsługiwanej usługi powiadomień.');
    if (![p256dh, auth].every(value => typeof value === 'string' && strictBase64.test(value))) throw new PushError('Niepełne dane subskrypcji.');
    const receiver = Buffer.from(p256dh, 'base64url');
    if (receiver.length !== 65 || receiver[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) throw new PushError('Niepoprawny klucz subskrypcji.');
    try { const probe = createECDH('prime256v1'); probe.generateKeys(); probe.computeSecret(receiver); }
    catch { throw new PushError('Niepoprawny klucz subskrypcji.'); }
    return transaction(db, () => {
      const existing = db.prepare('SELECT id,user_id FROM push_subscriptions WHERE endpoint=?').get(endpoint);
      const id = existing?.id || randomUUID();
      if (existing) {
        // A browser that moves to another account must not receive what was queued for the previous one.
        if (existing.user_id !== userId) db.prepare('DELETE FROM push_outbox WHERE subscription_id=?').run(id);
        db.prepare('UPDATE push_subscriptions SET user_id=?,p256dh=?,auth=? WHERE id=?').run(userId, p256dh, auth, id);
      } else db.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?,?)').run(id, userId, endpoint, p256dh, auth, new Date().toISOString());
      db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?)').run(userId, userId, MAX_SUBSCRIPTIONS_PER_USER);
      if (db.prepare('SELECT 1 FROM push_subscriptions WHERE id=?').get(id)) enqueue(db, [id], { kind: 'welcome', title: 'Powiadomienia włączone', body: 'Dostaniesz je na tym urządzeniu, dopóki się nie wylogujesz lub ich nie wyłączysz.', url: '/panel' });
      return id;
    });
  }
  const unsubscribe = (userId, endpoint) => typeof endpoint === 'string' && db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(userId, endpoint).changes > 0;
  const isSubscribed = (userId, endpoint) => typeof endpoint === 'string' && Boolean(db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(userId, endpoint));

  // 'ok' | 'gone' (subscription is dead) | 'retry' (try again later) | 'drop' (this message cannot be delivered)
  async function deliver(row) {
    const body = encryptPayload(JSON.stringify({ title: row.title, body: row.body, url: row.url, tag: `${row.kind}-${row.id}` }), row.p256dh, row.auth);
    let response;
    try {
      response = await fetchImpl(row.endpoint, {
        method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(TTL_SECONDS), Urgency: 'normal', Authorization: authorization(row.endpoint) },
      });
    } catch { return 'retry'; }
    if (response.status >= 200 && response.status < 300) return 'ok';
    if (response.status === 404 || response.status === 410) return 'gone';
    if (response.status === 429 || response.status >= 500) return 'retry';
    console.warn('Usługa powiadomień odrzuciła wiadomość, status', response.status);
    return 'drop';
  }

  async function drain() {
    if (!enabled()) return;
    const current = Date.now();
    db.prepare('DELETE FROM push_outbox WHERE created_at<?').run(current - OUTBOX_TTL_MS);
    const rows = db.prepare(`SELECT o.*,s.endpoint,s.p256dh,s.auth FROM push_outbox o JOIN push_subscriptions s ON s.id=o.subscription_id
      WHERE o.next_attempt_at<=? ORDER BY o.id LIMIT 100`).all(current);
    for (let start = 0; start < rows.length; start += 10) {
      await Promise.all(rows.slice(start, start + 10).map(async row => {
        const result = await deliver(row);
        if (result === 'gone') db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.subscription_id); // cascades to its queue
        else if (result === 'retry' && row.attempts + 1 < MAX_ATTEMPTS) db.prepare('UPDATE push_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=?').run(Date.now() + Math.min(15 * 60000, 30000 * 2 ** row.attempts), row.id);
        else {
          db.prepare('DELETE FROM push_outbox WHERE id=?').run(row.id);
          if (result === 'ok') db.prepare('UPDATE push_subscriptions SET last_success_at=? WHERE id=?').run(new Date().toISOString(), row.subscription_id);
        }
      }));
    }
  }
  // One drain at a time; a call made while one is running makes it go around again, so nothing queued meanwhile is missed.
  let running = null, again = false;
  const flush = () => {
    if (running) { again = true; return running; }
    running = (async () => { try { do { again = false; await drain(); } while (again); } finally { running = null; } })();
    return running;
  };
  const kick = () => { setImmediate(() => flush().catch(error => console.error('Wysyłka powiadomień nie powiodła się:', error.code || error.name))); };
  return { enabled, publicKey, authorization, subscribe, unsubscribe, isSubscribed, flush, kick };
}
