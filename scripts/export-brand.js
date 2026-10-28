import { Resvg } from '@resvg/resvg-js';
import { readFileSync,writeFileSync } from 'node:fs';
const svg=readFileSync('brand/og.svg');
const rendered=new Resvg(svg,{font:{loadSystemFonts:true,defaultFontFamily:'Arial'},fitTo:{mode:'width',value:1200}}).render().asPng();
writeFileSync('brand/og.png',rendered);writeFileSync('website/assets/og.png',rendered);
for(const size of [192,512])writeFileSync(`public/images/icon-${size}.png`,new Resvg(readFileSync('brand/mark.svg'),{fitTo:{mode:'width',value:size}}).render().asPng());
console.log('Wyeksportowano OG 1200×630 i ikony 192/512.');
