// Executes the real API handler with fake quota/model transports; no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Buffer} from 'node:buffer';
import * as boundary from '../lib/ai-request-boundary.js';
import actualHandler from '../api/ai.js';

const action={action:'open_tab',target:'roster',body:'',restated:'Open the roster.'};
const modelResponse=()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(action)}]});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function entry({env={},quota=()=>json({allowed:true,plan:'pro',quota:null}),model=modelResponse,maxDeadline=50}={}) {
  const source=await readFile(new URL('../api/ai.js',import.meta.url),'utf8');
  const state={quotaCalls:[],modelCalls:[],logs:[],clientOptions:[],handler:null};
  const code=source.replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler')
    .replaceAll('export function ','function ')+'\nglobalThis.capture(handler);';
  const context={...boundary,Buffer,URL,console:{error:(...args)=>state.logs.push(args.join(' '))},
    process:{env:{ANTHROPIC_API_KEY:'fixture-only',SUPABASE_URL:'https://quota.fixture.invalid',SUPABASE_ANON_KEY:'fixture-public',...env}},
    withDeadline:(fn,ms)=>boundary.withDeadline(fn,Math.min(ms,maxDeadline)),
    fetch:async(url,options)=>{state.quotaCalls.push({url,options});return quota();},
    Anthropic:class {
      constructor(options){state.clientOptions.push(options);}
      messages={create:async(body,options)=>{state.modelCalls.push({body,options});return model();}};
    },
    capture:handler=>{state.handler=handler;},
  };
  vm.runInNewContext(code,context);
  return state;
}
async function invoke(e,{body={text:'open roster'},authorization='Bearer fixture-token',ip='192.0.2.7'}={}) {
  const req={method:'POST',headers:{host:'sporv.fixture.invalid',origin:'https://sporv.fixture.invalid',
    'content-type':'application/json','x-forwarded-for':ip,authorization},body};
  const res={statusCode:200,headers:{},payload:null,
    setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},
    json(data){this.payload=JSON.parse(JSON.stringify(data));return this.payload;}};
  await e.handler(req,res);return res;
}

test('configuration is environment-only, HTTPS-root scoped and never substitutes a project',()=>{
  for(const env of [{},{SUPABASE_URL:'https://example.com'},
    {SUPABASE_URL:'http://example.com',SUPABASE_ANON_KEY:'fixture'},
    {SUPABASE_URL:'https://user:password@example.com',SUPABASE_ANON_KEY:'fixture'},
    {SUPABASE_URL:'https://example.com/path',SUPABASE_ANON_KEY:'fixture'},
    {SUPABASE_URL:'https://example.com?query=1',SUPABASE_ANON_KEY:'fixture'}]) assert.equal(boundary.quotaConfig(env),null);
  assert.deepEqual(boundary.quotaConfig({SUPABASE_URL:'https://example.com/',SUPABASE_ANON_KEY:' fixture '}),{url:'https://example.com',key:'fixture'});
});

test('quota schema requires an explicit boolean and bounded valid denial metadata',()=>{
  for(const value of [null,[],{},true,{allowed:'true'},{allowed:'false'},{allowed:1},{allowed:false},
    {allowed:false,reason:'quota_exhausted',used:'3',quota:3},
    {allowed:false,reason:'quota_exhausted',used:0,quota:3}]) assert.equal(boundary.validQuota(value),false);
  for(const value of [{allowed:true,plan:'pro',quota:null},{allowed:true,plan:'free',used:1,quota:3},{allowed:false,reason:'not_a_coach'},
    {allowed:false,reason:'not_authenticated'},{allowed:false,reason:'quota_exhausted',used:3,quota:3}]) assert.equal(boundary.validQuota(value),true);
});

test('positive quota receipts require a plan and consistent explicit usage metadata',async()=>{
  for(const value of [{allowed:true},{allowed:true,plan:'pro'},
    {allowed:true,plan:'',quota:null},{allowed:true,plan:'   ',quota:null},
    {allowed:true,plan:'x'.repeat(81),quota:null},{allowed:true,plan:1,quota:null},
    {allowed:true,plan:'pro',quota:null,reason:'not_a_coach'},
    {allowed:true,plan:'free',quota:3},{allowed:true,plan:'free',quota:3,used:0},
    {allowed:true,plan:'free',quota:3,used:4},{allowed:true,plan:'free',quota:3,used:'1'},
    {allowed:true,plan:'free',quota:0,used:1},{allowed:true,plan:'free',quota:1.5,used:1},
    {allowed:true,plan:'free',quota:Number.MAX_SAFE_INTEGER+1,used:1},
    {allowed:true,plan:'pro',quota:null,used:0}]) {
    assert.equal(boundary.validQuota(value),false);
    const e=await entry({quota:()=>json(value)});const r=await invoke(e);
    assert.equal(r.statusCode,503);assert.equal(r.payload.error,'quota_unavailable');
    assert.equal(e.modelCalls.length,0);
  }
  assert.equal(boundary.validQuota({allowed:true,plan:'pro',quota:null,used:1}),true);
});

