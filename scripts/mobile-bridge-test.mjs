#!/usr/bin/env node
// Dependency-free runtime tests against the real TypeScript bridge (Node >= 22.13).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto, createHash, createHmac } from 'node:crypto';
const require = createRequire(import.meta.url);
const desktop = require('../domain/totp.shared.cjs');
const source = readFileSync(new URL('../infrastructure/mobile/androidBridgePolyfill.ts', import.meta.url), 'utf8');
const timers = new Map(); let timerId = 0;
const storage = new Map(); const calls = [];
const win = { innerWidth: 400, setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id), dispatchEvent() {}, open() {} };
function event(type, payload) { win.__onNativeEvent(type, Buffer.from(JSON.stringify(payload)).toString('base64')); }
const response = (id, data = {}) => event('async_response', { reqId: id, ok: true, ...data });
const native = new Proxy({
 credentialsAvailable: () => true, credentialsDecrypt: s => { assert.equal(s, 'enc:v1:secret'); return 'decrypted-key'; },
 getHomeDirSync: () => '/sandbox',
 httpFetchAsync: (id, ...args) => { calls.push(['http', ...args]); response(id, { status: 200, data: '{}' }); },
 sshExecOnSession: (id, ...args) => { calls.push(['exec', ...args]); response(id, { success: true, exitCode: 0, stdout: '', stderr: '' }); },
 sftpStreamDownloadToLocal: (id, ...args) => calls.push(['download', id, ...args]),
 sftpStreamUploadFromLocal: (id, ...args) => calls.push(['upload', id, ...args]),
 cancelSftpTransfer: id => calls.push(['cancel', id]),
}, { get(target, key) { if (key in target) return target[key]; if (/^sftp(WriteFile|Mkdir|Delete|Rename|Chmod)$/.test(key)) return (id, ...args) => { calls.push([key, ...args]); response(id); }; return () => {}; } });
win.NativeBridge = native;
let now = 59000;
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const context = vm.createContext({ window: win, navigator: { userAgent: 'Android' }, document: { documentElement: { setAttribute() {} }, querySelector() { return null; } }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, URLSearchParams, Date: Clock, atob, btoa, console, queueMicrotask });
const js = stripTypeScriptTypes(source.replace(/export function /g, 'function '));
vm.runInContext(js + '\nglobalThis.testApi = { installAndroidBridgePolyfill, previewTotpWebCrypto, buildAwsSigV4SignedRequest, shellQuote };', context);
const { testApi } = context;
testApi.installAndroidBridgePolyfill(); const bridge = win.netcatty;
let tests = 0;
async function test(name, fn) { await fn(); tests++; console.log('ok - ' + name); }
await test('TOTP parser matches shared domain cases and bounds', async () => {
 const cases = ['', 'A'.repeat(15), 'A'.repeat(16), 'A'.repeat(205), 'A'.repeat(207), 'JBSW-Y3DPEHPK3PXP', 'JBSW Y3DPEHPK3PXP', 'otpauth://hotp/x', 'otpauth:///totp/x', 'otpauth://totp/x', 'otpauth-migration://x', 'otpauth://totp/ACME%3Aalice?secret=JBSWY3DPEHPK3PXP&digits=%20&period=%20', 'otpauth://totp/totp/alice?secret=JBSWY3DPEHPK3PXP', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5'];
 for (const text of cases) assert.equal(JSON.stringify(await bridge.previewTotp({ text })), JSON.stringify(desktop.previewTotpText(text, now)), text);
 for (const label of ['%ZZ', '%E0%A4%A', '%FF']) assert.equal((await bridge.previewTotp({ text: `otpauth://totp/${label}?secret=JBSWY3DPEHPK3PXP` })).error, 'invalid-uri');
});
await test('all RFC 6238 SHA1/SHA256/SHA512 vectors', async () => {
 const vectors = [[59,['94287082','46119246','90693936']], [1111111109,['07081804','68084774','25091201']], [1111111111,['14050471','67062674','99943326']], [1234567890,['89005924','91819424','93441116']], [2000000000,['69279037','90698825','38618901']], [20000000000,['65353130','77737706','47863826']]];
 const secrets = ['12345678901234567890','12345678901234567890123456789012','1234567890123456789012345678901234567890123456789012345678901234'];
 for (const [time, codes] of vectors) { now = time * 1000; for (const [i, algorithm] of ['SHA1','SHA256','SHA512'].entries()) { const text = `otpauth://totp/test?secret=${desktop.encodeBase32(Buffer.from(secrets[i]))}&digits=8&algorithm=${algorithm}`; assert.equal((await bridge.previewTotp({text})).code, codes[i]); } }
});
await test('SigV4 exact key encoding and independent signature', async () => {
 now = Date.UTC(2013,4,24); const config = { endpoint:'https://s3.amazonaws.com', bucket:'examplebucket', region:'us-east-1', accessKeyId:'AKID', secretAccessKey:'secret' };
 for (const key of ['a//b/', '/leading', 'a b/雪/%2F', "a!()'*b"]) {
  const signed = await testApi.buildAwsSigV4SignedRequest(config, 'GET', key);
  const path = '/examplebucket/' + key.split('/').map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
  assert.equal(signed.url, 'https://s3.amazonaws.com' + path);
  const hash = s => createHash('sha256').update(s).digest('hex'); const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
  const date = signed.headers['x-amz-date']; const scope = date.slice(0,8) + '/us-east-1/s3/aws4_request';
  const names = 'host;x-amz-content-sha256;x-amz-date'; const headers = `host:s3.amazonaws.com\nx-amz-content-sha256:${hash('')}\nx-amz-date:${date}\n`;
  const canonical = ['GET',path,'',headers,names,hash('')].join('\n');
  const signing = hmac(hmac(hmac(hmac('AWS4secret',date.slice(0,8)),'us-east-1'),'s3'),'aws4_request');
  const signature = hmac(signing, ['AWS4-HMAC-SHA256',date,scope,hash(canonical)].join('\n')).toString('hex');
  assert.equal(signed.headers.Authorization, `AWS4-HMAC-SHA256 Credential=AKID/${scope}, SignedHeaders=${names}, Signature=${signature}`);
 }
 await assert.rejects(testApi.buildAwsSigV4SignedRequest(config,'GET','a/../b'), /dot-segment/);
});
await test('cloud writes blocked; SFTP mutations invoke native', async () => {
 for (const name of ['cloudSyncS3Upload','cloudSyncS3Delete','cloudSyncWebdavUpload','cloudSyncWebdavDelete']) await assert.rejects(bridge[name]({}), /禁止/);
 await bridge.writeSftp('s','/file','hello'); await bridge.writeSftpBinary('s','/file',new Uint8Array([1,2]).buffer); await bridge.mkdirSftp('s','/dir'); await bridge.deleteSftp('s','/file'); await bridge.renameSftp('s','/a','/b'); await bridge.chmodSftp('s','/b','0644');
 assert.equal(calls.filter(c => /^sftp/.test(c[0])).length,6);
 await assert.rejects(bridge.chmodSftp('s','/b','777;rm'), /octal/);
});
await test('app lock, backups, OAuth and privacy never claim fake success', async () => {
 for (const name of ['requestAppLockEnable','requestAppLockDisable','requestAppLockUnlock','setAppLockRuntimeLocked','createVaultBackup','clearVaultBackups','prepareOAuthCallback','awaitOAuthCallback','googleExchangeCodeForTokens','onedriveRefreshAccessToken','aiPrivacyTransform']) await assert.rejects(bridge[name]({}), /Unsupported/);
 assert.equal((await bridge.getVaultBackupCapabilities()).encryptionAvailable,false);
 assert.equal((await bridge.getAppLockSettings()).enabled,false);
});
await test('UTF8 split chunks, backlog replay and listener unsubscribe', async () => {
 const bytes = Buffer.from('雪'); win.__onTerminalBytesB64('s',bytes.subarray(0,1).toString('base64')); win.__onTerminalBytesB64('s',bytes.subarray(1).toString('base64'));
 const values=[]; const off=bridge.onSessionData('s',v=>values.push(v),{replayBacklog:true}); await Promise.resolve(); assert.deepEqual(values,['雪']); off(); win.__onTerminalBytesB64('s',Buffer.from('x').toString('base64')); assert.deepEqual(values,['雪']);
});
await test('download and upload completion, timeout cancellation, cross-server rejection', async () => {
 for (const [direction,sourceType,targetType] of [['download','sftp','local'],['upload','local','sftp']]) {
  const p=bridge.startStreamTransfer({transferId:direction,sourceType,targetType,sourceSftpId:'s',targetSftpId:'s',sourcePath:'/a',targetPath:'/b'});
  const call=calls.at(-1); assert.equal(call[0],direction); response(call[1],{totalBytes:3}); assert.equal((await p).totalBytes,3);
 }
 const p=bridge.startStreamTransfer({transferId:'timeout',sourceType:'sftp',targetType:'local',sourceSftpId:'s',sourcePath:'/a',targetPath:'/b'});
 const timeout=[...timers.values()].find(t=>t.ms===600000); assert.ok(timeout); timeout.fn(); assert.match((await p).error,/timed out/); assert.deepEqual(calls.at(-1),['cancel','timeout']);
 assert.match((await bridge.startStreamTransfer({transferId:'cross',sourceType:'sftp',targetType:'sftp'})).error,/Cross-server/);
});
await test('AI decrypt cache uses native decryption before placeholder substitution', async () => {
 await bridge.aiSyncProviders([{id:'p',providerId:'openai',enabled:true,apiKey:'enc:v1:secret'}]); await bridge.aiFetch('https://example.test','GET',{Authorization:'Bearer __IPC_SECURED__'},'', 'p');
 assert.equal(JSON.parse(calls.at(-1)[3]).Authorization,'Bearer decrypted-key');
});
await test('server action injection rejected; autocomplete path quoted', async () => {
 const before=calls.length; assert.equal((await bridge.signalSystemProcess({sessionId:'s',pid:2,signal:'TERM;bad'})).success,false); assert.equal((await bridge.dockerAction({sessionId:'s',containerId:'foo;bad',action:'stop'})).success,false); assert.equal((await bridge.systemServiceAction({sessionId:'s',unitName:'x.service;bad',action:'restart'})).success,false); assert.equal(calls.length,before);
 await bridge.listAutocompleteRemoteDir('s',"a' ; echo PWN"); assert.ok(calls.at(-1)[3].includes("'a'\\'' ; echo PWN'"));
});
await test('session lease defers close until final transfer releases', async () => {
 assert.equal((await bridge.retainSftpTransferSession('leased','t1')).success,true);
 assert.equal((await bridge.closeSftp('leased')).deferred,true);
 assert.equal((await bridge.retainSftpTransferSession('leased','t2')).success,false);
 assert.equal((await bridge.releaseSftpTransferSession('leased','t1')).success,true);
});
await test('native failure rejects SFTP mutation rather than resolving success', async () => {
 const original=native.sftpMkdir; native.sftpMkdir=(id)=>event('async_response',{reqId:id,ok:false,success:false,error:'permission denied'});
 await assert.rejects(bridge.mkdirSftp('s','/denied'), /permission denied/); native.sftpMkdir=original;
});
await test('paced paste cancellation prevents queued commands without sending Ctrl-C', async () => {
 const original=native.writeTerminalBytesB64;
 native.writeTerminalBytesB64=(sid,data)=>calls.push(['write',sid,Buffer.from(data,'base64').toString()]);
 const before=calls.length;
 bridge.writeToSession('paste-cancel','first\nsecond\nthird',{lineDelayMs:100,pasteRequestId:'p'});
 bridge.interruptSession('paste-cancel',undefined,{cancelPendingWritesOnly:true});
 const queued=[...timers.entries()].filter(([,t])=>t.ms===0||t.ms===100||t.ms===200);
 for(const [id,t] of queued) { timers.delete(id); t.fn(); }
 assert.deepEqual(calls.slice(before),[]);
 native.writeTerminalBytesB64=original;
});
await test('closing terminal discards paced paste rather than writing to replacement session', async () => {
 const original=native.writeTerminalBytesB64;
 native.writeTerminalBytesB64=(sid,data)=>calls.push(['write',sid,data]);
 bridge.writeToSession('paste-close','old\ncommand',{lineDelayMs:100});
 bridge.closeSession('paste-close');
 const before=calls.length;
 for(const [id,t] of [...timers]) if(t.ms===0||t.ms===100) { timers.delete(id); t.fn(); }
 assert.deepEqual(calls.slice(before),[]);
 native.writeTerminalBytesB64=original;
});
await test('paced paste completes normally and interrupt/exit/error cancel only the target session', async () => {
 const original=native.writeTerminalBytesB64;
 native.writeTerminalBytesB64=(sid,data)=>calls.push(['write',sid,Buffer.from(data,'base64').toString()]);
 const acknowledgements=[]; const off=bridge.onTerminalPasteWrite(p=>acknowledgements.push(p));
 const before=calls.length;
 bridge.writeToSession('normal-paste','one\ntwo',{lineDelayMs:50,pasteRequestId:'normal'});
 for(const [id,t] of [...timers]) if(t.ms===0||t.ms===50) { timers.delete(id); t.fn(); }
 assert.deepEqual(calls.slice(before),[['write','normal-paste','one\r'],['write','normal-paste','two']]);
 assert.deepEqual(acknowledgements.map(p=>p.done),[false,true]);
 off();
 for(const mode of ['interrupt','terminal_exit','terminal_error']) {
  const sid='paste-'+mode;
  bridge.writeToSession(sid,'stop\nlater',{lineDelayMs:50});
  const queued=[...timers.entries()].filter(([,t])=>t.ms===0||t.ms===50);
  if(mode==='interrupt') bridge.interruptSession(sid); else event(mode,{sessionId:sid,error:'disconnected'});
  const count=calls.length;
  for(const [id,t] of queued) { timers.delete(id); t.fn(); }
  assert.equal(calls.length,count);
  if(mode==='interrupt') assert.deepEqual(calls.at(-1),['write',sid,'\x03']);
 }
 native.writeTerminalBytesB64=original;
});
await test('backlog stays before live output and unsubscribe suppresses deferred replay', async () => {
 win.__onTerminalBytesB64('ordered',Buffer.from('old').toString('base64'));
 const values=[]; const off=bridge.onSessionData('ordered',v=>values.push(v),{replayBacklog:true});
 win.__onTerminalBytesB64('ordered',Buffer.from('new').toString('base64'));
 await Promise.resolve(); assert.equal(values.join(''),'oldnew'); off();
 win.__onTerminalBytesB64('unsub-replay',Buffer.from('stale').toString('base64'));
 const stale=[]; const unsubscribe=bridge.onSessionData('unsub-replay',v=>stale.push(v),{replayBacklog:true});
 unsubscribe(); const count=stale.length; await Promise.resolve(); assert.equal(stale.length,count);
});
console.log(`PASS ${tests} mobile bridge runtime suites`);
