# Stan wdrożenia

Wdrożono 28 października 2026 (Europe/Warsaw).

- Aplikacja: https://bezreszty.org.pl — jeden kontener `bezreszty-app-1` na Wandzie192, status healthy; SQLite w trwałym wolumenie.
- Strona projektu i organizacji: https://pomagasie.github.io — GitHub Pages, publikacja potwierdzona.
- Profil organizacji: https://github.com/PomagaSie — repozytorium `.github` z `profile/README.md`.
- Publiczny kod: https://github.com/PomagaSie/BezReszty, MIT, README z instrukcją samodzielnego hostowania.
- Oddzielny Worker: `bezreszty-bank-mail`; reguła `wplaty@bezreszty.org.pl`, subadresy `wplaty+<alias>@…`. Osobny sekret HMAC; własny backend. Konfiguracja Workera i reguł wykonywana w procesie deployu.
- SMTP: `no-reply@bezreszty.org.pl` na `outsider.mikr.us:465`. Poprawny TLS i uwierzytelnienie zweryfikowane. Konto bez dodatkowego limitu ustawionego przez aplikację; limity dostawcy pozostają po jego stronie.
- SPF, publiczny DKIM z DirectAdmin i DMARC (`p=quarantine`, wszystkie trzy przechodzą z wyrównaniem do `bezreszty.org.pl`) zapisane jako kod w `deploy/mail-dns.json`, zsynchronizowane przez cf. Bankowe powiadomienia nie wymagają skrzynki IMAP.

## Weryfikacja

20 testów obejmuje konta, uprawnienia, moderację, dokładne kwoty, izolację organizatorów, duplikaty, kryptograficzny DKIM, niepodpisane/podmienione wiadomości i HMAC Workera. Kontrola składni JS/EJS oraz oba audyty zależności przeszły. Obraz zbudowany i uruchomiony na Wandzie; CI GitHub zakończone sukcesem. Publiczne strony zwracają HTTP 200. Widoki aplikacji i strony PomagaSie sprawdzono w przeglądarce na desktopie i przy szerokości 390 px; brak poziomego przewijania.

Weryfikacja SMTP nie wysłała testowego e-maila do żadnej osoby. Pierwsza rejestracja potwierdzi rzeczywiste doręczenie. **Prawdziwy przelew i bankowe powiadomienie Aliora nie były wykonywane**; organizator musi przejść opisany test bankowy przed zatwierdzeniem konta i publikacją. Roli operatora nie otrzymuje się z formularza rejestracji — nadaje ją administrator serwera przez `scripts/admin.js` po potwierdzeniu adresu e-mail.

## Współpraca

Claude przygotował koncepcję znaku „serce z pełnym obiegiem” i propozycje treści strony, FAQ i profilu. Codex wdrożył znak i wybrane teksty, przygotował aplikację, layout, testy i wdrożenie. Więcej: `CLAUDE-HANDOFF.md`.
