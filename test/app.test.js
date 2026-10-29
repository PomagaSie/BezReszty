import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup,addUser,addCampaign,addDonation,csrf,login,iban } from './helpers.js';
import { token,hash } from '../src/domain.js';

test('public pages render, errors stay escaped and responses have protective headers',async()=>{
 const {app,db}=setup();const owner=await addUser(db);const campaign=addCampaign(db,owner);
 for(const route of ['/','/zbiorki','/zbiorki?q=Pomagamy','/zbiorki?kategoria=pomoc','/jak-to-dziala','/zasady','/prywatnosc','/logowanie','/rejestracja','/odzyskaj-haslo','/nowe-haslo?token=x',`/zbiorka/${campaign.slug}`]){
  const response=await request(app).get(route);assert.equal(response.status,200,route);assert.match(response.headers['content-security-policy'],/frame-ancestors 'none'/);assert.doesNotMatch(response.text,/<%/);
 }
 const xss=await request(app).get('/zbiorki').query({q:'<script>alert(1)</script>'});assert.doesNotMatch(xss.text,/<script>alert/);assert.match(xss.text,/&lt;script&gt;/);
 assert.equal((await request(app).get('/missing')).status,404);assert.equal((await request(app).get('/panel')).status,302);assert.equal((await request(app).get('/admin')).status,403);db.close();
});
test('registration requires CSRF and creates an unverified non-privileged organizer',async()=>{
 const {app,db,messages}=setup();const agent=request.agent(app);
 assert.equal((await agent.post('/rejestracja').type('form').send({email:'test@example.test'})).status,403);
 const _csrf=await csrf(agent,'/rejestracja');
 const result=await agent.post('/rejestracja').type('form').send({_csrf,email:'Nowy@example.test',name:'Nowy Organizator',password:'bezpieczne-haslo-123',accept:'on',role:'admin',email_verified:1});
 assert.equal(result.status,302);assert.equal(messages.length,1);
 const user=db.prepare('SELECT * FROM users').get();assert.equal(user.email_verified,0);assert.equal(user.role,'organizer');assert.equal(user.email,'nowy@example.test');assert.notEqual(user.password,'bezpieczne-haslo-123');
 const raw=token();db.prepare("INSERT INTO tokens(hash,user_id,purpose,expires_at) VALUES (?,?,'verify',?)").run(hash(raw),user.id,Date.now()+60000);
 assert.equal((await agent.get(`/potwierdz-email?token=${raw}`)).status,200);assert.equal(db.prepare('SELECT email_verified FROM users').get().email_verified,0);
 const signedCsrf=await csrf(agent,'/panel');assert.equal((await agent.post('/potwierdz-email').type('form').send({_csrf:signedCsrf,token:raw})).status,302);
 assert.equal(db.prepare('SELECT email_verified FROM users').get().email_verified,1);assert.equal((await agent.get(`/potwierdz-email?token=${raw}`)).status,400);db.close();
});
test('organizer access is isolated and verification cannot be self-approved',async()=>{
 const {app,db}=setup();const owner=await addUser(db),other=await addUser(db,{verification_status:'unsubmitted'}),campaign=addCampaign(db,owner);
 const agent=request.agent(app),_csrf=await login(agent,other);
 assert.equal((await agent.get(`/panel/zbiorki/${campaign.id}/edytuj`)).status,404);
 assert.equal((await agent.post(`/panel/zbiorki/${campaign.id}/edytuj`).type('form').send({_csrf})).status,404);
 assert.equal((await agent.post(`/admin/organizator/${other.id}`).type('form').send({_csrf,action:'verify',note:'Sprawdzono wszystkie dane.'})).status,403);
 const bank=await agent.post('/panel/weryfikacja').type('form').send({_csrf,name:other.name,phone:'600 000 000',iban,bankConsent:'on',verification_status:'verified'});
 assert.equal(bank.status,302);assert.equal(db.prepare('SELECT verification_status FROM users WHERE id=?').get(other.id).verification_status,'pending');
 assert.equal((await agent.get('/panel/weryfikacja')).status,200);assert.equal((await agent.get('/panel/nowa-zbiorka')).status,200);db.close();
});
test('publishing requires verified organizer and explicit operator review; editing removes publication',async()=>{
 const {app,db}=setup();const owner=await addUser(db),admin=await addUser(db,{role:'admin'});
 const agent=request.agent(app),_csrf=await login(agent,owner);
 const body={_csrf,title:'Pomóżmy wspólnie naszej okolicy',summary:'Przejrzysta testowa zbiórka dla naszej społeczności i wszystkich sąsiadów.',story:'Wspólna historia testowa z jasno opisanym celem i budżetem. '.repeat(4),goal:'1000',category:'spolecznosc',location:'Radzymin',cover:'community',deadline:'',action:'submit'};
 assert.equal((await agent.post('/panel/nowa-zbiorka').type('form').send(body)).status,302);
 const campaign=db.prepare('SELECT * FROM campaigns').get();assert.equal(campaign.status,'pending');assert.equal((await request(app).get(`/zbiorka/${campaign.slug}`)).status,404);
 const operator=request.agent(app),adminCsrf=await login(operator,admin);assert.equal((await operator.get('/admin')).status,200);
 assert.equal((await operator.post(`/admin/zbiorka/${campaign.id}`).type('form').send({_csrf:adminCsrf,action:'publish'})).status,302);
 assert.equal((await request(app).get(`/zbiorka/${campaign.slug}`)).status,200);
 assert.equal((await agent.post(`/panel/zbiorki/${campaign.id}/edytuj`).type('form').send({...body,action:'draft'})).status,302);
 assert.equal(db.prepare('SELECT status FROM campaigns').get().status,'draft');db.close();
});
test('donation intent is pending; exact settlement is exclusively a bank-mail operation',async()=>{
 const {app,db}=setup();const owner=await addUser(db),campaign=addCampaign(db,owner),agent=request.agent(app);
 const _csrf=await csrf(agent,`/zbiorka/${campaign.slug}`);
 for(const amount of ['0','-1','10001','10.999','1e3'])assert.equal((await agent.post(`/zbiorka/${campaign.slug}/wesprzyj`).type('form').send({_csrf,amount})).status,422);
 const response=await agent.post(`/zbiorka/${campaign.slug}/wesprzyj`).type('form').send({_csrf,amount:'50.29',name:'<script>bad</script>',status:'confirmed'});
 assert.equal(response.status,302);const donation=db.prepare('SELECT * FROM donations').get();assert.equal(donation.status,'pending');assert.equal(donation.amount,5029);
 assert.equal((await agent.get(response.headers.location)).status,200);
 assert.deepEqual((await agent.get(`/api/wplaty/${donation.id}`)).body,{status:'pending',amount:5029});
 assert.equal((await agent.post(`/api/wplaty/${donation.id}`).type('form').send({_csrf,status:'confirmed'})).status,404);
 db.prepare("UPDATE users SET verification_status='rejected' WHERE id=?").run(owner.id);
 assert.equal((await agent.post(`/zbiorka/${campaign.slug}/wesprzyj`).type('form').send({_csrf,amount:'50'})).status,409);
 assert.equal((await agent.get(`/api/wplaty/${donation.id}`)).status,404);db.close();
});
test('demo blocks real donation instructions and registrations',async()=>{
 const {app,db}=setup({demo:true});const owner=await addUser(db);const campaign=addCampaign(db,owner);const agent=request.agent(app);
 const _csrf=await csrf(agent,'/logowanie');
 assert.equal((await agent.post(`/zbiorka/${campaign.slug}/wesprzyj`).type('form').send({_csrf,amount:'50'})).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM donations').get().n,0);
 assert.equal((await agent.post('/rejestracja').type('form').send({_csrf,email:'demo@example.test'})).status,403);db.close();
});
test('password reset revokes all sessions and reset links cannot be reused',async()=>{
 const {app,db}=setup();const user=await addUser(db),agent=request.agent(app),_csrf=await login(agent,user);
 const raw=token();db.prepare("INSERT INTO tokens(hash,user_id,purpose,expires_at) VALUES (?,?,'reset',?)").run(hash(raw),user.id,Date.now()+60000);
 const response=await agent.post('/nowe-haslo').type('form').send({_csrf,token:raw,password:'nowe-dobre-haslo-123'});assert.equal(response.status,302);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM tokens').get().n,0);assert.equal((await agent.get('/panel')).status,302);db.close();
});
test('expired campaigns cannot accept new intents and archived pages remain readable',async()=>{
 const {app,db}=setup();const owner=await addUser(db),campaign=addCampaign(db,owner,{deadline:'2020-01-01'}),agent=request.agent(app);
 const response=await agent.get(`/zbiorka/${campaign.slug}`);assert.equal(response.status,200);assert.match(response.text,/nie przyjmuje teraz/);
 const _csrf=await csrf(agent,'/logowanie');assert.equal((await agent.post(`/zbiorka/${campaign.slug}/wesprzyj`).type('form').send({_csrf,amount:'50'})).status,409);db.close();
});

test('operator cannot approve without bank notification and suspension closes campaigns',async()=>{
 const {app,db}=setup();const admin=await addUser(db,{role:'admin'}),organizer=await addUser(db,{verification_status:'pending'});
 db.prepare('UPDATE users SET bank_notification_seen=0 WHERE id=?').run(organizer.id);
 const agent=request.agent(app),_csrf=await login(agent,admin);
 assert.equal((await agent.post(`/admin/organizator/${organizer.id}`).type('form').send({_csrf,action:'verify',note:'Sprawdzono dane właściciela i numer BLIK.'})).status,409);
 db.prepare('UPDATE users SET bank_notification_seen=1 WHERE id=?').run(organizer.id);
 assert.equal((await agent.post(`/admin/organizator/${organizer.id}`).type('form').send({_csrf,action:'verify',note:'Sprawdzono dane właściciela i numer BLIK.'})).status,302);
 const campaign=addCampaign(db,organizer);
 assert.equal((await agent.post(`/admin/organizator/${organizer.id}`).type('form').send({_csrf,action:'suspend',note:'Wstrzymano w celu wyjaśnienia rachunku.'})).status,302);
 assert.equal(db.prepare('SELECT status FROM campaigns WHERE id=?').get(campaign.id).status,'closed');
 assert.equal((await request(app).get(`/zbiorka/${campaign.slug}`)).status,404);db.close();
});
test('cross-origin forms and invalid UTF-8-length CSRF are rejected without a server error',async()=>{
 const {app,db}=setup();const agent=request.agent(app),_csrf=await csrf(agent);
 assert.equal((await agent.post('/logowanie').set('Origin','https://attacker.example').type('form').send({_csrf,email:'x@example.test',password:'x'})).status,403);
 assert.equal((await agent.post('/logowanie').type('form').send({_csrf:'ą'.repeat(64)})).status,403);db.close();
});
test('bank webhook requires fresh HMAC over exact raw bytes, persists rejection and exposes no CSRF bypass',async()=>{
 const {createHmac}=await import('node:crypto');
 const secret='a'.repeat(64),{app,db}=setup({bankWebhookSecret:secret});
 const raw='From: powiadomienia@alior.pl\r\nTo: alias@example.test\r\n\r\nSfałszowana treść';
 assert.equal((await request(app).post('/api/bank-mail').set('Content-Type','message/rfc822').send(raw)).status,401);
 const ts=String(Date.now()),sig=createHmac('sha256',secret).update(ts+'\n').update(raw).digest('hex');
 const response=await request(app).post('/api/bank-mail').set('Content-Type','message/rfc822').set('X-Bezreszty-Timestamp',ts).set('X-Bezreszty-Signature',sig).send(raw);
 assert.equal(response.status,204);assert.equal(db.prepare('SELECT status FROM bank_messages').get().status,'rejected');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM donations').get().n,0);
 assert.equal((await request(app).post('/api/bank-mail').set('Content-Type','message/rfc822').set('X-Bezreszty-Timestamp',ts).set('X-Bezreszty-Signature',sig).send(raw+'zmiana')).status,401);db.close();
});
test('same-origin forms send a real Origin header, so the Origin check accepts them',async()=>{
 const {app,db,config}=setup();const agent=request.agent(app);
 const page=await agent.get('/rejestracja');
 // "no-referrer" makes browsers send "Origin: null" on same-origin POSTs, which the Origin check rejects
 assert.equal(page.headers['referrer-policy'],'same-origin');
 const _csrf=await csrf(agent,'/rejestracja');
 const result=await agent.post('/rejestracja').set('Origin',config.baseUrl).type('form').send({_csrf,email:'origin@example.test',name:'Organizator Origin',password:'bezpieczne-haslo-123',accept:'on'});
 assert.equal(result.status,302);db.close();
});
test('static assets are referenced with a content-hash version so deploys bust browser caches',async()=>{
 const {app,db}=setup();const page=await request(app).get('/');
 const css=page.text.match(/href="(\/assets\/style\.css\?v=[a-f0-9]{10})"/);assert.ok(css,'versioned stylesheet');
 assert.match(page.text,/src="\/brand\/mark\.svg\?v=[a-f0-9]{10}"/);
 assert.equal((await request(app).get(css[1])).status,200);db.close();
});

test('domain migration preserves paths and query strings and never replays an old-domain POST',async()=>{
 const {app,db}=setup({baseUrl:'https://bezreszty.org.pl',legacyDomains:['bezreszty.mleczki.pl','www.bezreszty.org.pl']});
 for(const host of ['bezreszty.mleczki.pl','www.bezreszty.org.pl']){
  const response=await request(app).get('/zbiorki?q=ogrod&kategoria=spolecznosc').set('Host',host);
  assert.equal(response.status,308);assert.equal(response.headers.location,'https://bezreszty.org.pl/zbiorki?q=ogrod&kategoria=spolecznosc');
 }
 assert.equal((await request(app).post('/logowanie').set('Host','bezreszty.mleczki.pl').send({password:'unused'})).status,409);
 assert.equal((await request(app).get('/healthz').set('Host','bezreszty.org.pl')).status,200);db.close();
});
