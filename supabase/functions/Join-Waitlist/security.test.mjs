// Real handler, fake DB/SMTP/captcha only. No external signup or email occurs.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import * as http from '../_shared/http.ts';

const request=(value,raw=false)=>new Request('https://fixture.invalid/waitlist',{
  method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'192.0.2.17'},
  body:raw?value:JSON.stringify(value),
});
async function entry({quota=()=>({data:true,error:null}), saved={data:{position:1,ref_code:'fixture_code'},error:null},
  existing={data:{id:'fixture-existing'},error:null},
  smtpError=false, captcha=false, captchaResponse=()=>new Response('{"success":true}')}={}) {
  const state={handler:null,quotas:[],inserts:[],emails:[],closes:0,fetches:0};
  const source=await readFile(new URL('./index.ts',import.meta.url),'utf8');
  const environment={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',
    SITE_URL:'https://fixture.invalid',GMAIL_USER:'fixture@example.invalid',GMAIL_APP_PASSWORD:'fixture-only',
    ...(captcha?{HCAPTCHA_SECRET:'fixture-only'}:{})};
  const code=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''));
  vm.runInNewContext(code,{
    ...http,Response,URL,URLSearchParams,console:{error(){},warn(){}},
    createClient:()=>({
      rpc:(name,args)=>{assert.equal(name,'consume_edge_rate_limit');state.quotas.push(args);
        return {abortSignal:async()=>quota()};},
      from:name=>{assert.equal(name,'waitlist');return {
        select:columns=>{assert.equal(columns,'id');return {eq:(column,email)=>{
          assert.equal(column,'email');assert.equal(email,'fixture@example.invalid');
          return {abortSignal:()=>({maybeSingle:async()=>existing})};
        }};},
        insert:row=>{state.inserts.push(row);return {select:()=>({abortSignal:()=>({single:async()=>{
          if(saved instanceof Error)throw saved;return saved;
        }})})};},
      };},
    }),
    SMTPClient:class {async send(message){state.emails.push(message);if(smtpError)throw new Error('fixture delivery failed');}
      async close(){state.closes++;}},
    fetch:async()=>{state.fetches++;return captchaResponse();},
    Deno:{env:{get:key=>environment[key]},serve:handler=>{state.handler=handler;}},
  });
  return state;
}

test('shared JSON reader enforces streamed UTF-8 byte caps, rejects arrays/null and releases streams',async()=>{
  for(const raw of ['[1]','null','{']) await assert.rejects(http.readBoundedJson(request(raw,true)),e=>e.status===400);
  const body=request('{"s":"ééé"}',true);
  await assert.rejects(http.readBoundedJson(body,12),e=>e.status===413);
  assert.equal(body.body.locked,false);
  assert.deepEqual(await http.readBoundedJson(request({ok:true})),{ok:true});
});

test('shared deadline cancels a stalled body and bounds a transport that ignores abort',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
  await assert.rejects(http.withHttpDeadline(signal=>http.readBoundedJson(response,100,signal),20),e=>e.status===504);
  await Promise.resolve();
  assert.equal(cancelled,true);assert.equal(response.body.locked,false);
  await assert.rejects(http.withHttpDeadline(()=>new Promise(()=>{}),20),e=>e.status===504);
});

test('waitlist malformed/oversized bodies and honeypot fail before quota and signup writes',async()=>{
  for(const [body,status] of [['null',400],['[]',400],['{',400],['x'.repeat(16_385),413],[JSON.stringify({company:'bot'}),400]]){
    const e=await entry(); const res=await e.handler(request(body,true));
    assert.equal(res.status,status);assert.equal(e.quotas.length,0);assert.equal(e.inserts.length,0);assert.equal(e.emails.length,0);
  }
});

test('quota errors, malformed verdicts and thrown transports fail closed before signup or captcha',async()=>{
  for(const quota of [()=>({data:null,error:{message:'offline'}}),()=>({data:'true',error:null}),()=>{throw new Error('offline');}]){
    const e=await entry({quota,captcha:true});
    const res=await e.handler(request({email:'fixture@example.invalid',captchaToken:'fixture'}));
    assert.equal(res.status,503); assert.equal((await res.json()).ok,false);
    assert.equal(e.inserts.length,0);assert.equal(e.emails.length,0);assert.equal(e.fetches,0);
  }
});

