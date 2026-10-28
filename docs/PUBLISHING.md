# Strona PomagaSie na GitHub

Źródłem statycznej strony organizacji jest katalog `website/` w BezReszty. Profil organizacji ma osobny plik `organisation/profile/README.md`. Adresy docelowe to `https://pomagasie.github.io` i `https://github.com/PomagaSie`.

## Strona organizacji

W publicznym repozytorium **PomagaSie/pomagasie.github.io** umieść zawartość `website/` w katalogu głównym, zachowując pliki assets i `.nojekyll`. Włącz GitHub Pages dla gałęzi `main`, katalog `/`.

Przykład, gdy repozytorium jeszcze nie istnieje:

```sh
gh repo create PomagaSie/pomagasie.github.io --public --description 'PomagaSie — otwarte narzędzia pomagania. Poznaj BezReszty.'
git clone git@github.com:PomagaSie/pomagasie.github.io.git /tmp/pomagasie-site
cp -R website/. /tmp/pomagasie-site/
git -C /tmp/pomagasie-site add .
git -C /tmp/pomagasie-site commit -m 'Publish PomagaSie and BezReszty project site'
git -C /tmp/pomagasie-site push origin main
gh api --method POST repos/PomagaSie/pomagasie.github.io/pages -f 'source[branch]=main' -f 'source[path]=/'
```

Przy aktualizacji skopiuj tylko pliki źródłowe strony, bez `.git`, sekretów czy konfiguracji wdrożenia innego repozytorium. `website/` pozostaje wersjonowanym źródłem w repo aplikacji.

## Profil organizacji

W publicznym repozytorium **PomagaSie/.github** umieść `organisation/profile/README.md` jako `profile/README.md`. Używa bezwzględnych linków, więc będzie działać na profilu organizacji.

## Aplikacja

GitHub Pages obsługuje stronę informacyjną. Aplikacja z sesjami, SQLite i IMAP potrzebuje serwera Node.js/Docker opisanego w README. Dla `bezreszty.mleczki.pl` ustaw domenę, HTTPS i pocztę na docelowym serwerze; publikacja strony GitHub Pages nie uruchamia backendu.
