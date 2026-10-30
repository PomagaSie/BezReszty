import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup, addUser, csrf, login, enableMfa, testMfaKey, addCampaign, addDonation } from './helpers.js';
import { hash, token, passwordMatches } from '../src/domain.js';
import { createApp } from '../src/app.js';
import { createMfaSecret, encryptMfaSecret, decryptMfaSecret, mfaStep, mfaTotp, createRecoveryCodes } from '../src/mfa.js';
import { openDatabase, pruneAuthState } from '../src/db.js';
import { readConfig } from '../src/config.js';

const password = 'bezpieczne-haslo-123';
async function challenge(agent, user, pass = password) {
 const _csrf=await csrf(agent);
 const response=await agent.post('/logowanie').type('form').send({_csrf,email:user.email,password:pass});
 assert.equal(response.status,302);assert.equal(response.headers.location,'/logowanie/2fa');
 return csrf(agent,'/logowanie/2fa');
}

test('only one concurrent password reset can consume a token and win', async () => {
 const {app,db}=setup(),user=await addUser(db),raw=token();
 const agents=[request.agent(app),request.agent(app)],values=await Promise.all(agents.map(a=>csrf(a)));
 db.prepare("INSERT INTO tokens(hash,user_id,purpose,expires_at) VALUES (?,?,'reset',?)").run(hash(raw),user.id,Date.now()+60000);
 const results=await Promise.all(agents.map((a,i)=>a.post('/nowe-haslo').type('form').send({_csrf:values[i],token:raw,password:`rownolegle-nowe-haslo-${i}`})));
 assert.deepEqual(results.map(r=>r.status).sort(),[302,400]);
 const winner=results.findIndex(r=>r.status===302),stored=db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password;
 assert.equal(await passwordMatches(`rownolegle-nowe-haslo-${winner}`,stored),true);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM tokens').get().n,0);db.close();
});

test('legacy hashes upgrade only after successful authentication', async () => {
 const {app,db}=setup(),user=await addUser(db),salt='0123456789abcdef0123456789abcdef';
 const legacy=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
 db.prepare('UPDATE users SET password=? WHERE id=?').run(legacy,user.id);
 const agent=request.agent(app),_csrf=await csrf(agent);
 assert.equal((await agent.post('/logowanie').type('form').send({_csrf,email:user.email,password:'wrong'})).status,401);
 assert.equal(db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password,legacy);
 await login(agent,user);assert.match(db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password,/^scrypt\$16384\$8\$5\$/);db.close();
});

test('account throttling spans IP addresses and survives app recreation without storing raw identities', async () => {
 const {app,db,config}=setup({trustProxy:1}),user=await addUser(db),agent=request.agent(app),_csrf=await csrf(agent);
 for(let i=1;i<=10;i++) assert.equal((await agent.post('/logowanie').set('X-Forwarded-For',`192.0.2.${i}`).type('form').send({_csrf,email:user.email,password:'wrong'})).status,401);
 assert.equal((await agent.post('/logowanie').set('X-Forwarded-For','192.0.2.11').type('form').send({_csrf,email:user.email.toUpperCase(),password})).status,429);
 const restarted=createApp({config,db,sendMail:async()=>{}}),fresh=request.agent(restarted),freshCsrf=await csrf(fresh);
 assert.equal((await fresh.post('/logowanie').set('X-Forwarded-For','192.0.2.12').type('form').send({_csrf:freshCsrf,email:user.email,password})).status,429);
 const rows=db.prepare('SELECT key FROM rate_limits').all();assert.ok(rows.length>0);assert.ok(rows.every(r=>/^[a-f0-9]{64}$/.test(r.key)));
 db.prepare('UPDATE rate_limits SET reset_at=?').run(Date.now()-1);
 assert.equal((await fresh.post('/logowanie').set('X-Forwarded-For','192.0.2.13').type('form').send({_csrf:freshCsrf,email:user.email,password})).status,302);db.close();
});

test('TOTP matches the RFC 6238 SHA1 vector with a bounded clock window', () => {
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 assert.equal(mfaStep(secret,'287082',59000),1);assert.equal(mfaStep(secret,'287082',89000),1);
 assert.equal(mfaStep(secret,'287082',90000),null);assert.equal(mfaStep(secret,'not-a-code',59000),null);
});

