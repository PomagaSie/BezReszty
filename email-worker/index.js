import { readBankMail, postSignedBankMail } from './shared/transport.js';

export default {
  async email(message, env) {
    if (message.rawSize > 256 * 1024 || !new RegExp(`^wplaty\\+[a-f0-9]{32}@${env.NOTIFICATION_DOMAIN.replaceAll('.', '\\.')}$`, 'i').test(message.to)) {
      message.setReject('Nieprawidłowy adres powiadomień lub rozmiar wiadomości.'); return;
    }
    const raw = await readBankMail(message, { maxSize: 256 * 1024, sizeReason: 'Nieprawidłowy adres powiadomień lub rozmiar wiadomości.', actualSizeReason: 'Wiadomość jest zbyt duża.' });
    if (!raw) return;
    await postSignedBankMail({ url: env.BANK_WEBHOOK_URL, secret: env.BANK_WEBHOOK_SECRET, body: raw, contentType: 'message/rfc822', timestamp: String(Date.now()), timestampHeader: 'X-Bezreszty-Timestamp', signatureHeader: 'X-Bezreszty-Signature' });
    // Never log recipients, bodies, signatures or account information.
  },
  fetch() { return new Response('Not found', { status: 404 }); },
};
