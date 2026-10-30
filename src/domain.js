import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
const scrypt = promisify(scryptCallback);
// OWASP's 16 MiB scrypt profile; bound concurrency to protect small instances.
const passwordCost = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const passwordPrefix = 'scrypt$16384$8$5$';
export const dummyPasswordHash = passwordPrefix + '0123456789abcdef0123456789abcdef$' + '0'.repeat(128);
let hashing = 0;
const hashQueue = [];
async function derivePassword(password, salt, options) {
  if (hashing >= 2) {
    if (hashQueue.length >= 16) throw Object.assign(new Error('Password hashing busy'), { code: 'AUTH_BUSY' });
    await new Promise(resolve => hashQueue.push(resolve));
  } else hashing++;
  try { return await scrypt(password, salt, 64, options); }
  finally { const next = hashQueue.shift(); if (next) next(); else hashing--; }
}
export const todayWarsaw = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const verificationCode = user => user.verification_code || null;
export const notificationAddress = (user, config) => `${config.notificationPrefix || ''}${user.notification_alias}@${config.notificationDomain}`;
export const categories = { zdrowie: 'Zdrowie', dzieci: 'Dzieci', zwierzeta: 'Zwierzęta', spolecznosc: 'Społeczność', edukacja: 'Edukacja', marzenia: 'Marzenia', pomoc: 'Pilna pomoc' };
export const covers = ['community', 'nature', 'care', 'education', 'animals', 'dream'];
export const token = (bytes = 32) => randomBytes(bytes).toString('hex');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const money = cents => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export function toCents(value) {
  const clean = String(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(clean)) throw new Error('Podaj poprawną kwotę z najwyżej dwoma miejscami po przecinku.');
  const [whole, fractional = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
}
export function validAliorIban(input) {
  const digits = input.replace(/^PL/i, '').replace(/\s/g, '');
  if (!/^\d{26}$/.test(digits) || digits.slice(2, 6) !== '2490') return false;
  let remainder = 0;
  for (const c of digits.slice(2) + '2521' + digits.slice(0, 2)) remainder = (remainder * 10 + Number(c)) % 97;
  return remainder === 1;
}
export const normalizeIban = value => value.replace(/^PL/i, '').replace(/\s/g, '');
export function accountMatches(mask, iban) {
  if (/^\d{26}$/.test(mask)) return mask === iban;
  const match = mask.match(/^(\d{2})\.{3}(\d{4})$/);
  return Boolean(match && iban.startsWith(match[1]) && iban.endsWith(match[2]));
}
export function slugify(text) {
  return text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65);
}
export async function passwordHash(password) {
  const salt = token(16);
  return `${passwordPrefix}${salt}$${(await derivePassword(password, salt, passwordCost)).toString('hex')}`;
}
export const passwordNeedsRehash = stored => !stored.startsWith(passwordPrefix);
export async function passwordMatches(password, stored) {
  const current = typeof stored === 'string' && stored.startsWith(passwordPrefix);
  const parts = typeof stored === 'string' ? stored.split(current ? '$' : ':') : [];
  const [salt, key] = current ? parts.slice(4) : parts;
  if (parts.length !== (current ? 6 : 2) || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(key || '')) {
    await derivePassword(password, '0123456789abcdef0123456789abcdef', passwordCost);
    return false;
  }
  const actual = await derivePassword(password, salt, current ? passwordCost : { ...passwordCost, p: 1 });
  const expected = Buffer.from(key, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const registrationSchema = z.object({
  name: z.string().trim().min(3, 'Podaj imię i nazwisko lub nazwę organizacji.').max(100),
  email: z.email('Podaj poprawny adres e-mail.').max(254).transform(v => v.toLowerCase()),
  password: z.string().min(12, 'Hasło musi mieć co najmniej 12 znaków.').max(128),
  accept: z.literal('on', 'Zaakceptuj zasady i zapoznaj się z informacją o prywatności.'),
});
export const bankSchema = z.object({
  name: z.string().trim().min(3).max(100),
  phone: z.string().transform(v => v.replace(/[\s()-]/g, '').replace(/^\+48/, '')).refine(v => /^[4-8]\d{8}$/.test(v), 'Podaj polski numer telefonu (9 cyfr).'),
  iban: z.string().refine(validAliorIban, 'Podaj poprawny 26-cyfrowy numer rachunku Alior Banku (2490).').transform(normalizeIban),
  bankConsent: z.literal('on', 'Potwierdź, że jesteś właścicielem rachunku i numeru BLIK.'),
});
export const campaignSchema = z.object({
  title: z.string().trim().min(10, 'Tytuł musi mieć co najmniej 10 znaków.').max(100),
  summary: z.string().trim().min(30, 'Krótki opis musi mieć co najmniej 30 znaków.').max(240),
  story: z.string().trim().min(100, 'Opisz cel zbiórki w co najmniej 100 znakach.').max(15000),
  goal: z.string().transform((v, ctx) => { try { return toCents(v); } catch { ctx.addIssue({ code: 'custom', message: 'Niepoprawny cel.' }); return z.NEVER; } }).refine(v => v >= 10000 && v <= 100000000, 'Cel musi wynosić od 100 do 1 000 000 zł.'),
  category: z.enum(Object.keys(categories)), location: z.string().trim().min(2).max(80),
  cover: z.enum(covers),
  deadline: z.string().refine(v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T23:59:59Z') > new Date()), 'Wybierz datę w przyszłości.').default(''),
});
