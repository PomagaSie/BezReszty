# Obsługa prywatności i retencji

Dokument operacyjny do wersji publicznych zasad z 2026-11-08. Dane kontaktowe i opis dostawców instancji produkcyjnej znajdują się w `deploy/production.json` (`publicInformation`). Są to dane przeznaczone do publikacji, nie sekrety. Skrypt wdrożenia przekazuje je jako zmienne interpolacji Compose, mające pierwszeństwo przed dawnymi wartościami w `runtime.env`. Przy wdrożeniu ręcznym trzeba przekazać te same wartości. Inna instancja musi podać własne dane w `.env`.

## Uprawnienia do przelewów

- `/panel/niedopasowane-wplaty` odczytuje wyłącznie rekordy należące do zalogowanego użytkownika, z rozpoznanym rachunkiem i dozwoloną przyczyną niedopasowania. Nie przyjmuje identyfikatora właściciela z formularza lub URL.
- Rola operatora nie daje dostępu do cudzych rekordów. Operator prowadzący własną zbiórkę widzi jedynie własne przelewy, przez swój panel organizatora.
- `/admin` nie pobiera listy niedopasowanych przelewów. Nie dodawaj tytułów, kwot ani pełnych wiadomości do dziennika operacji.
- Uprawnienia aplikacji nie oznaczają szyfrowania danych wyłącznie kluczem organizatora. Baza i klucz kwarantanny są dostępne administratorowi infrastruktury. Dostęp ten powinien służyć niezbędnemu utrzymaniu i bezpieczeństwu, nie przeglądaniu przelewów. W razie potrzeby ochrony również przed administratorem serwera konieczny jest odrębny projekt kryptograficzny.
- Pomoc techniczna może otrzymać od organizatora tylko wybrane dane potrzebne do obsługi zgłoszenia. Nie żądaj pełnego wyciągu bankowego.

## Automatyczne usuwanie

`src/retention.js` działa przy starcie serwera, następnie co minutę podczas pracy serwera, a także przed wykonaniem kopii przez `scripts/backup.js`:

- usuwa metadane bankowe starsze niż 30 dni, z wyjątkiem potwierdzeń wpłat i weryfikacji;
- usuwa niepotwierdzone zgłoszenia starsze niż 30 dni, o ile nie są powiązane z zachowanym dowodem bankowym;
- usuwa wygasłe kody inicjujące weryfikację mObywatel;
- usuwa zwykłe pliki kopii `bezreszty-<data>.sqlite` starsze niż 30 dni z katalogu `backups` obok bazy; ignoruje dowiązania symboliczne i inne nazwy.

Lista organizatora od razu wyklucza rekordy po 30 dniach, niezależnie od czasu ostatniego przebiegu porządkowania. Potwierdzone wpłaty i sumy zbiórek nie są zmieniane.

Kwarantanna pełnych wiadomości ma osobny limit jednej godziny i porządkowanie co 30 sekund. Kopie aplikacji nie zawierają kwarantanny. Skrypty nie usuwają dowolnych eksportów ani kopii dostawcy hostingu: właściciel każdej dodatkowej kopii musi ustawić usunięcie po 30 dniach. Dotyczy to również zaszyfrowanych kopii poza serwerem. Nie przenoś rekordów do eksportu tylko po to, aby ominąć retencję.

Wariant produkcyjny opisany w `docs/MAIL.md` nie ma skrzynki IMAP dla wiadomości bankowych. Przy zmianie na IMAP ustaw retencję także u dostawcy i uaktualnij politykę. Wyłączenie serwera wstrzymuje proces usuwania; zaległości są usuwane przy następnym starcie.

## Powiadomienia push

