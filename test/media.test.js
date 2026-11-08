import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { setup, addUser, addCampaign, login } from './helpers.js';
import { sanitizeStory, textToHtml, plainText } from '../src/story.js';
import { processImage, storeMedia, pruneMedia, MediaError } from '../src/media.js';

const ID_A = 'a'.repeat(32), ID_B = 'b'.repeat(32);
const photo = (width = 1200, height = 800) => sharp({ create: { width, height, channels: 3, background: '#3b82f6' } })
  .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'SECRET-OWNER' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 13/1 0/1' } } }).toBuffer();
const png = () => sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
const upload = (agent, csrf, body, type = 'image/jpeg') => agent.post('/panel/media').set('Content-Type', type).set('X-CSRF-Token', csrf).send(body);
const storyText = 'Wspólna historia testowa z jasno opisanym celem i budżetem. '.repeat(3);
const form = (csrf, extra = {}) => ({ _csrf: csrf, title: 'Pomóżmy wspólnie naszej okolicy', summary: 'Przejrzysta testowa zbiórka dla naszej społeczności i wszystkich sąsiadów.', story: `<p>${storyText}</p>`, goal: '1000', category: 'spolecznosc', location: 'Radzymin', cover: 'community', deadline: '', action: 'draft', ...extra });

test('story sanitiser rebuilds markup from an allow-list: no scripts, handlers, bad links or foreign images', () => {
  const own = id => id === ID_A;
  const dirty = `<h1>Tytuł</h1><p onclick="x()" style="color:red">Ala <b>ma</b> <i>kota</i> <u>i</u> <a href="https://example.com/a?b=1&c=2" onclick="x()">link</a></p>
    <script>alert(1)</script><style>p{}</style><iframe src="//evil"></iframe><ul><li>raz</li><li></li></ul><blockquote><p>cytat</p></blockquote><hr>
    <a href="javascript:alert(1)">js</a><a href=" jAvA\tscript:alert(1)">js2</a><a href="data:text/html,x">data</a>
    <img src="/media/${ID_A}" alt="Zdjęcie" onerror="x()"><img src="/media/${ID_B}"><img src="https://evil/x.png"><img src="/media/${ID_A}/../x"><img src=x onerror=alert(1)>
    <svg><script>1</script></svg><p><br></p><p>  </p>`;
  const { html, text } = sanitizeStory(dirty, { mediaAllowed: own });
  for (const forbidden of [/<script/i, /<style/i, /<iframe/i, /<svg/i, /onclick/i, /onerror/i, /style=/i, /javascript:/i, /data:text/i, /evil/i, /\/\.\.\//, /<h1/i, /<b>/i]) assert.doesNotMatch(html, forbidden, String(forbidden));
  assert.match(html, /<h2>Tytuł<\/h2>/);
  assert.match(html, /<strong>ma<\/strong> <em>kota<\/em> <u>i<\/u>/);
  assert.match(html, /<a href="https:\/\/example.com\/a\?b=1&amp;c=2" rel="noopener noreferrer nofollow ugc" target="_blank">link<\/a>/);
  assert.match(html, /<ul><li>raz<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>cytat<\/p><\/blockquote>/);
  assert.equal([...html.matchAll(/<img /g)].length, 1);
  assert.match(html, new RegExp(`<img src="/media/${ID_A}" alt="Zdjęcie" loading="lazy" />`));
  assert.doesNotMatch(html, /<p><\/p>|<p>\s*<\/p>/);
  assert.ok(text.includes('Ala ma kota'));
  assert.equal(sanitizeStory(html, { mediaAllowed: own }).html, html, 'sanitising is idempotent');
});

test('plain text input (legacy stories, no JavaScript) becomes escaped paragraphs; text length ignores markup', () => {
  assert.equal(textToHtml('Pierwszy <akapit> & znak\nlinia\n\nDrugi'), '<p>Pierwszy &lt;akapit&gt; &amp; znak<br>linia</p><p>Drugi</p>');
  assert.equal(sanitizeStory('Zwykły <tekst> bez znaczników\n\nDrugi akapit').html, '<p>Zwykły &lt;tekst&gt; bez znaczników</p><p>Drugi akapit</p>');
  assert.equal(plainText('<p>Ala &amp; <strong>Ola</strong>&nbsp;mają</p><p>kota</p>'), 'Ala & Ola mają kota');
});

test('uploaded pictures are re-encoded: proven images only, EXIF rotation applied, all metadata and GPS removed, size capped', async () => {
  const source = await photo();
  assert.ok((await sharp(source).metadata()).exif && source.includes(Buffer.from('SECRET-OWNER')), 'fixture carries EXIF');
  const out = await processImage(source);
  const meta = await sharp(out.data).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(out.mime, 'image/webp');
  assert.deepEqual([meta.width, meta.height], [800, 1200], 'orientation 6 rotates the picture upright');
  assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined); assert.equal(meta.xmp, undefined);
  assert.ok(!out.data.includes(Buffer.from('SECRET-OWNER')));
  assert.ok((await sharp(out.thumb).metadata()).width <= 640);
  const big = await processImage(await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#fff' } }).jpeg().toBuffer());
  assert.equal(Math.max(big.width, big.height), 1600);
  assert.equal((await sharp((await processImage(await png())).data).metadata()).hasAlpha, true, 'transparent illustrations keep transparency');
  for (const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.from('<html><script>alert(1)</script></html>'), Buffer.from('GIF89a-not-really'), Buffer.alloc(2000, 7), Buffer.alloc(0), await sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } }).png().toBuffer()]) {
    await assert.rejects(processImage(bad), MediaError);
  }
});

