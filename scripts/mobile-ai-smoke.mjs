#!/usr/bin/env node
// CI-only: actual production dist + explicit native mock; no external AI requests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseline=process.argv.includes('--baseline');
const root=resolve('dist');
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':decodeURIComponent(new URL(req.url,'http://localhost').pathname)));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
await mkdir('ai-smoke-results',{recursive:true});
const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
const steps=[];
await page.addInitScript(()=>{
 window.__errors=[];window.__requests=[];
 window.addEventListener('unhandledrejection',e=>window.__errors.push({message:String(e.reason),stack:e.reason?.stack}));
 window.NativeBridge={getHomeDirSync:()=>'/sandbox',getDeviceSysInfo:()=>'{}',credentialsAvailable:()=>true,credentialsEncrypt:s=>'fixture:'+s,credentialsDecrypt:s=>s.slice(8),setStatusBarColorHex:()=>{},listPortForwardsSync:()=>'[]',httpFetchAsync:(...args)=>{window.__requests.push(args);throw Error('Unexpected AI network request');}};
});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
 await page.locator('.netcatty-shell').waitFor();
 await page.evaluate(()=>window.netcatty.openSettingsWindow());
 await page.getByRole('tab',{name:/^AI$/}).click();
 await page.getByRole('button',{name:/添加提供商|Add Provider/i}).click();
 await page.waitForTimeout(2400);
 steps.push('providers idle with add menu open');
 if(baseline){
  const unhandled=await page.evaluate(()=>window.__errors);
  assert.ok(unhandled.some(e=>/Unsupported on Android/.test(e.message)&&/requestIdleCallback|SettingsAITab/.test(e.stack)),'must reproduce screenshot idle rejection');
 }else{
  await page.getByRole('button',{name:/^OpenAI$/}).click();
  console.log('provider inputs',await page.locator('.settings-window input').evaluateAll(es=>es.map(e=>({placeholder:e.placeholder,type:e.type,value:e.value}))));
  await page.locator('input[type=password]').fill('fixture-ai-key-not-real');
  await page.locator('input[placeholder="https://api.openai.com/v1"]').fill('https://fixture.invalid/v1');
  await page.getByRole('button',{name:/^保存$|^Save$/}).click();
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('https://fixture.invalid/v1'))));
  steps.push('OpenAI compatible provider saved locally');
  for(const name of [/^Agents?$|^Agent$/i,/工具接入|Tool Access|Tool Integration/i,/网络搜索|Web Search/i,/^安全$|^Safety$/i]){
   console.log('tabs',await page.getByRole('tab').allTextContents());
   const tab=page.getByRole('tab',{name});
   await tab.click();
   await page.waitForTimeout(2800);
   const panel=page.locator(`[id="${await tab.getAttribute('aria-controls')}"]`);
   if(name.source.includes('Agents')){
    await panel.locator('input').first().fill('/fixture/codex');
    const refresh=panel.getByRole('button',{name:/^Check$|^检查$/i}).first();
    await refresh.click();
    await page.waitForTimeout(500);
    assert.match(await panel.innerText(),/Not found|未找到/);
    assert.match(await page.getByRole('note').innerText(),/Android/);
   }else if(name.source.includes('Tool Access')){
    await panel.getByRole('button',{name:/Configure clients|配置客户端/i}).click();
    const dialog=page.getByRole('dialog');
    await dialog.locator('summary').filter({hasText:/Connection details|连接详情/i}).click();
    await dialog.getByRole('button',{name:/^Refresh$|^刷新$/}).click();
    await page.waitForTimeout(500);
    assert.match(await dialog.innerText(),/Unavailable|不可用/);
    await page.keyboard.press('Escape');
   }else if(name.source.includes('Web Search')){
    await panel.locator('input[type=password]').fill('fixture-search-key');
    await panel.locator('input[type=number]').fill('7');
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('maxResults')&&v.includes('7'))));
   }else{
    const timeout=panel.locator('[data-settings-anchor="ai-safety-response-idle-timeout"] input');
    await timeout.fill('123');
    await page.waitForTimeout(300);
    assert.equal(await timeout.inputValue(),'123');
   }
   steps.push(String(name));
   await page.screenshot({path:`ai-smoke-results/tab-${steps.length}.png`});
  }
  const status=await page.evaluate(async()=>({cli:await window.netcatty.aiResolveCli({command:'cursor'}),codex:await window.netcatty.aiCodexGetIntegration(),mcp:await window.netcatty.externalMcpGetStatus(),privacy:await window.netcatty.externalMcpSetConfig({redaction:{enabled:true}}),skills:await window.netcatty.aiUserSkillsOpenFolder(),models:await window.netcatty.aiSdkAgentListModels('cursor')}));
  assert.equal(status.cli.available,false);assert.equal(status.cli.sdkInstalled,false);assert.equal(status.codex.isConnected,false);for(const key of ['mcp','privacy','skills','models'])assert.equal(status[key].ok,false);
  steps.push('unsupported sensitive capabilities fail closed with structured results');
  await page.getByRole('tab',{name:/提供商|Providers/i}).click();
  assert.ok(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('https://fixture.invalid/v1'))));
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);assert.deepEqual(await page.evaluate(()=>window.__requests),[]);
 }
}finally{
 const report={baseline,steps,errors,unhandled:await page.evaluate(()=>window.__errors),requests:await page.evaluate(()=>window.__requests),text:await page.locator('body').innerText()};
 await writeFile(`ai-smoke-results/${baseline?'baseline':'fixed'}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 await page.screenshot({path:`ai-smoke-results/${baseline?'baseline':'fixed'}.png`});
 await browser.close();await new Promise(r=>server.close(r));
}