test('quota body cap counts UTF-8 bytes; deadline cancels stalled responses',async()=>{
  await assert.rejects(boundary.withDeadline(s=>boundary.readQuotaResponse(new Response('é'.repeat(10)),s,10),30),/too large/);
  let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
  await assert.rejects(boundary.withDeadline(s=>boundary.readQuotaResponse(response,s),20),{name:'DeadlineError'});
  await Promise.resolve();assert.equal(cancelled,true);assert.equal(response.body.locked,false);
});

test('unconfigured API or malformed bearer never contacts the quota or model',async()=>{
  for(const env of [{SUPABASE_URL:''},{SUPABASE_ANON_KEY:''},{SUPABASE_URL:'http://wrong.invalid'}]) {
    const e=await entry({env});const r=await invoke(e);
    assert.equal(r.statusCode,503);assert.equal(r.payload.error,'quota_not_configured');
    assert.equal(e.quotaCalls.length,0);assert.equal(e.modelCalls.length,0);
  }
  for(const authorization of ['', 'Bearer one two','Basic fixture']) {
    const e=await entry();assert.equal((await invoke(e,{authorization})).statusCode,401);
    assert.equal(e.quotaCalls.length,0);assert.equal(e.modelCalls.length,0);
  }
});

test('malformed/truthy authorization responses fail closed with no model spend',async()=>{
  for(const value of [{allowed:'true'},{allowed:'false'},{allowed:1},[],null,{allowed:false,reason:'unexpected'}]) {
    const e=await entry({quota:()=>json(value)});const r=await invoke(e);
    assert.equal(r.statusCode,503);assert.equal(r.payload.error,'quota_unavailable');assert.equal(e.modelCalls.length,0);
  }
});

test('API translates authentication, staff and monthly quota denials without contacting model',async()=>{
  for(const [quota,status,error] of [
    [()=>new Response(null,{status:401}),401,'auth_invalid'],
    [()=>json({allowed:false,reason:'not_a_coach'}),403,'coach_only'],
    [()=>json({allowed:false,reason:'not_authenticated'}),401,'auth_invalid'],
    [()=>json({allowed:false,reason:'quota_exhausted',used:3,quota:3}),429,'quota_exhausted'],
  ]) {
    const e=await entry({quota});const r=await invoke(e);
    assert.equal(r.statusCode,status);assert.equal(r.payload.error,error);assert.equal(e.modelCalls.length,0);
  }
});

test('catalog quota denial returns402 and never spends on the model',async()=>{
  const verdict={allowed:false,reason:'quota_exhausted',plan:'free',used:25,quota:25,
    contract_version:2,current_plan:'free',upgrade_to:'individual',limit:25,current:25};
  const e=await entry({quota:()=>json(verdict)});const r=await invoke(e);
  assert.equal(r.statusCode,402);
  for(const key of ['reason','current_plan','upgrade_to','limit','current']) assert.equal(r.payload[key],verdict[key]);
  assert.equal(e.modelCalls.length,0);
  for(const patch of [{contract_version:3},{current_plan:undefined},{upgrade_to:undefined},
    {upgrade_to:'<script>'},{limit:24},{current:26},{quota:'25'}]) {
    const bad=await entry({quota:()=>json({...verdict,...patch})});
    assert.equal((await invoke(bad)).statusCode,503);
    assert.equal(bad.modelCalls.length,0);
  }
  const noUpgrade=await entry({quota:()=>json({...verdict,upgrade_to:null})});
  assert.equal((await invoke(noUpgrade)).statusCode,402);
});

test('explicit unavailable quota verdict is valid but returns503 without model spend',async()=>{
  const verdict={allowed:false,reason:'quota_unavailable'};
  assert.equal(boundary.validQuota(verdict),true);
  assert.equal(boundary.validQuota({...verdict,allowed:true}),false);
  const e=await entry({quota:()=>json(verdict)});const r=await invoke(e);
  assert.equal(r.statusCode,503);assert.deepEqual(r.payload,{error:'quota_unavailable'});
  assert.equal(e.modelCalls.length,0);
});

test('shared quota burst denial becomes429 with validated Retry-After; invalid counter verdict stays closed',async()=>{
  const e=await entry({quota:()=>json({allowed:false,reason:'rate_limited',retry_after:23})});
  const r=await invoke(e);assert.equal(r.statusCode,429);assert.equal(r.headers['retry-after'],'23');
  assert.equal(r.payload.message,'Too many requests. Try again in 23 seconds.');
  assert.equal(e.modelCalls.length,0);
  for(const retry_after of [0,61,'23',null]){
    const bad=await entry({quota:()=>json({allowed:false,reason:'rate_limited',retry_after})});
    assert.equal((await invoke(bad)).statusCode,503);assert.equal(bad.modelCalls.length,0);
  }
});

