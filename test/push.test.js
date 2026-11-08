import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { setup, addUser, addCampaign, addDonation, csrf, login, enableMfa } from './helpers.js';
import { isPushEndpoint, encryptPayload, vapidAuthorization, createPush } from '../src/push.js';
import { ingestAuthenticatedMail } from '../src/bank.js';

// A "browser": the receiving side of RFC 8291, written independently of src/push.js.
function browser(host = 'fcm.googleapis.com') {
  const keys = createECDH('prime256v1'); keys.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://${host}/fcm/send/${randomBytes(12).toString('hex')}`;
  const subscription = { endpoint, keys: { p256dh: keys.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const decrypt = body => {
    const salt = body.subarray(0, 16), size = body.readUInt32BE(16), idLength = body[20], sender = body.subarray(21, 21 + idLength), record = body.subarray(21 + idLength);
    assert.equal(size, 4096); assert.equal(idLength, 65);
    const ikm = hkdfSync('sha256', keys.computeSecret(sender), auth, Buffer.concat([Buffer.from('WebPush: info\0'), keys.getPublicKey(), sender]), 32);
    const cek = Buffer.from(hkdfSync('sha256', Buffer.from(ikm), salt, 'Content-Encoding: aes128gcm\0', 16)), nonce = Buffer.from(hkdfSync('sha256', Buffer.from(ikm), salt, 'Content-Encoding: nonce\0', 12));
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce); decipher.setAuthTag(record.subarray(record.length - 16));
    const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 2); // last-record padding delimiter
    return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
  };
  return { subscription, endpoint, decrypt };
}
// A push service: records what it receives per endpoint; `status` can be changed to simulate failures.
function pushService() {
  const service = { requests: [], status: 201, fetchImpl: async (url, options) => { service.requests.push({ url, ...options, body: Buffer.from(options.body) }); return { status: service.status }; } };
  return service;
}
const subscribeTo = async (agent, token, device) => agent.post('/api/push/subscribe').set('X-CSRF-Token', token).send(device.subscription);
const received = (service, device) => service.requests.filter(r => r.url === device.endpoint).map(r => device.decrypt(r.body));

test('only the browsers\' own push services are accepted as endpoints', () => {
  for (const good of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/abc']) assert.equal(isPushEndpoint(good), true, good);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'notaurl', '', null, undefined, 42, `https://fcm.googleapis.com/${'a'.repeat(2100)}`]) assert.equal(isPushEndpoint(bad), false, String(bad));
});

test('payloads are RFC 8291 aes128gcm records that only the subscribed browser can read', () => {
  const device = browser(), message = JSON.stringify({ title: 'Nowa wpłata: 50 zł', body: 'Zbiórka „Żółć”' });
  const body = encryptPayload(message, device.subscription.keys.p256dh, device.subscription.keys.auth);
  assert.deepEqual(device.decrypt(body), JSON.parse(message));
  assert.ok(!body.includes(Buffer.from('Nowa')));
  assert.notDeepEqual(encryptPayload(message, device.subscription.keys.p256dh, device.subscription.keys.auth), body); // fresh key and salt each time
  assert.throws(() => browser().decrypt(body)); // another browser cannot decrypt it
});

test('VAPID authorization is an ES256 JWT for the push service origin that verifies with the published key', () => {
  const { db, config, push } = setup({ operatorEmail: 'op@example.test' });
  const key = push.publicKey(); assert.ok(key); assert.equal(Buffer.from(key, 'base64url').length, 65);
  assert.equal(push.publicKey(), key); // stable
  assert.equal(createPush(config, db).publicKey(), key); // and shared by another process opening the same database
  assert.ok(!db.prepare("SELECT value FROM app_secrets WHERE name='vapid'").get().value.includes(key)); // the private key at rest is encrypted
  const [, jwt, k] = push.authorization('https://fcm.googleapis.com/fcm/send/abc', 1_800_000_000_000).match(/^vapid t=([^,]+), k=(.+)$/); assert.equal(k, key);
  const [head, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'mailto:op@example.test' });
  const point = Buffer.from(key, 'base64url');
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  db.close();
});

