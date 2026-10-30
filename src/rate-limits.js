import { hash } from './domain.js';

// express-rate-limit Store backed by the existing SQLite connection. Each
// increment is atomic and survives process restarts; raw IPs/emails are not saved.
export class SqliteRateLimitStore {
  localKeys = false;
  constructor(db, bucket) { this.db = db; this.prefix = this.bucket = bucket; this.nextPrune = 0; }
  init({ windowMs }) { this.windowMs = windowMs; }
  increment(key) {
    const current = Date.now();
    if (current >= this.nextPrune) {
      this.db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(current);
      this.nextPrune = current + 60000;
    }
    const row = this.db.prepare(`INSERT INTO rate_limits(bucket,key,hits,reset_at) VALUES (?,?,1,?)
      ON CONFLICT(bucket,key) DO UPDATE SET
        hits=CASE WHEN reset_at<=? THEN 1 ELSE hits+1 END,
        reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END
      RETURNING hits,reset_at`).get(this.bucket, hash(key), current + this.windowMs, current, current);
    return { totalHits: row.hits, resetTime: new Date(row.reset_at) };
  }
  decrement(key) { this.db.prepare('UPDATE rate_limits SET hits=MAX(0,hits-1) WHERE bucket=? AND key=?').run(this.bucket, hash(key)); }
  resetKey(key) { this.db.prepare('DELETE FROM rate_limits WHERE bucket=? AND key=?').run(this.bucket, hash(key)); }
}
