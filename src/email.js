import nodemailer from 'nodemailer';
import { hash, token } from './domain.js';

export function createMailer(config, db) {
  const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;
  return async function sendToken(user, purpose) {
    const raw = token();
    db.prepare('DELETE FROM tokens WHERE user_id = ? AND purpose = ?').run(user.id, purpose);
    db.prepare('INSERT INTO tokens(hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)').run(hash(raw), user.id, purpose, Date.now() + 60 * 60 * 1000);
    const route = purpose === 'verify' ? 'potwierdz-email' : 'nowe-haslo';
    const link = `${config.baseUrl}/${route}?token=${raw}`;
    const subject = purpose === 'verify' ? 'Potwierdź adres e-mail — BezReszty' : 'Ustaw nowe hasło — BezReszty';
    if (config.mailRelayUrl && config.mailRelayKey) {
      const idempotencyKey = `bezreszty-${purpose}-${raw}`;
      const response = await fetch(config.mailRelayUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.mailRelayKey}`, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ idempotency_key: idempotencyKey, from_name: 'BezReszty', reply_to: config.operatorEmail, to: user.email, to_name: user.name, subject, text: `${subject}\n\nOtwórz link (ważny godzinę):\n${link}\n\nJeśli nie prosisz o tę wiadomość, zignoruj ją.\nBezReszty`, html: '' }),
        signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (response.status !== 202) throw new Error('MAIL_RELAY_REJECTED');
    } else if (transport) {
      await transport.sendMail({ from: config.mailFrom, to: user.email, subject, text: `${subject}\n\nOtwórz link (ważny godzinę):\n${link}\n\nJeśli nie prosisz o tę wiadomość, zignoruj ją.\nBezReszty` });
    } else if (!config.production) {
      console.info(`[DEV MAIL] ${purpose}: ${link}`);
    } else { throw new Error('SMTP nie jest skonfigurowane.'); }
  };
}