test('subscribing needs a session, CSRF and a real browser subscription; the first notification confirms it works', async () => {
  const service = pushService(), { app, db, push } = setup({}, { fetchImpl: service.fetchImpl });
  const user = await addUser(db), device = browser();
  assert.equal((await request(app).post('/api/push/subscribe').send(device.subscription)).status, 403); // no session, so no CSRF token either
  const agent = request.agent(app), token = await login(agent, user);
  assert.equal((await agent.post('/api/push/subscribe').send(device.subscription)).status, 403);
  for (const bad of [{}, { endpoint: 'https://evil.example/x', keys: device.subscription.keys }, { endpoint: device.endpoint, keys: { p256dh: 'AAAA', auth: device.subscription.keys.auth } }, { endpoint: device.endpoint, keys: { p256dh: device.subscription.keys.p256dh, auth: 'AAAA' } }, { endpoint: device.endpoint, keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: device.subscription.keys.auth } }]) {
    const response = await agent.post('/api/push/subscribe').set('X-CSRF-Token', token).send(bad);
    assert.equal(response.status, 422, JSON.stringify(bad)); assert.ok(response.body.error);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 0);
  assert.equal((await subscribeTo(agent, token, device)).status, 201);
  await push.flush();
  const [welcome] = received(service, device);
  assert.equal(welcome.title, 'Powiadomienia włączone');
  const request1 = service.requests[0];
  assert.equal(request1.headers['Content-Encoding'], 'aes128gcm'); assert.match(request1.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/); assert.equal(request1.redirect, 'manual');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n, 0);
  assert.equal((await agent.post('/api/push/status').set('X-CSRF-Token', token).send({ endpoint: device.endpoint })).body.subscribed, true);
  assert.equal((await agent.post('/api/push/status').set('X-CSRF-Token', token).send({ endpoint: browser().endpoint })).body.subscribed, false);
  db.close();
});

test('the panel offers notifications only where the server can send them', async () => {
  for (const [extra, shown] of [[{}, true], [{ mfaEncryptionKey: '' }, false], [{ demo: true }, false]]) {
    const { app, db } = setup(extra); const user = await addUser(db), agent = request.agent(app);
    if (extra.demo) db.prepare('UPDATE users SET verification_status=? WHERE id=?').run('verified', user.id);
    await login(agent, user);
    const page = await agent.get('/panel'); assert.equal(page.status, 200); assert.equal(page.text.includes('data-push'), shown);
    if (!shown) assert.equal((await agent.post('/api/push/subscribe').set('X-CSRF-Token', page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1]).send(browser().subscription)).status, 422);
    db.close();
  }
});

