# Weryfikacja organizatora

Operator odpowiada za decyzję o dopuszczeniu organizatora. Aplikacja zapewnia bramki techniczne, lecz nie zastępuje procesu ustalenia tożsamości.

## Kolejność

1. Organizator tworzy konto i potwierdza e-mail jednorazowym linkiem (ważnym godzinę). Otwarcie linku przez skaner poczty nie potwierdza konta — potrzebny jest formularz POST.
2. Podaje imię i nazwisko / nazwę organizacji, numer rachunku Alior Banku i polski telefon BLIK. Aplikacja sprawdza NRB modulo 97 i identyfikator 2490. To sprawdza format, nie własność.
3. Konfiguruje powiadomienia na losowy indywidualny adres z panelu.
4. Po przesłaniu danych wykonuje przelew testowy na swój rachunek z dokładnym tytułem z panelu. Podpisana wiadomość banku musi być zgodna z rachunkiem i aliasem. Przelew testowy nie jest darowizną ani opłatą za usługę.
5. **Operator ręcznie sprawdza osobno** tożsamość organizatora, własność wskazanego rachunku i przypisanie telefonu BLIK do tego rachunku. Wybiera adekwatny sposób sprawdzenia przed publicznym uruchomieniem instancji, np. kontakt na żywo i okazanie danych w aplikacji bankowej, bez udostępniania haseł, kodów, numerów dokumentów ani utrwalania zbędnych kopii. Nie opieraj decyzji wyłącznie na wpisanym formularzu, sfałszowanym zrzucie ekranu lub zgodności maski rachunku.
6. W `/admin` zapisuje krótką notatkę z zakresu i wyniku sprawdzenia (minimum 10 znaków), datę, podjętą decyzję. Nie wpisuje numerów dokumentów ani nadmiarowych danych. Notatkę zobaczy organizator.
7. Zatwierdza organizatora. System nie pozwala na zatwierdzenie bez potwierdzonego e-maila, danych rachunku i odebranego powiadomienia testowego.
8. Organizator zgłasza opis zbiórki. Operator czyta cel, budżet, zgody na dane i decyduje o publikacji. Akceptacja konta sama nie publikuje zbiórek.

## Zmiany i nadużycia

- Dane płatnicze są zablokowane podczas sprawdzania i po akceptacji. Ich zmianę uzgadnia się z operatorem i przeprowadza ponowną weryfikację. Nie podmieniaj telefonu na opublikowanej zbiórce bez sprawdzenia.
- Odrzucenie/wstrzymanie organizatora zamyka jego opublikowane i oczekujące zbiórki i blokuje nowe wpłaty. Historia wcześniejszych wpłat pozostaje.
- Poprawione zgłoszenie wymaga ponownego testu poczty i decyzji operatora.
- Edycja treści opublikowanej zbiórki cofa ją do szkicu lub moderacji. Zapis nie nadpisuje historii potwierdzonych wpłat.
- Dziennik operacji jest w bazie i panelu operatora. Nie usuwa się go przez formularz publiczny.

Publiczna odznaka „Sprawdzony organizator” oznacza wykonanie powyższego procesu przez operatora tej instancji. Nie jest certyfikatem Alior Banku, automatycznym KYC ani gwarancją realizacji celu.
