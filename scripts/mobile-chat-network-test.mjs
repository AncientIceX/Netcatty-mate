import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {streamText} from 'ai';
import {createAndroidPrivacyService} from '../infrastructure/mobile/androidPrivacy.ts';
import {initializeModelPrivacy,protectModel} from '../infrastructure/ai/harness/modelPrivacy.ts';
import {createModelFromConfig} from '../infrastructure/ai/sdk/providers.ts';
const wires=[];
const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;wires.push(body);const aliases=[...new Set(body.match(/\[NC_[^\]]+\]/g)||[])];res.writeHead(200,{'Content-Type':'text/event-stream'});const answer='reply '+aliases.join(' ');for(let i=0;i<answer.length;i+=3)res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content:answer.slice(i,i+3)},finish_reason:null}]})+'\n\n');res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let win;const emit=(event,data)=>win.__onNativeEvent(event,Buffer.from(JSON.stringify(data)).toString('base64'));
win={innerWidth:412,setTimeout,clearTimeout,__createAndroidPrivacyService:createAndroidPrivacyService,NativeBridge:{getHomeDirSync:()=>'/fixture',startAiChatStream:async(reqId,requestId,url,headers,body)=>{assert.ok(url.startsWith('https://fixture.invalid/'));try{const response=await fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',headers:JSON.parse(headers),body});emit('async_response',{reqId,ok:true,statusCode:response.status,statusText:'OK'});for(const line of (await response.text()).split('\n'))if(line.startsWith('data: ')&&line!=='data: [DONE]')emit('ai_stream_data',{requestId,data:line.slice(6)});emit('ai_stream_end',{requestId});}catch(error){emit('ai_stream_error',{requestId,error:String(error)});}},cancelAiChatStream:()=>true}};
const context=vm.createContext({window:win,document:{documentElement:{setAttribute(){}}},navigator:{userAgent:'Android'},localStorage:{getItem:()=>null,setItem(){}},TextEncoder,TextDecoder,crypto,URL,URLSearchParams,atob,btoa,console,queueMicrotask});vm.runInContext(stripTypeScriptTypes(readFileSync('infrastructure/mobile/androidBridgePolyfill.ts','utf8').replace(/export function /g,'function '))+'\ninstallAndroidBridgePolyfill();',context);globalThis.window=win;
try{
 const bridge=win.netcatty;await bridge.aiSyncProviders([{id:'fixture',apiKey:'fixture-not-real',baseURL:'https://fixture.invalid/v1'}]);const privacy=await initializeModelPrivacy(bridge,'fixture-chat');const model=protectModel(createModelFromConfig({id:'fixture',name:'Fixture',type:'openai',apiStyle:'openai',apiKey:'fixture-not-real',baseURL:'https://fixture.invalid/v1',defaultModel:'fixture'},{requireBridge:true}),privacy);
 const prompt='password=fixture-ssh-secret api_key=sk-fixture12345678901234567890 host=fixture-host.example 8.8.4.4';const result=streamText({model,prompt,maxRetries:0});const answer=await result.text;assert.equal(wires.length,1);
 for(const secret of ['fixture-ssh-secret','sk-fixture12345678901234567890','fixture-host.example','8.8.4.4']){assert.ok(!wires[0].includes(secret));assert.ok(answer.includes(secret),'restored '+secret);}
 await bridge.externalMcpSetConfig({redaction:null});await assert.rejects(initializeModelPrivacy(bridge,'denied'));assert.equal(wires.length,1);
 console.log('PASS actual Android bridge + privacy + OpenAI SDK + isolated HTTP SSE: wire protected, split tokens restored, invalid policy sends no request. No real provider tested.');
}finally{await new Promise(r=>server.close(r));}
