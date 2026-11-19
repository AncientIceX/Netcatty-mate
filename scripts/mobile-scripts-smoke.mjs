#!/usr/bin/env node
// Actions-only production UI with inert synthetic script data. Never executes SSH/scripts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseline=process.argv.includes('--baseline');
const root=resolve('dist');
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await mkdir('scripts-smoke-results',{recursive:true});
const browser=await chromium.launch();const reports=[];
try {
 for(const [width,height,theme] of (baseline?[[390,844,'dark']]:[[320,740,'dark'],[375,812,'light'],[390,844,'dark'],[844,390,'light'],[768,1024,'dark'],[1280,800,'light']])){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
  await page.addInitScript(({theme})=>{
   window.__errors=[];window.__writes=[];window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
   localStorage.setItem('netcatty_theme_v1',theme);
   localStorage.setItem('netcatty_ui_language_v1','en');
   localStorage.setItem('netcatty_side_panel_width','420');
   localStorage.setItem('netcatty_snippets_v1',JSON.stringify(Array.from({length:80},(_,i)=>({id:'fixture-'+i,label:'手机响应式测试脚本—很长的中文名称 '+i,command:'// synthetic, never run',kind:'script',language:'javascript',order:i}))));
   const emit=(type,payload)=>window.__onNativeEvent(type,btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
   window.NativeBridge={startLocalShell:(reqId,sessionId)=>emit('ssh_connected',{reqId,sessionId}),writeTerminalBytesB64:(...args)=>window.__writes.push(args),resizeSshPty:()=>{},closeSession:()=>{},getSessionRemoteInfoSync:()=>'{}',getHomeDirSync:()=>'/sandbox',getDeviceSysInfo:()=>'{}',credentialsAvailable:()=>true,credentialsEncrypt:s=>'fixture:'+s,credentialsDecrypt:s=>s.slice(8),setStatusBarColorHex:()=>{},listPortForwardsSync:()=>'[]'};
  },{theme});
  try {
   await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
   await page.locator('.netcatty-shell').waitFor();
   await page.getByRole('button',{name:/^Terminal$/}).focus();await page.keyboard.press('Enter');
   const open=page.locator('[data-section="terminal-toolbar"] button[aria-label="Scripts"]');
   await open.waitFor({state:'visible',timeout:15000});
   const terminal=page.locator('.xterm').first();await terminal.waitFor();
   const before=(await terminal.boundingBox()).width;
   await open.click();
   const panel=page.locator('[data-section="terminal-side-panel"]');await panel.waitFor();
   await page.locator('[data-section="snippets-panel"]').getByText('Library',{exact:true}).waitFor();
   const after=(await terminal.boundingBox()).width;
   if(baseline){assert.ok(before-after>100,'old sidebar must reproduce terminal squeeze');reports.push({width,before,after,baseline});await page.screenshot({path:'scripts-smoke-results/baseline.png'});continue;}
   const compact=width<768;
   if(compact){assert.ok(Math.abs(before-after)<2,`terminal squeezed ${before} -> ${after}`);assert.equal(await panel.evaluate(e=>e.closest('[data-mobile-drawer]').getAttribute('aria-modal')),'true');}
   else assert.ok(before-after>100,'wide screen retains split');
   await panel.getByRole('button',{name:'Running',exact:true}).click();await panel.getByRole('button',{name:'Library',exact:true}).click();
   assert.ok(await panel.getByTitle('手机响应式测试脚本—很长的中文名称 0',{exact:true}).count());
   if(compact){
    const box=await panel.boundingBox();assert.ok(box.width<=361 && box.width<width);
    const footer=panel.locator('[data-section="scripts-library-footer"] button');
    for(const button of await footer.all()){assert.ok((await button.boundingBox()).height>=44);}
    assert.ok(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    await page.keyboard.press('Tab');assert.ok(await panel.evaluate(e=>e.contains(document.activeElement)));
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
    await open.click();assert.equal(await page.evaluate(()=>window.__netcattyHandleBackPress()),true);await panel.waitFor({state:'hidden'});
    await open.click();const backdrop=page.locator('[data-mobile-panel-backdrop]');await backdrop.click({position:{x:width-5,y:100}});await panel.waitFor({state:'hidden'});
    await open.click();await page.screenshot({path:`scripts-smoke-results/${width}-${theme}.png`});
    await page.setViewportSize({width:1024,height:768});await page.waitForTimeout(300);assert.equal(await page.locator('[data-mobile-drawer="true"]').count(),0);
    await page.setViewportSize({width,height});await page.waitForTimeout(300);assert.ok(Math.abs((await terminal.boundingBox()).width-before)<2);
    await panel.locator('[data-mobile-panel-close]').click();await panel.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('netcatty_side_panel_width')),'420');
    await open.click();await page.evaluate(()=>document.documentElement.style.fontSize='20px');
   }
   await page.screenshot({path:`scripts-smoke-results/${width}-${theme}-final.png`});
   await page.waitForTimeout(1200);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
   reports.push({width,height,theme,before,after,compact,errors});
  }catch(e){await page.screenshot({path:`scripts-smoke-results/failure-${width}.png`});await writeFile('scripts-smoke-results/failure.txt',String(e.stack)+'\n'+await page.locator('body').innerText());throw e;}finally{await page.close();}
 }
 console.log(JSON.stringify(reports,null,2));
}finally{await writeFile(`scripts-smoke-results/${baseline?'baseline':'fixed'}.json`,JSON.stringify(reports,null,2));await browser.close();await new Promise(r=>server.close(r));}
