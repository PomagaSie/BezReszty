import { execFileSync,spawn } from 'node:child_process';
import { existsSync,readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const config=JSON.parse(readFileSync(resolve(root,process.argv[2] || 'deploy/production.json'),'utf8'));
for(const key of ['host','user','domain','zone','notificationDomain','worker'])if(!/^[A-Za-z0-9._-]+$/.test(config[key]))throw new Error('Nieprawidłowa konfiguracja: '+key);
for(const key of ['root','envFile'])if(!/^\/[A-Za-z0-9_./-]+$/.test(config[key]))throw new Error('Nieprawidłowa ścieżka: '+key);
const workerDir=resolve(root,'email-worker');
const cfBin=resolve(workerDir,'node_modules/.bin/cf');
const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,encoding:'utf8',stdio:options.capture?'pipe':'inherit',...options});
const cf=(args,capture=false)=>run(cfBin,args,{cwd:workerDir,capture,env:{...process.env,BEZRESZTY_DOMAIN:config.domain,BEZRESZTY_NOTIFICATION_DOMAIN:config.notificationDomain,BEZRESZTY_WORKER_NAME:config.worker}});
const json=args=>JSON.parse(cf(args,true));
const remote=script=>run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','-p',String(config.port),`${config.user}@${config.host}`,'python3','-'],{input:script,capture:true});
const q=JSON.stringify;
console.log('BezReszty: weryfikacja źródeł i konfiguracji wdrożenia.');
if(run('git',['status','--porcelain'],{capture:true}).trim())throw new Error('Wdrożenie wymaga czystego repozytorium i zacommitowanych zmian.');
const sha=run('git',['rev-parse','HEAD'],{capture:true}).trim();
if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Nieprawidłowy commit.');
run('npm',['run','check']);run('npm',['test']);
// Secrets stay on the server and in a protected, short-lived file consumed by cf.
const secretResult=remote(`import pathlib,json\np=pathlib.Path(${q(config.envFile)})\nif not p.is_file(): raise SystemExit('Brak chronionego runtime.env na serwerze.')\nvalues=dict(line.split('=',1) for line in p.read_text().splitlines() if line and not line.startswith('#') and '=' in line)\ns=values.get('BANK_WEBHOOK_SECRET','')\nif len(s)<32: raise SystemExit('Brak BANK_WEBHOOK_SECRET w runtime.env.')\nprint(json.dumps({'BANK_WEBHOOK_SECRET':s}))\n`);
const workerSecrets=JSON.parse(secretResult);
const temp=mkdtempSync(join(tmpdir(),'bezreszty-deploy-'));
const secretsFile=join(temp,'worker-secrets.json');
writeFileSync(secretsFile,JSON.stringify(workerSecrets),{mode:0o600});
try {
 const release=`${config.root}/releases/${sha}`;
 remote(`import pathlib\np=pathlib.Path(${q(release)})\np.mkdir(parents=True,exist_ok=True,mode=0o755)\n`);
 console.log('Wysyłanie podpisanej stanem git paczki źródeł na serwer.');
 // Stream a git archive; no working-tree files, .env, Git metadata or credentials are included.
 await new Promise((resolvePromise,reject)=>{
  const archive=spawn('git',['archive','--format=tar.gz','HEAD'],{cwd:root,stdio:['ignore','pipe','inherit']});
  const upload=spawn('ssh',['-o','BatchMode=yes','-p',String(config.port),`${config.user}@${config.host}`,'tar','-xzf','-','-C',release],{stdio:['pipe','inherit','inherit']});
  archive.stdout.pipe(upload.stdin);let archiveCode,uploadCode;
  const finish=()=>{if(archiveCode!==undefined&&uploadCode!==undefined)(archiveCode===0&&uploadCode===0?resolvePromise:reject)(new Error('Nie udało się wysłać archiwum.'));};
  archive.on('error',reject);upload.on('error',reject);archive.on('exit',c=>{archiveCode=c;finish();});upload.on('exit',c=>{uploadCode=c;finish();});
 });
 const deployed=remote(`import os,subprocess,pathlib\nrelease=${q(release)}\nenv=os.environ.copy()\nenv.update({'BEZRESZTY_ENV_FILE':${q(config.envFile)},'BEZRESZTY_RELEASE':${q(sha)}})\nargs=['docker','compose','--project-name','bezreszty','--env-file',${q(config.envFile)},'-f',release+'/compose.yaml','-f',release+'/deploy/compose.wanda.yaml']\nsubprocess.run(args+['up','-d','--build','--wait','--wait-timeout','90'],env=env,check=True)\npathlib.Path(${q(config.root+'/current-release')}).write_text(${q(sha)}+'\\n')\nprint('Kontener aplikacji jest healthy.')\n`);
 console.log(deployed.trim());
 // Add exactly this hostname, preserving the tunnel's other ingress settings and services.
 const tunnel=json(['tunnels','config','get',config.tunnelId]);
 const ingress=tunnel.config.ingress || [];
 const own=ingress.find(rule=>rule.hostname===config.domain);
 if(!own)ingress.splice(Math.max(0,ingress.length-1),0,{hostname:config.domain,service:config.tunnelOrigin});
 else if(own.service!==config.tunnelOrigin)throw new Error('Istniejąca reguła tunelu wskazuje inne origin. Sprawdź konfigurację.');
 if(!own)cf(['tunnels','config','update',config.tunnelId,'--body',JSON.stringify({config:{...tunnel.config,ingress}})]);
 const aliases=config.legacyDomains || [];
 if(aliases.some(hostname=>!ingress.some(rule=>rule.hostname===hostname))){
  for(const hostname of aliases){
   if(!/^[a-z0-9.-]+$/.test(hostname))throw new Error('Nieprawidłowa domena przekierowania.');
   if(!ingress.some(rule=>rule.hostname===hostname))ingress.splice(Math.max(0,ingress.length-1),0,{hostname,service:config.tunnelOrigin});
  }
  cf(['tunnels','config','update',config.tunnelId,'--body',JSON.stringify({config:{...tunnel.config,ingress}})]);
 }
 for(const hostname of aliases.filter(host=>host.endsWith('.'+config.zone))){
  const existing=json(['dns','records','list','-z',config.zone,'--name',hostname]).filter(record=>['A','AAAA','CNAME'].includes(record.type));
  if(!existing.length)cf(['dns','records','create','-z',config.zone,'--body',JSON.stringify({type:'CNAME',name:hostname,content:`${config.tunnelId}.cfargotunnel.com`,proxied:true,ttl:1})]);
  else if(existing.length!==1||existing[0].type!=='CNAME'||existing[0].content!==`${config.tunnelId}.cfargotunnel.com`)throw new Error('Alias ma inny rekord DNS — nie nadpisano go.');
 }
 const records=json(['dns','records','list','-z',config.zone,'--name',config.domain]).filter(record=>['A','AAAA','CNAME'].includes(record.type));
 const target=`${config.tunnelId}.cfargotunnel.com`;
 if(!records.length)cf(['dns','records','create','-z',config.zone,'--body',JSON.stringify({type:'CNAME',name:config.domain,content:target,proxied:true,ttl:1,comment:'BezReszty — wdrożenie aplikacji'})]);
 else if(records.length!==1||records[0].type!=='CNAME'||records[0].content!==target)throw new Error('Domena ma inny rekord — nie nadpisano go.');
 const routing=json(['email-routing','settings','get','-z',config.zone]);
 const configuredDomain=config.notificationDomain===config.zone ? routing.enabled : routing.subdomains?.some(domain=>domain.name===config.notificationDomain && domain.enabled);
 if(!configuredDomain)cf(['email-routing','enable','-z',config.zone,...(config.notificationDomain===config.zone ? [] : ['--name',config.notificationDomain])]);
 if(!routing.support_subaddress){
  if(config.enableSubaddressing && config.notificationDomain===config.zone)cf(['email-routing','settings','apply','-z',config.zone,'--support-subaddress']);
  else throw new Error('Email Routing wymaga support_subaddress=true. Ustaw je świadomie dla tej strefy przed wdrożeniem.');
 }
 if(existsSync(resolve(root,'deploy/mail-dns.json')))run(process.execPath,['scripts/sync-mail-dns.mjs']);
 console.log('Wdrożenie odseparowanego Workera bankowych powiadomień.');
 cf(['deploy','--secrets-file',secretsFile]);
 const rules=json(['email-routing','rules','list-account','-z',config.zone,'--per-page','100']);
 const address=`wplaty@${config.notificationDomain}`;
 const rule=rules.find(rule=>rule.matchers?.some(m=>m.type==='literal'&&m.value===address));
 if(!rule)cf(['email-routing','rules','create','-z',config.zone,'--name','BezReszty — powiadomienia bankowe','--matchers',JSON.stringify([{type:'literal',field:'to',value:address}]),'--actions',JSON.stringify([{type:'worker',value:[config.worker]}])]);
 else if(!rule.enabled||!rule.actions?.some(a=>a.type==='worker'&&a.value?.includes(config.worker)))throw new Error('Adres bankowych powiadomień ma inną regułę. Nie nadpisano jej.');
 const response=await fetch(`https://${config.domain}/healthz`,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Publiczna kontrola zdrowia nie powiodła się.');
 console.log(`Wdrożono ${sha.slice(0,12)}: https://${config.domain}`);
} finally { rmSync(temp,{recursive:true,force:true}); }
