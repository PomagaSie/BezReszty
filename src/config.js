import { resolve } from 'node:path';

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const baseUrl = (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const url = new URL(baseUrl);
  if (production && url.protocol !== 'https:') throw new Error('BASE_URL musi używać HTTPS w produkcji.');
  const demo = env.DEMO_MODE === 'true';
  if (production && !demo && (!env.SMTP_HOST || !env.MAIL_FROM || !env.NOTIFICATION_DOMAIN)) {
    throw new Error('Produkcja wymaga SMTP_HOST, MAIL_FROM i NOTIFICATION_DOMAIN.');
  }
  return {
    production, demo, baseUrl, port: Number(env.PORT || 3000),
    host: env.HOST || '127.0.0.1', dbPath: env.DB_PATH || resolve('data/bezreszty.sqlite'),
    notificationDomain: env.NOTIFICATION_DOMAIN || 'powiadomienia.localhost',
    operatorName: env.OPERATOR_NAME || 'Operator instancji BezReszty',
    operatorEmail: env.OPERATOR_EMAIL || '',
    smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_PORT === '465', requireTLS: env.SMTP_PORT !== '465', auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined } : null,
    mailFrom: env.MAIL_FROM || 'BezReszty <noreply@localhost>',
    imap: env.IMAP_HOST ? { host: env.IMAP_HOST, port: Number(env.IMAP_PORT || 993), secure: true, auth: { user: env.IMAP_USER, pass: env.IMAP_PASSWORD }, logger: false } : null,
    imapMailbox: env.IMAP_MAILBOX || 'INBOX',
    bankDkimDomains: (env.BANK_DKIM_DOMAINS || 'alior.pl,aliorbank.pl').split(',').map(s => s.trim().toLowerCase()),
    trustProxy: Number(env.TRUST_PROXY || 0),
  };
}
