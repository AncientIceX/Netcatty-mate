#!/usr/bin/env node
// Production-dist phone terminal input regression (synthetic local shell only;
// no real SSH/server). Reproduces the v3.1.9 blank, unusable terminal where the
// in-flow keybar squeezed xterm to zero width, then verifies the fixed layout,
// tap-to-type, keybar keys and sticky Ctrl applied to soft-keyboard text.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseline=process.argv.includes('--baseline');
const root=resolve('dist');
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await mkdir('terminal-input-results',{recursive:true});
const browser=await chromium.launch();const reports=[];
try{
 for(const [width,height,theme] of (baseline?[[390,844,'light']]:[[320,740,'dark'],[375,812,'light'],[390,844,'light'],[844,390,'dark']])){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.addInitScript(({theme})=>{
   window.__errors=[];window.__writes=[];window.__ime=0;
   window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
   localStorage.setItem('netcatty_theme_v1',theme);
   localStorage.setItem('netcatty_ui_language_v1','en');
   const emit=(type,payload)=>window.__onNativeEvent(type,btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
   const dec=b=>decodeURIComponent(escape(atob(b)));
   window.NativeBridge={
    startLocalShell:(reqId,sessionId)=>{window.__sid=sessionId;emit('ssh_connected',{reqId,sessionId});setTimeout(()=>window.__onTerminalBytesB64(sessionId,btoa('fixture$ ')),50);},
    writeTerminalBytesB64:(id,b64)=>window.__writes.push(dec(b64)),
    showSoftKeyboard:()=>{window.__ime++;},vibrateShort:()=>{},
    resizeSshPty:()=>{},closeSession:()=>{},setTerminalOutputPaused:(reqId)=>emit('async_response',{reqId,ok:true}),acknowledgeTerminalOutput:()=>{},
    getSessionRemoteInfoSync:()=>'{}',getHomeDirSync:()=>'/sandbox',getDeviceSysInfo:()=>'{}',credentialsAvailable:()=>true,credentialsEncrypt:s=>'fixture:'+s,credentialsDecrypt:s=>s.slice(8),setStatusBarColorHex:()=>{},listPortForwardsSync:()=>'[]'};
  },{theme});
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
   await page.locator('.netcatty-shell').waitFor();
   await page.getByRole('button',{name:/^Terminal$/}).focus();await page.keyboard.press('Enter');
   const xterm=page.locator('.xterm').first();await xterm.waitFor({state:'attached'});
   const keybar=page.getByRole('button',{name:/^ESC$/}).first();
   await keybar.waitFor({state:'visible',timeout:15000});
   await page.waitForTimeout(600);
   const geo=await page.evaluate(()=>{const x=document.querySelector('.xterm-container')?.getBoundingClientRect();const k=[...document.querySelectorAll('button')].find(b=>b.textContent==='ESC')?.parentElement?.getBoundingClientRect();return {xw:x?.width??0,xh:x?.height??0,kTop:k?.top,kBottom:k?.bottom,kh:k?.height,vh:innerHeight};});
   await page.screenshot({path:`terminal-input-results/${baseline?'baseline':`${width}x${height}`}.png`});
   if(baseline){
    // v3.1.9: terminal squeezed to (near) zero width and keybar stretched mid-screen.
    assert.ok(geo.xw<40,`old layout should squeeze xterm, got ${geo.xw}`);
    reports.push({baseline:true,width,geo});continue;
   }
   assert.ok(geo.xw>width*0.8,`xterm width ${geo.xw}`);
   assert.ok(geo.xh>height*0.3,`xterm height ${geo.xh}`);
   assert.ok(geo.kh<60,`keybar height ${geo.kh}`);
   assert.ok(Math.abs(geo.kBottom-geo.vh)<=2,`keybar must dock at bottom: ${geo.kBottom} vs ${geo.vh}`);
   // Tap the terminal: focuses xterm textarea and asks native for the IME.
   const box=await xterm.boundingBox();
   await page.touchscreen.tap(box.x+box.width/2,box.y+Math.min(80,box.height/2));
   await page.waitForTimeout(150);
   assert.ok(await page.evaluate(()=>document.activeElement?.classList.contains('xterm-helper-textarea')),'tap must focus terminal input');
   assert.ok(await page.evaluate(()=>window.__ime)>0,'tap must request soft keyboard');
   // Soft-keyboard typing reaches the session.
   await page.keyboard.type('ls');await page.keyboard.press('Enter');
   // Keybar: ESC, arrows and sticky CTRL applied to the next typed char.
   await page.locator('[data-mobile-key="ESC"]').click();
   await page.locator('[data-mobile-key="↑"]').click();
   await page.locator('[data-mobile-key="CTRL"]').click();
   assert.equal(await page.locator('[data-mobile-key="CTRL"]').getAttribute('aria-pressed'),'true');
   assert.ok(await page.evaluate(()=>document.activeElement?.classList.contains('xterm-helper-textarea')),'keybar taps must keep IME focus');
   await page.keyboard.type('c');
   assert.equal(await page.locator('[data-mobile-key="CTRL"]').getAttribute('aria-pressed'),'false');
   await page.keyboard.type('x');
   await page.waitForTimeout(150);
   const writes=await page.evaluate(()=>window.__writes);
   const joined=writes.join('');
   assert.ok(joined.startsWith('ls\r'),`typed input ${JSON.stringify(writes)}`);
   assert.ok(joined.includes('\x1b'),'ESC sent');
   assert.ok(/\x1b(\[|O)A/.test(joined),'arrow sent');
   assert.ok(joined.endsWith('\x03x'),`sticky ctrl ${JSON.stringify(joined)}`);
   const state=await page.evaluate(()=>window.__errors);
   assert.deepEqual(errors,[]);assert.deepEqual(state,[]);
   reports.push({width,height,theme,geo,writes});
  }catch(e){await page.screenshot({path:`terminal-input-results/failure-${width}.png`});await writeFile(`terminal-input-results/failure-${width}.txt`,String(e.stack));throw e;}
  finally{await page.close();}
 }
 console.log(JSON.stringify(reports,null,2));
}finally{await writeFile(`terminal-input-results/${baseline?'baseline':'fixed'}.json`,JSON.stringify(reports,null,2));await browser.close();await new Promise(r=>server.close(r));}
