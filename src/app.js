import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { audit, now, transaction } from './db.js';
import { notificationAddress, verificationCode, todayWarsaw, categories, covers, money, token, hash, passwordHash, passwordMatches, registrationSchema, bankSchema, campaignSchema, toCents, slugify } from './domain.js';
import { createMailer } from './email.js';
import { authenticateBankMail, ingestAuthenticatedMail } from './bank.js';

export { verificationCode } from './domain.js';
const sessionDuration = 1000 * 60 * 60 * 24 * 7;
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const aggregate = `SELECT c.*, u.name organizer, u.verification_status, COALESCE((SELECT SUM(amount) FROM donations d WHERE d.campaign_id=c.id AND d.status='confirmed'),0) raised, (SELECT COUNT(*) FROM donations d WHERE d.campaign_id=c.id AND d.status='confirmed') supporters FROM campaigns c JOIN users u ON u.id=c.owner_id`;
const available = () => `c.status='published' AND u.verification_status='verified' AND (c.deadline IS NULL OR c.deadline='' OR c.deadline >= '${todayWarsaw()}')`;
const statuses = { draft: 'Szkic', pending: 'Czeka na publikację', published: 'Opublikowana', closed: 'Zakończona', rejected: 'Wymaga poprawy' };
// Content hash of every static asset: changes on each deploy that touches CSS, JS, images or brand files,
// so browsers fetch the new versions instead of serving a stale cached stylesheet next to new HTML.
const assetVersion = (() => {
  const digest = createHash('sha256');
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else digest.update(path).update(readFileSync(path)); } };
  for (const dir of ['public', 'brand']) walk(resolve(dir));
  return digest.digest('hex').slice(0, 10);
})();
const asset = path => `${path}?v=${assetVersion}`;
export function createApp({ config, db, sendMail = createMailer(config, db) }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', resolve('views'));
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.production ? [] : null } }, referrerPolicy: { policy: 'same-origin' }, hsts: config.production ? undefined : false }));
  app.use('/assets', express.static(resolve('public'), { maxAge: '1h', etag: true }));
  app.use('/brand', express.static(resolve('brand'), { maxAge: '1h' }));
  app.post('/api/bank-mail', express.raw({ type: 'message/rfc822', limit: '256kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!config.bankWebhookSecret || config.demo) return res.sendStatus(503);
    const timestamp = req.get('x-bezreszty-timestamp') || '', signature = req.get('x-bezreszty-signature') || '';
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !Buffer.isBuffer(req.body)) return res.sendStatus(401);
    const expected = createHmac('sha256', config.bankWebhookSecret).update(timestamp + '\n').update(req.body).digest('hex');
    if (!safeEqual(signature, expected)) return res.sendStatus(401);
    const event = await authenticateBankMail(req.body, config);
    if (event.rejected) {
      db.prepare("INSERT OR IGNORE INTO bank_messages(id,fingerprint,status,reason,received_at) VALUES (?,?,'rejected',?,?)").run(randomUUID(), hash(req.body), event.rejected, now());
    } else ingestAuthenticatedMail(db, config, event);
    res.sendStatus(204);
  });
  app.use(express.urlencoded({ extended: false, limit: '40kb' }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
  const sessionCookie = config.production ? '__Host-br_session' : 'br_session';
  const csrfCookie = config.production ? '__Host-br_csrf' : 'br_csrf';
  app.use((req, res, next) => {
    req.user = null;
    const raw = req.cookies[sessionCookie];
    if (raw && /^[a-f0-9]{64}$/.test(raw)) {
      const session = db.prepare('SELECT u.*, s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?').get(hash(raw), Date.now());
      if (session) req.user = session;
    }
    const existing = req.cookies[csrfCookie];
    req.csrf = req.user?.csrf || (/^[a-f0-9]{64}$/.test(existing || '') ? existing : token());
    if (!req.user && req.csrf !== existing) res.cookie(csrfCookie, req.csrf, cookieOptions);
    res.locals = { asset, user: req.user, csrf: req.csrf, config, categories, covers, money, statuses, path: req.path, title: 'Zrzutki bez prowizji', error: null, notice: null, values: {}, verificationCode, notificationAddress };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') && req.get('origin') !== config.baseUrl) return res.status(403).render('error', { title: 'Niedozwolone żądanie', message: 'Otwórz formularz ponownie na tej stronie.' });
      if (!safeEqual(req.body?._csrf || req.get('x-csrf-token'), req.csrf)) return res.status(403).render('error', { title: 'Formularz wygasł', message: 'Odśwież stronę i spróbuj ponownie.' });
    }
    if (req.user || /^\/(panel|admin|logowanie|rejestracja|potwierdz|nowe-haslo)/.test(req.path)) res.set('Cache-Control', 'no-store');
    next();
  });
  const limiter = (max, windowMs = 15 * 60 * 1000) => rateLimit({ windowMs, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => res.status(429).render('error', { title: 'Chwila przerwy', message: 'Zbyt wiele prób. Spróbuj ponownie za kilka minut.' }) });
  const authLimit = limiter(15), donationLimit = limiter(30), readLimit = limiter(180, 60 * 1000);
  const requireUser = (req, res, next) => req.user ? next() : res.redirect('/logowanie');
  const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).render('error', { title: 'Brak dostępu', message: 'Ta strona jest dostępna dla operatora instancji.' });
  const formError = (res, view, error, extra = {}) => res.status(422).render(view, { error: error instanceof z.ZodError ? error.issues[0].message : error.message, ...extra });
  const createSession = (res, userId) => {
    const raw = token();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES (?,?,?,?)').run(hash(raw), userId, token(), Date.now() + sessionDuration);
    res.cookie(sessionCookie, raw, { ...cookieOptions, maxAge: sessionDuration });
  };
  const campaignBySlug = slug => db.prepare(`${aggregate} WHERE c.slug=?`).get(slug);
  const dashboard = id => ({
    campaigns: db.prepare(`${aggregate} WHERE c.owner_id=? ORDER BY c.created_at DESC`).all(id),
    donations: db.prepare(`SELECT d.*,c.title campaign_title,c.slug FROM donations d JOIN campaigns c ON d.campaign_id=c.id WHERE c.owner_id=? AND d.status='confirmed' ORDER BY d.confirmed_at DESC LIMIT 20`).all(id),
  });

  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); });
  app.get('/', (req, res) => {
    const featured = db.prepare(`${aggregate} WHERE ${available()} ORDER BY c.created_at DESC LIMIT 3`).all();
    res.render('home', { featured });
  });
  app.get('/zbiorki', (req, res) => {
    const search = String(req.query.q || '').slice(0, 100), category = String(req.query.kategoria || '');
    const clauses = [available()], params = [];
    if (search) { clauses.push("(c.title LIKE ? ESCAPE '!' OR c.summary LIKE ? ESCAPE '!' OR c.location LIKE ? ESCAPE '!')"); params.push(...Array(3).fill(`%${search.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`)); }
    if (category && category in categories) { clauses.push('c.category=?'); params.push(category); }
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.strona, 10) || 1));
    const count = db.prepare(`SELECT COUNT(*) total FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE ${clauses.join(' AND ')}`).get(...params).total;
    const campaigns = db.prepare(`${aggregate} WHERE ${clauses.join(' AND ')} ORDER BY c.created_at DESC LIMIT 12 OFFSET ?`).all(...params, (page - 1) * 12);
    res.render('campaigns', { title: 'Znajdź swoją dobrą sprawę', campaigns, search, category, page, count });
  });
  app.get('/jak-to-dziala', (req, res) => res.render('how', { title: 'Jak działa BezReszty' }));
  app.get('/zasady', (req, res) => res.render('legal', { title: 'Zasady korzystania', type: 'terms' }));
  app.get('/prywatnosc', (req, res) => res.render('legal', { title: 'Prywatność', type: 'privacy' }));
  app.get('/rejestracja', (req, res) => req.user ? res.redirect('/panel') : res.render('auth', { title: 'Załóż konto organizatora', mode: 'register' }));
  app.post('/rejestracja', authLimit, async (req, res) => {
    if (config.demo) return res.status(403).render('error', { title: 'Tryb demonstracyjny', message: 'Demo nie przyjmuje rejestracji ani prawdziwych danych.' });
    let data;
    try { data = registrationSchema.parse(req.body); }
    catch (error) { return formError(res, 'auth', error, { mode: 'register', values: { email: req.body.email, name: req.body.name } }); }
    const exists = db.prepare('SELECT id FROM users WHERE email=?').get(data.email);
    if (exists) return res.render('auth', { mode: 'login', notice: 'Jeśli masz już konto, zaloguj się lub skorzystaj z odzyskiwania hasła.' });
    const user = { id: randomUUID(), ...data };
    db.prepare('INSERT INTO users(id,email,name,password,notification_alias,created_at) VALUES (?,?,?,?,?,?)').run(user.id, user.email, user.name, await passwordHash(data.password), token(16), now());
    createSession(res, user.id);
    try { await sendMail(user, 'verify'); }
    catch { return res.redirect('/panel?notice=mail-error'); }
    res.redirect('/panel?notice=registered');
  });
  app.get('/logowanie', (req, res) => req.user ? res.redirect('/panel') : res.render('auth', { title: 'Dobrze Cię widzieć', mode: 'login' }));
  app.post('/logowanie', authLimit, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '').slice(0, 129);
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    // Always perform scrypt to avoid an inexpensive account-existence timing oracle.
    const dummy = '0123456789abcdef0123456789abcdef:' + '0'.repeat(128);
    const correct = await passwordMatches(password, user?.password || dummy);
    if (!user || !correct) return res.status(401).render('auth', { mode: 'login', error: 'Niepoprawny e-mail lub hasło.', values: { email } });
    if (req.cookies[sessionCookie]) db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(req.cookies[sessionCookie]));
    createSession(res, user.id); res.redirect('/panel');
  });
  app.post('/wyloguj', requireUser, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(req.cookies[sessionCookie]));
    res.clearCookie(sessionCookie, cookieOptions); res.redirect('/');
  });
  app.get('/potwierdz-email', (req, res) => {
    const raw = String(req.query.token || '');
    const record = db.prepare("SELECT * FROM tokens WHERE hash=? AND purpose='verify' AND expires_at>?").get(hash(raw), Date.now());
    if (!record) return res.status(400).render('error', { title: 'Link wygasł', message: 'Zaloguj się i wyślij ponownie wiadomość weryfikacyjną z panelu.' });
    // GET does not consume the token: mail scanners cannot verify an account.
    res.render('verify', { title: 'Potwierdź swój e-mail', emailToken: raw });
  });
  app.post('/potwierdz-email', authLimit, (req, res) => {
    const record = db.prepare("SELECT * FROM tokens WHERE hash=? AND purpose='verify' AND expires_at>?").get(hash(String(req.body.token || '')), Date.now());
    if (!record) return res.status(400).render('error', { title: 'Link wygasł', message: 'Wyślij ponownie wiadomość z panelu.' });
    transaction(db, () => { db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(record.user_id); db.prepare('DELETE FROM tokens WHERE hash=?').run(record.hash); });
    res.redirect('/panel?notice=verified-email');
  });
  app.post('/panel/email', requireUser, authLimit, async (req, res) => {
    if (req.user.email_verified) return res.redirect('/panel');
    try { await sendMail(req.user, 'verify'); res.redirect('/panel?notice=mail-sent'); }
    catch { res.redirect('/panel?notice=mail-error'); }
  });
  app.get('/odzyskaj-haslo', (req, res) => res.render('auth', { title: 'Odzyskaj dostęp', mode: 'forgot' }));
  app.post('/odzyskaj-haslo', authLimit, async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').trim().toLowerCase());
    if (user && !config.demo) { try { await sendMail(user, 'reset'); } catch { /* Generic response prevents enumeration. */ } }
    res.render('auth', { mode: 'forgot', notice: 'Jeśli ten adres jest zarejestrowany, otrzymasz link do zmiany hasła.' });
  });
  app.get('/nowe-haslo', (req, res) => res.render('auth', { title: 'Nowe hasło', mode: 'reset', resetToken: String(req.query.token || '') }));
  app.post('/nowe-haslo', authLimit, async (req, res) => {
    const record = db.prepare("SELECT * FROM tokens WHERE hash=? AND purpose='reset' AND expires_at>?").get(hash(String(req.body.token || '')), Date.now());
    const password = String(req.body.password || '');
    if (!record || password.length < 12 || password.length > 128 || config.demo) return res.status(400).render('auth', { mode: 'reset', resetToken: req.body.token, error: 'Link jest nieważny lub hasło nie ma od 12 do 128 znaków.' });
    const encoded = await passwordHash(password);
    transaction(db, () => { db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, record.user_id); db.prepare('DELETE FROM tokens WHERE user_id=?').run(record.user_id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(record.user_id); });
    res.clearCookie(sessionCookie, cookieOptions); res.redirect('/logowanie');
  });

  app.get('/panel', requireUser, (req, res) => {
    const notices = { registered: 'Konto utworzone. Sprawdź pocztę i potwierdź adres e-mail.', 'verified-email': 'Adres e-mail potwierdzony.', 'mail-sent': 'Wiadomość wysłana. Sprawdź swoją skrzynkę.', 'mail-error': 'Nie udało się wysłać wiadomości. Spróbuj ponownie lub skontaktuj się z operatorem.', 'bank-sent': 'Dane wysłane do weryfikacji. Teraz skonfiguruj powiadomienia bankowe.', saved: 'Zmiany zapisane.', submitted: 'Zbiórka czeka na sprawdzenie przez operatora.' };
    res.render('dashboard', { title: 'Twoje centrum pomagania', ...dashboard(req.user.id), notice: notices[req.query.notice] || null });
  });
  app.get('/panel/weryfikacja', requireUser, (req, res) => res.render('bank', { title: 'Weryfikacja organizatora', values: req.user }));
  app.post('/panel/weryfikacja', requireUser, limiter(10), (req, res) => {
    if (config.demo || ['verified', 'pending'].includes(req.user.verification_status)) return res.status(409).render('error', { title: 'Dane są zablokowane', message: 'Zmianę danych płatniczych uzgodnij z operatorem. Wymaga ponownej weryfikacji.' });
    if (!req.user.email_verified) return formError(res, 'bank', new Error('Najpierw potwierdź adres e-mail.'), { values: req.body });
    try {
      const data = bankSchema.parse(req.body);
      db.prepare("UPDATE users SET name=?,phone=?,iban=?,verification_status='pending',verification_note='',bank_notification_seen=0,submitted_at=? WHERE id=?").run(data.name, data.phone, data.iban, now(), req.user.id);
      audit(db, req.user.id, 'verification_submitted', req.user.id);
      res.redirect('/panel?notice=bank-sent');
    } catch (error) { formError(res, 'bank', error, { values: req.body }); }
  });
  app.get('/panel/nowa-zbiorka', requireUser, (req, res) => res.render('editor', { title: 'Zacznij coś dobrego', campaign: null }));
  app.post('/panel/nowa-zbiorka', requireUser, limiter(20), (req, res) => saveCampaign(req, res));
  app.get('/panel/zbiorki/:id/edytuj', requireUser, (req, res) => {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id=? AND owner_id=?').get(req.params.id, req.user.id);
    if (!campaign) return res.status(404).render('error', { title: 'Nie ma takiej zbiórki', message: 'Sprawdź adres strony.' });
    res.render('editor', { title: 'Edytuj zbiórkę', campaign, values: { ...campaign, goal: String(campaign.goal / 100) } });
  });
  app.post('/panel/zbiorki/:id/edytuj', requireUser, (req, res) => saveCampaign(req, res, req.params.id));
  function saveCampaign(req, res, id = null) {
    if (config.demo) return res.status(403).render('error', { title: 'Tryb demonstracyjny', message: 'Demo nie zapisuje zbiórek.' });
    const campaign = id ? db.prepare('SELECT * FROM campaigns WHERE id=? AND owner_id=?').get(id, req.user.id) : null;
    if (id && !campaign) return res.sendStatus(404);
    try {
      const data = campaignSchema.parse(req.body);
      if (req.body.action === 'submit' && req.user.verification_status !== 'verified') throw new Error('Przed zgłoszeniem zbiórki ukończ weryfikację organizatora. Szkic możesz zapisać już teraz.');
      const status = req.body.action === 'submit' ? 'pending' : 'draft';
      const campaignId = id || randomUUID();
      if (id) {
        db.prepare('UPDATE campaigns SET title=?,summary=?,story=?,category=?,location=?,cover=?,goal=?,deadline=?,status=?,updated_at=? WHERE id=? AND owner_id=?').run(data.title, data.summary, data.story, data.category, data.location, data.cover, data.goal, data.deadline || null, status, now(), id, req.user.id);
      } else {
        db.prepare('INSERT INTO campaigns(id,owner_id,slug,title,summary,story,category,location,cover,goal,deadline,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(campaignId, req.user.id, `${slugify(data.title)}-${token(3)}`, data.title, data.summary, data.story, data.category, data.location, data.cover, data.goal, data.deadline || null, status, now(), now());
      }
      audit(db, req.user.id, `campaign_${status}`, campaignId);
      res.redirect(`/panel?notice=${status === 'pending' ? 'submitted' : 'saved'}`);
    } catch (error) { formError(res, 'editor', error, { campaign, values: req.body }); }
  }
  app.post('/panel/zbiorki/:id/zamknij', requireUser, (req, res) => {
    if (config.demo) return res.sendStatus(403);
    db.prepare("UPDATE campaigns SET status='closed',updated_at=? WHERE id=? AND owner_id=?").run(now(), req.params.id, req.user.id);
    audit(db, req.user.id, 'campaign_closed', req.params.id); res.redirect('/panel');
  });

  app.get('/zbiorka/:slug', (req, res) => {
    const campaign = campaignBySlug(req.params.slug);
    const isOwner = campaign && (req.user?.id === campaign.owner_id || req.user?.role === 'admin');
    if (!campaign || (!['published', 'closed'].includes(campaign.status) && !isOwner) || (campaign.verification_status !== 'verified' && !isOwner)) return res.status(404).render('error', { title: 'Nie ma takiej zbiórki', message: 'Ta zbiórka nie jest dostępna. Zobacz inne dobre sprawy.' });
    const donations = db.prepare("SELECT name,message,amount,confirmed_at FROM donations WHERE campaign_id=? AND status='confirmed' ORDER BY confirmed_at DESC LIMIT 30").all(campaign.id);
    const canDonate = campaign.status === 'published' && campaign.verification_status === 'verified' && (!campaign.deadline || campaign.deadline >= todayWarsaw());
    res.render('campaign', { title: campaign.title, campaign, donations, canDonate, isOwner, canonical: `${config.baseUrl}/zbiorka/${campaign.slug}` });
  });
  app.post('/zbiorka/:slug/wesprzyj', donationLimit, (req, res) => {
    const campaign = campaignBySlug(req.params.slug);
    if (!campaign || campaign.status !== 'published' || campaign.verification_status !== 'verified' || (campaign.deadline && campaign.deadline < todayWarsaw())) return res.status(409).render('error', { title: 'Wpłaty są zamknięte', message: 'Ta zbiórka nie przyjmuje nowych wpłat.' });
    if (config.demo || campaign.is_demo) return res.status(409).render('error', { title: 'To zbiórka pokazowa', message: 'Nie wykonuj przelewu. Demo pokazuje działanie aplikacji i nie zbiera pieniędzy.' });
    try {
      const amount = toCents(req.body.amount);
      if (amount < 100 || amount > 1000000) throw new Error('Jednorazowo możesz wesprzeć zbiórkę kwotą od 1 do 10 000 zł.');
      const donor = String(req.body.name || '').trim().slice(0, 60) || 'Anonimowo';
      const message = String(req.body.message || '').trim().slice(0, 300);
      const id = token(), code = `BR-${token(6).toUpperCase()}`;
      db.prepare('INSERT INTO donations(id,campaign_id,code,amount,name,message,created_at) VALUES (?,?,?,?,?,?,?)').run(id, campaign.id, code, amount, donor, message, now());
      res.redirect(`/wplata/${id}`);
    } catch (error) { res.status(422).render('error', { title: 'Sprawdź kwotę wpłaty', message: error.message }); }
  });
  const payment = id => db.prepare(`SELECT d.*,c.slug,c.title,c.is_demo,u.name organizer,u.phone,u.iban,u.verification_status FROM donations d JOIN campaigns c ON c.id=d.campaign_id JOIN users u ON u.id=c.owner_id WHERE d.id=?`).get(id);
  app.get('/wplata/:id', (req, res) => {
    const donation = payment(req.params.id);
    if (!donation || donation.verification_status !== 'verified') return res.status(404).render('error', { title: 'Nie ma takiej wpłaty', message: 'Otwórz ponownie stronę zbiórki.' });
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
    res.render('payment', { title: 'Twoja pomoc ma znaczenie', donation });
  });
  app.get('/api/wplaty/:id', readLimit, (req, res) => {
    const donation = payment(req.params.id);
    res.set('Cache-Control', 'no-store');
    if (!donation || donation.verification_status !== 'verified') return res.status(404).json({ error: 'Nie znaleziono wpłaty.' });
    res.json({ status: donation.status, amount: donation.amount });
  });

  app.get('/admin', requireAdmin, (req, res) => {
    res.render('admin', { title: 'Panel operatora',
      organizers: db.prepare("SELECT * FROM users WHERE verification_status IN ('pending','verified') ORDER BY submitted_at").all(),
      campaigns: db.prepare(`${aggregate} WHERE c.status='pending' ORDER BY c.updated_at`).all(),
      messages: db.prepare('SELECT b.*,u.name organizer FROM bank_messages b LEFT JOIN users u ON u.id=b.owner_id WHERE b.status NOT IN (\'matched\',\'verification\') ORDER BY b.received_at DESC LIMIT 50').all(),
      audits: db.prepare('SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 30').all(),
    });
  });
  app.post('/admin/organizator/:id', requireAdmin, (req, res) => {
    if (config.demo) return res.sendStatus(403);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    const action = req.body.action, note = String(req.body.note || '').trim().slice(0, 1000);
    if (!user || !['verify','reject','suspend'].includes(action) || note.length < 10) return res.status(422).render('error', { title: 'Uzupełnij uzasadnienie', message: 'Wymagany jest opis przeprowadzonej weryfikacji lub przyczyny odmowy (minimum 10 znaków).' });
    if (action === 'verify' && (!user.email_verified || !user.phone || !user.iban || !user.bank_notification_seen || user.verification_status !== 'pending')) return res.status(409).render('error', { title: 'Weryfikacja niekompletna', message: 'Potrzebne są potwierdzony e-mail, dane rachunku oraz podpisane powiadomienie z przelewu testowego.' });
    transaction(db, () => {
      db.prepare('UPDATE users SET verification_status=?,verification_note=?,verified_at=? WHERE id=?').run(action === 'verify' ? 'verified' : 'rejected', note, action === 'verify' ? now() : null, user.id);
      if (action !== 'verify') db.prepare("UPDATE campaigns SET status='closed',updated_at=? WHERE owner_id=? AND status IN ('published','pending')").run(now(), user.id);
      audit(db, req.user.id, `organizer_${action}`, user.id, note);
    });
    res.redirect('/admin');
  });
  app.post('/admin/zbiorka/:id', requireAdmin, (req, res) => {
    if (config.demo) return res.sendStatus(403);
    const campaign = db.prepare('SELECT c.*,u.verification_status FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE c.id=?').get(req.params.id);
    if (!campaign || !['publish','reject'].includes(req.body.action) || campaign.status !== 'pending') return res.sendStatus(409);
    if (req.body.action === 'publish' && campaign.verification_status !== 'verified') return res.sendStatus(409);
    transaction(db, () => { db.prepare('UPDATE campaigns SET status=?,updated_at=? WHERE id=?').run(req.body.action === 'publish' ? 'published' : 'rejected', now(), campaign.id); audit(db, req.user.id, `campaign_${req.body.action}`, campaign.id); });
    res.redirect('/admin');
  });
  app.use((req, res) => res.status(404).render('error', { title: 'Ta strona gdzieś się zapodziała', message: 'Sprawdź adres lub wróć do zbiórek.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (req.path === '/api/bank-mail') return res.sendStatus(error.status === 413 ? 413 : 503);
    console.error('Request failed:', error.code || error.name);
    res.status(error.status === 413 ? 413 : 500).render('error', { title: 'Nie udało się dokończyć operacji', message: 'Spróbuj ponownie za chwilę. Jeśli problem się powtarza, skontaktuj się z operatorem.' });
  });
  return app;
}
