# Strona PomagaSie na GitHub

Źródłem statycznej strony organizacji jest katalog `website/` w BezReszty. Profil organizacji ma osobny plik `organisation/profile/README.md`. Adresy docelowe to `https://pomagasie.github.io` i `https://github.com/PomagaSie`.

## Strona organizacji

Repozytorium **PomagaSie/pomagasie.github.io** serwuje stronę z gałęzi `main`. Nie edytuj go ręcznie: jego workflow `sync-from-bezreszty.yml` kopiuje `website/` z tego repozytorium, wersjonuje `style.css` i `script.js` skrótem zawartości i przebudowuje Pages.

Synchronizacja uruchamia się:
- po każdym pushu na `main`, który zmienia `website/` (workflow `publish-site.yml`, wymaga sekretu `SITE_DISPATCH_TOKEN`: fine-grained token tylko do `PomagaSie/pomagasie.github.io` z uprawnieniem Contents: Read and write),
- co 30 minut jako zabezpieczenie,
- ręcznie (Actions → „Sync site from BezReszty” → Run workflow).

## Profil organizacji

W publicznym repozytorium **PomagaSie/.github** umieść `organisation/profile/README.md` jako `profile/README.md`. Używa bezwzględnych linków, więc będzie działać na profilu organizacji.

## Aplikacja

GitHub Pages obsługuje stronę informacyjną. Aplikacja z sesjami, SQLite i IMAP potrzebuje serwera Node.js/Docker opisanego w README. Dla `bezreszty.org.pl` ustaw domenę, HTTPS i pocztę na docelowym serwerze; publikacja strony GitHub Pages nie uruchamia backendu.
