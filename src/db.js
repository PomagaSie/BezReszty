import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA recursive_triggers = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'organizer' CHECK(role IN ('organizer','admin')),
      phone TEXT, iban TEXT, notification_alias TEXT NOT NULL UNIQUE,
      verification_status TEXT NOT NULL DEFAULT 'unsubmitted' CHECK(verification_status IN ('unsubmitted','pending','verified','rejected')),
      verification_note TEXT NOT NULL DEFAULT '', bank_notification_seen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, submitted_at TEXT, verified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, summary TEXT NOT NULL, story TEXT NOT NULL, category TEXT NOT NULL,
      location TEXT NOT NULL, cover TEXT NOT NULL DEFAULT 'community', goal INTEGER NOT NULL CHECK(goal > 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','published','closed','rejected')),
      is_demo INTEGER NOT NULL DEFAULT 0, deadline TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS donations (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), code TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL CHECK(amount > 0), name TEXT NOT NULL DEFAULT 'Anonimowo', message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),
      created_at TEXT NOT NULL, confirmed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bank_messages (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, owner_id TEXT REFERENCES users(id),
      amount INTEGER, title TEXT, account_mask TEXT, donation_id TEXT REFERENCES donations(id),
      status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_state (mailbox TEXT PRIMARY KEY, uid_validity TEXT NOT NULL, last_uid INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bank_mail_quarantine (
      fingerprint TEXT PRIMARY KEY, encrypted BLOB NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS campaign_status ON campaigns(status, created_at);
    CREATE INDEX IF NOT EXISTS donation_campaign ON donations(campaign_id, status);
    CREATE INDEX IF NOT EXISTS bank_owner ON bank_messages(owner_id, status);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS campaign_owner ON campaigns(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS donation_recent ON donations(campaign_id, status, confirmed_at DESC);
    CREATE INDEX IF NOT EXISTS donation_confirmed_recent ON donations(confirmed_at DESC) WHERE status='confirmed';
    CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS token_user ON tokens(user_id, purpose);
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT NOT NULL, key TEXT NOT NULL, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL,
      PRIMARY KEY(bucket,key)
    );
    CREATE INDEX IF NOT EXISTS rate_limit_expiry ON rate_limits(reset_at);
    CREATE TABLE IF NOT EXISTS mfa_challenges (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mfa_challenge_user ON mfa_challenges(user_id);
    CREATE INDEX IF NOT EXISTS mfa_challenge_expiry ON mfa_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS mfa_enrollments (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,
      secret TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL,
      PRIMARY KEY(user_id,hash)
    );
    CREATE INDEX IF NOT EXISTS mfa_enrollment_expiry ON mfa_enrollments(expires_at);
  `);
  transaction(db, () => {
    const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
    if (!userColumns.has('verification_code')) db.exec('ALTER TABLE users ADD COLUMN verification_code TEXT');
    if (!userColumns.has('verification_started_at')) db.exec('ALTER TABLE users ADD COLUMN verification_started_at TEXT');
    if (!userColumns.has('verification_code')) db.exec("UPDATE users SET verification_code='BR-KONTO-' || upper(substr(replace(id,'-',''),1,12)),verification_started_at=submitted_at WHERE verification_status='pending' AND bank_notification_seen=0 AND submitted_at IS NOT NULL");
    if (!userColumns.has('phone_identity_confirmed_at')) db.exec('ALTER TABLE users ADD COLUMN phone_identity_confirmed_at TEXT');
    if (!userColumns.has('mobywatel_code')) db.exec('ALTER TABLE users ADD COLUMN mobywatel_code TEXT');
    if (!userColumns.has('mobywatel_code_expires_at')) db.exec('ALTER TABLE users ADD COLUMN mobywatel_code_expires_at INTEGER');
    if (!userColumns.has('mobywatel_manual_code')) db.exec('ALTER TABLE users ADD COLUMN mobywatel_manual_code TEXT');
    if (!userColumns.has('mfa_secret')) db.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
    if (!userColumns.has('mfa_last_step')) db.exec('ALTER TABLE users ADD COLUMN mfa_last_step INTEGER');
    const sessionColumns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(column => column.name));
    if (!sessionColumns.has('mfa_verified')) db.exec('ALTER TABLE sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0');
    const hasTotals = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='campaign_totals'").get();
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_totals (
        campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
        raised INTEGER NOT NULL DEFAULT 0 CHECK(raised>=0),
        supporters INTEGER NOT NULL DEFAULT 0 CHECK(supporters>=0)
      );
      CREATE TRIGGER IF NOT EXISTS campaign_totals_create AFTER INSERT ON campaigns BEGIN
        INSERT INTO campaign_totals(campaign_id) VALUES (NEW.id);
      END;
      CREATE TRIGGER IF NOT EXISTS campaign_totals_insert AFTER INSERT ON donations WHEN NEW.status='confirmed' BEGIN
        UPDATE campaign_totals SET raised=raised+NEW.amount,supporters=supporters+1 WHERE campaign_id=NEW.campaign_id;
      END;
      CREATE TRIGGER IF NOT EXISTS campaign_totals_delete AFTER DELETE ON donations WHEN OLD.status='confirmed' BEGIN
        UPDATE campaign_totals SET raised=raised-OLD.amount,supporters=supporters-1 WHERE campaign_id=OLD.campaign_id;
      END;
      CREATE TRIGGER IF NOT EXISTS campaign_totals_update AFTER UPDATE OF amount,status,campaign_id ON donations
      WHEN OLD.amount<>NEW.amount OR OLD.status<>NEW.status OR OLD.campaign_id<>NEW.campaign_id BEGIN
        UPDATE campaign_totals SET raised=raised-OLD.amount,supporters=supporters-1 WHERE campaign_id=OLD.campaign_id AND OLD.status='confirmed';
        UPDATE campaign_totals SET raised=raised+NEW.amount,supporters=supporters+1 WHERE campaign_id=NEW.campaign_id AND NEW.status='confirmed';
      END;
    `);
    if (!hasTotals) populateCampaignTotals(db);
    db.exec(`PRAGMA user_version = ${Math.max(4, db.prepare('PRAGMA user_version').get().user_version)}`);
  });
  return db;
}

function populateCampaignTotals(db) {
  db.exec(`DELETE FROM campaign_totals;
    INSERT INTO campaign_totals(campaign_id,raised,supporters)
    SELECT c.id,COALESCE(SUM(d.amount),0),COUNT(d.id) FROM campaigns c
    LEFT JOIN donations d ON d.campaign_id=c.id AND d.status='confirmed' GROUP BY c.id`);
}

export function rebuildCampaignTotals(db) {
  transaction(db, () => populateCampaignTotals(db));
}

export function pruneAuthState(db) {
  const current = Date.now();
  transaction(db, () => {
    for (const table of ['sessions', 'tokens', 'mfa_challenges', 'mfa_enrollments']) db.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).run(current);
    db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(current);
  });
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export const now = () => new Date().toISOString();
export function audit(db, actor, action, target, note = '') {
  db.prepare('INSERT INTO audit(actor_id, action, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)').run(actor, action, target, note, now());
}