test('upload endpoint needs a signed-in organizer and CSRF, accepts only images, and serves stripped, immutable, sandboxed bytes', async () => {
  const { app, db } = setup(); const owner = await addUser(db);
  const anonymous = await request(app).post('/panel/media').set('Content-Type', 'image/png').send(await png());
  assert.ok([302, 403].includes(anonymous.status)); assert.equal(db.prepare('SELECT COUNT(*) n FROM media').get().n, 0);
  const agent = request.agent(app), csrf = await login(agent, owner);
  assert.equal((await agent.post('/panel/media').set('Content-Type', 'image/jpeg').send(await photo())).status, 403, 'CSRF token required');
  const created = await upload(agent, csrf, await photo());
  assert.equal(created.status, 201); assert.match(created.body.id, /^[0-9a-f]{32}$/); assert.equal(created.body.url, `/media/${created.body.id}`);
  const full = await request(app).get(created.body.url), thumb = await request(app).get(created.body.thumb);
  assert.equal(full.status, 200); assert.equal(full.headers['content-type'], 'image/webp');
  assert.equal(full.headers['x-content-type-options'], 'nosniff'); assert.match(full.headers['cache-control'], /immutable/);
  assert.match(full.headers['content-security-policy'], /sandbox/); assert.equal(full.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal((await sharp(full.body).metadata()).exif, undefined);
  assert.ok(thumb.body.length <= full.body.length);
  assert.equal((await request(app).get(`/media/${'0'.repeat(32)}`)).status, 404);
  for (const route of ['/media/short', '/media/..%2F..%2Fetc', `/media/${created.body.id}/huge`]) assert.equal((await request(app).get(route)).status, 404, route);
  assert.equal((await upload(agent, csrf, '<svg onload=alert(1)/>', 'image/svg+xml')).status, 415);
  assert.equal((await upload(agent, csrf, '<html><script>1</script></html>', 'text/html')).status, 415);
  assert.equal((await upload(agent, csrf, '<svg onload=alert(1)/>', 'image/png')).status, 422, 'a lie about the type is caught by decoding');
  assert.equal((await upload(agent, csrf, Buffer.alloc(11 * 1024 * 1024, 1), 'image/png')).status, 413);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM media').get().n, 1);
  db.close();
});

test('saving a campaign keeps only the author\'s own pictures, sanitises the story and validates the cover and short description', async () => {
  const { app, db } = setup(); const owner = await addUser(db), other = await addUser(db);
  const agent = request.agent(app), csrf = await login(agent, owner);
  const mine = (await upload(agent, csrf, await photo())).body.id;
  const foreign = storeMedia(db, other.id, await processImage(await png())).id;
  const body = form(csrf, { story: `<h2>Cel</h2><p>${storyText}</p><img src="/media/${mine}" alt="Moje"><img src="/media/${foreign}"><script>alert(1)</script><p onclick="x()">koniec</p>`, cover: 'custom', cover_media_id: mine });
  assert.equal((await agent.post('/panel/nowa-zbiorka').type('form').send(body)).status, 302);
  const saved = db.prepare('SELECT * FROM campaigns').get();
  assert.equal(saved.story_format, 'html'); assert.equal(saved.cover_media_id, mine); assert.equal(saved.cover, 'community');
  assert.ok(saved.story.includes(`/media/${mine}`)); assert.ok(!saved.story.includes(foreign)); assert.doesNotMatch(saved.story, /script|onclick/);

  for (const [name, extra, message] of [
    ['foreign cover', { cover: 'custom', cover_media_id: foreign }, /Wgraj własne zdjęcie/],
    ['custom without a file', { cover: 'custom', cover_media_id: '' }, /Wgraj własne zdjęcie/],
    ['summary over the limit', { summary: 'a'.repeat(241) }, /najwyżej 240/],
    ['story too short', { story: '<p>Za krótko.</p>' }, /co najmniej 100/],
    ['story only markup', { story: '<p><img src="/media/' + foreign + '"></p>' }, /co najmniej 100/],
  ]) {
    const before = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
    const response = await agent.post('/panel/nowa-zbiorka').type('form').send(form(csrf, extra));
    assert.equal(response.status, 422, name); assert.match(response.text, message, name);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n, before, name);
  }
  // Browsers submit line breaks as CRLF; the limit is counted on the text as the person typed it (LF).
  const summary = `${'a'.repeat(120)}\r\n${'b'.repeat(119)}`;
  assert.equal([...summary.replace(/\r\n/g, '\n')].length, 240);
  assert.equal((await agent.post('/panel/nowa-zbiorka').type('form').send(form(csrf, { summary }))).status, 302);
  assert.equal(db.prepare('SELECT summary FROM campaigns ORDER BY created_at DESC, rowid DESC').get().summary.length, 240);

  // Switching back to a ready-made illustration clears the custom picture.
  assert.equal((await agent.post(`/panel/zbiorki/${saved.id}/edytuj`).type('form').send(form(csrf, { cover: 'nature', cover_media_id: mine, story: saved.story }))).status, 302);
  const switched = db.prepare('SELECT cover, cover_media_id FROM campaigns WHERE id=?').get(saved.id);
  assert.deepEqual({ ...switched }, { cover: 'nature', cover_media_id: null });
  db.close();
});

