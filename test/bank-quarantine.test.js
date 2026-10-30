import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase } from '../src/db.js';
import { recordRejectedBankMail, readBankQuarantine, preserveQuarantinedBankMail } from '../src/bank-quarantine.js';

const config={bankWebhookSecret:'test-secret-'.repeat(8)};
const event={rejected:'dkim_not_authenticated'};
const raw=Buffer.from('From: powiadomienia@alior.pl\r\n\r\nPrivate bank notification test');

test('DKIM quarantine is encrypted, authenticated and does not extend retention on duplicates',()=>{
 const db=openDatabase(':memory:');
 recordRejectedBankMail(db,config,raw,event);
 const row=db.prepare('SELECT * FROM bank_mail_quarantine').get();
 assert.equal(Buffer.from(row.encrypted).includes(raw),false);
 assert.deepEqual(readBankQuarantine(db,config)[0].raw,raw);
 recordRejectedBankMail(db,config,raw,event);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_mail_quarantine').get().n,1);
 assert.equal(db.prepare('SELECT expires_at FROM bank_mail_quarantine').get().expires_at,row.expires_at);
 assert.throws(()=>readBankQuarantine(db,{bankWebhookSecret:'wrong-key'.repeat(8)}));
 const damaged=Buffer.from(row.encrypted);damaged[damaged.length-1]^=1;
 db.prepare('UPDATE bank_mail_quarantine SET encrypted=?').run(damaged);
 assert.throws(()=>readBankQuarantine(db,config));db.close();
});

test('quarantine has a 20-message cap and removes expired originals',()=>{
 const db=openDatabase(':memory:');
 for(let i=0;i<25;i++)recordRejectedBankMail(db,config,Buffer.concat([raw,Buffer.from(String(i))]),event);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_mail_quarantine').get().n,20);
 db.exec("UPDATE bank_mail_quarantine SET expires_at='2000-01-01T00:00:00.000Z'");
 assert.deepEqual(readBankQuarantine(db,config),[]);
 recordRejectedBankMail(db,config,raw,{rejected:'unexpected_sender'});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_mail_quarantine').get().n,0);
 db.close();
});
test('an authenticated unmatched original can be preserved without creating a false rejection',()=>{
 const db=openDatabase(':memory:');preserveQuarantinedBankMail(db,config,raw);
 assert.deepEqual(readBankQuarantine(db,config)[0].raw,raw);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_messages').get().n,0);
 db.close();
});

test('application backups exclude encrypted diagnostic originals',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bezreszty-quarantine-backup-'));
 try {
  const source=join(dir,'app.sqlite'),target=join(dir,'backup.sqlite');
  let db=openDatabase(source);recordRejectedBankMail(db,config,raw,event);
  const encrypted=Buffer.from(db.prepare('SELECT encrypted FROM bank_mail_quarantine').get().encrypted);db.close();
  execFileSync(process.execPath,['scripts/backup.js',target],{env:{...process.env,NODE_ENV:'development',DB_PATH:source},stdio:'pipe'});
  db=openDatabase(target);assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_mail_quarantine').get().n,0);db.close();
  assert.equal(readFileSync(target).includes(encrypted),false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
