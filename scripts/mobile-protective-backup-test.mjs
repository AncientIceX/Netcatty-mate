import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const storage=new Map();
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const win={innerWidth:412,setTimeout,clearTimeout,dispatchEvent(){},open(){}};
let fail=false, creates=0;const backups=new Map();
win.NativeBridge={getHomeDirSync:()=>'/fixture',vaultBackupAsync(id,operation,json){
 const options=JSON.parse(json);let result;
 if(operation==='create'){
  creates++;
  if(fail){queueMicrotask(()=>emit(id,{ok:false,error:'Injected private disk failure'}));return;}
  const backup={id:'fixture',createdAt:1,reason:options.reason,fingerprint:'fixture',preview:{}};
  backups.set(backup.id,structuredClone({backup,payload:options.payload}));result={created:true,backup};
 }else if(operation==='read')result=backups.get(options.id);
 else if(operation==='list')result=[...backups.values()].map(x=>x.backup);
 else if(operation==='capabilities')result={encryptionAvailable:true};
 queueMicrotask(()=>emit(id,{ok:true,result}));
}};
function emit(id,result){win.__onNativeEvent('async_response',Buffer.from(JSON.stringify({reqId:id,...result})).toString('base64'));}
const context=vm.createContext({window:win,navigator:{userAgent:'Android',language:'zh-CN'},document:{documentElement:{setAttribute(){}},querySelector(){return null;}},localStorage:globalThis.localStorage,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,URLSearchParams,atob,btoa,console,queueMicrotask});
vm.runInContext(stripTypeScriptTypes(readFileSync(process.env.BRIDGE_SOURCE||'infrastructure/mobile/androidBridgePolyfill.ts','utf8').replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();',context);
globalThis.window=win;
const backupSource=readFileSync('application/localVaultBackups.ts','utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm,'').replace(/export /g,'');
const backupContext=vm.createContext({window:win,navigator:{},console,setInterval,clearInterval,
 localStorageAdapter:{readString:k=>storage.get(k)??null,writeString:(k,v)=>storage.set(k,v),readNumber:()=>10,writeNumber:(k,v)=>storage.set(k,String(v)),remove:k=>storage.delete(k)},
 netcattyBridge:{get:()=>win.netcatty},getCloudSyncManager:()=>({getState:()=>({localVersion:1})}),
 hasMeaningfulSyncData:p=>Boolean(p.hosts?.length||p.keys?.length),
 STORAGE_KEY_LOCAL_VAULT_BACKUP_LAST_APP_VERSION:'version',STORAGE_KEY_LOCAL_VAULT_BACKUP_MAX_COUNT:'count',STORAGE_KEY_VAULT_APPLY_IN_PROGRESS:'applying',STORAGE_KEY_VAULT_RESTORE_IN_PROGRESS_UNTIL:'barrier'});
vm.runInContext(stripTypeScriptTypes(backupSource)+'\nthis.api={applyProtectedSyncPayload,readInterruptedVaultApply};',backupContext);
const {applyProtectedSyncPayload,readInterruptedVaultApply}=backupContext.api;
const original={hosts:[{id:'local',password:'secret'}],keys:[{id:'key',privateKey:'fixture'}],snippets:[],customGroups:[],syncedAt:1};
let current=structuredClone(original), applies=0;
const apply=()=>applyProtectedSyncPayload({buildPreApplyPayload:()=>current,translateProtectiveBackupFailure:m=>m,applyPayload:()=>{applies++;current={...original,hosts:[{id:'remote'}]};}});
fail=true;await assert.rejects(apply(),/Injected/);assert.deepEqual(current,original);assert.equal(applies,0);assert.equal(readInterruptedVaultApply(),null);
fail=false;await apply();assert.equal(applies,1);assert.deepEqual(JSON.parse(JSON.stringify((await win.netcatty.readVaultBackup({id:'fixture'})).payload)),original);assert.equal(readInterruptedVaultApply(),null);
const before=creates;current={...original,hosts:[],keys:[]};await apply();assert.equal(creates,before);assert.equal(applies,2);
console.log('PASS actual protected apply + actual mobile bridge: failure abort unchanged; populated vault backs up then applies once; backup readable; empty vault needs no backup. Native storage mocked here, tested independently on JVM.');
