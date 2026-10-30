# BezReszty i PomagaSie — zestaw PNG

Gotowe pliki znajdują się w `brand/png/bezreszty/` i `brand/png/pomagasie/`.
Cały zestaw: `brand/brand-kit.zip`, także pod adresem
https://pomagasie.github.io/assets/brand-kit.zip.

| Plik | Zastosowanie |
| --- | --- |
| `icon-16.png`, `icon-32.png`, `icon-48.png` | Małe ikony i favicony |
| `icon-64.png`, `icon-128.png`, `icon-256.png` | Ikony interfejsu i profilu |
| `icon-180.png` | Ikona Apple Touch |
| `icon-192.png`, `icon-512.png`, `icon-1024.png` | Ikony aplikacji i duże awatary |
| `mark-transparent-{64,128,256,512,1024}.png` | Sam znak, przezroczyste tło, jasne powierzchnie |
| `mark-light-transparent-{64,128,256,512,1024}.png` | Jasny znak na ciemne powierzchnie |
| `logo-transparent-{328,656,1312}.png` | Logo z nazwą, przezroczyste tło, jasne powierzchnie |
| `logo-light-transparent-{328,656,1312}.png` | Jasne logo z nazwą na ciemne powierzchnie |
| `social-1200x630.png` | Grafika linków społecznościowych |
| `bezreszty/flower-transparent-{440,880,1320}.png` | Oryginalny kwiat z sercem w nowej palecie |

Rozmiary znaków są kwadratowe. Liczba w nazwie logo lub kwiatu oznacza szerokość
w pikselach; wysokość zachowuje proporcje źródła. Przezroczyste warianty mają
rzeczywisty kanał alfa. Jasne logo oglądaj na ciemnym tle.

Nie rozciągaj grafik, nie zmieniaj kształtu serca lub kwiatu. Zachowaj wolne pole
wokół znaku. Ikony z kafelkiem nie są osobnym wariantem Android maskable.
Hasło BezReszty: **Całe serce. Cała wpłata**. Prowizja: **0% prowizji aplikacji**.

Paleta: zieleń `#176B4B`, żółty `#FFD75A`, liliowy `#C7B8F5`, mięta `#BDE9CE`,
krem `#FFFBF0`, tekst `#203E33`, fiolet znaku PomagaSie `#7253A8`.

Ponowny eksport z katalogu repozytorium: `npm run brand:export`.
Wymaga Node.js 24, zainstalowanych zależności npm i polecenia `zip`.
Źródła to SVG w `brand/`; kwiat pochodzi bezpośrednio z `views/home.ejs`.
Litery w SVG są zamienione na krzywe, więc eksport PNG nie wymaga instalowania fontów.

Materiały autorskie: licencja MIT repozytorium BezReszty. Font Nunito: SIL OFL,
licencja w `public/fonts/OFL.txt`. Zestaw nie zawiera znaków banku ani operatora BLIK.
