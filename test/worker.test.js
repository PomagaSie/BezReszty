import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../email-worker/index.js';
test('isolated email worker forwards exact RFC822 bytes with HMAC and awaits durable acknowledgement',async()=>{
 const oldFetch=globalThis.fetch,raw='From: powiadomienia@alior.pl\r\n\r\nTreść',secret='b'.repeat(64);let called=0;
 globalThis.fetch=async(url,options)=>{
  called++;assert.equal(url,'https://example.test/api/bank-mail');assert.equal(Buffer.from(options.body).toString(),raw);
  const expected=createHmac('sha256',secret).update(options.headers['X-Bezreszty-Timestamp']+'\n').update(Buffer.from(options.body)).digest('hex');
  assert.equal(options.headers['X-Bezreszty-Signature'],expected);return new Response(null,{status:204});
 };
 try{
  await worker.email({to:'wplaty+'+'a'.repeat(32)+'@bank.example.test',rawSize:Buffer.byteLength(raw),raw:new Response(raw).body,setReject:()=>assert.fail('Valid route rejected')},{BANK_WEBHOOK_URL:'https://example.test/api/bank-mail',BANK_WEBHOOK_SECRET:secret,NOTIFICATION_DOMAIN:'bank.example.test'});
  assert.equal(called,1);
  let rejected=false;await worker.email({to:'somebody@bank.example.test',rawSize:1,setReject:()=>rejected=true},{NOTIFICATION_DOMAIN:'bank.example.test'});assert.equal(rejected,true);
 }finally{globalThis.fetch=oldFetch;}
});
