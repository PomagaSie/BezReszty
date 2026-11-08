import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { now } from './db.js';

// Images uploaded by organizers (cover pictures and pictures inside the story). Every upload is decoded and re-encoded:
// the file is proven to be an image, rotated according to EXIF, shrunk, and stripped of ALL metadata (camera, GPS, XMP).
// Only the re-encoded WebP is stored and served, never the bytes the client sent.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const SOURCE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);
const MAX_SIDE = 1600, THUMB_SIDE = 640, MAX_INPUT_PIXELS = 40_000_000;
const MAX_PER_OWNER = 120, MAX_BYTES_PER_OWNER = 80 * 1024 * 1024;
export const MEDIA_ID = /^[0-9a-f]{32}$/;

export class MediaError extends Error {}

export async function processImage(buffer) {
  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' };
  let meta;
  try { meta = await sharp(buffer, options).metadata(); } catch { throw new MediaError('Nie udało się odczytać tego pliku jako obrazu.'); }
  if (!SOURCE_FORMATS.has(meta.format)) throw new MediaError('Obsługujemy zdjęcia i ilustracje w formatach JPEG, PNG, WebP, GIF i AVIF.');
  if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64) throw new MediaError('Obraz jest za mały. Wgraj plik o boku co najmniej 64 pikseli.');
  // Flat artwork (PNG/GIF) keeps crisp edges; photographs use ordinary lossy compression.
  const flat = meta.format === 'png' || meta.format === 'gif';
  const encode = (side, quality) => sharp(buffer, options).rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .webp(flat ? { quality: 92, nearLossless: true } : { quality, smartSubsample: true }).toBuffer({ resolveWithObject: true });
  try {
    const [full, thumb] = await Promise.all([encode(MAX_SIDE, 84), encode(THUMB_SIDE, 78)]);
    return { data: full.data, thumb: thumb.data.length ? thumb.data : full.data, width: full.info.width, height: full.info.height, mime: 'image/webp' };
  } catch { throw new MediaError('Nie udało się przetworzyć tego obrazu. Spróbuj innego pliku.'); }
}

export function storeMedia(db, ownerId, image) {
  const usage = db.prepare('SELECT COUNT(*) count, COALESCE(SUM(LENGTH(data)+LENGTH(thumb)),0) bytes FROM media WHERE owner_id=?').get(ownerId);
  if (usage.count >= MAX_PER_OWNER || usage.bytes + image.data.length + image.thumb.length > MAX_BYTES_PER_OWNER) throw new MediaError('Wgrano już bardzo dużo obrazów. Usuń nieużywane z opisu zbiórek i spróbuj ponownie.');
  const id = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO media(id,owner_id,mime,width,height,data,thumb,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, ownerId, image.mime, image.width, image.height, image.data, image.thumb, now());
  return { id, width: image.width, height: image.height };
}

// Ids of media referenced from a sanitised story.
export const mediaIdsIn = html => [...String(html || '').matchAll(/\/media\/([0-9a-f]{32})(?![0-9a-f])/g)].map(match => match[1]);

// Drops pictures that were uploaded but never ended up in a campaign (abandoned drafts, replaced covers).
export function pruneMedia(db, ownerId, olderThanMs = 2 * 86400000) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const stale = db.prepare('SELECT id FROM media WHERE owner_id=? AND created_at<?').all(ownerId, cutoff).map(row => row.id);
  if (!stale.length) return 0;
  const used = new Set();
  for (const campaign of db.prepare('SELECT cover_media_id, story FROM campaigns WHERE owner_id=?').all(ownerId)) {
    if (campaign.cover_media_id) used.add(campaign.cover_media_id);
    for (const id of mediaIdsIn(campaign.story)) used.add(id);
  }
  const remove = db.prepare('DELETE FROM media WHERE id=? AND owner_id=?');
  let removed = 0;
  for (const id of stale) if (!used.has(id)) removed += remove.run(id, ownerId).changes;
  return removed;
}
