import { dkimVerify } from 'mailauth/lib/dkim/verify';
import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';
import { randomUUID } from 'node:crypto';
import { accountMatches, toCents, hash } from './domain.js';
import { now, transaction, audit } from './db.js';
import { verificationCode } from './app.js';

const clean = text => text.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').trim();
export function parseAlior(subject, body) {
  const subjectMatch = subject.match(/^Uznanie rachunku (\d{2}\.{3}\d{4}|\d{26}) kwotą ([\d ,\u00a0]+) PLN\s*$/u);
  if (!subjectMatch) return null;
  const normalized = body.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div)>/gi, '\n');
  const text = clean(normalized);
  const amount = text.match(/kwotą ([\d., \u00a0]+) PLN/u);
  const sender = text.match(/Nadawca:\s*([^\r\n]+)/u);
  const title = text.match(/Tytuł zlecenia:\s*([^\r\n]+)/u);
  if (!amount || !sender || !title) return null;
  try {
    const cents = toCents(amount[1]);
    if (cents <= 0 || cents !== toCents(subjectMatch[2])) return null;
    return { accountMask: subjectMatch[1], amount: cents, title: title[1].trim().toUpperCase(), sender: sender[1].trim() };
  } catch { return null; }
}

// Only verified RFC822 is accepted. Never trust a caller-supplied Authentication-Results header.
export async function authenticateBankMail(raw, config, options = {}) {
  if (raw.length > 256 * 1024) return { rejected: 'message_too_large' };
  const headers = raw.toString('binary').split(/\r?\n\r?\n/, 1)[0];
  for (const field of ['from', 'to', 'subject', 'date', 'content-type', 'content-transfer-encoding']) {
    if ((headers.match(new RegExp(`^${field}:`, 'gim')) || []).length > 1) return { rejected: 'duplicate_headers' };
  }
  const result = await dkimVerify(raw, { strict: true, ...options });
  const message = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  if (message.from?.value.length !== 1 || message.from.value[0].address.toLowerCase() !== 'powiadomienia@alior.pl') return { rejected: 'unexpected_sender' };
  const required = ['from', 'to', 'subject', 'date'];
  if (/^content-type:/im.test(headers)) required.push('content-type');
  if (/^content-transfer-encoding:/im.test(headers)) required.push('content-transfer-encoding');
  const signature = result.results.find(s => s.status.result === 'pass' && !s.status.testing && !s.canonBodyLengthLimited && config.bankDkimDomains.includes(s.signingDomain?.toLowerCase()) && required.every(h => s.signingHeaders?.keys.map(v => v.toLowerCase()).includes(h)));
  if (!signature) {
    if (result.results.some(s => s.status.result === 'temperror')) throw new Error('DKIM_DNS_TEMPORARY_FAILURE');
    return { rejected: 'dkim_not_authenticated' };
  }
  if (!message.date || Math.abs(Date.now() - message.date.getTime()) > 7 * 86400000 || message.date.getTime() > Date.now() + 5 * 60000) return { rejected: 'stale_message' };
  const recipients = (Array.isArray(message.to) ? message.to.flatMap(v => v.value) : message.to?.value || []).map(v => v.address?.toLowerCase());
  if (recipients.length !== 1) return { rejected: 'ambiguous_recipient' };
  return { fingerprint: hash(signature.signature), recipient: recipients[0], subject: message.subject || '', body: message.html || message.text || '', date: message.date.toISOString() };
}

