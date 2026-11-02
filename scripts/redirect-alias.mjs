// One command to redirect an old host (usually in another Cloudflare zone) to the main domain:
//   npm run redirect:alias -- bezreszty.mleczki.pl [--zone mleczki.pl]
// Needs an authenticated cf (CLOUDFLARE_API_TOKEN or `cf auth login`) with DNS and Rulesets edit rights on that zone.
// The host only has to be proxied (orange cloud): the redirect answers at the Cloudflare edge, so no Cytrus registration is needed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureRedirectRule,redirectRule,REDIRECT_DESCRIPTION } from './lib/redirect-rule.mjs';
const root=resolve(import.meta.dirname,'..');
const config=JSON.parse(readFileSync(resolve(root,'deploy/production.json'),'utf8'));
const args=process.argv.slice(2);
const zoneFlag=args.indexOf('--zone');
const zone=zoneFlag>=0?args.splice(zoneFlag,2)[1]:null;
const host=(args[0]||'').toLowerCase();
if(!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host))throw new Error('Użycie: npm run redirect:alias -- <host> [--zone <strefa>]');
if(host===config.domain)throw new Error('Host nie może być domeną docelową.');
const zoneName=zone||host.split('.').slice(-2).join('.');
if(!host.endsWith('.'+zoneName)&&host!==zoneName)throw new Error(`Host ${host} nie należy do strefy ${zoneName}. Podaj --zone.`);
const workerDir=resolve(root,'email-worker');
const cfBin=resolve(workerDir,'node_modules/.bin/cf');
const cf=(args,capture=false)=>execFileSync(cfBin,args,{cwd:workerDir,encoding:'utf8',stdio:capture?['ignore','pipe','inherit']:'inherit'});
const json=args=>JSON.parse(cf(args,true));

const records=json(['dns','records','list','-z',zoneName,'--name',host]).filter(record=>['A','AAAA','CNAME'].includes(record.type));
if(!records.length){
 // A proxied placeholder is enough: the rule answers before any request reaches the origin.
 cf(['dns','records','create','-z',zoneName,'--body',JSON.stringify({type:'A',name:host,content:process.env.CYTRUS_IPV4||'192.0.2.1',proxied:true,ttl:1,comment:'BezReszty — przekierowanie na '+config.domain})]);
 console.log(`Dodano proxied rekord A dla ${host}.`);
}else if(records.some(record=>!record.proxied)){
 console.log(`Uwaga: ${host} ma rekord bez proxy Cloudflare — przekierowanie nie zadziała, dopóki go nie włączysz (pomarańczowa chmurka).`);
}
const outcome=ensureRedirectRule({cf,json,zone:zoneName,hosts:[host],domain:config.domain});
const done={created:'Utworzono regułę',added:'Dodano regułę do istniejących reguł strefy',unchanged:'Reguła już istnieje i jest zgodna',differs:`Reguła „${REDIRECT_DESCRIPTION}” już istnieje z innym wyrażeniem — nie zmieniono jej`}[outcome];
console.log(`${done}: ${redirectRule([host],config.domain).expression} -> https://${config.domain}/…, 301.`);
console.log(`Sprawdź: curl -sI https://${host}/healthz | head -3`);
