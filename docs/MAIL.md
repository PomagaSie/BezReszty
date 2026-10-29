# Powiadomienia Alior Banku

## Model

Wpłata jest **przelewem na telefon BLIK**, bezpośrednio do organizatora. BezReszty generuje unikalny tytuł `BR-<12 losowych znaków hex>`. Odbiorca musi mieć telefon zarejestrowany do odbioru BLIK na swoim darmowym koncie Alior Banku. Alternatywnie strona wpłaty pokazuje zwykły przelew na ten sam rachunek, z identycznym tytułem i kwotą.

Aplikacja nie inicjuje przelewu i nie ma dostępu do bankowości użytkownika. Nie używa sześciocyfrowych kodów BLIK, PSD2 ani bramki płatniczej.

## Zalecany wariant: osobny Email Worker, bez skrzynki przychodzącej

W produkcji BezReszty powiadomienia odbiera odseparowany Worker `bezreszty-bank-mail` z katalogu `email-worker/`. Aplikacja i SQLite pozostają w jednym kontenerze na Wandzie. Worker nie korzysta z parsera ani endpointu ClassyCash.

- Domena pocztowa: `bezreszty.org.pl`; MX kierują na Cloudflare Email Routing.
- Jedna reguła literalna `wplaty@bezreszty.org.pl` i aktywne subadresowanie obsługują `wplaty+<losowy-alias>@bezreszty.org.pl` każdego organizatora.
- Worker przesyła do `POST /api/bank-mail` surowy RFC822 (do 256 KiB) z HMAC-SHA256 po `timestamp + "\n" + raw`. Nagłówki: `X-Bezreszty-Timestamp` i `X-Bezreszty-Signature`. Okno podpisu: 5 minut.
- Aplikacja weryfikuje HMAC, a następnie niezależnie prawdziwy podpis DKIM banku i całą zgodność rachunku/referencji/kwoty. Samo wysłanie żądania przez Workera nie potwierdza wpłaty.
- Konfiguracja, build, sekret HMAC i reguła Worker są częścią `scripts/deploy.mjs`. Sekret różni się od pozostałych aplikacji.
- Worker nie loguje adresów, treści ani kwot. Błędna odpowiedź backendu powoduje błąd przetwarzania poczty; nie potwierdza doręczenia przed trwałym zapisem zdarzenia.

Nadawca `no-reply@bezreszty.org.pl` jest odrębnym kontem **SMTP** na Outsiderze. Nie potrzebujemy skrzynki bankowych powiadomień, catch-all w IMAP ani dostępu do prywatnej poczty.

## Alternatywny wariant: IMAP

Dla self-hostingu bez Workera można użyć poniższego procesu ze skrzynką IMAP. Wybierz jeden importer, a nie oba równocześnie.

## Dostarczenie e-maila

1. Przygotuj **dedykowaną** domenę/subdomenę np. `powiadomienia.twojadomena.pl` i skrzynkę IMAP. Wszystkie losowe aliasy tej subdomeny mają trafiać do tej skrzynki (catch-all). Nie używaj prywatnej skrzynki operatora.
2. Ustaw `NOTIFICATION_DOMAIN` na tę subdomenę, a `IMAP_HOST`, `IMAP_PORT=993`, `IMAP_USER`, `IMAP_PASSWORD` na skrzynkę. Certyfikat TLS musi być poprawny.
3. W panelu każdy organizator zobaczy oddzielny adres: `<losowy-alias>@powiadomienia.twojadomena.pl`. **Nie zmieniaj nagłówka To ani treści bankowego e-maila.** Routing kopertowy/alias jest dopuszczalny, przepisywanie podpisanych nagłówków i dopiski w treści mogą zepsuć DKIM.
4. Organizator w Alior Online ustawia ten adres dla powiadomień o **uznaniu rachunku** właściwego konta. Przed zmianą ustawień sprawdza dostępne opcje w swoim banku. Nie potrzebujemy jego hasła, cookies, numeru karty ani kodów bankowych.
5. Po zgłoszeniu danych organizator wykonuje na swój rachunek testowy przelew z tytułem `BR-KONTO-<kod z panelu>`. Panel pokazuje odebranie uwierzytelnionego powiadomienia.
6. Operator dodatkowo sprawdza właściciela rachunku i telefon według [VERIFICATION.md](VERIFICATION.md). Dopiero potem akceptuje konto.

