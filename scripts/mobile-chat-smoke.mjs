#!/usr/bin/env node
// Actions only: production UI, real SDK/privacy wrappers, isolated SSE provider.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseline=process.argv.includes('--baseline');
const root=resolve('dist');const wires=[];
const provider=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const parsed=JSON.parse(body);wires.push({url:req.url,headers:req.headers,body:parsed});
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const text=parsed.messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
 const aliases=[...new Set(text.match(/\[NC_[^\]]+\]/g)||[])];
 const answer='Fixture reply: '+aliases.join(' ');
 const send=delta=>res.write('data: '+JSON.stringify({id:'chat-fixture',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
 send({role:'assistant'});
 // Deliberately split privacy tokens across chunks.
 for(let i=0;i<answer.length;i+=3){send({content:answer.slice(i,i+3)});await new Promise(r=>setTimeout(r,2));}
 res.end('data: '+JSON.stringify({id:'chat-fixture',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});await new Promise(r=>provider.listen(0,'127.0.0.1',r));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await mkdir('chat-smoke-results',{recursive:true});const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
await page.exposeFunction('fixtureRequest',async(url,method,headers,body)=>{
 assert.ok(url.startsWith('https://fixture.invalid/v1/'),'No external network allowed');
 const r=await fetch(`http://127.0.0.1:${provider.address().port}/v1/chat/completions`,{method,headers,body});return {status:r.status,text:await r.text()};
});
await page.addInitScript(()=>{
 window.__errors=[];window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
 const emit=(type,payload)=>window.__onNativeEvent(type,btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
 window.NativeBridge={startLocalShell:(reqId,sessionId)=>emit('ssh_connected',{reqId,sessionId}),writeTerminalBytesB64:()=>{},resizeSshPty:()=>{},closeSession:()=>{},getSessionRemoteInfoSync:()=>'{}',getHomeDirSync:()=>'/sandbox',getDeviceSysInfo:()=>'{}',credentialsAvailable:()=>true,credentialsEncrypt:s=>'fixture:'+s,credentialsDecrypt:s=>s.slice(8),setStatusBarColorHex:()=>{},listPortForwardsSync:()=>'[]',
 httpFetchAsync:async(reqId,url,method,headers,body)=>{const r=await window.fixtureRequest(url,method,JSON.parse(headers),body);emit('async_response',{reqId,ok:r.status===200,status:r.status,data:r.text});},
 startAiChatStream:async(reqId,requestId,url,headers,body)=>{try{const r=await window.fixtureRequest(url,'POST',JSON.parse(headers),body);emit('async_response',{reqId,ok:true,statusCode:r.status,statusText:'OK'});for(const line of r.text.split('\n'))if(line.startsWith('data: ')&&line!=='data: [DONE]')emit('ai_stream_data',{requestId,data:line.slice(6)});emit('ai_stream_end',{requestId});}catch(e){emit('ai_stream_error',{requestId,error:String(e)});}},cancelAiChatStream:()=>true};
});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});await page.locator('.netcatty-shell').waitFor();
 await page.evaluate(()=>window.netcatty.openSettingsWindow());await page.getByRole('tab',{name:/^AI$/}).click();await page.getByRole('button',{name:/添加提供商|Add Provider/i}).click();await page.getByRole('button',{name:/^OpenAI$/}).click();
 await page.locator('input[type=password]').fill('fixture-provider-key');await page.locator('input[placeholder="https://api.openai.com/v1"]').fill('https://fixture.invalid/v1');await page.getByRole('button',{name:/^保存$|^Save$/}).click();await page.waitForTimeout(500);
 await page.evaluate(()=>window.netcatty.closeSettingsWindow());
 console.log('shell buttons',await page.getByRole('button').evaluateAll(es=>es.map(e=>({text:e.innerText,title:e.title,aria:e.getAttribute('aria-label')}))));
 await page.getByRole('button',{name:/^Terminal$/}).focus();await page.keyboard.press('Enter');await page.waitForTimeout(1500);
 await page.locator('[data-section="top-tabs-toolbar-actions"] button').filter({has:page.locator('svg.lucide-sparkles')}).click();await page.waitForTimeout(1500);
 console.log('chat body',await page.locator('body').innerText());
 console.log('inputs',await page.locator('textarea,input').evaluateAll(es=>es.map(e=>({tag:e.tagName,placeholder:e.placeholder}))));
 const input=page.locator('textarea[placeholder*="Message Catty"]');
 await page.getByRole('button',{name:/Select provider/}).click();await page.getByRole('button',{name:/OpenAI/}).last().click();await page.waitForTimeout(500);
 console.log('picker',await page.locator('body').innerText());
 const modelOption=page.getByRole('option').first();if(await modelOption.count())await modelOption.click();
 await input.fill('Please echo password=fixture-ssh-secret api_key=sk-fixture12345678901234567890 host=fixture-host.example 8.8.4.4');await input.press('Enter');await page.waitForTimeout(8000);
 const text=await page.locator('body').innerText();console.log('after send',text);
 if(baseline){assert.equal(wires.length,0);assert.match(text,/privacy protection is unavailable/);}else{
 assert.ok(wires.length>0,'actual UI send must reach provider');const wire=JSON.stringify(wires);
 for(const secret of ['fixture-ssh-secret','sk-fixture12345678901234567890','fixture-host.example','8.8.4.4'])assert.ok(!wire.includes(secret),'wire leaked '+secret);
 assert.match(wire,/\[NC_/);assert.match(text,/Fixture reply:.*fixture-ssh-secret/);
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
 }
}finally{await writeFile(`chat-smoke-results/${baseline?'baseline':'fixed'}.json`,JSON.stringify({baseline,errors,unhandled:await page.evaluate(()=>window.__errors),wires,text:await page.locator('body').innerText()},null,2));await page.screenshot({path:`chat-smoke-results/${baseline?'baseline':'fixed'}.png`});await browser.close();await new Promise(r=>server.close(r));await new Promise(r=>provider.close(r));}