test('MFA secrets are encrypted, authenticated and bound to the account and encryption key', () => {
 const config={mfaEncryptionKey:testMfaKey},secret=createMfaSecret(),encrypted=encryptMfaSecret(config,'user-a',secret);
 assert.ok(!encrypted.includes(secret));assert.equal(decryptMfaSecret(config,'user-a',encrypted),secret);
 assert.throws(()=>decryptMfaSecret(config,'user-b',encrypted));
 assert.throws(()=>decryptMfaSecret({mfaEncryptionKey:'other-key-'.repeat(8)},'user-a',encrypted));
 const bytes=Buffer.from(encrypted,'base64url');bytes[30]^=1;assert.throws(()=>decryptMfaSecret(config,'user-a',bytes.toString('base64url')));
 assert.throws(()=>encryptMfaSecret({},'user-a',secret));
});

test('organizers can enroll with Authenticator, see recovery codes once and revoke other sessions', async () => {
 const {app,db,config}=setup(),user=await addUser(db),agent=request.agent(app),other=request.agent(app);
 let _csrf=await login(agent,user);await login(other,user);
 assert.equal((await agent.get('/panel')).status,200);
 assert.equal((await agent.post('/panel/bezpieczenstwo/2fa/start').type('form').send({password})).status,403);
 assert.equal((await agent.post('/panel/bezpieczenstwo/2fa/start').type('form').send({_csrf,password:'wrong'})).status,401);
 assert.equal((await agent.post('/panel/bezpieczenstwo/2fa/start').type('form').send({_csrf,password})).status,302);
 const enrollment=db.prepare('SELECT * FROM mfa_enrollments WHERE user_id=?').get(user.id),secret=decryptMfaSecret(config,user.id,enrollment.secret);
 const page=await agent.get('/panel/bezpieczenstwo');assert.equal(page.status,200);assert.match(page.headers['cache-control'],/no-store/);assert.ok(page.text.includes(secret));assert.match(page.text,/data:image\/png;base64,/);
 assert.ok(!(await other.get('/panel/bezpieczenstwo')).text.includes(secret));
 const otherCsrf=await csrf(other,'/panel');
 assert.equal((await other.post('/panel/bezpieczenstwo/2fa/potwierdz').type('form').send({_csrf:otherCsrf,code:mfaTotp(secret).generate()})).status,400);
 const response=await agent.post('/panel/bezpieczenstwo/2fa/potwierdz').type('form').send({_csrf,code:mfaTotp(secret).generate()});assert.equal(response.status,200);
 const codes=[...response.text.matchAll(/<code>([A-F0-9]{4}(?:-[A-F0-9]{4}){4})<\/code>/g)].map(m=>m[1]);assert.equal(codes.length,10);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(user.id).n,1);
 assert.equal((await other.get('/panel')).status,302);
 const enabled=await agent.get('/panel/bezpieczenstwo');assert.ok(!enabled.text.includes(secret));assert.ok(!enabled.text.includes(codes[0]));
 assert.ok(db.prepare('SELECT hash FROM mfa_recovery_codes').all().every(r=>/^[a-f0-9]{64}$/.test(r.hash)));
 const next=request.agent(app);_csrf=await challenge(next,user);
 assert.equal((await next.get('/panel')).status,302);assert.equal((await next.get('/admin')).status,403);
 assert.equal((await next.post('/logowanie/2fa').type('form').send({code:codes[0]})).status,403);
 assert.equal((await next.post('/logowanie/2fa').type('form').send({_csrf,code:'wrong'})).status,401);
 assert.equal((await next.post('/logowanie/2fa').type('form').send({_csrf,code:codes[0]})).status,302);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mfa_recovery_codes').get().n,9);
 const replay=request.agent(app),replayCsrf=await challenge(replay,user);
 assert.equal((await replay.post('/logowanie/2fa').type('form').send({_csrf:replayCsrf,code:codes[0]})).status,401);
 _csrf=await csrf(next,'/panel/bezpieczenstwo');
 assert.equal((await next.post('/panel/bezpieczenstwo/2fa/wylacz').type('form').send({_csrf,password,code:codes[1]})).status,302);
 assert.equal(db.prepare('SELECT mfa_secret FROM users WHERE id=?').get(user.id).mfa_secret,null);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mfa_recovery_codes').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mfa_challenges').get().n,0);assert.equal((await agent.get('/panel')).status,302);db.close();
});

