#!/usr/bin/env node
// CI-only real dist boot. Native mock is explicit: unknown calls fail rather
// than succeeding via a Proxy. This is browser coverage, NOT an Android device test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseline = process.argv.includes('--baseline');
const root = resolve('dist');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm'};
const server = createServer(async (req,res)=>{
  try {
    const path = resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url,'http://localhost').pathname));
    if (!path.startsWith(root+'/')) throw new Error('invalid path');
    res.setHeader('Content-Type',mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode=404; res.end('Not found'); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36'});
  const errors=[];
  page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
  await page.addInitScript(()=>{
    window.__bootUnhandled=[];
    window.addEventListener('unhandledrejection',e=>window.__bootUnhandled.push({message:String(e.reason),stack:e.reason?.stack}));
    window.NativeBridge={
      getHomeDirSync:()=>'/data/user/0/de.newaii.netcatty/files',
      getDeviceSysInfo:()=>JSON.stringify({model:'CI Android bridge mock',sdk:34}),
      credentialsAvailable:()=>true,
      // Fresh storage needs no crypto operations; unexpected encryption fails.
      credentialsEncrypt:()=>{throw new Error('Unexpected startup encryption');},
      credentialsDecrypt:()=>{throw new Error('Unexpected startup decryption');},
      setStatusBarColorHex:()=>{}, listPortForwardsSync:()=>'[]',
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
  await page.locator('#root .netcatty-shell').waitFor({state:'visible',timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('#root button').length>5);
  await page.waitForTimeout(4000); // lazy TerminalLayer/effects must settle too
  const unhandled=await page.evaluate(()=>window.__bootUnhandled);
  const report={baseline,rendered:true,buttons:await page.locator('#root button').count(),errors,unhandled};
  await mkdir('boot-smoke-results',{recursive:true});
  await writeFile(`boot-smoke-results/${baseline?'baseline':'fixed'}.json`,JSON.stringify(report,null,2));
  await page.screenshot({path:`boot-smoke-results/${baseline?'baseline':'fixed'}.png`});
  console.log(JSON.stringify(report,null,2));
  if(baseline){
    assert.equal(unhandled.length,7,'v3.1.1 should reproduce seven startup rejections');
    assert.ok(unhandled.every(e=>e.message==='Error: Unsupported on Android'));
    // Print exact old bundle call sites even if generated hashes change.
    for(const file of await readdir('dist/assets')){
      if(!/^(index-|TerminalLayer-).*\.js$/.test(file))continue;
      const lines=(await readFile('dist/assets/'+file,'utf8')).split('\n');
      for(const [line,col] of file.startsWith('index-')?[[116,8943],[116,9367],[116,9374],[158,15458]]:[[4,322325],[4,322390],[4,322450],[4,322564],[4,322654]]) console.log('STACK CALLSITE',file,line,col,lines[line-1]?.slice(Math.max(0,col-90),col+100));
    }
  }else{
    assert.deepEqual(unhandled,[],'no unhandled promises in actual app boot');
    assert.deepEqual(errors,[],'no page errors in actual app boot');
    assert.equal(await page.locator('#splash').count(),0);
  }
} finally {await browser.close();await new Promise(r=>server.close(r));}
