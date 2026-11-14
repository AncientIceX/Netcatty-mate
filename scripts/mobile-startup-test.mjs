#!/usr/bin/env node
// Executes the shipped bridge, not a reimplementation. Also supports pre-fix source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source = readFileSync(process.env.MOBILE_BRIDGE_SOURCE || new URL('../infrastructure/mobile/androidBridgePolyfill.ts', import.meta.url), 'utf8');
const storage = new Map();
const win = { innerWidth: 412, setTimeout, clearTimeout, NativeBridge: {
  getHomeDirSync: () => '/sandbox', getDeviceSysInfo: () => JSON.stringify({model:'Android smoke'}),
  credentialsAvailable: () => true, listPortForwardsSync: () => '[]',
} };
const context = vm.createContext({ window:win, document:{documentElement:{setAttribute(){}}}, navigator:{userAgent:'Android'}, localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}, TextEncoder, TextDecoder, crypto:webcrypto, URL, URLSearchParams, atob, btoa, console, queueMicrotask });
vm.runInContext(stripTypeScriptTypes(source.replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();', context);
const bridge = win.netcatty;
const unhandled = [];
const onUnhandled = e => unhandled.push(String(e));
process.on('unhandledRejection', onUnhandled);
const defects = [];
// These are the actual fire-and-forget startup calls in useAIState,
// useAIPermissionGrantsState and ExternalMcpApprovalsHost. Unsupported optional
// desktop-only capabilities must be absent, not advertised as rejecting methods.
for (const name of ['aiMcpSetCommandBlocklist','aiMcpSetCommandTimeout','aiMcpSetMaxIterations','aiMcpSetPermissionMode','aiMcpSetToolIntegrationMode','aiMcpSyncPermissionGrants','setExternalMcpApprovalAlertMode']) {
  if (bridge[name] !== undefined) { defects.push(name+' advertises unsupported capability'); bridge[name]({}); }
}
// Audit every onX contract, including lazy terminal/plugin/settings subscriptions.
// Session/request-scoped subscriptions use (id, callback); globals use (callback).
let subscriptions = 0;
for (const [name, method] of Object.entries(bridge)) {
  if (!/^on[A-Z]/.test(name)) continue;
  const off = method.length >= 2 ? method('smoke-session',()=>{}) : method(()=>{});
  if (typeof off !== 'function') defects.push(name+' must synchronously return unsubscribe');
  else { off(); off(); }
  subscriptions++;
}
const lock = await bridge.getAppLockRuntimeState();
assert.equal(lock.initialized,true); assert.equal(lock.locked,false);
assert.equal((await bridge.getAppLockSettings()).enabled,false);
assert.equal((await bridge.getAppLockSystemUnlockStatus()).supported,false);
const themes = await bridge.getPluginThemes();
assert.equal(themes.selection.revision,0); assert.ok(Array.isArray(themes.entries));
assert.equal((await bridge.getPluginRuntimeStatus()).available,false);
assert.ok(Array.isArray((await bridge.getPluginContributions()).plugins));
assert.equal((await bridge.getVaultBackupCapabilities()).encryptionAvailable,false);
assert.deepEqual(Array.from((await bridge.getPortForwardSnapshot()).tunnels),[]);
assert.equal(await bridge.credentialsAvailable(),true);
assert.equal(await bridge.getHomeDir(),'/sandbox');
assert.equal((await bridge.getSystemInfo()).hostname,'Android smoke');
assert.equal((await bridge.getUpdateStatus()).status,'idle');
assert.ok(Array.isArray(await bridge.scriptGetRuns()));
for (const name of ['requestAppLockEnable','createVaultBackup','prepareOAuthCallback','aiPrivacyTransform','aiMcpUpdateSessions']) await assert.rejects(bridge[name]({}), /Unsupported on Android/);
await new Promise(resolve=>setImmediate(resolve));
process.off('unhandledRejection',onUnhandled);
assert.deepEqual({defects,unhandled},{defects:[],unhandled:[]});
console.log(`PASS startup: ${subscriptions} synchronous subscription/cleanup contracts; startup getters; unsupported security operations reject; zero unhandled rejections`);
