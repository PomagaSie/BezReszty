# BezReszty — Dobro w całości

Nazwa łączy brak potrąceń z pełnym zaangażowaniem. Organizacja nadrzędna: **PomagaSie**. Produkt: **BezReszty**. Nie przedstawiaj PomagaSie jako Siepomaga, fundacji ani partnera Alior Banku/BLIK.

## Znak

Otwarte serce: jedna gruba linia z zaokrąglonymi końcami, przerwana u dołu. Serce oznacza dobry gest, a przerwa pokazuje, że pomoc przez nie przechodzi, a nie zostaje po drodze. Grubość linii i obłe zakończenia odpowiadają Nunito ExtraBold z logotypu. Znak zaproponował Claude w ramach współpracy z Codexem. Nie używaj znaku zamiast logo banku lub BLIK.

- `mark.svg`: kremowe serce na zielonym kafelku 64×64; favicona i ikona aplikacji, czytelna od 16 px.
- `mark-clay.svg`: wariant na fiolecie (historyczna nazwa pliku), do użycia jako dodatkowy akcent.
- `mark-mono.svg`: samo serce w zieleni, bez kafelka.
- `logo.svg`: znak + logotyp „BezReszty” w Nunito ExtraBold, tekst zamieniony na krzywe; minimalna szerokość 160 px, pole ochronne równe połowie wysokości znaku.
- `og.svg` i `og.png`: 1200×630, grafika linków społecznościowych. `npm run brand:export` eksportuje PNG, ikony, warianty przezroczyste i ZIP. Szczegóły oraz rozmiary: [PNG.md](PNG.md).
- Logotyp i nazwa organizacji nie mają kropki na końcu. Nagłówki również kończą się bez kropki.
- PomagaSie, organizacja nadrzędna, używa fioletowego znaku ✳. Strona organizacji korzysta z tej samej palety zieleni, żółtego, liliowego i mięty. BezReszty używa otwartego serca.

## Typografia

- Nagłówki, logotyp i duże liczby: **Nunito** 700/800, hostowany lokalnie (`public/fonts`, `website/assets/fonts`, licencja OFL w `OFL.txt`). Bez Google Fonts i zewnętrznych CDN.
- Interfejs, formularze i tekst ciągły: krój systemowy (Inter, gdy dostępny). Dane przelewu muszą być przede wszystkim czytelne.

## Paleta — Sunny together

| Rola | Kolor |
| --- | --- |
| Świeża zieleń: marka, główne przyciski, ciemne sekcje | `#176B4B` |
| Ciemna zieleń: aktywny przycisk i link | `#105239` |
| Słoneczny żółty: płatki kwiatu, podkreślenie „wpłata”, CTA na zieleni | `#FFD75A` |
| Liliowy: tło oryginalnego kwiatu i akcenty ilustracji | `#C7B8F5` |
| Jasny liliowy: puste stany, pomoc i onboarding | `#EEE8FC` |
| Mięta: pasek zasad i detale ilustracji | `#BDE9CE` |
| Kremowe tło | `#FFFBF0` |
| Tekst | `#203E33` |
| Tekst pomocniczy | `#586960` |
| Fiolet: fokus i drobne akcenty tekstowe | `#7253A8` |

Biały tekst na zieleni; ciemny tekst na żółtym, liliowym, miętowym i kremowym tle. Żółty nie służy do drobnego tekstu ani obramowania fokusu. Fokus jest kontrastowo fioletowy. Przycisk CTA na zielonej sekcji jest żółty z ciemnym tekstem.

Kolorowe akcenty podkreślają odkrywanie zbiórek i powitanie. Formularze, dane przelewu i komunikaty o stanie pozostają spokojne i czytelne. Kolor nie zastępuje etykiety ani komunikatu. Nie używaj pomarańczu ani czerwieni jako koloru głównego.

Oryginalny kwiat z sercem zachowuje wszystkie kształty, linie i proporcje. Zmieniamy wyłącznie kolory: żółte płatki, zielone serce i łodyga, miętowy liść, liliowe tło. Nie dodajemy twarzy. Zachowujemy główne hasło **Całe serce. Cała wpłata** i wyraźne **0% prowizji aplikacji**.

## Materiały PomagaSie

`pomagasie-mark.svg` i `pomagasie-mark-mono.svg` zawierają fioletową gwiazdkę. `pomagasie-logo.svg` łączy znak z logotypem Nunito na krzywych. `pomagasie-og.svg` i PNG to osobna grafika społecznościowa organizacji. Zestawy PNG obu marek dostępne są w `brand/png/` i `brand-kit.zip`.

## Język

Krótko, ciepło i konkretnie. Hasła: **Dobro w całości**, **Całe serce. Cała wpłata**, **Pomaganie bez odejmowania** Zawsze określaj `0% prowizji aplikacji`. Model wymaga darmowego konta organizatora w Alior Banku; przelewy trafiają do organizatora, nie na konto platformy. Nie obiecuj czasu księgowania e-maila, gwarancji realizacji celu ani automatycznego KYC.

Ilustracje `public/images/*.svg` są autorskimi grafikami kategorii. Zbiórki demonstracyjne są jawnie oznaczone, nie ilustrują prawdziwych osób i nie służą do przyjmowania wpłat.

Kod i autorskie materiały są objęte MIT z głównego pliku LICENSE. Znaki banków i operatora BLIK należą do ich właścicieli.
