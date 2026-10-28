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
    if (transport) {
      await transport.sendMail({ from: config.mailFrom, to: user.email, subject, text: `${subject}\n\nOtwórz link (ważny godzinę):\n${link}\n\nJeśli nie prosisz o tę wiadomość, zignoruj ją.\nBezReszty` });
    } else if (!config.production) {
      console.info(`[DEV MAIL] ${purpose}: ${link}`);
    } else { throw new Error('SMTP nie jest skonfigurowane.'); }
  };
}
