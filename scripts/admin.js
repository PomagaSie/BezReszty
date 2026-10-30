import { readConfig } from '../src/config.js';
import { openDatabase, audit, transaction } from '../src/db.js';
const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.slice(3).some(arg => arg !== '--reset-mfa')) throw new Error('Użycie: npm run admin -- adres-istniejącego-konta@example.pl [--reset-mfa]');
const config=readConfig(), db=openDatabase(config.dbPath);
const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
if (!user || !user.email_verified) throw new Error('Najpierw zarejestruj konto w aplikacji i potwierdź e-mail.');
const resetMfa = process.argv.includes('--reset-mfa');
transaction(db, () => {
  if (resetMfa) {
    db.prepare('UPDATE users SET mfa_secret=NULL,mfa_last_step=NULL WHERE id=?').run(user.id);
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id=?').run(user.id);
  } else db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  db.prepare('DELETE FROM mfa_challenges WHERE user_id=?').run(user.id);
  audit(db,null,resetMfa?'mfa_reset_via_cli':'admin_granted_via_cli',user.id,'Wykonano lokalnym poleceniem administratora serwera.');
});
db.close();console.log(resetMfa ? 'Zresetowano 2FA i unieważniono sesje. Rola konta nie została zmieniona. Operator musi ponownie włączyć 2FA przed uzyskaniem dostępu.' : 'Nadano rolę operatora i unieważniono sesje. Zaloguj się ponownie, skonfiguruj 2FA w /panel/bezpieczenstwo i otwórz /admin.');
