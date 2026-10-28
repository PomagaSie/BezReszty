import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ejs from 'ejs';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(`${dir}/${f.name}`):[`${dir}/${f.name}`]);}
for(const path of [...files('src'),...files('scripts'),...files('public'),...files('test')].filter(f=>/\.m?js$/.test(f))){
 const r=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(r.status)process.exit(r.status);
}
for(const path of files('views').filter(f=>f.endsWith('.ejs')))ejs.compile(readFileSync(path,'utf8'),{filename:path});
console.log('Składnia JavaScript i szablony EJS: OK.');
