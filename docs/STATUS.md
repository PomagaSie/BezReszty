# Stan wdrożenia

Kod aplikacji, witryna organizacji, profil GitHub, branding i instrukcje samodzielnego hostowania są w tym repozytorium.

## Weryfikacja lokalna

- Testy kont, uprawnień, moderacji i rozliczania wpłat: `npm test`.
- Kryptograficzny test DKIM z syntetycznym kluczem DNS, odrzucanie podmiany treści/odbiorcy i podpisów częściowych.
- Kontrola składni JS/EJS: `npm run check`.
- Audyt zależności produkcyjnych: `npm audit --omit=dev --audit-level=high`.
- Widok strony głównej i zbiórki sprawdzony w przeglądarce lokalnej. Po odblokowaniu Maca można kontynuować końcową weryfikację mobilną.

## Wymagane na docelowym serwerze

1. Serwer wskazany: Wanda192, jeden kontener aplikacji z SQLite. DNS/HTTPS i osobny Worker są zarządzane przez skrypt deployu.
2. SMTP no-reply na Outsiderze oraz osobny Worker Email Routing. Skrzynka przychodząca nie jest wymagana.
3. Prawdziwy test dostarczenia podpisanego powiadomienia Alior Banku na tę skrzynkę.
4. Dane operatora instancji, procedura weryfikacji i retencja.

Repozytorium nie zawiera haseł ani poświadczeń do banku. Przeszłe/pokazowe wpłaty w bazie demonstracyjnej nie są prawdziwymi darowiznami. Nie uznawaj publicznego wdrożenia aplikacji za wykonane na podstawie samego README lub obecności konfiguracji Compose.

## Współpraca z Claude

Claude przygotował koncepcję znaku „serce z pełnym obiegiem”, propozycje tekstów strony organizacji, FAQ i profilu GitHub. Codex wdrożył znak SVG i wybrane treści, zaprojektował stronę oraz aplikację, zaimplementował backend i testy. Nieaktywne środowisko Claude Code zastąpiono zwykłą rozmową, z której odebrano i przejrzano odpowiedź.
