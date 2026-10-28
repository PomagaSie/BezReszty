import { randomUUID } from 'node:crypto';
import { readConfig } from '../src/config.js';
import { openDatabase, now, transaction } from '../src/db.js';
import { token } from '../src/domain.js';
const config = readConfig();
if (!config.demo) throw new Error('Ustaw DEMO_MODE=true i użyj osobnej bazy. Nigdy nie dodawaj fikcyjnych wpłat do produkcji.');
const db = openDatabase(config.dbPath);
if (db.prepare('SELECT COUNT(*) n FROM campaigns').get().n) { console.log('Baza zawiera zbiórki — bez zmian.'); process.exit(0); }
transaction(db, () => {
  const id = randomUUID();
  // No usable credentials or payment destinations exist in demo accounts.
  db.prepare("INSERT INTO users(id,email,name,password,notification_alias,email_verified,verification_status,created_at) VALUES (?,?,?,'disabled',?,1,'verified',?)").run(id, 'demo@example.invalid', 'Zespół demonstracyjny', token(16), now());
  const examples = [
    ['Otwórzmy ogród dla całej okolicy', 'Miejsce spotkań, wspólne grządki i trochę zieleni. Zobacz, jak może wyglądać zbiórka, która łączy sąsiadów.', 'spolecznosc', 'Radzymin', 'community', 1500000, 946000, 42, 'ogrod-dla-okolicy'],
    ['Dajmy bezdomnym łapkom ciepły dom', 'Ciepłe legowiska, pełne miski i bezpieczny kąt. Przykładowa historia pomocy zwierzętom, które czekają na człowieka.', 'zwierzeta', 'Warszawa', 'animals', 800000, 532000, 67, 'cieply-dom-dla-lapek'],
    ['Mała pracownia, wielkie możliwości', 'Pomóżmy dzieciakom odkrywać świat. Pokazowa zbiórka na materiały i narzędzia do wspólnego tworzenia.', 'edukacja', 'Cała Polska', 'education', 1000000, 318000, 23, 'mala-pracownia'],
  ];
  for (const [title, summary, category, location, cover, goal, raised, supporters, slug] of examples) {
    const cid = randomUUID();
    const story = `To fikcyjna zbiórka demonstracyjna. Wszystkie osoby, kwoty i wpłaty na tej stronie są przykładowe. Nie wykonuj przelewu.\n\n${summary}\n\nW prawdziwej zbiórce znajdziesz tutaj szczegółową historię organizatora, uzasadnienie celu i plan wykorzystania zebranych środków. Każda złotówka trafi bezpośrednio do organizatora, a BezReszty nie potrąci prowizji.\n\nTa strona pokazuje, jak przejrzyście opowiedzieć o celu i wspólnie budować coś dobrego. Przetestuj udostępnianie zbiórki i zobacz instrukcję wspierania.`;
    db.prepare("INSERT INTO campaigns(id,owner_id,slug,title,summary,story,category,location,cover,goal,status,is_demo,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'published',1,?,?)").run(cid, id, slug, title, summary, story, category, location, cover, goal, now(), now());
    for (let i=0; i<supporters; i++) {
      const amount = Math.floor(raised/supporters)+(i===0?raised%supporters:0);
      db.prepare("INSERT INTO donations(id,campaign_id,code,amount,name,message,status,created_at,confirmed_at) VALUES (?,?,?,?,?,?,'confirmed',?,?)").run(token(),cid,`DEMO-${token(6)}`,amount,i%3?'Anonimowy gest (demo)':'Przykładowa osoba (demo)',i%5?'':'Razem możemy więcej! (wpis pokazowy)',now(),now());
    }
  }
});
db.close(); console.log('Dodano 3 wyraźnie oznaczone zbiórki demonstracyjne. Płatności i rejestracja są wyłączone.');
