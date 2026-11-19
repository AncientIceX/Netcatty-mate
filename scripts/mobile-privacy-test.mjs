import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createAndroidPrivacyService} from '../infrastructure/mobile/androidPrivacy.ts';
const require=createRequire(import.meta.url);const {createAiPrivacyService}=require('../electron/shared/aiPrivacyService.cjs');
const sample={text:'password=fixture-secret host=test.example 8.8.4.4 2001:4860:4860::8888 10.0.0.1',apiKey:'sk-fixture1234567890123456789',nested:{password:123}};
for(const config of [{enabled:true},{enabled:true,redactPrivateIps:true,cidrs:['10.0.0.0/8'],patterns:['fixture-[a-z]+']}]){
 const pc=createAiPrivacyService();pc.configure(config);const mobile=createAndroidPrivacyService();mobile.configure(config);
 const a=pc.redact('chat',sample),b=mobile.redact('chat',sample);
 const canonical=x=>JSON.stringify(x).replace(/NC_[a-f0-9]+_/g,'NC_NONCE_');assert.equal(canonical(a),canonical(b));assert.deepEqual(mobile.restore('chat',b),sample);
 assert.throws(()=>mobile.restore('other',b));mobile.clearSession('chat');assert.throws(()=>mobile.redact('chat',sample));
}
const window={innerWidth:412,setTimeout,clearTimeout,__createAndroidPrivacyService:createAndroidPrivacyService,NativeBridge:{getHomeDirSync:()=>'/sandbox'}};
const context=vm.createContext({window,document:{documentElement:{setAttribute(){}}},navigator:{userAgent:'Android'},localStorage:{getItem:()=>null,setItem(){}},TextEncoder,TextDecoder,crypto,URL,URLSearchParams,atob,btoa,console,queueMicrotask});
const source=readFileSync(process.env.BRIDGE_SOURCE||'infrastructure/mobile/androidBridgePolyfill.ts','utf8');vm.runInContext(stripTypeScriptTypes(source.replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();',context);
const bridge=window.netcatty;assert.equal((await bridge.aiPrivacyStatus()).enabled,true);
// Values cross a realm as in the native bridge; structured JSON only.
const request=vm.runInContext('({chatSessionId:"bridge-chat",operation:"redact",value:"password=fixture-secret 8.8.4.4"})',context);
const result=await bridge.aiPrivacyTransform(request);assert.equal(result.ok,true);assert.ok(!result.value.includes('fixture-secret'));assert.ok(!result.value.includes('8.8.4.4'));
assert.equal((await bridge.aiPrivacyTransform({chatSessionId:'bridge-chat',operation:'restore',value:result.value})).value,request.value);
await bridge.externalMcpSetConfig({redaction:null});assert.equal((await bridge.aiPrivacyStatus()).ok,false);assert.equal((await bridge.aiPrivacyTransform(request)).ok,false);
console.log('PASS Android/desktop detector parity, real bridge transformation/restoration, session isolation/retirement, invalid policy fail closed');
