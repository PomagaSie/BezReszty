<p align="center"><img src="brand/logo.svg" alt="BezReszty" width="330"></p>
<h3 align="center">Dobro w całości.</h3>
<p align="center">Zrzutki bez prowizji aplikacji. Pieniądze bezpośrednio do organizatora.</p>
<p align="center"><a href="https://bezreszty.org.pl">Aplikacja</a> · <a href="https://pomagasie.github.io">O projekcie PomagaSie</a> · <a href="#uruchomienie-na-własnym-serwerze">Uruchom u siebie</a></p>

BezReszty to otwarta aplikacja do prowadzenia zbiórek oparta na mechanizmie znanym z [ClassyCash](https://github.com/classy-cash/app): przelew na telefon BLIK z unikalnym tytułem i dopasowanie powiadomienia o uznaniu rachunku Alior Banku. Nie integrujemy terminala BLIK ani płatności sześciocyfrowym kodem. Nie przechowujemy środków.

Organizator potrzebuje **darmowego konta w Alior Banku**, numeru telefonu zarejestrowanego do odbierania przelewów BLIK na ten rachunek oraz bankowych powiadomień wysyłanych na indywidualny adres e-mail z aplikacji. Wpłacający nie potrzebuje konta w BezReszty ani w Alior Banku.

Jeśli BezReszty pomaga Ci pomagać, możesz dobrowolnie [postawić autorowi kawę ☕](https://suppi.pl/mleczakm) i wesprzeć rozwój projektu.

## Co działa

- Publiczny katalog: wyszukiwanie, kategorie, strony zbiórek, postęp i potwierdzone wpłaty, udostępnianie.
- Konto organizatora: rejestracja, hasła scrypt, sesje, weryfikacja e-maila, reset hasła.
- Weryfikacja rachunku: suma kontrolna NRB i bank 2490, indywidualny alias, test poczty i ręczna decyzja operatora.
- Edycja szkiców, zgłoszenie i moderacja przed publikacją; zakończenie zbiórki.
- Wpłaty: dokładne kwoty w groszach, losowa referencja, instrukcja BLIK lub przelewu i odświeżany status.
- IMAP z TLS: weryfikacja podpisu DKIM banku, zgodności rachunku i kwoty, ochrona przed ponownym zaksięgowaniem, kwarantanna wyjątków.
- Panel operatora, dziennik operacji, responsywny interfejs, SVG branding, strona organizacji i instrukcja instalacji.

## Uruchomienie lokalne

Wymagany **Node.js 24** i npm. Baza SQLite korzysta z `node:sqlite`.

```sh
npm ci --ignore-scripts
cp .env.example .env
npm start
```

Otwórz `http://localhost:3000`. Bez SMTP linki weryfikacji i resetu pojawiają się **tylko w logu deweloperskim**. Nie używaj trybu development w internecie.

Widok z fikcyjnymi danymi:

```sh
DEMO_MODE=true DB_PATH=./data/demo.sqlite npm run demo:seed
DEMO_MODE=true DB_PATH=./data/demo.sqlite npm start
```

Wszystkie przykłady są oznaczone. Demo blokuje rejestrację i tworzenie prawdziwych wpłat. Nigdy nie używaj bazy demonstracyjnej do prawdziwych zbiórek.

## Uruchomienie na własnym serwerze

Potrzebujesz serwera z Docker Engine i Docker Compose, domeny oraz dostawcy SMTP. Aplikacja to **jeden kontener z SQLite** w trwałym wolumenie. Powiadomienia banku odbiera oddzielny Email Worker Cloudflare (bez skrzynki przychodzącej) lub opcjonalnie dedykowane IMAP. Kontener udostępnia port tylko lokalnie; HTTPS zapewnia istniejący proxy/tunel. Dla serwera bez proxy dodano opcjonalny profil Caddy w `deploy/compose.https.yaml`.

```sh
git clone https://github.com/PomagaSie/BezReszty.git
cd BezReszty
cp .env.example .env
chmod 600 .env
```

Uzupełnij `.env`:

```dotenv
NODE_ENV=production
BASE_URL=https://bezreszty.twojadomena.pl
APP_DOMAIN=bezreszty.twojadomena.pl
ACME_EMAIL=administrator@twojadomena.pl
DEMO_MODE=false
NOTIFICATION_DOMAIN=powiadomienia.twojadomena.pl
OPERATOR_NAME=Pełna nazwa operatora instancji
OPERATOR_EMAIL=kontakt@twojadomena.pl
SMTP_HOST=smtp.twoj-dostawca.pl
SMTP_PORT=587
SMTP_USER=noreply@twojadomena.pl
SMTP_PASSWORD=uzupelnij-sekret-na-serwerze
MAIL_FROM=BezReszty <noreply@twojadomena.pl>
NOTIFICATION_PREFIX=wplaty+
BANK_WEBHOOK_SECRET=losowy-sekret-co-najmniej-32-znaki
```

Sekretów nie zapisuj w repozytorium. Compose podaje pozostałe parametry sieci i ścieżkę bazy.

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app
```

Jeśli nie masz istniejącego HTTPS/proxy, uruchom dodatkowo opcjonalny Caddy: `docker compose -f compose.yaml -f deploy/compose.https.yaml up -d`. Na Wandzie aplikacja korzysta z istniejącego tunelu, a jedynym nowym kontenerem jest sama aplikacja.

Skonfiguruj osobnego Workera i aliasy bankowych powiadomień według [MAIL.md](docs/MAIL.md). Zarejestruj zwykłe konto na swojej stronie, potwierdź e-mail i nadaj mu rolę operatora:

```sh
docker compose exec app node scripts/admin.js twoj-email@example.pl
```

Zaloguj się ponownie i skonfiguruj aplikację Authenticator w `/panel/bezpieczenstwo`, a następnie otwórz `/admin`. Rola operatora wymaga 2FA i nie jest dostępna z formularza rejestracji. Procedura sprawdzania organizatora jest w [VERIFICATION.md](docs/VERIFICATION.md). Uzupełnij rzeczywiste dane operatora, zasady i retencję danych dla swojej instancji przed przyjmowaniem zgłoszeń.

### Authenticator i odzyskiwanie dostępu

Organizator może opcjonalnie włączyć 2FA w „Bezpieczeństwo konta i 2FA” w panelu. Dla operatora jest ono obowiązkowe, również na istniejącym koncie po aktualizacji. Po potwierdzeniu hasła zeskanuj lokalnie wygenerowany kod QR lub wpisz klucz w aplikacji obsługującej TOTP (np. Google Authenticator, Microsoft Authenticator). Potwierdź kodem z aplikacji i zapisz dziesięć jednorazowych kodów odzyskiwania; aplikacja pokazuje je tylko raz. Każdy kod TOTP również działa tylko raz, więc po jego wykorzystaniu poczekaj na nowy. Serwer i telefon powinny mieć prawidłowo ustawiony czas.

Klucze TOTP są szyfrowane AES-256-GCM. Ustaw stały, losowy `MFA_ENCRYPTION_KEY` (minimum 32 znaki) **przed pierwszą konfiguracją 2FA**. Bez tej zmiennej aplikacja korzysta z `BANK_WEBHOOK_SECRET`; instalacja wyłącznie IMAP wymaga osobnego klucza. Klucz zachowaj niezależnie od kopii bazy. Zmiana efektywnego klucza, również przejście z fallbacku na osobny klucz, wymaga migracji sekretów lub ponownej konfiguracji 2FA. Do wygenerowania użyj np. `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` i zapisz wynik wyłącznie w chronionym pliku środowiska.

Reset hasła nie wyłącza 2FA. Zmiany 2FA i reset hasła unieważniają wcześniejsze sesje i rozpoczęte logowania. Użytkownik bez telefonu może zalogować się kodem odzyskiwania. Jeśli utraci oba sposoby, administrator serwera po niezależnym sprawdzeniu właściciela konta może wykonać:

```sh
docker compose exec app node scripts/admin.js adres-konta@example.pl --reset-mfa
```

Polecenie resetuje wyłącznie 2FA, nie nadaje roli operatora. Zapisuje zdarzenie w audycie i wylogowuje konto. Operator musi ponownie skonfigurować Authenticator przed uzyskaniem dostępu.

### Aktualizacje i kopie

```sh
docker compose exec app node scripts/backup.js
git pull --ff-only
docker compose up -d --build
```

Kopie znajdują się w wolumenie `app_data` w katalogu `backups`. Skopiuj je też zaszyfrowane poza serwer; sam wolumen nie chroni przed utratą serwera. Skrypt używa SQLite Online Backup API, uwzględniając WAL. Przykładowy eksport:

```sh
docker compose exec app node scripts/backup.js /app/data/export.sqlite
docker compose cp app:/app/data/export.sqlite ./bezreszty-backup.sqlite
chmod 600 ./bezreszty-backup.sqlite
```

Odtwarzaj przy zatrzymanej aplikacji: zastąp `bezreszty.sqlite` sprawdzoną kopią, usuń **powiązane stare** pliki `bezreszty.sqlite-wal` i `bezreszty.sqlite-shm`, uruchom ponownie. Nie usuwaj wolumenu poleceniem `down -v`, jeśli chcesz zachować dane.

## Strona organizacji i branding

- `website/` — statyczna strona dla `pomagasie.github.io`, bez procesu budowania.
- `organisation/profile/README.md` — profil GitHub organizacji, do repozytorium `PomagaSie/.github` jako `profile/README.md`.
- `brand/` — logo, znak, grafika społecznościowa i zasady marki.
- [PUBLISHING.md](docs/PUBLISHING.md) — publikacja strony organizacji na GitHub Pages.

## Testy

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix email-worker
npm run check
npm test
npm audit --omit=dev --audit-level=high
docker build -f deploy/Dockerfile -t bezreszty:local .
```

`npm test` uruchamia również testy Email Workera w Miniflare/workerd: rzeczywisty handler `email()`, zgodność surowych bajtów i HMAC, oczekiwanie na zapis w backendzie, odrzucanie przekierowań i błędów sieci oraz kontrolę adresów i limitu 256 KiB. Sam Worker: `npm --prefix email-worker test`. Testy korzystają wyłącznie z lokalnego backendu testowego, bez wysyłania poczty i wykonywania przelewów.

Testy obejmują kryptograficzny podpis DKIM, podmienione i niepodpisane wiadomości, niezgodne kwoty i rachunki, duplikaty, izolację organizatorów, moderację, CSRF, weryfikację e-maila i unieważnianie sesji po zmianie hasła. Nie wykonują przelewów i nie łączą się z bankiem. Prawdziwy przebieg SMTP oraz Alior → Worker/webhook (lub IMAP) wymaga końcowego testu na docelowej skrzynce.

## Architektura i ograniczenia

Node.js 24 + Express + EJS + SQLite. Jeden proces aplikacji. Dedykowany Worker odbiera bankowe wiadomości i przesyła surowy RFC822 z podpisem HMAC; opcjonalny importer IMAP działa co 30 sekund, trwała baza w wolumenie. Kwoty są liczbami całkowitymi w groszach. Widoki są renderowane na serwerze; JavaScript obsługuje kopiowanie, udostępnianie i status wpłaty. Tryb demonstracyjny jest odseparowany od prawdziwych zbiórek.

Tabela `campaign_totals` w tej samej bazie SQLite przechowuje sumę i liczbę potwierdzonych wpłat każdej zbiórki. Pierwsze uruchomienie po aktualizacji przelicza wcześniejsze dane raz, a triggery aktualizują agregaty przy dodaniu, potwierdzeniu, korekcie, przeniesieniu i usunięciu wpłaty, w tej samej transakcji. Odczyt stron nie sumuje całej historii wpłat; nie ma TTL ani dodatkowego serwisu cache. Panel organizatora ma paginację, a podsumowanie obejmuje wszystkie jego zbiórki. Najnowsze wpłaty korzystają z indeksu daty. Kontrolowane odtworzenie agregatów: `npm run cache:rebuild` (w kontenerze: `node scripts/rebuild-cache.js`).

Limity żądań są przechowywane w SQLite i zachowują stan po restarcie. Logowanie ma niezależne limity według IP i konta; kody 2FA limitowane są także według konta. Scrypt używa profilu `N=16384,r=8,p=5` z ograniczoną kolejką i współbieżnością. Stare hashe są aktualizowane po poprawnym logowaniu. SQLite nadal pracuje synchronicznie; przy większym ruchu mierz opóźnienia i dodaj limity w zaufanym proxy.

Integracja nie ma dostępu do historii rachunku przez API banku. E-mail jest zdarzeniem ewidencyjnym, a nie bankowym potwierdzeniem rozrachunku. Niepasujące wpłaty wymagają wyjaśnienia z organizatorem i sprawdzenia bankowej historii. Automatyczny import obsługuje tylko rozpoznany format powiadomień Aliora i wymagany podpis DKIM; zmiana formatu lub domen podpisu może wymagać aktualizacji parsera. Szczegóły: [MAIL.md](docs/MAIL.md), [SECURITY.md](SECURITY.md).

Projekt jest niezależny od Alior Banku i operatora BLIK. Kod aplikacji i autorskie materiały marki są udostępnione na licencji [MIT](LICENSE).

## Wdrożenie na Wandę i automatyczna konfiguracja Workera

Konfiguracja docelowa znajduje się w `deploy/production.json`. `node scripts/deploy.mjs` wymaga czystego repozytorium, dostępu SSH do wskazanego serwera i zalogowanego `cf` (lub ograniczonego tokena Cloudflare). Proces:

1. Uruchamia testy, wysyła wyłącznie archiwum aktualnego commita.
2. Buduje i uruchamia jeden kontener na Wandzie, zachowując wolumen SQLite.
3. Dodaje wyłącznie hostname aplikacji do istniejącego tunelu i ustawia jej CNAME.
4. Włącza routing tylko dla subdomeny BezReszty, zachowując MX domeny głównej.
5. Buduje i wdraża **odrębnego** Workera `bezreszty-bank-mail`, podaje mu osobny sekret HMAC i tworzy regułę `wplaty@bezreszty.org.pl` (z subadresowaniem).
6. Synchronizuje publiczne SPF/DKIM/DMARC z `deploy/mail-dns.json`, jeśli plik istnieje, i sprawdza publiczne `/healthz`.

Sekrety pozostają w `/etc/bezreszty/runtime.env` (0600). Nie są w archiwum źródeł ani argumentach poleceń; plik sekretu Workera jest krótkotrwały i usuwany po wdrożeniu. Hasło SMTP nie jest resetowane w każdym deployu.

`deploy.yml` wykonuje ten sam proces automatycznie po każdym pushu na `main`, gdy przejdą „Application checks” (testy, audyt, build obrazu), a także ręcznie (Run workflow). Wymaga dedykowanego `DEPLOY_SSH_KEY`, zweryfikowanego `DEPLOY_SSH_KNOWN_HOSTS`, `CLOUDFLARE_API_TOKEN` i zmiennej `CLOUDFLARE_ACCOUNT_ID`. Nie kopiuj osobistego klucza SSH do CI.

### Outsider — własny adres nadawcy

Domena `bezreszty.org.pl` na Outsiderze i konto `no-reply` służą wyłącznie SMTP. MX pozostają przy Cloudflare, więc nie potrzebujesz dodatkowych skrzynek przychodzących. `scripts/provision-outsider.mjs` potrafi idempotentnie dodać domenę i konto przez API DirectAdmin (z kluczem ograniczonym do domen i poczty). Wymaga zmiennych `DIRECTADMIN_USER`, `DIRECTADMIN_KEY` i `BEZRESZTY_ENV_FILE`; nie przyjmuje sekretów w argumentach i nie zmienia istniejącego hasła. Uprawnienia i rzeczywiste SPF/DKIM sprawdź u dostawcy. Dla instalacji bez klucza API konto można jednorazowo utworzyć w panelu.

Po włączeniu DKIM pobierz publiczne rekordy domeny z panelu. Zapisz je w `deploy/mail-dns.json` według przykładu; `scripts/sync-mail-dns.mjs` i proces deployu utworzą lub zaktualizują je przez **cf CLI**. Skrypt DNS nie usuwa MX ani innych domen.