test('non-string email values cannot throw or create a signup',async()=>{
  for(const email of [42,null,[],{toString:'not callable'}]) {
    const e=await entry(); const res=await e.handler(request({email}));
    assert.equal(res.status,400);assert.equal(e.inserts.length,0);assert.equal(e.emails.length,0);
  }
});

test('exhausted atomic quota returns429 plus Retry-After before captcha or insert',async()=>{
  const e=await entry({quota:()=>({data:false,error:null}),captcha:true});
  const res=await e.handler(request({email:'fixture@example.invalid',captchaToken:'fixture'}));
  assert.equal(res.status,429);assert.ok(Number(res.headers.get('retry-after'))>=1);assert.ok(Number(res.headers.get('retry-after'))<=3600);
  assert.equal(e.inserts.length,0);assert.equal(e.fetches,0);assert.equal(e.emails.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(e.quotas[0])),{
    p_actor_key:'ip:192.0.2.17',p_scope:'join-waitlist:hour',p_limit:5,p_window_seconds:3600,
  });
});

test('six concurrent handlers honor a shared quota verdict: five writes, one429 (DB counter mocked)',async()=>{
  let count=0;
  const e=await entry({quota:()=>({data:++count<=5,error:null})});
  const results=await Promise.all(Array.from({length:6},(_,i)=>e.handler(request({email:`fixture${i}@example.invalid`}))));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,200,200,200,200,429]);
  assert.equal(e.inserts.length,5);assert.equal(e.emails.length,5);
});

test('database rejection, absent receipt and thrown write never report signup success or email',async()=>{
  for(const [saved,status] of [[{data:null,error:{code:'other'}},500],[{data:null,error:null},502],
    [{data:{position:1},error:null},502],[{data:{position:0,ref_code:'fixture'},error:null},502],
    [new Error('connection failed'),503]]){
    const e=await entry({saved});const res=await e.handler(request({email:'fixture@example.invalid'}));
    assert.equal(res.status,status);assert.equal((await res.json()).ok,false);assert.equal(e.emails.length,0);
  }
});

test('duplicate signup remains a generic idempotent acknowledgment without another email',async()=>{
  const e=await entry({saved:{data:null,error:{code:'23505'}}});
  const res=await e.handler(request({email:'fixture@example.invalid'}));
  assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true});assert.equal(e.emails.length,0);
});

test('a unique-key error without a confirmed existing email cannot claim a signup',async()=>{
  for(const existing of [{data:null,error:null},{data:null,error:{message:'lookup failed'}}]) {
    const e=await entry({saved:{data:null,error:{code:'23505'}},existing});
    const res=await e.handler(request({email:'fixture@example.invalid'}));
    assert.equal(res.status,503);assert.equal((await res.json()).ok,false);assert.equal(e.emails.length,0);
  }
});

test('verified signup returns a receipt, bounds fields and closes SMTP; email failure does not erase saved signup',async()=>{
  for(const smtpError of [false,true]){
    const e=await entry({smtpError});
    const res=await e.handler(request({email:' Fixture@Example.invalid ',role:'provider',sports:[42,'dance','x'.repeat(200)],ref:'r'.repeat(500)}));
    assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
    assert.deepEqual(await res.json(),{ok:true,position:1,refCode:'fixture_code',alreadyOnList:false});
    assert.equal(e.inserts[0].email,'fixture@example.invalid');assert.equal(e.inserts[0].role,'coach');
    assert.deepEqual(Array.from(e.inserts[0].sports),['dance','x'.repeat(80)]);
    assert.equal(e.inserts[0].referred_by.length,120);assert.equal(e.emails.length,1);assert.equal(e.closes,1);
  }
});

test('configured captcha requires a token, distinguishes service failure, and permits a verified response',async()=>{
  const missing=await entry({captcha:true});
  assert.equal((await missing.handler(request({email:'fixture@example.invalid'}))).status,400);assert.equal(missing.inserts.length,0);
  const failed=await entry({captcha:true,captchaResponse:()=>new Response('unavailable',{status:503})});
  assert.equal((await failed.handler(request({email:'fixture@example.invalid',captchaToken:'fixture'}))).status,503);assert.equal(failed.inserts.length,0);
  const valid=await entry({captcha:true});
  assert.equal((await valid.handler(request({email:'fixture@example.invalid',captchaToken:'fixture'}))).status,200);assert.equal(valid.fetches,1);
});