test('operators must enroll before accessing any privileged view or action and cannot disable 2FA', async () => {
 const {app,db}=setup(),admin=await addUser(db,{role:'admin'}),owner=await addUser(db),draft=addCampaign(db,owner,{status:'draft'}),agent=request.agent(app);
 const _csrf=await login(agent,admin);
 for(const path of ['/admin','/panel',`/zbiorka/${draft.slug}`]) {
   const r=await agent.get(path);assert.equal(r.status,302);assert.equal(r.headers.location,'/panel/bezpieczenstwo');
 }
 assert.equal((await agent.post(`/admin/organizator/${owner.id}`).type('form').send({_csrf,action:'suspend',note:'Powinno wymagać 2FA.'})).status,403);
 assert.equal((await agent.get('/panel/bezpieczenstwo')).status,200);
 // Simulate completed enrollment, but keep the old password-only session.
 enableMfa(db,admin);assert.equal((await agent.get('/admin')).status,403);
 const verified=request.agent(app),verifiedCsrf=await login(verified,admin);assert.equal((await verified.get('/admin')).status,200);
 assert.equal((await verified.post('/panel/bezpieczenstwo/2fa/wylacz').type('form').send({_csrf:verifiedCsrf,password,code:'123456'})).status,403);
 assert.ok(db.prepare('SELECT mfa_secret FROM users WHERE id=?').get(admin.id).mfa_secret);db.close();
});

test('TOTP cannot be replayed and expired login challenges grant no session', async () => {
 const {app,db}=setup(),user=await addUser(db);enableMfa(db,user);
 const agent=request.agent(app),_csrf=await challenge(agent,user),code=mfaTotp(user.mfaTestSecret).generate();
 assert.equal((await agent.post('/logowanie/2fa').type('form').send({_csrf,code})).status,302);
 const second=request.agent(app),otherCsrf=await challenge(second,user);
 assert.equal((await second.post('/logowanie/2fa').type('form').send({_csrf:otherCsrf,code})).status,401);
 db.prepare('UPDATE mfa_challenges SET expires_at=?').run(Date.now()-1);
 assert.equal((await second.get('/logowanie/2fa')).headers.location,'/logowanie');assert.equal((await second.get('/panel')).status,302);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);db.close();
});

test('password reset revokes pending MFA challenges without removing the second factor', async () => {
 const {app,db}=setup(),user=await addUser(db);enableMfa(db,user);createRecoveryCodes(db,user.id);
 const pending=request.agent(app);await challenge(pending,user);
 const reset=request.agent(app),_csrf=await csrf(reset),raw=token();
 db.prepare("INSERT INTO tokens(hash,user_id,purpose,expires_at) VALUES (?,?,'reset',?)").run(hash(raw),user.id,Date.now()+60000);
 assert.equal((await reset.post('/nowe-haslo').type('form').send({_csrf,token:raw,password:'nowe-bezpieczne-haslo-123'})).status,302);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mfa_challenges').get().n,0);assert.ok(db.prepare('SELECT mfa_secret FROM users WHERE id=?').get(user.id).mfa_secret);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mfa_recovery_codes').get().n,10);
 await challenge(request.agent(app),user,'nowe-bezpieczne-haslo-123');db.close();
});

test('production requires a stable MFA encryption key and supports an existing webhook secret', () => {
 const env={NODE_ENV:'production',BASE_URL:'https://example.test',NOTIFICATION_DOMAIN:'mail.example.test',OPERATOR_NAME:'Test',SMTP_HOST:'smtp.example.test',IMAP_HOST:'imap.example.test'};
 assert.throws(()=>readConfig(env),/MFA_ENCRYPTION_KEY/);
 assert.equal(readConfig({...env,MFA_ENCRYPTION_KEY:testMfaKey}).mfaEncryptionKey,testMfaKey);
 assert.equal(readConfig({...env,BANK_WEBHOOK_SECRET:testMfaKey}).mfaEncryptionKey,testMfaKey);
 assert.equal(readConfig({...env,BANK_WEBHOOK_SECRET:'fallback-'.repeat(8),MFA_ENCRYPTION_KEY:testMfaKey}).mfaEncryptionKey,testMfaKey);
});

