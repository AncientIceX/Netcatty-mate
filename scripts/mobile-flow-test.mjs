#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const timers=new Map(); let serial=0;
const win={innerWidth:390,setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id),dispatchEvent(){}};
const sessions=new Map();const input=[];
const emit=(type,payload)=>win.__onNativeEvent(type,Buffer.from(JSON.stringify(payload)).toString('base64'));
function session(id){if(!sessions.has(id))sessions.set(id,{paused:false,pending:[],credit:0,closed:false});return sessions.get(id);}
function pump(id){const s=session(id);while(!s.closed&&!s.paused&&s.pending.length&&s.credit+s.pending[0].length<=65536){const b=s.pending.shift();s.credit+=b.length;win.__onTerminalBytesB64(id,b.toString('base64'));}}
win.NativeBridge={getHomeDirSync:()=>'/sandbox',setTerminalOutputPaused:(req,id,paused)=>{const s=session(id);s.paused=paused;emit('async_response',{reqId:req,ok:!s.closed,error:s.closed?'closed':undefined});pump(id);},acknowledgeTerminalOutput:(id,n)=>{session(id).credit-=n;queueMicrotask(()=>pump(id));},writeTerminalBytesB64:(id,b64)=>input.push([id,Buffer.from(b64,'base64').toString()]),closeSession:id=>{session(id).closed=true;},connectSshSession:(req,json)=>{const {sessionId:id}=JSON.parse(json);sessions.set(id,{paused:false,pending:[],credit:0,closed:false});emit('ssh_connected',{reqId:req,sessionId:id});}};
const context=vm.createContext({window:win,navigator:{userAgent:'Android'},document:{documentElement:{setAttribute(){}},querySelector:()=>null},localStorage:{getItem:()=>null,setItem(){}},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,URLSearchParams,atob,btoa,console,queueMicrotask});
const source=readFileSync(process.env.BRIDGE_SOURCE||'infrastructure/mobile/androidBridgePolyfill.ts','utf8');
vm.runInContext(stripTypeScriptTypes(source.replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();',context);
const b=win.netcatty;const received=[];
b.onSessionData('a',s=>received.push(s));
let drains=0;const off=b.onTerminalOutputDrainRequest('a',({requestId})=>{drains++;queueMicrotask(()=>b.respondTerminalOutputDrain(requestId));});
const a=await b.acquireSessionFlowPauseLease('a');assert.equal(a.success,true);assert.equal((await b.waitSessionFlowPauseLease('a',a.leaseId)).success,true);assert.equal(drains,1);
const c=await b.acquireSessionFlowPauseLease('a');b.setSessionFlowPaused('a',false);assert.equal(session('a').paused,true);
const expected=Array.from({length:5000},(_,i)=>`${i}:雪🙂\r\n`).join('');const bytes=Buffer.from(expected);
for(let i=0;i<bytes.length;i+=7)session('a').pending.push(bytes.subarray(i,i+7));pump('a');assert.equal(received.join(''),'');
b.writeToSession('a','echo input\n');assert.equal(input.at(-1)[1],'echo input\n');
await b.releaseSessionFlowPauseLease('a',a.leaseId);assert.equal(session('a').paused,true);
await b.releaseSessionFlowPauseLease('a',c.leaseId);await new Promise(r=>setImmediate(r));assert.equal(received.join(''),expected);assert.equal(session('a').credit,0);
assert.equal((await b.releaseSessionFlowPauseLease('a',c.leaseId)).success,false);
const hold=await b.acquireSessionFlowPauseLease('a');await b.releaseSessionFlowPauseLease('a',hold.leaseId,{keepPaused:true});assert.equal(session('a').paused,true);await b.setSessionFlowPausedAndWait('a',false);assert.equal(session('a').paused,false);
const exp=await b.acquireSessionFlowPauseLease('a');const expiry=[...timers.values()].find(t=>t.ms===30000);expiry.fn();await Promise.resolve();assert.equal(session('a').paused,false);assert.equal((await b.waitSessionFlowPauseLease('a',exp.leaseId)).success,false);
const isolated=await b.acquireSessionFlowPauseLease('b');assert.equal(session('a').paused,false);assert.equal(session('b').paused,true);
b.closeSession('b');assert.equal((await b.waitSessionFlowPauseLease('b',isolated.leaseId)).success,false);
await b.startSSHSession({sessionId:'b',hostname:'fixture.invalid'});assert.equal((await b.releaseSessionFlowPauseLease('b',isolated.leaseId)).success,false);
off();const noAck=b.onTerminalOutputDrainRequest('a',()=>{});const d=await b.acquireSessionFlowPauseLease('a');const waiting=b.waitSessionFlowPauseLease('a',d.leaseId);await Promise.resolve();await Promise.resolve();const timeout=[...timers.values()].find(t=>t.ms===5000);assert.ok(timeout);timeout.fn();assert.equal((await waiting).success,false);await b.releaseSessionFlowPauseLease('a',d.leaseId);noAck();
// No listener: native credit bounds undelivered backlog, without truncation.
const detached=Buffer.from('z'.repeat(180000));for(let i=0;i<detached.length;i+=4096)session('z').pending.push(detached.subarray(i,i+4096));pump('z');assert.ok(session('z').credit<=65536);assert.ok(session('z').pending.length>0);
const replay=[];b.onSessionData('z',s=>replay.push(s),{replayBacklog:false});await new Promise(r=>setImmediate(r));assert.equal(replay.join(''),detached.toString());assert.equal(session('z').credit,0);
const originalAcquire=b.acquireSessionFlowPauseLease;
const pendingLease=await originalAcquire('a');const pendingDrain=b.onTerminalOutputDrainRequest('a',()=>{});const pendingWait=b.waitSessionFlowPauseLease('a',pendingLease.leaseId);await Promise.resolve();await Promise.resolve();b.closeSession('a');assert.equal((await pendingWait).success,false);pendingDrain();
console.log('PASS real Android bridge: native gate/barrier, renderer drain, 5000 ordered UTF8 rows, concurrent leases/direct watermark, keepPaused, expiry, isolation, close/reconnect, input unaffected, drain timeout, bounded 180000-byte detached replay');
