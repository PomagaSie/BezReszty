import { readConfig } from '../src/config.js';
import { openDatabase, audit } from '../src/db.js';
import { readBankQuarantine } from '../src/bank-quarantine.js';
import { authenticateBankMail, ingestAuthenticatedMail } from '../src/bank.js';

const config=readConfig(),db=openDatabase(config.dbPath);
try {
  for(const item of readBankQuarantine(db,config)) {
    const event=await authenticateBankMail(item.raw,config);
    if(event.rejected) {console.log(JSON.stringify({fingerprint:item.fingerprint.slice(0,12),rejected:event.rejected,diagnostics:event.diagnostics}));continue;}
    const result=ingestAuthenticatedMail(db,config,event,{reprocessQuarantined:true});
    console.log(JSON.stringify({fingerprint:item.fingerprint.slice(0,12),result}));
    if(result!=='quarantined') {
      db.prepare('DELETE FROM bank_mail_quarantine WHERE fingerprint=?').run(item.fingerprint);
      audit(db,null,'bank_mail_reprocessed',item.fingerprint);
    }
  }
} finally {db.close();}
