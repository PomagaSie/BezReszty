import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, rebuildCampaignTotals, transaction } from '../src/db.js';
import { addUser, addCampaign, addDonation } from './helpers.js';

test('upgrading the verification schema preserves an already issued legacy test title', async t => {
 const dir=mkdtempSync(join(tmpdir(),'bezreszty-migration-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'legacy.sqlite');let db=openDatabase(path);
 const owner=await addUser(db,{verification_status:'pending'});
 db.prepare('UPDATE users SET bank_notification_seen=0 WHERE id=?').run(owner.id);
 db.exec('ALTER TABLE users DROP COLUMN verification_code; ALTER TABLE users DROP COLUMN verification_started_at; PRAGMA user_version=1');
 db.close();db=openDatabase(path);
 const user=db.prepare('SELECT * FROM users WHERE id=?').get(owner.id);
 assert.equal(user.verification_code,`BR-KONTO-${owner.id.replaceAll('-','').slice(0,12).toUpperCase()}`);
 assert.equal(user.verification_started_at,user.submitted_at);
 db.close();db=openDatabase(path);
 assert.equal(db.prepare('SELECT verification_code FROM users WHERE id=?').get(owner.id).verification_code,user.verification_code);
 db.close();
});

test('cached campaign totals follow confirmations, corrections, moves, deletions and rollbacks', async () => {
 const db=openDatabase(':memory:');
 const owner=await addUser(db),a=addCampaign(db,owner),b=addCampaign(db,owner);
 const totals=id=>{const r=db.prepare('SELECT raised,supporters FROM campaign_totals WHERE campaign_id=?').get(id);return {...r};};
 const d=addDonation(db,a,{amount:5029});
 assert.deepEqual(totals(a.id),{raised:0,supporters:0});
 db.prepare("UPDATE donations SET status='confirmed' WHERE id=?").run(d.id);
 assert.deepEqual(totals(a.id),{raised:5029,supporters:1});
 db.prepare("UPDATE donations SET status='confirmed',confirmed_at=? WHERE id=?").run(new Date().toISOString(),d.id);
 assert.deepEqual(totals(a.id),{raised:5029,supporters:1});
 db.prepare('UPDATE donations SET amount=7000,campaign_id=? WHERE id=?').run(b.id,d.id);
 assert.deepEqual(totals(a.id),{raised:0,supporters:0});assert.deepEqual(totals(b.id),{raised:7000,supporters:1});
 assert.throws(()=>transaction(db,()=>{db.prepare('UPDATE donations SET amount=9000 WHERE id=?').run(d.id);throw new Error('rollback');}));
 assert.deepEqual(totals(b.id),{raised:7000,supporters:1});
 db.prepare("UPDATE donations SET status='pending' WHERE id=?").run(d.id);
 assert.deepEqual(totals(b.id),{raised:0,supporters:0});
 db.prepare("UPDATE donations SET status='confirmed' WHERE id=?").run(d.id);
 db.prepare('DELETE FROM donations WHERE id=?').run(d.id);
 assert.deepEqual(totals(b.id),{raised:0,supporters:0});
 db.prepare("INSERT INTO donations(id,campaign_id,code,amount,status,created_at) VALUES ('confirmed-insert',?,'DEMO-1',1234,'confirmed',?)").run(a.id,new Date().toISOString());
 assert.deepEqual(totals(a.id),{raised:1234,supporters:1});
 db.prepare("INSERT OR REPLACE INTO donations(id,campaign_id,code,amount,status,created_at) VALUES ('confirmed-insert',?,'DEMO-1',500,'confirmed',?)").run(a.id,new Date().toISOString());
 assert.deepEqual(totals(a.id),{raised:500,supporters:1});
 db.close();
});

test('existing donations are backfilled once and totals can be rebuilt explicitly', async t => {
 const dir=mkdtempSync(join(tmpdir(),'bezreszty-cache-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'legacy.sqlite');let db=openDatabase(path);
 const owner=await addUser(db),campaign=addCampaign(db,owner),empty=addCampaign(db,owner);
 const confirmed=addDonation(db,campaign,{amount:2345});addDonation(db,campaign,{amount:9999});
 db.prepare("UPDATE donations SET status='confirmed' WHERE id=?").run(confirmed.id);
 db.exec('DROP TRIGGER campaign_totals_create; DROP TRIGGER campaign_totals_insert; DROP TRIGGER campaign_totals_delete; DROP TRIGGER campaign_totals_update; DROP TABLE campaign_totals; PRAGMA user_version=3');
 db.close();db=openDatabase(path);
 const read=()=>db.prepare('SELECT campaign_id,raised,supporters FROM campaign_totals ORDER BY campaign_id').all().map(r=>({...r}));
 const expected=[{campaign_id:campaign.id,raised:2345,supporters:1},{campaign_id:empty.id,raised:0,supporters:0}].sort((a,b)=>a.campaign_id.localeCompare(b.campaign_id));
 assert.deepEqual(read(),expected);db.close();db=openDatabase(path);assert.deepEqual(read(),expected);
 db.prepare('UPDATE campaign_totals SET raised=1,supporters=1 WHERE campaign_id=?').run(campaign.id);
 rebuildCampaignTotals(db);assert.deepEqual(read(),expected);
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT name,message,amount,confirmed_at FROM donations WHERE campaign_id=? AND status='confirmed' ORDER BY confirmed_at DESC LIMIT 30").all(campaign.id).map(r=>r.detail).join('\n');
 assert.match(plan,/donation_recent/);assert.doesNotMatch(plan,/TEMP B-TREE/);db.close();
});
