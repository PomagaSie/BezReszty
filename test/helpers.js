import { randomUUID } from 'node:crypto';
import { openDatabase, now } from '../src/db.js';
import { token, passwordHash } from '../src/domain.js';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
export const iban='96249000000000000000000001';
export function setup(extra={}) {
  const db=openDatabase(':memory:');
  const config={...readConfig({}),...extra};
  const messages=[];
  const app=createApp({config,db,sendMail:async(user,purpose)=>{messages.push({user,purpose});}});
  return {db,config,app,messages};
}
export async function addUser(db,options={}) {
  const id=randomUUID(),email=`${token(6)}@example.test`;
  const user={id,email,name:'Testowy Organizator',password:await passwordHash('bezpieczne-haslo-123'),phone:'600000000',iban,notification_alias:token(16),verification_status:'verified',role:'organizer',...options};
  db.prepare('INSERT INTO users(id,email,name,password,phone,iban,notification_alias,email_verified,verification_status,role,bank_notification_seen,created_at,submitted_at) VALUES (?,?,?,?,?,?,?,1,?,?,1,?,?)').run(user.id,user.email,user.name,user.password,user.phone,user.iban,user.notification_alias,user.verification_status,user.role,now(),now());
  return user;
}
export function addCampaign(db,user,options={}) {
  const c={id:randomUUID(),owner_id:user.id,slug:token(6),title:'Pomagamy wspólnie testować',summary:'Pomoc dla testów systemu weryfikacji wpłat i poprawnej izolacji organizatorów.',story:'Historia testowa. '.repeat(20),category:'pomoc',location:'Warszawa',cover:'care',goal:100000,status:'published',...options};
  db.prepare('INSERT INTO campaigns(id,owner_id,slug,title,summary,story,category,location,cover,goal,status,deadline,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(c.id,c.owner_id,c.slug,c.title,c.summary,c.story,c.category,c.location,c.cover,c.goal,c.status,c.deadline||null,now(),now());
  return c;
}
export async function csrf(agent,path='/logowanie') {
  const response=await agent.get(path);
  const match=response.text.match(/name="_csrf" value="([a-f0-9]+)"/);
  return match?.[1];
}
export async function login(agent,user) {
  const value=await csrf(agent);
  const response=await agent.post('/logowanie').type('form').send({_csrf:value,email:user.email,password:'bezpieczne-haslo-123'});
  if(response.status!==302)throw new Error(`Login failed: ${response.status}`);
  return csrf(agent,'/panel');
}
export function addDonation(db,c,options={}) {
  const d={id:token(),campaign_id:c.id,code:`BR-${token(6).toUpperCase()}`,amount:5000,...options};
  db.prepare('INSERT INTO donations(id,campaign_id,code,amount,created_at) VALUES (?,?,?,?,?)').run(d.id,d.campaign_id,d.code,d.amount,new Date(Date.now()-10000).toISOString());
  return d;
}
