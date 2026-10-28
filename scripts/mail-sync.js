import { readConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { syncMailbox } from '../src/bank.js';
const config = readConfig(), db = openDatabase(config.dbPath);
try { console.log(await syncMailbox(db, config)); } finally { db.close(); }