Format wiadomości i podpisy zweryfikuj na rzeczywistym bankowym powiadomieniu docelowej skrzynki. Testy repozytorium używają syntetycznych podpisanych e-maili; nie potwierdzają dostarczalności konkretnego dostawcy.

## Co sprawdza importer

- Surowa wiadomość RFC822 do 256 KiB, brak duplikatów istotnych nagłówków.
- Dokładny nadawca `powiadomienia@alior.pl`.
- Poprawny DKIM z domeny z listy `BANK_DKIM_DOMAINS` (domyślnie `alior.pl,aliorbank.pl`); podpisane: From, To, Subject, Date i występujące nagłówki MIME. Pełne ciało wiadomości, klucz nieoznaczony jako testowy.
- Data wiadomości nie starsza niż 7 dni i nie więcej niż 5 minut w przyszłości.
- Pojedynczy podpisany adres `To` równy aliasowi znanego organizatora.
- Temat `Uznanie rachunku 46...5420 kwotą 50,00 PLN`, zgodność kwoty w treści i temacie.
- Rachunek z tematu odpowiada zweryfikowanemu rachunkowi organizatora (pełny numer albo pierwsze 2 i ostatnie 4 cyfry maski). Maska sama w sobie nie dowodzi własności — dlatego jest też alias i ręczna weryfikacja.
- Dokładnie jedna znana referencja wpłaty w tytule, właściciel zbiórki zgodny z aliasem, dokładna kwota w groszach i brak wcześniejszego potwierdzenia.

Weryfikujemy podpis kryptograficznie przez DNS, **nie ufamy tekstowi nagłówka Authentication-Results**. Nie dodawaj domen podpisu bez sprawdzenia rzeczywistego nadawcy i infrastruktury banku. Nie ma przełącznika „pomijaj DKIM”.

## Praca w tle

Proces serwera synchronizuje skrzynkę co 30 sekund. Nie uruchamiaj drugiej repliki ani równoległego synchronizatora na tym samym koncie IMAP. Polecenie diagnostyczne dla zatrzymanej aplikacji:

```sh
npm run mail:sync
```

Importer zapisuje UIDVALIDITY i ostatni UID, przetwarza do 100 wiadomości na przebieg, nie kasuje wiadomości i nie zmienia flag przeczytania. Gdy UIDVALIDITY się zmieni, ponowne przejrzenie skrzynki jest bezpieczne dzięki deduplikacji. Tymczasowy błąd DNS lub połączenia nie przesuwa kursora ponad nieprzetworzoną wiadomość; kolejna próba nastąpi automatycznie.

Zalecana retencja skrzynki powinna uwzględniać czas potrzebny na wyjaśnienie błędów i obowiązki operatora. Aplikacja nie usuwa e-maili dostawcy poczty. Nie trzymaj latami zbędnych powiadomień.

## Kwarantanna

W `/admin` widać wyjątki, np. `amount_mismatch`, `account_mismatch`, `unknown_or_ambiguous_reference`, `dkim_not_authenticated`. Takie zdarzenia nie zwiększają sumy zbiórki. Wyjaśniaj je z organizatorem na podstawie historii jego rachunku. Nie ma przycisku do zatwierdzania niesprawdzonego e-maila. Jeśli bank zmieni format, popraw parser i dodaj zanonimizowany test regresyjny przed ponownym importem.

Zapisywane są tylko fingerprint, organizator, kwota, tytuł, maska rachunku, status i referencja wpłaty. Treść wiadomości i nazwa bankowego nadawcy nie trafiają do bazy ani logów aplikacji.
