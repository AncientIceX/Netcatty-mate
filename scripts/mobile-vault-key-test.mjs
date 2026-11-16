#!/usr/bin/env node
// Source-executing crypto/bridge regression. Fixed public fixture keys only.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.')) {
    const url = new URL(specifier, context.parentURL);
    const path = fileURLToPath(url);
    if (existsSync(path + '.ts')) return next(url.href + '.ts', context);
    if (existsSync(path) && statSync(path).isDirectory()) return next(url.href + '/index.ts', context);
  }
  return next(specifier, context);
}});
const pc = await import('../infrastructure/services/EncryptionService.ts');
const { SYNC_CONSTANTS } = await import('../domain/sync.ts');
const convergent = await import('../domain/convergentSync/index.ts');
function load(path, names, globals = {}) {
 const source = readFileSync(path,'utf8').replace(/^import[\s\S]*?;\s*$/gm,'').replace(/^export default .*;\s*$/gm,'').replace(/\bexport /g,'');
 return vm.runInNewContext(stripTypeScriptTypes(source)+`\n;({${names.join(',')}})`,{
  crypto:webcrypto, TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,atob,btoa,console,setTimeout,clearTimeout,
  ...globals,
 });
}
// Android bundles this exact EncryptionService; execute it in a separate realm,
// with real shared schema validation and WebCrypto, not a decrypt mock.
const mobile = load('infrastructure/services/EncryptionService.ts',['EncryptionService'],{
 SYNC_CONSTANTS, validateConvergentSyncPayload:convergent.validateConvergentSyncPayload,
}).EncryptionService;
const normalize = x => JSON.parse(JSON.stringify(x));
const payload={hosts:[{id:'fixture-host',label:'测试🔐',hostname:'example.invalid'}],keys:[],snippets:[],notes:[],identities:[],settings:{theme:'dark'}};
const keys=['Fixture-only-KEY-2026!','  Fixture 密钥Ａ🔐 e\u0301　 '];
// Execute the real desktop recovery parser on the same trailing-byte body.
const desktopBridgeSource=readFileSync('electron/bridges/cloudSyncBridge.cjs','utf8');
const parserStart=desktopBridgeSource.indexOf('const parseSyncedFileJson =');
const parserEnd=desktopBridgeSource.indexOf('\n};',parserStart)+3;
const desktopParse=vm.runInNewContext(desktopBridgeSource.slice(parserStart,parserEnd)+'\nparseSyncedFileJson');
const managerApi=load('infrastructure/services/cloudSync/providerSyncMethods.ts',['downloadFromProviderImpl'],{EncryptionService:mobile});
const results=[];
let vault;
for (const key of keys) {
 vault=await pc.encryptPayload(payload,key,'fixture-pc','PC','fixture');
 assert.equal(vault.meta.kdfIterations,600000);
 assert.equal(Buffer.from(vault.meta.salt,'base64').length,32);
 assert.equal(Buffer.from(vault.meta.iv,'base64').length,12);
 assert.deepEqual(normalize(await mobile.decryptPayload(vault,key)),payload);
 const reverse=await mobile.encryptPayload(payload,key,'fixture-android','Android','fixture');
 assert.deepEqual(await pc.decryptPayload(reverse,key),payload);
 await assert.rejects(mobile.decryptPayload(vault,key+'wrong'));
 if (key!==key.trim()) await assert.rejects(mobile.decryptPayload(vault,key.trim()));
 const tampered=structuredClone(vault); const bytes=Buffer.from(tampered.payload,'base64');bytes[0]^=1;tampered.payload=bytes.toString('base64');
 await assert.rejects(mobile.decryptPayload(tampered,key));
 results.push('PC → Android and Android → PC; exact UTF-8 preserved; wrong key/tamper rejected');
}
const v2state=convergent.createConvergentSyncStateFromPayload(payload,'fixture',1);
const v2=convergent.materializeSyncPayloadFromConvergentState(v2state,{syncedAt:1});
v2.convergentSync=convergent.createConvergentSyncEnvelope(v2state,v2);
const v2file=await pc.encryptPayload(v2,keys[0],'fixture-pc','PC','fixture');
assert.equal(v2file.meta.syncSchemaVersion,2);
assert.deepEqual(normalize(await mobile.decryptPayload(v2file,keys[0])),normalize(v2));
const v2reverse=await mobile.encryptPayload(v2,keys[0],'fixture-mobile','Android','fixture');
assert.deepEqual(await pc.decryptPayload(v2reverse,keys[0]),normalize(v2));
results.push('convergent schema v2 roundtrip with real validator');
const requests=[];let raw=JSON.stringify(vault);
const auth='Basic '+Buffer.from('fixture-user:fixture-webdav-password','utf8').toString('base64');
const server=createServer((req,res)=>{
 requests.push({method:req.method,path:req.url,authenticated:req.headers.authorization===auth});
 if(req.headers.authorization!==auth){res.writeHead(401);res.end();return;}
 res.writeHead(req.method==='PROPFIND'?207:200);res.end(req.method==='PROPFIND'?'<multistatus/>':raw);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const win={innerWidth:412,setTimeout,clearTimeout,dispatchEvent(){},open(){}};
const transport=async(id,url,method,headers)=>{try{const r=await fetch(url,{method,headers:JSON.parse(headers),redirect:'manual'});win.__onNativeEvent('async_response',Buffer.from(JSON.stringify({reqId:id,ok:r.ok,status:r.status,data:await r.text()})).toString('base64'));}catch(e){throw e;}};
win.NativeBridge={getHomeDirSync:()=>'/fixture',cloudReadFetchAsync:transport};
const context=vm.createContext({window:win,navigator:{userAgent:'Android',language:'zh-CN'},document:{documentElement:{setAttribute(){}},querySelector(){return null;}},localStorage:{getItem(){return null;},setItem(){}},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,URLSearchParams,atob,btoa,console,queueMicrotask});
vm.runInContext(stripTypeScriptTypes(readFileSync(process.env.BRIDGE_SOURCE||'infrastructure/mobile/androidBridgePolyfill.ts','utf8').replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();',context);
try {
 const api=win.netcatty;
 await api.cloudSyncSetSessionPassword(keys[1]);
 assert.equal(await api.cloudSyncGetSessionPassword(),keys[1]);
 const config={endpoint:`http://127.0.0.1:${server.address().port}/dav`,authType:'basic',username:'fixture-user',password:'fixture-webdav-password'};
 await api.cloudSyncWebdavInitialize(config);
 const downloaded=(await api.cloudSyncWebdavDownload(config)).syncedFile;
 assert.deepEqual(normalize(await mobile.decryptPayload(downloaded,await api.cloudSyncGetSessionPassword())),payload);
 // Desktop explicitly recovers a valid JSON object followed by old trailing
 // bytes left by non-truncating WebDAV. Android must restore that same object.
 raw=JSON.stringify(vault)+'OLD-VAULT-TRAILING-BYTES';
 assert.deepEqual(normalize(await pc.decryptPayload(desktopParse(raw),keys[1])),payload);
 const recovered=(await api.cloudSyncWebdavDownload(config)).syncedFile;
 assert.deepEqual(normalize(await mobile.decryptPayload(recovered,keys[1])),payload);
 const m={state:{securityState:'UNLOCKED'},masterPassword:keys[1],getConnectedAdapter:async()=>({download:async()=>(await api.cloudSyncWebdavDownload(config)).syncedFile}),addSyncHistoryEntry(){}};
 assert.deepEqual(normalize((await managerApi.downloadFromProviderImpl.call(m,'webdav')).payload),payload);
 m.masterPassword='different-fixture-key';
 await assert.rejects(managerApi.downloadFromProviderImpl.call(m,'webdav'),/Decryption failed/);
 m.masterPassword=keys[1];
 raw=JSON.stringify(vault).slice(0,-8);
 await assert.rejects(managerApi.downloadFromProviderImpl.call(m,'webdav'),/Download failed/);
 await assert.rejects(api.cloudSyncWebdavDownload(config));
 await api.cloudSyncClearSessionPassword();assert.equal(await api.cloudSyncGetSessionPassword(),null);
 assert.ok(requests.every(r=>['GET','HEAD','PROPFIND'].includes(r.method)&&r.authenticated));
 results.push('real loopback GET/PROPFIND; WebDAV credentials distinct from encryption key; session exact save/read/clear; trailing-byte restore; truncated JSON rejected');
 mkdirSync('cloud-read-results',{recursive:true});
 writeFileSync('cloud-read-results/vault-key.json',JSON.stringify({results,requests,remoteWrites:0,scope:'actual source in Node VM/WebCrypto; Node transport adapter, not Android device'},null,2));
 console.log('PASS vault key compatibility:',results);
} finally {await new Promise(r=>server.close(r));}
