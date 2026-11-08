import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign';
import { authenticateBankMail, ingestAuthenticatedMail } from '../src/bank.js';
import { titleHasCode,newTransferCode,CODE_ALPHABET } from '../src/domain.js';
import { setup,addUser,addCampaign,addDonation } from './helpers.js';
const eventFor=(owner,donation,overrides={})=>({fingerprint:crypto.randomUUID(),recipient:`${owner.notification_alias}@powiadomienia.localhost`,subject:`Uznanie rachunku 96...0001 kwotą 50,00 PLN`,body:`Uznanie kwotą 50,00 PLN\nNadawca: TEST\nTytuł zlecenia: ${donation.code}\n`,date:new Date().toISOString(),...overrides});
test('only a verified owner, matching destination, exact amount and reference settle a donation',async()=>{
 const {db,config}=setup();const owner=await addUser(db),other=await addUser(db);const c=addCampaign(db,owner),d=addDonation(db,c),d2=addDonation(db,c,{code:d0(d.code)});
 for(const event of [eventFor(other,d),eventFor(owner,d,{subject:'Uznanie rachunku 96...9999 kwotą 50,00 PLN'}),eventFor(owner,d,{body:`kwotą 60,00 PLN\nNadawca: TEST\nTytuł zlecenia: ${d.code}\n`,subject:'Uznanie rachunku 96...0001 kwotą 60,00 PLN'}),eventFor(owner,d,{body:`kwotą 50,00 PLN\nNadawca: TEST\nTytuł zlecenia: ${d.code} ${d2.code}\n`})]){
  assert.equal(ingestAuthenticatedMail(db,config,event),'quarantined');
  assert.equal(db.prepare('SELECT status FROM donations WHERE id=?').get(d.id).status,'pending');
 }
 const event=eventFor(owner,d);assert.equal(ingestAuthenticatedMail(db,config,event),'matched');
 assert.equal(ingestAuthenticatedMail(db,config,event),'duplicate');
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d)),'quarantined');
 assert.equal(db.prepare("SELECT SUM(amount) total FROM donations WHERE status='confirmed'").get().total,5000);
 assert.deepEqual({...db.prepare('SELECT raised,supporters FROM campaign_totals WHERE campaign_id=?').get(c.id)},{raised:5000,supporters:1});
 db.close();
});
test('test notifications prove bank mail flow, never independently verify an organizer',async()=>{
 const {db,config}=setup();const owner=await addUser(db,{verification_status:'pending'});
 const d={code:'A1B2'};
 db.prepare('UPDATE users SET verification_code=?,verification_started_at=?,bank_notification_seen=0 WHERE id=?').run(d.code,new Date().toISOString(),owner.id);
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d)),'verification');
 const user=db.prepare('SELECT * FROM users WHERE id=?').get(owner.id);
 assert.equal(user.bank_notification_seen,1);assert.equal(user.verification_status,'pending');db.close();
});
test('bank tests require the current code, account, alias and start time and accept a code only once',async()=>{
 const {db,config}=setup();const owner=await addUser(db,{verification_status:'pending'}),other=await addUser(db,{verification_status:'pending'});
 db.prepare('UPDATE users SET bank_notification_seen=0 WHERE id IN (?,?)').run(owner.id,other.id);
 const d={code:'A1B2'};
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d)),'quarantined');
 db.prepare('UPDATE users SET verification_code=?,verification_started_at=? WHERE id=?').run(d.code,new Date().toISOString(),owner.id);
 for(const event of [eventFor(owner,{code:'C3D4'}),eventFor(other,d),eventFor(owner,d,{date:new Date(Date.now()-180000).toISOString()}),eventFor(owner,d,{subject:'Uznanie rachunku 96...9999 kwotą 50,00 PLN'}),eventFor(owner,{code:'A1B2 C3D4'})])assert.equal(ingestAuthenticatedMail(db,config,event),'quarantined');
 assert.equal(db.prepare('SELECT bank_notification_seen FROM users WHERE id=?').get(owner.id).bank_notification_seen,0);
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d)),'verification');
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d)),'quarantined');
 db.close();
});
test('bank test titles ignore letter case and whitespace, but never extra text or another code',async()=>{
 for(const title of ['a7bc','a 7bc','a\u00a07 b c','A7BC inny','A7BC C3D4']) {
  const {db,config}=setup();const owner=await addUser(db,{verification_status:'pending'});
  db.prepare("UPDATE users SET verification_code='A7BC',verification_started_at=?,bank_notification_seen=0 WHERE id=?").run(new Date().toISOString(),owner.id);
  const accepted=!title.includes('inny')&&!title.includes('C3D4');
  assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,{code:title})),accepted?'verification':'quarantined');
  assert.equal(db.prepare('SELECT bank_notification_seen FROM users WHERE id=?').get(owner.id).bank_notification_seen,accepted?1:0);
  db.close();
 }
});
test('operator reprocessing can retry a quarantined event but cannot repeat an accepted verification',async()=>{
 const {db,config}=setup();const owner=await addUser(db,{verification_status:'pending'});
 db.prepare("UPDATE users SET verification_code='ABCD',verification_started_at=?,bank_notification_seen=0 WHERE id=?").run(new Date().toISOString(),owner.id);
 const event=eventFor(owner,{code:'A7BC'});
 assert.equal(ingestAuthenticatedMail(db,config,event),'quarantined');
 db.prepare("UPDATE users SET verification_code='A7BC' WHERE id=?").run(owner.id);
 assert.equal(ingestAuthenticatedMail(db,config,event),'duplicate');
 assert.equal(ingestAuthenticatedMail(db,config,event,{reprocessQuarantined:true}),'verification');
 assert.equal(ingestAuthenticatedMail(db,config,event,{reprocessQuarantined:true}),'duplicate');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='bank_notification_verified'").get().n,1);
 db.close();
});
test('old notifications, demo accounts and suspended organizers cannot settle pending donations',async()=>{
 const {db,config}=setup();const owner=await addUser(db),c=addCampaign(db,owner),d=addDonation(db,c);
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d,{date:'2020-01-01T00:00:00.000Z'})),'quarantined');
 db.prepare("UPDATE users SET verification_status='rejected' WHERE id=?").run(owner.id);
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d)),'quarantined');
 assert.equal(db.prepare('SELECT status FROM donations WHERE id=?').get(d.id).status,'pending');db.close();
});
test('cryptographic DKIM verification rejects unsigned, tampered, readdressed and partial-body mail',async()=>{
 const {config,db}=setup();const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const privatePem=privateKey.export({type:'pkcs8',format:'pem'}),publicDer=publicKey.export({type:'spki',format:'der'}).toString('base64');
 const source=Buffer.from(`From: powiadomienia@alior.pl\r\nTo: alias@powiadomienia.localhost\r\nSubject: Uznanie rachunku 96...0001 kwotą 50,00 PLN\r\nDate: ${new Date().toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nkwotą 50,00 PLN\r\nNadawca: TEST\r\nTytuł zlecenia: BR-AABBCCDDEEFF\r\n`);
 const resolver=async()=>[[`v=DKIM1; k=rsa; p=${publicDer}`]];
 const signed=await dkimSign(source,{headerList:'from:to:subject:date:content-type',signatureData:[{signingDomain:'alior.pl',selector:'test',privateKey:privatePem}]});
 const raw=Buffer.concat([Buffer.from(signed.signatures),source]);
 const event=await authenticateBankMail(raw,config,{resolver});assert.equal(event.recipient,'alias@powiadomienia.localhost');
 assert.equal((await authenticateBankMail(source,config,{resolver})).rejected,'dkim_not_authenticated');
 for(const corrupted of [raw.toString().replace('50,00 PLN\r\nNadawca','60,00 PLN\r\nNadawca'),raw.toString().replace('alias@','attacker@')])assert.equal((await authenticateBankMail(Buffer.from(corrupted),config,{resolver})).rejected,'dkim_not_authenticated');
 for (const options of [
  {headerList:'from:subject:date:content-type'},
  {headerList:'from:to:subject:date:content-type',signatureData:[{signingDomain:'alior.pl',selector:'test',privateKey:privatePem,maxBodyLength:10}]}
 ]) {
  const limited=await dkimSign(source,{headerList:'from:to:subject:date:content-type',signatureData:[{signingDomain:'alior.pl',selector:'test',privateKey:privatePem}],...options});
  assert.equal((await authenticateBankMail(Buffer.concat([Buffer.from(limited.signatures),source]),config,{resolver})).rejected,'dkim_not_authenticated');
 }
 const duplicated=Buffer.concat([Buffer.from('To: attacker@powiadomienia.localhost\r\n'),raw]);
 assert.equal((await authenticateBankMail(duplicated,config,{resolver})).rejected,'duplicate_headers');
 const forgedHeaders=Buffer.from('Authentication-Results: attacker; dkim=pass header.d=alior.pl\r\n'+source.toString());
 assert.equal((await authenticateBankMail(forgedHeaders,config,{resolver})).rejected,'dkim_not_authenticated');
 db.close();
});

