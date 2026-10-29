// Idempotent provisioning through DirectAdmin's documented legacy API.
// Input secrets must be supplied via environment or a protected env file, never arguments.
import { readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
const endpoint=process.env.DIRECTADMIN_URL || 'https://outsider.mikr.us:2222';
const domain=process.env.MAIL_DOMAIN || 'bezreszty.org.pl';
const user=process.env.DIRECTADMIN_USER,key=process.env.DIRECTADMIN_KEY;
const runtime=process.env.BEZRESZTY_ENV_FILE;
if(!user||!key||!runtime)throw new Error('Wymagane DIRECTADMIN_USER, DIRECTADMIN_KEY i BEZRESZTY_ENV_FILE. Sekretów nie przekazuj argumentami.');
if(new URL(endpoint).protocol!=='https:'||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))throw new Error('Nieprawidłowa domena lub adres API.');
const auth='Basic '+Buffer.from(`${user}:${key}`).toString('base64');
async function api(path,params,post=false){
 const url=new URL(path,endpoint);if(!post)url.search=new URLSearchParams(params);
 const response=await fetch(url,{method:post?'POST':'GET',headers:{Authorization:auth,...(post?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:post?new URLSearchParams(params):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`DirectAdmin HTTP ${response.status}`);
 const text=await response.text();
 let result;try{result=JSON.parse(text);}catch{result=Object.fromEntries(new URLSearchParams(text));}
 if(String(result.error)==='1')throw new Error('DirectAdmin odrzucił operację. Sprawdź limity i uprawnienia klucza; odpowiedź z danymi nie jest logowana.');
 return {result,text};
}
const domains=await api('/CMD_API_SHOW_DOMAINS',{});
if(!domains.text.includes(domain)){
 await api('/CMD_API_DOMAIN',{action:'create',domain,ubandwidth:'unlimited',uquota:'unlimited',ssl:'ON',cgi:'OFF',php:'OFF'},true);
 console.log('Dodano domenę pocztową w DirectAdmin.');
}
const accounts=await api('/CMD_API_POP',{action:'list',domain});
const values=existsSync(runtime)?Object.fromEntries(readFileSync(runtime,'utf8').split('\n').filter(v=>v&&!v.startsWith('#')&&v.includes('=')).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];})):{};
const address=`no-reply@${domain}`;
const accountList=JSON.stringify(accounts.result);
if(!/(?:^|[^a-z0-9-])no-reply(?:[^a-z0-9-]|$)/i.test(accountList)){
 const password=values.SMTP_USER===address&&values.SMTP_PASSWORD?values.SMTP_PASSWORD:randomBytes(32).toString('base64url');
 // Persist a pending credential before the API mutation so an interrupted creation is recoverable.
 values.SMTP_HOST='outsider.mikr.us';values.SMTP_PORT='465';values.SMTP_USER=address;values.SMTP_PASSWORD=password;values.MAIL_FROM=`BezReszty <${address}>`;
 save();
 await api('/CMD_API_POP',{action:'create',domain,user:'no-reply',passwd:password,passwd2:password,quota:'20',limit:'0'},true);
 console.log('Utworzono oddzielne konto SMTP no-reply. Hasło zapisano tylko w chronionym pliku runtime.');
}else{
 if(values.SMTP_USER!==address||!values.SMTP_PASSWORD)throw new Error('Konto już istnieje; nie zmieniono hasła. Podaj jego obecne hasło w chronionym runtime.env.');
 console.log('Konto SMTP już istnieje — nie zmieniono go.');
}
function save(){mkdirSync(dirname(runtime),{recursive:true,mode:0o700});const temporary=runtime+'.tmp';writeFileSync(temporary,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});chmodSync(temporary,0o600);renameSync(temporary,runtime);}
console.log('DNS SPF/DKIM należy zsynchronizować z rekordami domeny w DirectAdmin; nie kieruj MX na Outsidera, gdy bankowe wiadomości odbiera Worker.');