- Klucz VAPID instancji powstaje przy pierwszym użyciu i jest zapisany w tabeli `app_secrets` zaszyfrowany kluczem wyprowadzonym z `MFA_ENCRYPTION_KEY` (osobny kontekst HKDF). Bez tego klucza powiadomienia są wyłączone. Po jego zmianie nowa para VAPID powstaje automatycznie, a stare subskrypcje są usuwane; urządzenia muszą ponownie włączyć powiadomienia.
- `push_subscriptions` zawiera adres i klucze subskrypcji przeglądarki. Rekord znika po wyłączeniu przez użytkownika, wylogowaniu z przeglądarki, odpowiedzi 404/410 usługi powiadomień albo usunięciu konta. Adresy są przyjmowane wyłącznie z usług przeglądarek (lista w `src/push.js`).
- `push_outbox` to kolejka wysyłki, czyszczona po dostarczeniu i najpóźniej po godzinie. Powiadomienie nie zawiera podpisu ani komentarza wpłacającego; nie dodawaj ich ani innych danych osobowych do treści.
- Przy wniosku o usunięcie danych usuń także subskrypcje użytkownika (kasuje je usunięcie konta).

## Roszczenia, zamknięcie konta i prawa osób

1. Obsługuj wnioski przez prywatny adres z `/kontakt`. Potwierdź tożsamość proporcjonalnie do żądania; nie wymagaj automatycznie kopii dokumentu.
2. Przed upływem miesiąca odpowiedz albo uzasadnij przedłużenie zgodnie z RODO. Reklamacje dotyczące usługi mają termin odpowiedzi 14 dni.
3. Wycofanie zgody na podpis/komentarz oznacza usunięcie publicznego tekstu, nie usunięcie samej wpłaty ani zmianę sumy zbiórki. Zachowaj minimalny zapis wykonania żądania. Nowe zgody mają datę i wersję w `donations`; nie dopisuj zgód wstecz dla starszych wpisów.
4. Przy zamykaniu konta zakończ aktywne zbiórki, unieważnij sesje i tokeny oraz usuń zbędne dane. Ustal oddzielnie, jakie dane są jeszcze potrzebne do konkretnego rozliczenia lub roszczenia. Sama możliwość wystąpienia sporu nie uzasadnia zachowania całej bazy bezterminowo.
5. Potwierdzenia wpłat, wyniki weryfikacji i dziennik operacji wymagają regularnego przeglądu (co najmniej raz w roku). Dla zachowanych dowodów ustal zdarzenie rozpoczynające termin, podstawę i datę następnego przeglądu/usunięcia. Nie zakładaj automatycznie sześciu lat dla wszystkich informacji.
6. Jeżeli konkretne postępowanie wymaga zachowania dowodu, zabezpiecz tylko niezbędny zakres w odrębnej dokumentacji sprawy z ograniczonym dostępem i własnym terminem przeglądu. Nie udostępniaj operatorowi całej listy przelewów organizatora.
7. Po przywróceniu kopii uruchom porządkowanie i ponownie wykonaj żądania usunięcia/ograniczenia spełnione od daty kopii, zanim przywrócisz ruch użytkowników.

## Przegląd dostawców i dokumentów

Potwierdź zakres umów powierzenia i lokalizacje danych u dostawców hostingu, poczty, kopii i ochrony ruchu. W szczególności utrzymuj aktualną dokumentację transferów Cloudflare. Nie przedstawiaj samych publicznych dokumentów dostawcy jako dowodu indywidualnie sprawdzonej konfiguracji konta.

Przy zmianie polityki zachowaj poprzednią wersję (historia Git), ustaw nową datę w `config.legalVersion` i poinformuj użytkowników zgodnie z regulaminem. Nie zmieniaj celu przetwarzania ani nie rozszerzaj publikacji danych wyłącznie przez edycję tekstu polityki. Polityka BezReszty nie zastępuje polityki aplikacji, na którą prowadzona jest zbiórka.

Podstawy przygotowania: RODO, w szczególności art. 5, 6, 12–14, 15–22, 28 i rozdział V; art. 118 i następne Kodeksu cywilnego; zasady świadczenia usług drogą elektroniczną i, w zakresie mającym zastosowanie, DSA. Status operatora jest opisany zgodnie z jego deklaracją; nie dodawaj fikcyjnej firmy, adresu ulicznego ani numerów rejestrowych.
