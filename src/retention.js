import { readdirSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { transaction } from './db.js';

export const transientRetentionDays = 30;
export const transientCutoff = (current = Date.now()) => new Date(current - transientRetentionDays * 86400000).toISOString();

// Confirmed donations, verification evidence and dispute records are not purged
// on a blanket timer. Their limitation period requires an individual assessment.
export function pruneTransientData(db, current = Date.now()) {
  const cutoff = transientCutoff(current);
  return transaction(db, () => {
    const messages = db.prepare("DELETE FROM bank_messages WHERE status NOT IN ('matched','verification') AND received_at<=?").run(cutoff).changes;
    const donations = db.prepare("DELETE FROM donations WHERE status='pending' AND created_at<=? AND NOT EXISTS (SELECT 1 FROM bank_messages b WHERE b.donation_id=donations.id)").run(cutoff).changes;
    db.prepare('UPDATE users SET mobywatel_code=NULL,mobywatel_manual_code=NULL,mobywatel_code_expires_at=NULL WHERE mobywatel_code_expires_at<=?').run(current);
    return { messages, donations };
  });
}

// Only application-managed backups in the DB's backups directory are eligible.
// Never follow symlinks or remove arbitrary exports / directories.
export function pruneManagedBackups(dbPath, current = Date.now()) {
  const directory = join(dirname(dbPath), 'backups');
  let files;
  try {
    if (!lstatSync(directory).isDirectory()) return 0;
    files = readdirSync(directory);
  } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let removed = 0;
  for (const filename of files) {
    const match = filename.match(/^bezreszty-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)\.sqlite$/);
    if (!match) continue;
    const created = Date.parse(`${match[1]}:${match[2]}:${match[3]}`);
    const path = join(directory, filename), stat = lstatSync(path);
    if (stat.isFile() && created <= current - transientRetentionDays * 86400000 && stat.mtimeMs <= current - transientRetentionDays * 86400000) {
      unlinkSync(path); removed++;
    }
  }
  return removed;
}