test('quota gateway or grant failures are unavailable, never a coach role verdict',async()=>{
  for(const status of [403,404,429,500,503]) {
    const e=await entry({quota:()=>new Response(null,{status})});const r=await invoke(e);
    assert.equal(r.statusCode,503);assert.equal(r.payload.error,'quota_unavailable');
    assert.equal(e.modelCalls.length,0);
  }
});

test('quota timeout, oversized response and upstream error close the gate without leaking raw errors',async()=>{
  for(const quota of [()=>new Promise(()=>{}),()=>new Response('x'.repeat(16_385)),()=>{throw new Error('private fixture token');}]){
    const e=await entry({quota,maxDeadline:20});const r=await invoke(e);
    assert.equal(r.statusCode,503);assert.equal(e.modelCalls.length,0);
    assert.deepEqual(e.logs,['AI quota verification unavailable']);
  }
});

test('per-instance burst limit allows12 attempts then returns429 with Retry-After',async()=>{
  const e=await entry({quota:()=>json({allowed:false,reason:'not_a_coach'})});
  for(let i=0;i<12;i++)assert.equal((await invoke(e)).statusCode,403);
  const r=await invoke(e);assert.equal(r.statusCode,429);assert.equal(r.payload.error,'rate_limited');
  assert.ok(Number(r.headers['retry-after'])>=1);assert.ok(Number(r.headers['retry-after'])<=60);
  assert.equal(r.payload.message,`Too many requests. Try again in ${r.payload.retry_after} seconds.`);
  assert.equal(e.quotaCalls.length,12);assert.equal(e.modelCalls.length,0);
});

test('authorized request forwards only caller JWT and public key, disables redirects/retries, returns data only',async()=>{
  const e=await entry();const r=await invoke(e);
  assert.equal(r.statusCode,200);assert.deepEqual(r.payload,action);
  assert.equal(e.quotaCalls[0].url,'https://quota.fixture.invalid/rest/v1/rpc/consume_ai_quota');
  assert.equal(e.quotaCalls[0].options.headers.Authorization,'Bearer fixture-token');
  assert.equal(e.quotaCalls[0].options.headers.apikey,'fixture-public');
  assert.equal(e.quotaCalls[0].options.redirect,'error');
  assert.equal(e.clientOptions[0].maxRetries,0);assert.equal(e.clientOptions[0].timeout,20_000);
  assert.equal(e.modelCalls.length,1);assert.ok(e.modelCalls[0].options.signal);
  assert.equal(e.modelCalls[0].body.tools,undefined);
});

test('model timeout/malformed output becomes a bounded502 without upstream text in logs',async()=>{
  for(const model of [()=>new Promise(()=>{}),()=>{throw new Error('private fixture instruction');},
    ()=>({content:[{type:'text',text:'x'.repeat(16_385)}]}),()=>({content:[{type:'text',text:'{'}]})]) {
    const e=await entry({model,maxDeadline:20});const r=await invoke(e);
    assert.equal(r.statusCode,502);assert.equal(r.payload.error,'ai_unavailable');
    assert.deepEqual(e.logs,['AI classification unavailable']);assert.equal(e.modelCalls.length,1);
  }
});

test('installed SDK integration uses one model attempt and preserves the actual API response contract',async()=>{
  const prior={fetch:globalThis.fetch,error:console.error,
    key:process.env.ANTHROPIC_API_KEY,url:process.env.SUPABASE_URL,anon:process.env.SUPABASE_ANON_KEY};
  process.env.ANTHROPIC_API_KEY='fixture-only';process.env.SUPABASE_URL='https://quota.fixture.invalid';
  process.env.SUPABASE_ANON_KEY='fixture-public';
  console.error=()=>{};
  try {
    for(const status of [200,500]){
      let modelCalls=0,quotaCalls=0;
      globalThis.fetch=async(input)=>{
        const url=typeof input==='string'?input:input.url || String(input);
        if(url==='https://quota.fixture.invalid/rest/v1/rpc/consume_ai_quota'){
          quotaCalls++;return json({allowed:true,plan:'free',used:1,quota:3});
        }
        assert.equal(url,'https://api.anthropic.com/v1/messages');modelCalls++;
        return new Response(JSON.stringify(status===200 ? {
          id:'msg_fixture',type:'message',role:'assistant',model:'fixture',...modelResponse(),usage:{input_tokens:1,output_tokens:1},
        } : {type:'error',error:{type:'api_error',message:'fixture failure'}}),{
          status,headers:{'content-type':'application/json','request-id':'fixture'},
        });
      };
      const res=await invoke({handler:actualHandler},{ip:'192.0.2.'+(status===200?'90':'91')});
      assert.equal(quotaCalls,1);assert.equal(modelCalls,1);
      assert.equal(res.statusCode,status===200?200:502);
      if(status===200)assert.deepEqual(res.payload,action);
    }
  } finally {
    globalThis.fetch=prior.fetch;console.error=prior.error;
    for(const [name,value] of [['ANTHROPIC_API_KEY',prior.key],['SUPABASE_URL',prior.url],['SUPABASE_ANON_KEY',prior.anon]]){
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  }
});
