import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),cfg=JSON.parse(readFileSync(resolve(root,'deploy/production.json')));
const path=resolve(root,process.argv[2]||'deploy/mail-dns.json');
const records=JSON.parse(readFileSync(path));
const binary=resolve(root,'email-worker/node_modules/.bin/cf');
const cf=args=>execFileSync(binary,args,{encoding:'utf8',cwd:resolve(root,'email-worker')});
for(const record of records){
 if(!['TXT','CNAME'].includes(record.type)||!(record.name===cfg.domain||record.name.endsWith('.'+cfg.domain)))throw new Error('Rekord poza zakresem domeny pocztowej.');
 const old=JSON.parse(cf(['dns','records','list','-z',cfg.zone,'--name',record.name,'--type',record.type]));
 const exact=old.find(r=>r.content.replaceAll('"','')===record.content.replaceAll('"',''));
 if(exact){console.log(`${record.name}: aktualny`);continue;}
 if(old.length>1)throw new Error(`Wiele rekordów ${record.name}; nie nadpisano żadnego.`);
 const body={...record,ttl:300,proxied:false};
 if(!old.length)cf(['dns','records','create','-z',cfg.zone,'--body',JSON.stringify(body)]);
 else cf(['dns','records','update',old[0].id,'-z',cfg.zone,'--body',JSON.stringify(body)]);
 console.log(`${record.name}: zsynchronizowany`);
}
