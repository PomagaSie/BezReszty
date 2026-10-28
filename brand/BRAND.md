# BezReszty — Dobro w całości

Nazwa łączy brak potrąceń z pełnym zaangażowaniem. Organizacja nadrzędna: **PomagaSie**. Produkt: **BezReszty**. Nie przedstawiaj PomagaSie jako Siepomaga, fundacji ani partnera Alior Banku/BLIK.

## Znak

Otwarte serce: jedna gruba linia z zaokrąglonymi końcami, przerwana u dołu. Serce oznacza dobry gest, a przerwa pokazuje, że pomoc przez nie przechodzi, a nie zostaje po drodze. Grubość linii i obłe zakończenia odpowiadają Nunito ExtraBold z logotypu. Znak zaproponował Claude w ramach współpracy z Codexem. Nie używaj znaku zamiast logo banku lub BLIK.

- `mark.svg`: owsiane serce na sosnowym kafelku 64×64; favicona i ikona aplikacji, czytelna od 16 px.
- `mark-clay.svg`: wariant na glinie, do użycia na sosnowych tłach.
- `mark-mono.svg`: samo serce w sośnie, bez kafelka.
- `logo.svg`: znak + logotyp „BezReszty” w Nunito ExtraBold, tekst zamieniony na krzywe; minimalna szerokość 160 px, pole ochronne równe połowie wysokości znaku.
- `og.svg` i `og.png`: 1200×630, grafika linków społecznościowych. `node scripts/export-brand.js` eksportuje PNG i ikony 192/512.
- Logotyp i nazwa organizacji nie mają kropki na końcu. Nagłówki również kończą się bez kropki.
- PomagaSie, organizacja nadrzędna, używa znaku ✳ w kolorze gliny. BezReszty używa otwartego serca.

## Typografia

- Nagłówki, logotyp i duże liczby: **Nunito** 700/800, hostowany lokalnie (`public/fonts`, `website/assets/fonts`, licencja OFL w `OFL.txt`). Bez Google Fonts i zewnętrznych CDN.
- Interfejs, formularze i tekst ciągły: krój systemowy (Inter, gdy dostępny). Dane przelewu muszą być przede wszystkim czytelne.

## Paleta

| Rola | Kolor |
| --- | --- |
| Sosna: marka, przyciski główne, ciemne sekcje | `#1F4D3F` |
| Glina: akcent, przycisk „Załóż zbiórkę” w sekcjach CTA, ✳ | `#B5532F` |
| Morela: duże liczby i akcenty na sośnie | `#F2C4A6` |
| Jasna glina: podkreślenia, zaznaczenie | `#F3D9CA` |
| Szałwia: weryfikacja, potwierdzone wpłaty | `#8FAE8B` |
| Owsiane tło | `#FAF7F2` |
| Tekst | `#1E2A26` |
| Tekst pomocniczy | `#5D6862` |

Biały tekst na sośnie i glinie; ciemny tekst na owsianym tle, jasnej glinie i moreli. Nie stosuj gliny ani moreli jako koloru drobnego tekstu na owsianym tle. Nie używaj pomarańczu ani czerwieni jako koloru głównego, żeby marka nie przypominała Siepomaga. Widoczne fokusy (glina) i kontrastowe przyciski.

## Język

Krótko, ciepło i konkretnie. Hasła: **Dobro w całości**, **Całe serce. Cała wpłata**, **Pomaganie bez odejmowania** Zawsze określaj `0% prowizji aplikacji`. Model wymaga darmowego konta organizatora w Alior Banku; przelewy trafiają do organizatora, nie na konto platformy. Nie obiecuj czasu księgowania e-maila, gwarancji realizacji celu ani automatycznego KYC.

Ilustracje `public/images/*.svg` są autorskimi grafikami kategorii. Zbiórki demonstracyjne są jawnie oznaczone, nie ilustrują prawdziwych osób i nie służą do przyjmowania wpłat.

Kod i autorskie materiały są objęte MIT z głównego pliku LICENSE. Znaki banków i operatora BLIK należą do ich właścicieli.
