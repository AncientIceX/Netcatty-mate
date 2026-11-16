#!/usr/bin/env node
// Real loopback HTTP with the actual bridge; native transport is an explicit test adapter.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const requests=[]; let mode='ok';
const auth='Basic '+Buffer.from('用户:密 码:@!雪','utf8').toString('base64');
const server=createServer((req,res)=>{
 requests.push({method:req.method,path:req.url,authenticated:req.headers.authorization===auth});
 if(req.headers.authorization!==auth){res.writeHead(401,{'WWW-Authenticate':'Basic realm="fixture", charset="UTF-8"'});res.end();return;}
 if(mode==='empty'){res.writeHead(404);res.end();return;}
 if(mode==='redirect'){res.writeHead(302,{Location:'/elsewhere'});res.end();return;}
 res.writeHead(req.method==='PROPFIND'?207:200);res.end(req.method==='PROPFIND'?'<multistatus/>':JSON.stringify({meta:{version:1},encrypted:'fixture'}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const win={innerWidth:412,setTimeout,clearTimeout,dispatchEvent(){},open(){}};
const emit=(id,data)=>win.__onNativeEvent('async_response',Buffer.from(JSON.stringify({reqId:id,...data})).toString('base64'));
const transport=async(id,url,method,headers,body)=>{try{const r=await fetch(url,{method,headers:JSON.parse(headers),redirect:'manual'});emit(id,{ok:r.ok,status:r.status,data:await r.text()});}catch(e){emit(id,{ok:false,status:0,error:e.message});}};
win.NativeBridge={getHomeDirSync:()=>'/fixture',cloudReadFetchAsync:transport,httpFetchAsync:transport};
const context=vm.createContext({window:win,navigator:{userAgent:'Android',language:'zh-CN'},document:{documentElement:{setAttribute(){}},querySelector(){return null;}},localStorage:{getItem(){return null;},setItem(){}},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,URLSearchParams,atob,btoa,console,queueMicrotask});
const source=readFileSync(process.env.BRIDGE_SOURCE||'infrastructure/mobile/androidBridgePolyfill.ts','utf8');
vm.runInContext(stripTypeScriptTypes(source.replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();',context);
const api=win.netcatty;
try{
 const base=`http://127.0.0.1:${server.address().port}/dav`;
 const config={endpoint:base,authType:'basic',username:'用户',password:'密 码:@!雪'};
 for(const endpoint of [base,base+'/',base+'/netcatty-vault.json']){
  await api.cloudSyncWebdavInitialize({...config,endpoint});
  assert.equal((await api.cloudSyncWebdavDownload({...config,endpoint})).syncedFile.meta.version,1);
 }
 for(const method of ['cloudSyncWebdavInitialize','cloudSyncWebdavDownload']){
  const before=requests.length;
  await assert.rejects(api[method]({...config,password:'wrong'}),/认证失败.*401.*未写入云端/);
  assert.equal(requests.length,before+1,'401 must not retry');
 }
 mode='empty';await api.cloudSyncWebdavInitialize(config);assert.equal((await api.cloudSyncWebdavDownload(config)).syncedFile,null);
 mode='redirect';await assert.rejects(api.cloudSyncWebdavInitialize(config),/302/);
 const before=requests.length;
 for(const method of ['cloudSyncWebdavInitialize','cloudSyncWebdavDownload'])await assert.rejects(api[method]({...config,authType:'digest'}),/Digest/);
 for(const method of ['cloudSyncWebdavUpload','cloudSyncWebdavDelete','cloudSyncS3Upload','cloudSyncS3Delete'])await assert.rejects(api[method](config),/禁止/);
 assert.equal(requests.length,before);
 assert.ok(requests.every(r=>['PROPFIND','GET','HEAD'].includes(r.method)));
 assert.ok(requests.every(r=>r.path==='/dav/netcatty-vault.json'));
 mkdirSync('cloud-read-results',{recursive:true});writeFileSync('cloud-read-results/http-methods.json',JSON.stringify({requests,remoteWrites:0,transport:'Node fetch adapter, not Android device'},null,2));
 console.log(`PASS ${requests.length} real loopback requests; zero writes; UTF-8 Basic, 401 no retry, empty remote, trailing slash, redirect rejection`);
}finally{await new Promise(r=>server.close(r));}