test('expired authentication state is pruned without changing active sessions or limits', async () => {
 const {db}=setup(),user=await addUser(db),past=Date.now()-1000,future=Date.now()+60000;
 for (const [suffix,expires] of [['expired',past],['active',future]]) {
   db.prepare('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES (?,?,?,?)').run(hash(suffix),user.id,token(),expires);
   db.prepare("INSERT INTO tokens(hash,user_id,purpose,expires_at) VALUES (?,?,'reset',?)").run(hash(suffix),user.id,expires);
   db.prepare('INSERT INTO mfa_challenges(hash,user_id,csrf,expires_at) VALUES (?,?,?,?)').run(hash(suffix),user.id,token(),expires);
   db.prepare('INSERT INTO rate_limits(bucket,key,hits,reset_at) VALUES (?,?,1,?)').run('test',hash(suffix),expires);
 }
 db.prepare('INSERT INTO mfa_enrollments(user_id,session_hash,secret,expires_at) VALUES (?,?,?,?)').run(user.id,hash('expired'),'encrypted-test-value',past);
 pruneAuthState(db);
 for(const table of ['sessions','tokens','mfa_challenges','rate_limits']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mfa_enrollments').get().n,0);db.close();
});

test('local MFA recovery revokes access, records an audit and never promotes an organizer', async t => {
 const dir=mkdtempSync(join(tmpdir(),'bezreszty-mfa-recovery-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'test.sqlite');let db=openDatabase(path);const user=await addUser(db);enableMfa(db,user);createRecoveryCodes(db,user.id);
 db.prepare('INSERT INTO sessions(hash,user_id,csrf,expires_at,mfa_verified) VALUES (?,?,?,?,1)').run(hash('session'),user.id,token(),Date.now()+60000);
 db.prepare('INSERT INTO mfa_challenges(hash,user_id,csrf,expires_at) VALUES (?,?,?,?)').run(hash('challenge'),user.id,token(),Date.now()+60000);
 db.close();
 const result=spawnSync(process.execPath,['scripts/admin.js',user.email,'--reset-mfa'],{cwd:resolve('.'),env:{...process.env,NODE_ENV:'test',DB_PATH:path},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);db=openDatabase(path);
 const updated=db.prepare('SELECT role,mfa_secret,mfa_last_step FROM users WHERE id=?').get(user.id);
 assert.equal(updated.role,'organizer');assert.equal(updated.mfa_secret,null);assert.equal(updated.mfa_last_step,null);
 for(const table of ['sessions','mfa_challenges','mfa_recovery_codes']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE actor_id IS NULL AND action='mfa_reset_via_cli' AND target_id=?").get(user.id).n,1);db.close();
});

test('dashboard pagination keeps complete totals and public pages read updated cached amounts', async () => {
 const {app,db}=setup(),user=await addUser(db),campaigns=Array.from({length:13},()=>addCampaign(db,user));
 const a=addDonation(db,campaigns[0],{amount:12345}),b=addDonation(db,campaigns[12],{amount:2000});
 db.prepare("UPDATE donations SET status='confirmed',confirmed_at=? WHERE id IN (?,?)").run(new Date().toISOString(),a.id,b.id);
 const agent=request.agent(app);await login(agent,user);
 const first=await agent.get('/panel'),second=await agent.get('/panel?strona=2');
 assert.equal((first.text.match(/>Podgląd ↗<\/a>/g)||[]).length,12);assert.equal((second.text.match(/>Podgląd ↗<\/a>/g)||[]).length,1);
 for(const page of [first,second]){assert.match(page.text,/143,45/);assert.match(page.text,/>13<\/strong>/);}
 const publicPage=await request(app).get(`/zbiorka/${campaigns[0].slug}`);assert.match(publicPage.text,/123,45/);db.close();
});