export function ingestAuthenticatedMail(db, config, event) {
  return transaction(db, () => {
    if (db.prepare('SELECT id FROM bank_messages WHERE fingerprint=?').get(event.fingerprint)) return 'duplicate';
    const [alias, domain] = event.recipient?.split('@') || [];
    const owner = domain === config.notificationDomain ? db.prepare('SELECT * FROM users WHERE notification_alias=?').get(alias) : null;
    const parsed = parseAlior(event.subject, event.body);
    let outcome = 'quarantined', reason = '', donationId = null;
    if (!owner) reason = 'unknown_recipient';
    else if (!parsed) reason = 'unrecognized_notification';
    else if (!owner.iban || !accountMatches(parsed.accountMask, owner.iban)) reason = 'account_mismatch';
    else if (parsed.title === verificationCode(owner)) {
      if (owner.verification_status === 'pending' && owner.submitted_at && event.date >= owner.submitted_at) {
        db.prepare('UPDATE users SET bank_notification_seen=1 WHERE id=?').run(owner.id);
        outcome = 'verification';
        audit(db, null, 'bank_notification_verified', owner.id);
      } else reason = 'verification_not_pending_or_stale';
    } else {
      // A title with zero or multiple references must not be guessed or partially matched.
      const codes = [...parsed.title.matchAll(/\bBR-[A-F0-9]{12}\b/g)].map(m => m[0]);
      const donation = codes.length === 1 ? db.prepare('SELECT d.*,c.owner_id,c.is_demo FROM donations d JOIN campaigns c ON c.id=d.campaign_id WHERE d.code=?').get(codes[0]) : null;
      if (!donation) reason = 'unknown_or_ambiguous_reference';
      else if (donation.owner_id !== owner.id) reason = 'owner_mismatch';
      else if (owner.verification_status !== 'verified' || donation.is_demo || config.demo) reason = 'owner_unverified_or_demo';
      else if (donation.amount !== parsed.amount) reason = 'amount_mismatch';
      else if (event.date < donation.created_at) reason = 'notification_predates_intent';
      else if (donation.status === 'confirmed') reason = 'already_confirmed';
      else {
        db.prepare("UPDATE donations SET status='confirmed',confirmed_at=? WHERE id=? AND status='pending'").run(now(), donation.id);
        donationId = donation.id; outcome = 'matched';
        audit(db, null, 'donation_confirmed', donation.id);
      }
    }
    db.prepare('INSERT INTO bank_messages(id,fingerprint,owner_id,amount,title,account_mask,donation_id,status,reason,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), event.fingerprint, owner?.id || null, parsed?.amount || null, parsed?.title || null, parsed?.accountMask || null, donationId, outcome, reason, now());
    return outcome;
  });
}

export async function syncMailbox(db, config) {
  if (!config.imap || config.demo) return { disabled: true };
  const client = new ImapFlow({ ...config.imap, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
  client.on('error', error => console.error('IMAP connection:', error.code || 'connection_error'));
  await client.connect();
  let lock;
  let processed = 0;
  try {
    lock = await client.getMailboxLock(config.imapMailbox);
    const mailbox = `${config.imap.host}/${config.imap.auth.user}/${config.imapMailbox}`;
    const validity = String(client.mailbox.uidValidity);
    const state = db.prepare('SELECT * FROM mail_state WHERE mailbox=?').get(mailbox);
    const cursor = state?.uid_validity === validity ? state.last_uid : 0;
    if (Number(client.mailbox.uidNext) <= cursor + 1) return { processed };
    const uids = (await client.search({ uid: `${cursor + 1}:*` }, { uid: true })).filter(uid => uid > cursor).slice(0, 100);
    for (const uid of uids) {
      const meta = await client.fetchOne(uid, { size: true }, { uid: true });
      if (!meta) continue;
      if (meta.size <= 256 * 1024) {
        const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!fetched?.source) continue;
        const event = await authenticateBankMail(fetched.source, config);
        if (event.rejected) {
          const fingerprint = hash(fetched.source);
          db.prepare("INSERT OR IGNORE INTO bank_messages(id,fingerprint,status,reason,received_at) VALUES (?,?,'rejected',?,?)").run(randomUUID(), fingerprint, event.rejected, now());
        } else ingestAuthenticatedMail(db, config, event);
      } else {
        db.prepare("INSERT OR IGNORE INTO bank_messages(id,fingerprint,status,reason,received_at) VALUES (?,?,'rejected','message_too_large',?)").run(randomUUID(), hash(`${mailbox}:${validity}:${uid}`), now());
      }
      db.prepare('INSERT INTO mail_state(mailbox,uid_validity,last_uid) VALUES (?,?,?) ON CONFLICT(mailbox) DO UPDATE SET uid_validity=excluded.uid_validity,last_uid=excluded.last_uid').run(mailbox, validity, uid);
      processed++;
    }
    return { processed };
  } finally { lock?.release(); await client.logout().catch(() => {}); }
}
