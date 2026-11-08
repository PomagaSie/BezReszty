import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { processImage, storeMedia } from './media.js';
import { sanitizeStory, textToHtml } from './story.js';
import { now, transaction, audit } from './db.js';

// One-off migration. The screenshots of "Szkatułka Bajek w Google Play" used to be wired to the campaign's slug in code,
// so the page showed them but the editor knew nothing about them (they could not be seen, replaced or removed).
// They are turned into ordinary pictures of that campaign: a collage as the cover and the four screenshots at the end of
// the story. After that the editor is the single place where the campaign's pictures live.
export const EDITORIAL_MIGRATION = 'szkatulka-bajek-media-v1';
const SLUG = 'szkatulka-bajek-w-google-play';
const DIRECTORY = new URL('../public/images/szkatulka-bajek/', import.meta.url);
const SHOTS = [
  ['home.png', 'Szkatułka Bajek — ekran główny z wyborem nastroju'],
  ['discovery.png', 'Szkatułka Bajek — wylosowana bajka'],
  ['player.png', 'Szkatułka Bajek — odtwarzacz i klucz snu'],
  ['library.png', 'Szkatułka Bajek — biblioteka pobranych bajek'],
];

// Four phone screens side by side on the app's dark purple, with a margin that survives the cover crop on cards.
async function collage(buffers) {
  const WIDTH = 1600, HEIGHT = 940, SHOT = 760, GAP = 24;
  const shots = await Promise.all(buffers.map(async buffer => {
    const resized = await sharp(buffer).resize({ height: SHOT }).png().toBuffer({ resolveWithObject: true });
    const { width } = resized.info;
    const rounded = await sharp(resized.data).composite([{ input: Buffer.from(`<svg width="${width}" height="${SHOT}"><rect width="${width}" height="${SHOT}" rx="22"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
    return { input: rounded, width };
  }));
  const total = shots.reduce((sum, shot) => sum + shot.width, 0) + GAP * (shots.length - 1);
  let left = Math.round((WIDTH - total) / 2);
  const composite = shots.map(shot => { const item = { input: shot.input, left, top: Math.round((HEIGHT - SHOT) / 2) }; left += shot.width + GAP; return item; });
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#211846' } }).composite(composite).png().toBuffer();
}

export async function importEditorialMedia(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name=?').get(EDITORIAL_MIGRATION)) return 'done';
  const campaign = db.prepare('SELECT * FROM campaigns WHERE slug=?').get(SLUG);
  if (!campaign) return 'absent'; // other installations never had this campaign
  const sources = await Promise.all(SHOTS.map(([file]) => readFile(new URL(file, DIRECTORY))));
  const processed = await Promise.all(sources.map(processImage));
  const cover = await processImage(await collage(sources));
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM migrations WHERE name=?').get(EDITORIAL_MIGRATION)) return;
    const ids = processed.map(image => storeMedia(db, campaign.owner_id, image).id);
    const coverId = campaign.cover_media_id || storeMedia(db, campaign.owner_id, cover).id;
    const gallery = `<h2>Zajrzyj do Szkatułki Bajek</h2><p>Zrzuty z działającej aplikacji.</p>${ids.map((id, index) => `<img src="/media/${id}" alt="${SHOTS[index][1]}">`).join('')}`;
    const current = campaign.story_format === 'html' ? campaign.story : textToHtml(campaign.story);
    const owned = id => ids.includes(id) || Boolean(db.prepare('SELECT 1 FROM media WHERE id=? AND owner_id=?').get(id, campaign.owner_id));
    const story = sanitizeStory(current + gallery, { mediaAllowed: owned });
    // Status and updated_at stay untouched: the page must not drop out of publication because of this migration.
    db.prepare("UPDATE campaigns SET story=?, story_format='html', cover_media_id=? WHERE id=?").run(story.html, coverId, campaign.id);
    db.prepare('INSERT INTO migrations(name, applied_at) VALUES (?,?)').run(EDITORIAL_MIGRATION, now());
    audit(db, null, 'editorial_media_imported', campaign.id);
  });
  return 'imported';
}
