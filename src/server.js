import { readConfig } from './config.js';
import { openDatabase, pruneAuthState } from './db.js';
import { createApp } from './app.js';
import { syncMailbox } from './bank.js';
import { pruneBankQuarantine } from './bank-quarantine.js';
const config = readConfig();
const db = openDatabase(config.dbPath);
pruneBankQuarantine(db);
pruneAuthState(db);
const modes = db.prepare('SELECT DISTINCT is_demo FROM campaigns').all().map(row => row.is_demo);
if (modes.some(mode => Boolean(mode) !== config.demo)) throw new Error('Baza zawiera dane z innego trybu. Użyj osobnej bazy dla demo i produkcji.');
const server = createApp({ config, db }).listen(config.port, config.host, () => console.log(`BezReszty: ${config.baseUrl} (${config.demo ? 'demo — wpłaty wyłączone' : config.production ? 'production' : 'development'})`));
let syncing = false;
const sync = async () => {
  if (syncing) return;
  syncing = true;
  try { pruneAuthState(db); pruneBankQuarantine(db); await syncMailbox(db, config); }
  catch (error) { console.error('Synchronizacja poczty nie powiodła się:', error.code || error.name); }
  finally { syncing = false; }
};
if (config.imap && !config.demo) void sync();
const timer = setInterval(sync, 30000);
timer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(timer);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
