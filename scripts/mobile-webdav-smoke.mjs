#!/usr/bin/env node
// CI-only production UI; all credentials and HTTP responses are isolated fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseline = process.argv.includes('--baseline');
const root=resolve('dist');
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':decodeURIComponent(new URL(req.url,'http://localhost').pathname)));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
await mkdir('webdav-smoke-results',{recursive:true});
try{
 for(const existing of [false,true]){
  const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({existing})=>{
   window.__errors=[];window.__requests=[];window.__mode='fail';
   window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
   // Fake at-rest encryption ONLY in this isolated test, never real credentials.
   window.NativeBridge={getHomeDirSync:()=>'/sandbox',getDeviceSysInfo:()=>'{}',credentialsAvailable:()=>true,credentialsEncrypt:s=>'fixture:'+s,credentialsDecrypt:s=>s.slice(8),setStatusBarColorHex:()=>{},listPortForwardsSync:()=>'[]',
    httpFetchAsync:(reqId,url,method)=>{window.__requests.push({url,method});setTimeout(()=>window.__onNativeEvent('async_response',btoa(JSON.stringify({reqId,ok:false,status:401,error:window.__mode==='timeout'?'HTTP request timed out':'fixture authentication failure'}))),window.__mode==='timeout'?1200:30);},
   };
   if(existing)localStorage.setItem('netcatty_provider_webdav_v1',JSON.stringify({provider:'webdav',status:'disconnected',config:{endpoint:'https://fixture.invalid/dav',authType:'basic',username:'fixture-user',password:'fixture-password'}}));
  },{existing});
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
   await page.locator('.netcatty-shell').waitFor();
   await page.evaluate(()=>window.netcatty.openSettingsWindow());
   await page.locator('.settings-window').waitFor();
   console.log('settings tabs',await page.getByRole('tab').allTextContents());
   await page.getByRole('tab',{name:/云同步|Cloud Sync|Sync & Cloud/i}).click();
   const form=page.locator('.settings-window form');
   await form.locator('input[type=password]').nth(0).fill('Fixture-only-123!');
   await form.locator('input[type=password]').nth(1).fill('Fixture-only-123!');
   await form.locator('input[type=checkbox]').check();
   await form.locator('button[type=submit]').click();
   const card=page.locator('[data-settings-anchor="sync-providers"]');
   console.log('provider buttons',await page.locator('.settings-window button').allTextContents());
   const webdav=page.locator('div.rounded-lg').filter({has:page.getByText('WebDAV',{exact:true})}).filter({has:page.getByRole('button',{name:/连接|Connect/i})}).last();
   await webdav.getByRole('button',{name:/连接|Connect/i}).click();
   const dialog=page.getByRole('dialog').filter({has:page.locator('input[placeholder="https://dav.example.com/remote.php/webdav/"]')});
   await dialog.waitFor();
   await page.waitForTimeout(300);
   const hit=await dialog.evaluate(el=>{const settings=document.querySelector('.settings-window').parentElement;const before=settings.style.pointerEvents;settings.style.pointerEvents='auto';const r=el.getBoundingClientRect();const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);settings.style.pointerEvents=before;return {front:el.contains(target),target:target?.outerHTML.slice(0,300),z:getComputedStyle(el).zIndex};});
   const report={baseline,existing,hit,errors,unhandled:await page.evaluate(()=>window.__errors),requests:await page.evaluate(()=>window.__requests)};
   await writeFile(`webdav-smoke-results/${baseline?'baseline':'fixed'}-${existing}.json`,JSON.stringify(report,null,2));
   await page.screenshot({path:`webdav-smoke-results/${baseline?'baseline':'fixed'}-${existing}.png`});
   console.log(JSON.stringify(report));
   if(baseline){assert.equal(hit.front,false,'old dialog must reproduce hidden behind settings');assert.equal(report.requests.length,0);continue;}
   assert.equal(hit.front,true,'dialog must be above settings');
   const inputs=dialog.locator('input');
   await inputs.nth(0).fill('https://fixture.invalid/dav');
   await dialog.locator('input[autocomplete=username]').fill('fixture-user');
   await dialog.locator('input[autocomplete=current-password]').fill('fixture-password');
   for(const mode of ['fail','timeout']){
    await page.evaluate(mode=>{window.__mode=mode;},mode);
    const save=dialog.getByRole('button',{name:/^保存$|^Save$/i});await save.click();
    await page.evaluate(()=>new Promise(r=>setTimeout(r,50)));
    await save.waitFor({state:'visible'});
    await page.waitForFunction(()=>[...document.querySelectorAll('[role=dialog] button')].some(b=>/^(保存|Save)$/.test(b.textContent)&&!b.disabled));
   }
   await dialog.getByRole('button',{name:/取消|Cancel/i}).click();
   await dialog.waitFor({state:'hidden'});
   await page.evaluate(()=>window.netcatty.openSettingsWindow());
   assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
   assert.ok((await page.evaluate(()=>window.__requests)).every(r=>r.method==='PROPFIND'));
  }catch(e){console.log('UI failure',await page.locator('body').innerText());await page.screenshot({path:`webdav-smoke-results/failure-${existing}.png`});throw e;}finally{await page.close();}
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