test('a confirmed donation notifies the campaign owner only, without donor name or message', async () => {
  const service = pushService(), { db, config, app, push } = setup({}, { fetchImpl: service.fetchImpl });
  const owner = await addUser(db), other = await addUser(db), campaign = addCampaign(db, owner, { title: 'Dach dla Burka' });
  const phone = browser(), tablet = browser(), stranger = browser();
  for (const [user, device] of [[owner, phone], [owner, tablet], [other, stranger]]) { const agent = request.agent(app); await subscribeTo(agent, await login(agent, user), device); }
  await push.flush(); service.requests.length = 0;
  const donation = addDonation(db, campaign, { amount: 5000 });
  db.prepare("UPDATE donations SET name='Jan Kowalski',message='Dla Burka!' WHERE id=?").run(donation.id);
  const event = { fingerprint: crypto.randomUUID(), recipient: `${owner.notification_alias}@${config.notificationDomain}`, subject: 'Uznanie rachunku 96...0001 kwotą 50,00 PLN', body: `kwotą 50,00 PLN\nNadawca: JAN\nTytuł zlecenia: ${donation.code}\n`, date: new Date().toISOString() };
  assert.equal(ingestAuthenticatedMail(db, config, event), 'matched');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n, 2); // written with the donation, one per device
  await push.flush();
  for (const device of [phone, tablet]) assert.deepEqual(received(service, device).map(m => [m.title, m.body, m.url]), [['Nowa wpłata: 50\u00a0zł', 'Zbiórka „Dach dla Burka”', '/panel']]);
  assert.deepEqual(received(service, stranger), []);
  assert.ok(!service.requests.some(r => r.body.includes('Kowalski')));
  assert.ok(!JSON.stringify(received(service, phone)).match(/Kowalski|Burka!/));
  // The same bank mail again is a duplicate: no second notification. An unmatched transfer does not notify either.
  assert.equal(ingestAuthenticatedMail(db, config, event), 'duplicate');
  assert.equal(ingestAuthenticatedMail(db, config, { ...event, fingerprint: crypto.randomUUID() }), 'quarantined');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n, 0);
  db.close();
});

test('a campaign sent for acceptance notifies operators once, not organizers', async () => {
  const service = pushService(), { app, db, push } = setup({}, { fetchImpl: service.fetchImpl });
  const admin = enableMfa(db, await addUser(db, { role: 'admin' })), second = enableMfa(db, await addUser(db, { role: 'admin' })), organizer = await addUser(db);
  const desk = browser(), phone = browser(), mine = browser();
  const adminAgent = request.agent(app), adminToken = await login(adminAgent, admin);
  assert.match((await adminAgent.get('/admin')).text, /data-push/);
  await subscribeTo(adminAgent, adminToken, desk); await subscribeTo(adminAgent, adminToken, phone);
  const organizerAgent = request.agent(app), token = await login(organizerAgent, organizer); await subscribeTo(organizerAgent, token, mine);
  void second; await push.flush(); service.requests.length = 0;
  const form = { _csrf: token, title: 'Pomóżmy wspólnie naszej okolicy', summary: 'Przejrzysta testowa zbiórka dla naszej społeczności i wszystkich sąsiadów.', story: 'Wspólna historia testowa z jasno opisanym celem i budżetem. '.repeat(4), goal: '1000', category: 'spolecznosc', location: 'Radzymin', cover: 'community', deadline: '' };
  assert.equal((await organizerAgent.post('/panel/nowa-zbiorka').type('form').send({ ...form, action: 'draft' })).status, 302);
  await push.flush(); assert.equal(service.requests.length, 0); // drafts are not for the operator
  assert.equal((await organizerAgent.post('/panel/nowa-zbiorka').type('form').send({ ...form, action: 'submit' })).status, 302);
  await push.flush();
  for (const device of [desk, phone]) assert.deepEqual(received(service, device).map(m => [m.title, m.url]), [['Zbiórka czeka na akceptację', '/admin']]);
  assert.match(received(service, desk)[0].body, /Pomóżmy wspólnie naszej okolicy/);
  assert.deepEqual(received(service, mine), []);
  // Editing a campaign that is already waiting does not ping again.
  const id = db.prepare("SELECT id FROM campaigns WHERE status='pending'").get().id;
  service.requests.length = 0;
  assert.equal((await organizerAgent.post(`/panel/zbiorki/${id}/edytuj`).type('form').send({ ...form, action: 'submit' })).status, 302);
  await push.flush(); assert.equal(service.requests.length, 0);
  db.close();
});

