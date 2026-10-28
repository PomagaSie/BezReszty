import { readConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { syncMailbox } from './bank.js';
const config = readConfig();
const db = openDatabase(config.dbPath);
const server = createApp({ config, db }).listen(config.port, config.host, () => console.log(`BezReszty: ${config.baseUrl} (${config.demo ? 'demo — wpłaty wyłączone' : config.production ? 'production' : 'development'})`));
let syncing = false;
const sync = async () => {
  if (syncing) return;
  syncing = true;
  try { await syncMailbox(db, config); }
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