const d0=code=>[...CODE_ALPHABET].find(ch=>ch!==code[0])+'XYZ';
test('transfer codes are four characters from an unambiguous alphabet',()=>{
 for(let i=0;i<500;i++)assert.match(newTransferCode(),/^[2-9A-HJ-NP-Z]{4}$/);
});
test('title matching tolerates stray spaces, case and extra text but not neighbouring letters or digits',()=>{
 for(const title of ['ABC1','A BC1','AB C1','A B C 1','abc1','Dla Ani ABC1 dziękuję!','WPŁATA: A-B.C 1','ABC1\u00a0'.trim()])assert.ok(titleHasCode(title,'ABC1'),title);
 for(const title of ['ABC12','XABC1','ABC','AB C','ŻABC1','AB1C','1ABC','']) assert.ok(!titleHasCode(title,'ABC1'),title);
 assert.ok(titleHasCode('123 A','123A'));assert.ok(titleHasCode('kiddo 1 2 3A pozdrawiam','123A'));
 assert.ok(titleHasCode('BR-AABBCCDDEEFF','BR-AABBCCDDEEFF'));
});
test('a donation is settled by a sloppy title only for its own organizer, amount and a single candidate',async()=>{
 const {db,config}=setup();const owner=await addUser(db),other=await addUser(db);
 const c=addCampaign(db,owner),otherCampaign=addCampaign(db,other);
 const spaced=code=>code.slice(0,1)+' '+code.slice(1);
 const d=addDonation(db,c,{code:'7K3Q'}),twin=addDonation(db,otherCampaign,{code:'7K3R'}); // another organizer's pending donation never interferes
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,d,{body:`kwotą 50,00 PLN\nNadawca: KIDDO\nTytuł zlecenia: wpłata od kiddo ${spaced(d.code)} dzięki\n`})),'matched');
 assert.equal(db.prepare('SELECT status FROM donations WHERE id=?').get(d.id).status,'confirmed');
 assert.equal(db.prepare('SELECT status FROM donations WHERE id=?').get(twin.id).status,'pending');
 const again=addDonation(db,c,{code:'ZZ22'});
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,again,{body:`kwotą 50,00 PLN\nNadawca: X\nTytuł zlecenia: ZZ223\n`})),'quarantined');
 assert.equal(ingestAuthenticatedMail(db,config,eventFor(owner,again,{body:`kwotą 50,00 PLN\nNadawca: X\nTytuł zlecenia: Z Z 2 2\n`})),'matched');
 db.close();
});
