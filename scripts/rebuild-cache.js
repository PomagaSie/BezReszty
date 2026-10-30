import { readConfig } from '../src/config.js';
import { openDatabase, rebuildCampaignTotals } from '../src/db.js';
const db = openDatabase(readConfig().dbPath);
try { rebuildCampaignTotals(db); console.log('Przeliczono sumy i liczbę potwierdzonych wpłat w SQLite.'); }
finally { db.close(); }
