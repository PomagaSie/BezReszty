import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup, addUser, addCampaign, addDonation, login, csrf, enableMfa } from './helpers.js';
import { pruneTransientData, pruneManagedBackups } from '../src/retention.js';

function bankRow(db, owner, title, { status = 'quarantined', reason = 'unknown_or_ambiguous_reference', date = new Date().toISOString(), donationId = null } = {}) {
  const id = randomUUID();
  db.prepare('INSERT INTO bank_messages(id,fingerprint,owner_id,amount,title,status,reason,received_at,donation_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id, randomUUID(), owner?.id || null, 12345, title, status, reason, date, donationId);
  return id;
}

test('unmatched transfer details belong only to the account owner, including when another user is an admin', async () => {
  const { app, db } = setup();
  const owner = await addUser(db), other = await addUser(db), admin = await addUser(db, { role: 'admin' });
  enableMfa(db, admin);
  bankRow(db, owner, 'PRYWATNY-PRZELEW-WLASCICIELA');
  bankRow(db, other, 'PRYWATNY-PRZELEW-INNEGO');
  bankRow(db, admin, 'WŁASNY-PRZELEW-ADMINA');
  bankRow(db, owner, 'NIEWŁAŚCIWY-RACHUNEK', { reason: 'account_mismatch' });
  bankRow(db, null, 'NIEZNANY-ODBIORCA', { reason: 'unknown_recipient' });
  bankRow(db, owner, 'PRZETERMINOWANY', { date: '2020-01-01T00:00:00.000Z' });
  bankRow(db, owner, '<img src=x onerror=alert(1)>');
  assert.equal((await request(app).get('/panel/niedopasowane-wplaty')).status, 302);
  for (const [user, allowed, forbidden] of [
    [owner, 'PRYWATNY-PRZELEW-WLASCICIELA', 'PRYWATNY-PRZELEW-INNEGO'],
    [other, 'PRYWATNY-PRZELEW-INNEGO', 'PRYWATNY-PRZELEW-WLASCICIELA'],
    [admin, 'WŁASNY-PRZELEW-ADMINA', 'PRYWATNY-PRZELEW-WLASCICIELA'],
  ]) {
    const agent = request.agent(app); await login(agent, user);
    const response = await agent.get('/panel/niedopasowane-wplaty').query({ owner_id: owner.id, userId: owner.id });
    assert.equal(response.status, 200);
    assert.match(response.headers['cache-control'], /no-store/);
    assert.ok(response.text.includes(allowed)); assert.ok(!response.text.includes(forbidden));
    for (const hidden of ['NIEWŁAŚCIWY-RACHUNEK', 'NIEZNANY-ODBIORCA', 'PRZETERMINOWANY', '<img src=x']) assert.ok(!response.text.includes(hidden));
    if (user === owner) assert.ok(response.text.includes('&lt;img src=x'));
    if (user === admin) {
      const panel = await agent.get('/admin'); assert.equal(panel.status, 200);
      for (const hidden of ['PRYWATNY-PRZELEW', 'WŁASNY-PRZELEW', 'NIEZNANY-ODBIORCA', 'NIEWŁAŚCIWY-RACHUNEK']) assert.ok(!panel.text.includes(hidden));
    }
  }
  db.close();
});

test('retention removes expired transient data and QR codes, preserves confirmed totals and linked evidence', async () => {
  const { db } = setup(), owner = await addUser(db), campaign = addCampaign(db, owner);
  const old = '2020-01-01T00:00:00.000Z';
  const expired = addDonation(db, campaign), fresh = addDonation(db, campaign), confirmed = addDonation(db, campaign), linked = addDonation(db, campaign);
  db.prepare('UPDATE donations SET created_at=? WHERE id IN (?,?,?)').run(old, expired.id, confirmed.id, linked.id);
  db.prepare("UPDATE donations SET status='confirmed',confirmed_at=? WHERE id=?").run(old, confirmed.id);
  bankRow(db, owner, 'old-unmatched', { date: old });
  bankRow(db, owner, 'old-rejected', { date: old, status: 'rejected' });
  bankRow(db, owner, 'old-confirmed', { date: old, status: 'matched', donationId: confirmed.id });
  bankRow(db, owner, 'old-verification', { date: old, status: 'verification' });
  bankRow(db, owner, 'recent-unmatched');
  bankRow(db, owner, 'linked-evidence', { status: 'matched', donationId: linked.id });
  db.prepare("UPDATE users SET mobywatel_code='expired-private-code',mobywatel_manual_code='123456',mobywatel_code_expires_at=1 WHERE id=?").run(owner.id);
  const before = db.prepare('SELECT raised,supporters FROM campaign_totals WHERE campaign_id=?').get(campaign.id);
  assert.deepEqual(pruneTransientData(db), { messages: 2, donations: 1 });
  assert.equal(db.prepare('SELECT id FROM donations WHERE id=?').get(expired.id), undefined);
  for (const id of [fresh.id, confirmed.id, linked.id]) assert.ok(db.prepare('SELECT id FROM donations WHERE id=?').get(id));
  assert.deepEqual(db.prepare('SELECT raised,supporters FROM campaign_totals WHERE campaign_id=?').get(campaign.id), before);
  assert.deepEqual(db.prepare('SELECT mobywatel_code,mobywatel_manual_code,mobywatel_code_expires_at FROM users WHERE id=?').get(owner.id), Object.assign(Object.create(null), { mobywatel_code: null, mobywatel_manual_code: null, mobywatel_code_expires_at: null }));
  assert.deepEqual(pruneTransientData(db), { messages: 0, donations: 0 }); db.close();
});

test('backup retention only deletes old managed backup files, never exports, active DB or symlinks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bezreszty-retention-'));
  try {
    const backups = join(directory, 'backups'); mkdirSync(backups);
    const dbPath = join(directory, 'active.sqlite'); writeFileSync(dbPath, 'active');
    const old = join(backups, 'bezreszty-2020-01-01T00-00-00.000Z.sqlite'); writeFileSync(old, 'old'); utimesSync(old, new Date(0), new Date(0));
    const recent = join(backups, `bezreszty-${new Date().toISOString().replaceAll(':', '-')}.sqlite`); writeFileSync(recent, 'recent');
    const exportFile = join(backups, 'export.sqlite'); writeFileSync(exportFile, 'manual export'); utimesSync(exportFile, new Date(0), new Date(0));
    const link = join(backups, 'bezreszty-2020-01-02T00-00-00.000Z.sqlite'); symlinkSync(dbPath, link);
    assert.equal(pruneManagedBackups(dbPath), 1); assert.equal(existsSync(old), false);
    for (const path of [recent, exportFile, link, dbPath]) assert.ok(existsSync(path));
    assert.equal(pruneManagedBackups(dbPath), 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('publishing optional donor text requires explicit consent; anonymous transfers do not', async () => {
  const { app, db, config } = setup(), owner = await addUser(db), campaign = addCampaign(db, owner), agent = request.agent(app);
  const _csrf = await csrf(agent, `/zbiorka/${campaign.slug}`), url = `/zbiorka/${campaign.slug}/wesprzyj`;
  assert.equal((await agent.post(url).type('form').send({ _csrf, amount: '10', name: 'Ala' })).status, 422);
  assert.equal((await agent.post(url).type('form').send({ _csrf, amount: '10', message: 'Dobry cel' })).status, 422);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM donations').get().n, 0);
  assert.equal((await agent.post(url).type('form').send({ _csrf, amount: '10' })).status, 302);
  assert.equal(db.prepare('SELECT publication_consent_at FROM donations').get().publication_consent_at, null);
  assert.equal((await agent.post(url).type('form').send({ _csrf, amount: '20', name: 'Ala', message: 'Dobry cel', publishConsent: 'on' })).status, 302);
  const row = db.prepare("SELECT * FROM donations WHERE name='Ala'").get();
  assert.ok(row.publication_consent_at); assert.equal(row.publication_consent_version, config.legalVersion);
  db.close();
});
