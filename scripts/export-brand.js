import { Resvg } from '@resvg/resvg-js';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

// All SVG lettering is outlined: exports need neither system fonts nor network access.
function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
function png(svg, width, path) {
  write(path, new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
}
const read = name => readFileSync(`brand/${name}.svg`, 'utf8');
const recolor = (svg, colors) => svg.replace(/#[0-9a-f]{6}/gi, color => colors[color.toUpperCase()] || color);

const flower = readFileSync('views/home.ejs', 'utf8').match(/<svg class="hero-flower"[\s\S]*?<\/svg>/)?.[0];
if (!flower) throw new Error('Nie znaleziono oryginalnego kwiatu w views/home.ejs');
write('brand/flower.svg', flower.replace('class="hero-flower"', 'xmlns="http://www.w3.org/2000/svg" width="440" height="470"').replace(' aria-hidden="true"', ''));

const brands = [
  { name: 'bezreszty', mark: 'mark', mono: 'mark-mono', logo: 'logo', og: 'og' },
  { name: 'pomagasie', mark: 'pomagasie-mark', mono: 'pomagasie-mark-mono', logo: 'pomagasie-logo', og: 'pomagasie-og' },
];
for (const brand of brands) {
  const base = `brand/png/${brand.name}`;
  for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) {
    png(read(brand.mark), size, `${base}/icon-${size}.png`);
  }
  for (const size of [64, 128, 256, 512, 1024]) {
    png(read(brand.mono), size, `${base}/mark-transparent-${size}.png`);
    png(recolor(read(brand.mono), { '#176B4B': '#FFFBF0', '#7253A8': '#FFFBF0' }), size, `${base}/mark-light-transparent-${size}.png`);
  }
  for (const width of [328, 656, 1312]) {
    png(read(brand.logo), width, `${base}/logo-transparent-${width}.png`);
    png(recolor(read(brand.logo), { '#176B4B': '#FFFBF0', '#7253A8': '#FFFBF0', '#FFFBF0': '#176B4B' }), width, `${base}/logo-light-transparent-${width}.png`);
  }
  png(read(brand.og), 1200, `${base}/social-1200x630.png`);
  copyFileSync(`${base}/social-1200x630.png`, `brand/${brand.og}.png`);
  copyFileSync(`brand/${brand.og}.png`, `website/assets/${brand.og}.png`);
  for (const asset of [brand.mark, brand.mono, brand.logo, brand.og]) {
    copyFileSync(`brand/${asset}.svg`, `website/assets/${asset}.svg`);
  }
}
for (const width of [440, 880, 1320]) png(read('flower'), width, `brand/png/bezreszty/flower-transparent-${width}.png`);
copyFileSync('brand/mark-clay.svg', 'website/assets/mark-clay.svg');
for (const size of [32, 192, 512]) copyFileSync(`brand/png/bezreszty/icon-${size}.png`, `public/images/icon-${size}.png`);
copyFileSync('brand/png/bezreszty/icon-180.png', 'public/images/apple-touch-icon.png');
copyFileSync('brand/png/pomagasie/icon-32.png', 'website/assets/pomagasie-icon-32.png');
copyFileSync('brand/png/pomagasie/icon-180.png', 'website/assets/pomagasie-apple-touch-icon.png');
copyFileSync('brand/PNG.md', 'brand/png/README.md');
// zip is available on macOS and the Ubuntu publishing environment. Recreate the
// archive so removed assets from an earlier export cannot linger in the download.
rmSync('brand/brand-kit.zip', { force: true });
execFileSync('zip', ['-X', '-q', '-r', resolve('brand/brand-kit.zip'), 'README.md', 'bezreszty', 'pomagasie'], { cwd: 'brand/png' });
copyFileSync('brand/brand-kit.zip', 'website/assets/brand-kit.zip');
console.log('Wyeksportowano PNG BezReszty i PomagaSie, ikony aplikacji, grafiki społecznościowe i brand-kit.zip.');
