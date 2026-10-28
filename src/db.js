import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
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
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS campaign_status ON campaigns(status, created_at);
    CREATE INDEX IF NOT EXISTS donation_campaign ON donations(campaign_id, status);
    CREATE INDEX IF NOT EXISTS bank_owner ON bank_messages(owner_id, status);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    PRAGMA user_version = 1;
  `);
  return db;
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