test('rich stories render as HTML on the public page and in the editor; legacy plain-text stories stay escaped paragraphs', async () => {
  const { app, db } = setup(); const owner = await addUser(db);
  const legacy = addCampaign(db, owner, { story: 'Pierwszy akapit <script>alert(1)</script> historii.\n\nDrugi akapit, który ma sens i długość.', status: 'published' });
  const page = await request(app).get(`/zbiorka/${legacy.slug}`);
  assert.equal(page.status, 200); assert.doesNotMatch(page.text, /<script>alert/); assert.match(page.text, /<p>Pierwszy akapit &lt;script&gt;alert\(1\)&lt;\/script&gt; historii\.<\/p>/); assert.match(page.text, /<p>Drugi akapit/);

  const agent = request.agent(app), csrf = await login(agent, owner);
  const mine = (await upload(agent, csrf, await photo())).body.id;
  await agent.post('/panel/nowa-zbiorka').type('form').send(form(csrf, { story: `<h2>Cel zbiórki</h2><p>${storyText}</p><img src="/media/${mine}" alt="Opis">`, cover: 'custom', cover_media_id: mine }));
  const rich = db.prepare("SELECT * FROM campaigns WHERE story_format='html'").get();
  db.prepare("UPDATE campaigns SET status='published' WHERE id=?").run(rich.id);
  const view = await request(app).get(`/zbiorka/${rich.slug}`);
  assert.match(view.text, /<div class="rich"><h2>Cel zbiórki<\/h2><p>/); assert.match(view.text, new RegExp(`<img src="/media/${mine}" alt="Opis"`));
  assert.match(view.text, new RegExp(`class="detail-cover cover-custom"`)); assert.match(view.text, new RegExp(`<img src="/media/${mine}"`));
  const list = await request(app).get('/zbiorki'); assert.match(list.text, new RegExp(`/media/${mine}/thumb`)); assert.match(list.text, /card-cover cover-custom/);
  const editor = await agent.get(`/panel/zbiorki/${rich.id}/edytuj`);
  assert.equal(editor.status, 200); assert.match(editor.text, /&lt;h2&gt;Cel zbiórki&lt;\/h2&gt;/, 'story is escaped inside the textarea'); assert.doesNotMatch(editor.text, /<h2>Cel zbiórki/);
  assert.match(editor.text, new RegExp(`name="cover" value="custom" checked`)); assert.match(editor.text, new RegExp(`name="cover_media_id" value="${mine}"`));
  const legacyEditor = await agent.get(`/panel/zbiorki/${legacy.id}/edytuj`);
  assert.match(legacyEditor.text, /&lt;p&gt;Pierwszy akapit &amp;lt;script&amp;gt;/, 'legacy text is converted to escaped paragraphs for the editor');
  db.close();
});

test('unused pictures are pruned after two days; pictures used as cover or inside a story are kept', async () => {
  const { db } = setup(); const owner = await addUser(db);
  const image = await processImage(await png());
  const ids = Array.from({ length: 4 }, () => storeMedia(db, owner.id, image).id);
  const [cover, inStory, unused, fresh] = ids;
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  for (const id of [cover, inStory, unused]) db.prepare('UPDATE media SET created_at=? WHERE id=?').run(old, id);
  addCampaign(db, owner, { story: `<p>x</p><img src="/media/${inStory}">` });
  db.prepare('UPDATE campaigns SET cover_media_id=?').run(cover);
  assert.equal(pruneMedia(db, owner.id), 1);
  assert.deepEqual(db.prepare('SELECT id FROM media ORDER BY id').all().map(row => row.id).sort(), [cover, inStory, fresh].sort());
  db.close();
});
