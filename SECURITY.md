# Bezpieczeństwo

Nie zgłaszaj podatności z sekretami ani danymi użytkowników w publicznym issue. Skontaktuj się prywatnie z operatorem instancji lub właścicielem repozytorium przez GitHub.

- Sesje: losowy token 256 bitów, w bazie tylko SHA-256, cookies HttpOnly/Secure/SameSite i prefiks `__Host-` w produkcji.
- Formularze: token CSRF powiązany z sesją lub host-only cookie i sprawdzenie Origin. Brak publicznego endpointu zmiany statusu wpłaty.
- Hasła: scrypt z losową solą. Reset jednorazowy, 1h, unieważnia wszystkie sesje.
- Moderacja: organizator nie może nadać sobie statusu verified ani opublikować zbiórki bez decyzji operatora.
- Bank: weryfikacja DKIM na surowej wiadomości, bez ufania sfałszowanym nagłówkom Authentication-Results. Podpis obejmuje odbiorcę, nadawcę, datę, temat i nagłówki MIME. Podpisy z częściowym ciałem (`l=`), testowe klucze, duplikaty istotnych nagłówków i nieznane domeny nie są akceptowane.
- Izolacja: indywidualny losowy alias organizatora, zgodność maski rachunku oraz właściciela referencji i dokładnej kwoty. Transakcja SQLite i unikalny fingerprint chronią przed duplikatami.
- Nie przechowujemy treści e-maila ani nazwy nadawcy bankowego; dostawca poczty przechowuje wiadomości poza aplikacją. Ogranicz dostęp i retencję skrzynki.
- Powiadomienia do siedmiu dni wstecz. Niepasujące zdarzenia są widoczne w kwarantannie operatora i nie zwiększają zbiórki.
- Brak danych bankowych w logach błędów. Linki e-mail pojawiają się w logach wyłącznie przy NODE_ENV innym niż production.

Uruchamiaj za HTTPS. Nie udostępniaj portu aplikacji poza zaufanym proxy; `TRUST_PROXY=1` w Compose zakłada dokładnie jeden proxy. Nie konfiguruj zaufania do dowolnego X-Forwarded-For. Rate limiting jest w pamięci procesu i resetuje się po restarcie. Dla dużego ruchu stosuj dodatkowe limity w reverse proxy. SQLite i proces IMAP są przeznaczone dla pojedynczej instancji aplikacji, nie wielu replik.

Zweryfikuj rzeczywistą konfigurację DKIM powiadomień Aliora na docelowej skrzynce przed uruchomieniem prawdziwych zbiórek. Nie wyłączaj uwierzytelnienia na podstawie treści wiadomości. Jeśli bankowy format się zmieni, pozostaw powiadomienia w kwarantannie do czasu poprawienia parsera i testów.