test('dead subscriptions are removed, temporary failures are retried and then given up on', async () => {
  const service = pushService(), { app, db, push } = setup({}, { fetchImpl: service.fetchImpl });
  const user = await addUser(db), gone = browser(), flaky = browser();
  const agent = request.agent(app), token = await login(agent, user);
  service.status = 410; await subscribeTo(agent, token, gone); await push.flush();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 0); // 410 Gone: forgotten, with its queue
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n, 0);
  service.status = 503; await subscribeTo(agent, token, flaky); await push.flush();
  let row = db.prepare('SELECT attempts,next_attempt_at FROM push_outbox').get();
  assert.equal(row.attempts, 1); assert.ok(row.next_attempt_at > Date.now());
  const count = service.requests.length; await push.flush(); assert.equal(service.requests.length, count); // not before its time
  for (let attempt = 0; attempt < 6; attempt++) { db.prepare('UPDATE push_outbox SET next_attempt_at=0').run(); await push.flush(); }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n, 0); // given up after the attempt limit
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 1); // but the device is kept
  // A network error counts as temporary too.
  const offline = setup({}, { fetchImpl: async () => { throw new Error('offline'); } }), other = await addUser(offline.db), agent2 = request.agent(offline.app);
  await subscribeTo(agent2, await login(agent2, other), browser()); await offline.push.flush();
  assert.equal(offline.db.prepare('SELECT attempts FROM push_outbox').get().attempts, 1);
  db.close(); offline.db.close();
});

test('turning notifications off, logging out and switching accounts keep them from reaching the wrong person', async () => {
  const service = pushService(), { app, db, push } = setup({}, { fetchImpl: service.fetchImpl });
  const first = await addUser(db), second = await addUser(db), device = browser(), other = browser();
  service.status = 503; // the push service is down, so nothing is delivered yet
  const a = request.agent(app), tokenA = await login(a, first); await subscribeTo(a, tokenA, device); await push.flush();
  // Account B cannot remove or probe A's device, but can claim the browser for itself; what was queued for A does not follow.
  const b = request.agent(app), tokenB = await login(b, second);
  assert.equal((await b.post('/api/push/unsubscribe').set('X-CSRF-Token', tokenB).send({ endpoint: device.endpoint })).body.removed, false);
  assert.equal((await b.post('/api/push/status').set('X-CSRF-Token', tokenB).send({ endpoint: device.endpoint })).body.subscribed, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n, 1); // A's welcome, still waiting because the service was down
  await subscribeTo(b, tokenB, device); await push.flush();
  assert.equal(db.prepare('SELECT user_id FROM push_subscriptions').get().user_id, second.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n, 1); // only B's own welcome
  service.status = 201; service.requests.length = 0; db.prepare('UPDATE push_outbox SET next_attempt_at=0').run(); await push.flush();
  assert.equal(received(service, device).length, 1);
  assert.equal((await a.post('/api/push/unsubscribe').set('X-CSRF-Token', tokenA).send({ endpoint: device.endpoint })).body.removed, false);
  assert.equal((await b.post('/api/push/unsubscribe').set('X-CSRF-Token', tokenB).send({ endpoint: device.endpoint })).body.removed, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 0);
  // At most ten devices per account: the oldest are dropped.
  for (let i = 0; i < 12; i++) { await subscribeTo(b, tokenB, browser()); db.prepare('UPDATE push_subscriptions SET created_at=? WHERE rowid=(SELECT MAX(rowid) FROM push_subscriptions)').run(new Date(Date.now() + i * 1000).toISOString()); }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?').get(second.id).n, 10);
  void other; db.close();
});

test('the service worker and manifest are served from the site root with the right headers', async () => {
  const { app, db } = setup();
  const worker = await request(app).get('/sw.js');
  assert.equal(worker.status, 200); assert.match(worker.headers['content-type'], /javascript/); assert.equal(worker.headers['cache-control'], 'no-cache'); assert.equal(worker.headers['service-worker-allowed'], '/');
  assert.match(worker.text, /addEventListener\('push'/);
  const manifest = await request(app).get('/assets/manifest.webmanifest');
  assert.equal(manifest.status, 200); assert.match(manifest.headers['content-type'], /manifest|json/);
  assert.match((await request(app).get('/')).text, /rel="manifest"/);
  db.close();
});
