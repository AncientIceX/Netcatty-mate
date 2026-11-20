#!/usr/bin/env node
// Production-dist exact server-list clicks; synthetic native SSH stream only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseline=process.argv.includes('--baseline');const root=resolve('dist');
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':decodeURIComponent(new URL(req.url,'http://localhost').pathname)));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));await mkdir('flow-smoke-results',{recursive:true});const browser=await chromium.launch();const reports=[];
try{for(const width of baseline?[390]:[375,390,320]){
 const page=await browser.newPage({viewport:{width,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 await page.addInitScript(()=>{
  window.__flowErrors=[];window.__flow={leases:0,pauses:0,rows:0,received:'',id:null,writes:[]};window.addEventListener('unhandledrejection',e=>window.__flowErrors.push(String(e.reason)));
  localStorage.setItem('netcatty_ui_language_v1','en');
  const emit=(type,payload)=>window.__onNativeEvent(type,btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  const states=new Map();let seq=0;
  const pump=id=>{const s=states.get(id);while(s&&!s.paused&&s.queue.length&&s.credit+s.queue[0].length<=65536){const chunk=s.queue.shift();s.credit+=chunk.length;window.__onTerminalBytesB64(id,btoa(String.fromCharCode(...chunk)));}};
  window.NativeBridge={startLocalShell:(reqId,id)=>{states.set(id,{paused:false,credit:0,queue:[]});window.__flow.id=id;emit('ssh_connected',{reqId,sessionId:id});},connectSshSession:(reqId,json)=>{const {sessionId:id}=JSON.parse(json);states.set(id,{paused:false,credit:0,queue:[]});window.__flow.id=id;emit('ssh_connected',{reqId,sessionId:id});},setTerminalOutputPaused:(reqId,id,paused)=>{window.__flow.pauses++;const s=states.get(id);if(s)s.paused=paused;emit('async_response',{reqId,ok:true});pump(id);},acknowledgeTerminalOutput:(id,n)=>{const s=states.get(id);if(s)s.credit-=n;queueMicrotask(()=>pump(id));},writeTerminalBytesB64:(...args)=>window.__flow.writes.push(args),resizeSshPty:()=>{},closeSession:id=>states.delete(id),getSessionRemoteInfoSync:()=>'{}',getHomeDirSync:()=>'/sandbox',getDeviceSysInfo:()=>'{}',credentialsAvailable:()=>true,credentialsEncrypt:s=>'fixture:'+s,credentialsDecrypt:s=>s.slice(8),setStatusBarColorHex:()=>{},listPortForwardsSync:()=>'[]'};
  window.__produce=()=>{const id=window.__flow.id;if(!id)return;const text=`ROW-${String(seq++).padStart(5,'0')}-雪🙂\r\n`;window.__flow.rows++;window.__flow.received+=text;const bytes=new TextEncoder().encode(text);const s=states.get(id);if(!s)return;for(let i=0;i<bytes.length;i+=5)s.queue.push(bytes.slice(i,i+5));pump(id);};
 });
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});await page.locator('.netcatty-shell').waitFor();
  await page.getByRole('button',{name:/^Terminal$/}).focus();await page.keyboard.press('Enter');await page.locator('.xterm').first().waitFor();
  await page.evaluate(()=>{const original=window.netcatty.acquireSessionFlowPauseLease;window.netcatty.acquireSessionFlowPauseLease=(...a)=>{window.__flow.leases++;return original(...a);};window.__streamTimer=setInterval(window.__produce,8);});
  const toggle=page.locator('[data-tab-type="host-tree-toggle"]');await toggle.waitFor({state:'visible'});
  await page.waitForTimeout(400);await toggle.click();await page.waitForTimeout(900);await page.screenshot({path:`flow-smoke-results/${baseline?'baseline':width}-servers-open.png`});
  // Clicking again uses the same real toolbar control, not store mutation.
  await toggle.click();await page.waitForTimeout(700);
  await page.evaluate(()=>clearInterval(window.__streamTimer));await page.waitForTimeout(700);
  const state=await page.evaluate(()=>({flow:window.__flow,errors:window.__flowErrors,output:Array.from(document.querySelectorAll('.xterm-screen .xterm-rows>div')).map(e=>e.textContent).join('\n')}));
  if(baseline){assert.ok([...errors,...state.errors].some(e=>e.includes('Unsupported on Android')),'old server-list click must reproduce Unsupported');reports.push({width,baseline,errors,unhandled:state.errors});continue;}
  assert.deepEqual(errors,[]);assert.deepEqual(state.errors,[]);assert.ok(state.flow.leases>0,'actual server-list resize must acquire lease');assert.ok(state.flow.pauses>0);assert.ok(state.flow.rows>100);assert.deepEqual(state.flow.writes,[]);
  // xterm DOM contains only viewport rows; inspect its actual buffer via a
  // read-only test hook installed in Terminal.tsx in CI, never execute scripts.
  const actual=await page.evaluate(()=>window.__terminalFlowReadBuffer?.());
  assert.equal(actual,state.flow.received.replace(/\r\n/g,'\n').trimEnd());
  reports.push({width,rows:state.flow.rows,leases:state.flow.leases,pauses:state.flow.pauses,pageerror:errors,unhandled:state.errors,ordered:true});await page.screenshot({path:`flow-smoke-results/${width}-terminal-return.png`});
 }catch(e){await page.screenshot({path:`flow-smoke-results/failure-${width}.png`});await writeFile('flow-smoke-results/failure.txt',String(e.stack)+'\n'+await page.locator('body').innerText());throw e;}finally{await page.close();}
}console.log(JSON.stringify(reports,null,2));}finally{await writeFile(`flow-smoke-results/${baseline?'baseline':'fixed'}.json`,JSON.stringify(reports,null,2));await browser.close();await new Promise(r=>server.close(r));}
