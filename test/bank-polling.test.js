import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function browser(responses) {
 const timers=[],listeners={},state={reloads:0,requests:0};
 const document={hidden:false,querySelectorAll:()=>[],getElementById:()=>null,querySelector:selector=>selector==='[data-bank-verification]'?{dataset:{startedAt:'started'}}:null,addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const window={location:{reload(){state.reloads++;}},addEventListener:(name,fn)=>{listeners[name]=fn;}};
 runInNewContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),{
  document,window,AbortSignal,
  setTimeout(fn,delay){const timer={fn,delay};timers.push(timer);return timer;},
  clearTimeout(timer){if(timer)timer.cleared=true;},
  async fetch(url,options){assert.equal(url,'/api/weryfikacja/status');assert.equal(options.cache,'no-store');state.requests++;return responses.shift();},
 });
 return {state,document,listeners,timers,async tick(){const timer=timers.find(t=>!t.cleared&&!t.ran);assert.ok(timer);timer.ran=true;await timer.fn();return timer;}};
}
const pending={ok:true,status:200,json:async()=>({notificationSeen:false,status:'pending',startedAt:'started'})};
test('bank page polls, keeps the active code and reloads only when the state changes',async()=>{
 const b=browser([pending,{ok:true,status:200,json:async()=>({notificationSeen:true,status:'pending',startedAt:'started'})}]);
 assert.equal((await b.tick()).delay,5000);assert.equal(b.state.reloads,0);
 await b.tick();assert.equal(b.state.reloads,1);assert.equal(b.state.requests,2);
 assert.equal(b.timers.filter(t=>!t.cleared&&!t.ran).length,0);
});
test('bank polling backs off on failure, pauses while hidden and stops on expired sessions',async()=>{
 const b=browser([{ok:false,status:503},{ok:false,status:401}]);
 await b.tick();assert.equal(b.timers.at(-1).delay,10000);
 b.document.hidden=true;await b.tick();assert.equal(b.state.requests,1);
 b.document.hidden=false;await b.listeners.visibilitychange();assert.equal(b.state.requests,2);
 assert.equal(b.state.reloads,0);assert.equal(b.timers.filter(t=>!t.cleared&&!t.ran).length,0);
});
