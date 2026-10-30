import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign';
import { authenticateBankMail, ingestAuthenticatedMail } from '../src/bank.js';
import { setup, addUser } from './helpers.js';

const { privateKey, publicKey }=generateKeyPairSync('rsa',{modulusLength:2048});
const privatePem=privateKey.export({type:'pkcs8',format:'pem'});
const publicDer=publicKey.export({type:'spki',format:'der'}).toString('base64');
const resolver=async(name,type)=>{assert.equal(type,'TXT');assert.equal(name,'test._domainkey.alior.pl');return [[`v=DKIM1; k=rsa; p=${publicDer}`]];};
const config={bankDkimDomains:['alior.pl']};
const boundary='----=_Alior_Test.123';
const body=`--${boundary}\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n--inner\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nkwot=C4=85 1,00 PLN\r\nNadawca: TEST\r\nTytu=C5=82 zlecenia: a 7bc\r\n--inner\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>kwot=C4=85 1,00 PLN<br>Nadawca: TEST<br>Tytu=C5=82 zlecenia: a 7bc</p>\r\n--inner--\r\n--${boundary}\r\nContent-Type: application/pkcs7-signature\r\nContent-Transfer-Encoding: base64\r\n\r\nc2lnbmF0dXJl\r\n--${boundary}--\r\n`;

async function signedMail({content=body,headerList='from:to:subject',signTime=new Date(),...signing}={}) {
 const source=Buffer.from(`From: powiadomienia@alior.pl\r\nTo: alias@bank.example.test\r\nSubject: Uznanie rachunku 96...0001 kwotą 1,00 PLN\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/signed; boundary="${boundary}"; protocol="application/pkcs7-signature"\r\n\r\n${content}`);
 const signed=await dkimSign(source,{headerList,signTime,signatureData:[{signingDomain:'alior.pl',selector:'test',privateKey:privatePem,...signing}]});
 return Buffer.concat([Buffer.from(signed.signatures),source]);
}

test('Alior multipart with only From/To/Subject signed uses signed time and signed MIME parts',async()=>{
 const raw=await signedMail();
 const event=await authenticateBankMail(raw,config,{resolver});
 assert.equal(event.rejected,undefined);
 assert.match(event.body,/Tytuł zlecenia: a 7bc/);
 assert.ok(Math.abs(Date.now()-Date.parse(event.date))<5000);
 const {db,config:appConfig}=setup({notificationDomain:'bank.example.test'});
 const owner=await addUser(db,{verification_status:'pending',notification_alias:'alias'});
 db.prepare("UPDATE users SET bank_notification_seen=0,verification_code='A7BC',verification_started_at=? WHERE id=?").run(new Date(Date.now()-10000).toISOString(),owner.id);
 assert.equal(ingestAuthenticatedMail(db,appConfig,event),'verification');
 assert.equal(ingestAuthenticatedMail(db,appConfig,event),'duplicate');db.close();
});

test('changing unsigned Date, MIME type, boundary or transfer encoding cannot change authenticated content',async()=>{
 const raw=await signedMail();const original=await authenticateBankMail(raw,config,{resolver});
 for(const altered of [
  raw.toString().replace(/^Date:.*$/m,'Date: Mon, 01 Jan 2001 00:00:00 GMT\r'),
  raw.toString().replace(/^Content-Type: multipart\/signed;.*$/m,'Content-Type: text/plain; charset=iso-8859-2\r'),
  raw.toString().replace(/^Content-Type: multipart\/signed;.*$/m,'Content-Type: multipart/mixed; boundary="inner"\r'),
  raw.toString().replace(/\r\n\r\n/,'\r\nContent-Transfer-Encoding: base64\r\n\r\n'),
 ]) {
  const event=await authenticateBankMail(Buffer.from(altered),config,{resolver});
  assert.equal(event.rejected,undefined);assert.equal(event.body,original.body);assert.equal(event.date,original.date);assert.equal(event.fingerprint,original.fingerprint);
 }
});

test('body/header tampering, partial signatures, unsigned recipients and old signed timestamps remain rejected',async()=>{
 const raw=await signedMail();
 for(const changed of [raw.toString().replace('1,00 PLN<br>','9,00 PLN<br>'),raw.toString().replace('alias@bank.example.test','other@bank.example.test')])assert.equal((await authenticateBankMail(Buffer.from(changed),config,{resolver})).rejected,'dkim_not_authenticated');
 assert.equal((await authenticateBankMail(await signedMail({headerList:'from:subject'}),config,{resolver})).rejected,'dkim_not_authenticated');
 assert.equal((await authenticateBankMail(await signedMail({maxBodyLength:100}),config,{resolver})).rejected,'dkim_not_authenticated');
 assert.equal((await authenticateBankMail(await signedMail({signTime:new Date(Date.now()-8*86400000)}),config,{resolver})).rejected,'stale_message');
 assert.equal((await authenticateBankMail(await signedMail({content:'This is not a signed MIME multipart body'}),config,{resolver})).rejected,'dkim_not_authenticated');
});

test('a signed address-change notification never confirms the bank test',async()=>{
 const {db,config:appConfig}=setup({notificationDomain:'bank.example.test'});
 const owner=await addUser(db,{verification_status:'pending',notification_alias:'alias'});
 db.prepare('UPDATE users SET bank_notification_seen=0 WHERE id=?').run(owner.id);
 const raw=Buffer.from((await signedMail()).toString());
 const event=await authenticateBankMail(raw,config,{resolver});
 assert.equal(ingestAuthenticatedMail(db,appConfig,{...event,subject:'Zmiana adresu e-mail do powiadomień'}),'ignored');
 assert.equal(db.prepare('SELECT bank_notification_seen FROM users WHERE id=?').get(owner.id).bank_notification_seen,0);
 db.close();
});
