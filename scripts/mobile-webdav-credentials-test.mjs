// Source-executing regression: renderer credential hydration -> real loopback WebDAV.
// Native key access is mocked; no Android-device or CD2-server claim.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {handleWebdavInitialize}=require('../electron/bridges/cloudSyncBridge.cjs');
const requests=[];
const password='密 码:@!雪', username='用户';
const expected='Basic '+Buffer.from(`${username}:${password}`).toString('base64');
const server=createServer((req,res)=>{
 requests.push({method:req.method,path:req.url,authenticated:req.headers.authorization===expected});
 if(req.headers.authorization!==expected){res.writeHead(401,{'WWW-Authenticate':['Basic realm="CD2-compatible fixture", charset="UTF-8"','Digest realm="fixture", nonce="fixture", qop="auth"']});res.end();return;}
 res.writeHead(207,{'Content-Type':'application/xml'});res.end(`<D:multistatus xmlns:D="DAV:"><D:response><D:href>${req.url}</D:href><D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const win={innerWidth:412,setTimeout,clearTimeout,dispatchEvent(){},open(){}};
const emit=(id,data)=>win.__onNativeEvent('async_response',Buffer.from(JSON.stringify({reqId:id,...data})).toString('base64'));
let nativeCalls=0;
win.NativeBridge={getHomeDirSync:()=>'/fixture',credentialsDecrypt(value){nativeCalls++;return value==='enc:v1:android-keystore:fixture'?password:'';},async cloudReadFetchAsync(id,url,method,headers){const r=await fetch(url,{method,headers:JSON.parse(headers),redirect:'manual'});emit(id,{ok:r.ok,status:r.status,data:await r.text(),headers:Object.fromEntries(r.headers)});}};
const context=vm.createContext({window:win,navigator:{userAgent:'Android',language:'zh-CN'},document:{documentElement:{setAttribute(){}},querySelector(){return null;}},localStorage:{getItem(){return null;},setItem(){}},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,URLSearchParams,atob,btoa,console,queueMicrotask});
const source=readFileSync(process.env.BRIDGE_SOURCE||'infrastructure/mobile/androidBridgePolyfill.ts','utf8');
vm.runInContext(stripTypeScriptTypes(source.replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();',context);
const api=win.netcatty;
try{
 const config={endpoint:`http://127.0.0.1:${server.address().port}/dav/`,authType:'basic',username,password};
 await handleWebdavInitialize(config);
 // secureFieldAdapter decryptFieldResult invokes credentialsDecrypt for plaintext too.
 const {decryptProviderSecrets}=await import('../infrastructure/persistence/secureFieldAdapter.ts');
 globalThis.window=win;
 const connection=await decryptProviderSecrets({provider:'webdav',status:'connected',config});
 const hydrated=connection.config.password;
 assert.equal(hydrated,password,'plaintext WebDAV password must survive hydration, not become empty');
 assert.equal(nativeCalls,0,'plaintext must not enter native ciphertext decoder');
 await api.cloudSyncWebdavInitialize({...config,password:hydrated});
 assert.equal(await api.credentialsDecrypt('enc:v1:android-keystore:fixture'),password);
 for(const value of ['enc:v1:android-keystore:foreign-device','enc:v1:'+Buffer.concat([Buffer.from('v10'),Buffer.alloc(32,1)]).toString('base64')]){
  await assert.rejects(api.credentialsDecrypt(value),/credential|凭据/i);
 }
 assert.equal(await api.credentialsDecrypt(''), '');
 assert.ok(requests.every(r=>r.authenticated&&r.path==='/dav/netcatty-vault.json'&&r.method==='PROPFIND'));
 mkdirSync('cloud-read-results',{recursive:true});writeFileSync('cloud-read-results/credential-parity.json',JSON.stringify({requests,remoteWrites:0,scope:'actual PC webdav + mobile JS, Node transport/native cipher mock'},null,2));
 console.log('PASS PC/mobile Basic header parity; plaintext hydration; encrypted failure closed; zero cloud writes');
}finally{await new Promise(r=>server.close(r));}
