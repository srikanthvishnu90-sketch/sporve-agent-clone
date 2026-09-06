// Executes production handlers with database/Stripe SDK replaced, never calls
// an external service. Resend HMAC uses real Web Crypto; Stripe SDK crypto is
// covered separately by ../tests/stripe-webhook.test.ts, not by these mocks.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto, createHmac} from 'node:crypto';
import vm from 'node:vm';
import {HttpInputError,readBoundedText,withHttpDeadline as deadline} from '../_shared/http.ts';

const fixtureSecret = Buffer.from('local webhook verification fixture only').toString('base64');
const environment = {
  STRIPE_SECRET_KEY:'fixture-only', STRIPE_WEBHOOK_SECRET:'platform-fixture',
  STRIPE_CONNECT_WEBHOOK_SECRET:'connect-fixture', RESEND_WEBHOOK_SECRET:'whsec_'+fixtureSecret,
  SUPABASE_URL:'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY:'fixture-only',
};
async function load(relative, verify=async()=>{throw new Error('Untrusted payload must not reach logs');}, database=null) {
  const source=await readFile(new URL(relative,import.meta.url),'utf8');
  const code=stripTypeScriptTypes(source.replace(/^import\s+[\s\S]*?;\n/gm,''));
  const state={handler:null,dbCalls:0,verified:[],logs:[]};
  class Stripe {
    static createFetchHttpClient(){return {};}
    static createSubtleCryptoProvider(){return {};}
    webhooks={constructEventAsync:async(...args)=>{state.verified.push(args[2]);return verify(...args);}};
  }
  const noDatabase=()=>{state.dbCalls++;throw new Error('Unexpected database access');};
  vm.runInNewContext(code,{
    Stripe, Response, TextEncoder, Uint8Array, crypto:webcrypto, atob,btoa,
    HttpInputError,readBoundedText,withHttpDeadline:(work,ms)=>deadline(work,Math.min(ms,50)),
    console:{error:(...args)=>state.logs.push(args.join(' '))},
    createClient:()=>database || ({from:noDatabase,rpc:noDatabase}),
    Deno:{serve:fn=>{state.handler=fn;},env:{get:key=>environment[key]}},
  });
  return state;
}
const req=(body='{}',headers={})=>new Request('https://fixture.invalid/webhook',{method:'POST',headers,body});

test('Stripe unsigned real handler is401 before reading body, verifying or accessing database',async()=>{
  const state=await load('./index.ts');
  let bodyReads=0;
  const response=await state.handler({method:'POST',headers:new Headers(),text:()=>{bodyReads++;throw new Error('read');}});
  assert.equal(response.status,401); assert.equal(bodyReads,0);
  assert.deepEqual(state.verified,[]); assert.equal(state.dbCalls,0);
});

test('Stripe invalid signature tries both configured signers then401 with no data writes or payload logging',async()=>{
  const state=await load('./index.ts');
  assert.equal((await state.handler(req('{"private":"fixture"}',{'stripe-signature':'forged'}))).status,401);
  assert.deepEqual(state.verified,['platform-fixture','connect-fixture']);
  assert.equal(state.dbCalls,0);
  assert.deepEqual(state.logs,['Stripe signature verification failed']);
});

test('Stripe valid verification result still acknowledges an unhandled event; method guard remains405',async()=>{
  const state=await load('./index.ts',async()=>({id:'evt_fixture',type:'unhandled.fixture',livemode:false,created:1,data:{object:{}}}));
  const response=await state.handler(req('{}',{'stripe-signature':'sdk-result-fixture'}));
  assert.equal(response.status,200); assert.deepEqual(await response.json(),{received:true});
  assert.equal(state.dbCalls,0); assert.deepEqual(state.verified,['platform-fixture']);
  assert.equal((await state.handler(new Request('https://fixture.invalid'))).status,405);
});

function svix(body,ts=String(Math.floor(Date.now()/1000)),version='v1') {
  const id='msg_fixture';
  const signature=createHmac('sha256',Buffer.from(fixtureSecret,'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return {'svix-id':id,'svix-timestamp':ts,'svix-signature':`${version},${signature}`};
}

test('Resend unsigned, forged, stale and future requests return401 before database access',async()=>{
  const state=await load('../resend-webhook/index.ts');
  const body=JSON.stringify({type:'email.bounced',data:{email_id:'fixture'}});
  const now=Math.floor(Date.now()/1000);
  for(const headers of [{}, {...svix(body),'svix-signature':'v1,forged'},svix(body,String(now-400)),svix(body,String(now+400))]) {
    assert.equal((await state.handler(req(body,headers))).status,401);
  }
  assert.equal(state.dbCalls,0);
});

test('Resend rejects correctly signed malformed timestamps and unsupported versions',async()=>{
  const state=await load('../resend-webhook/index.ts');
  const body=JSON.stringify({type:'ignored.fixture'});
  for(const ts of ['NaN','Infinity','-1','1.5','9007199254740993','']) {
    assert.equal((await state.handler(req(body,svix(body,ts)))).status,401,ts);
  }
  assert.equal((await state.handler(req(body,svix(body,undefined,'v0')))).status,401);
  const extra=svix(body); extra['svix-signature']+=',extra';
  assert.equal((await state.handler(req(body,extra))).status,401);
  assert.equal(state.dbCalls,0);
});

test('Resend real HMAC accepts current signed request and a valid rotation entry, rejects body tampering',async()=>{
  const state=await load('../resend-webhook/index.ts');
  const body=JSON.stringify({type:'ignored.fixture'});
  const headers=svix(body);
  assert.equal((await state.handler(req(body,headers))).status,200);
  assert.equal((await state.handler(req(body+' ',headers))).status,401);
  assert.equal((await state.handler(req(body,{...headers,'svix-signature':'v1,old '+headers['svix-signature']}))).status,200);
  assert.equal(state.dbCalls,0);
});

// Models PostgREST receipts, not live RLS, transactions, or provider retries.
function deliveryDatabase(overrides={}) {
  const calls=[];
  const defaults={
    'outbound_messages:select':{id:'message-fixture',content:{guardian_id:'guardian-fixture',to_email:'stale-draft@example.invalid'}},
    'delivery_events:insert':{id:'event-fixture'},
    'outbound_messages:update':{id:'message-fixture'},
    'guardians:update':{id:'guardian-fixture',email:'Parent@Example.invalid'},
    'guardians:select':{id:'guardian-fixture',email:'Parent@Example.invalid'},
    'email_suppressions:upsert':{email:'parent@example.invalid'},
  };
  return {calls,from(table) {
    const call={table,operation:null,payload:null,filters:[],signal:null};calls.push(call);
    const query={
      select(){call.operation ||= 'select';return query;},
      insert(payload){call.operation='insert';call.payload=payload;return query;},
      update(payload){call.operation='update';call.payload=payload;return query;},
      upsert(payload){call.operation='upsert';call.payload=payload;return query;},
      eq(key,value){call.filters.push([key,value]);return query;},
      abortSignal(signal){call.signal=signal;return query;},
      single(){return result();},maybeSingle(){return result();},
    };
    function result(){
      const key=table+':'+call.operation;
      if(Object.hasOwn(overrides,key))return typeof overrides[key]==='function'?overrides[key]():overrides[key];
      assert.ok(Object.hasOwn(defaults,key),key);
      return Promise.resolve({data:{...(Array.isArray(call.payload)?call.payload[0]:call.payload),...defaults[key]},error:null});
    }
    return query;
  }};
}
async function deliver(database,type='email.bounced',to=['parent@example.invalid']) {
  const state=await load('../resend-webhook/index.ts',undefined,database);
  const body=JSON.stringify({type,data:{email_id:'provider-message-fixture',to}});
  return {state,response:await state.handler(req(body,svix(body)))};
}

test('Resend signed bounce and complaint acknowledge only verified write receipts',async()=>{
  for(const [type,status] of [['email.bounced','bounced'],['email.complained','complained']]){
    const db=deliveryDatabase();const {response,state}=await deliver(db,type);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    assert.equal(db.calls.length,6);assert.ok(db.calls.every(c=>c.signal));
    assert.equal(db.calls[1].payload[0].message_id,'message-fixture');
    assert.equal(db.calls[1].payload[0].guardian_id,'guardian-fixture');
    assert.equal(db.calls[5].payload.email_status,status);
    assert.equal(db.calls[3].payload.email,'parent@example.invalid');
    assert.equal(db.calls[3].payload.reason,status);assert.deepEqual(state.logs,[]);
    assert.deepEqual(db.calls[5].filters,[['id','guardian-fixture'],['email','Parent@Example.invalid']]);
  }
});

test('Resend lookup and every write error return retryable503 without raw database details',async()=>{
  for(const [step,key] of ['outbound_messages:select','delivery_events:insert','outbound_messages:update',
    'email_suppressions:upsert','guardians:select','guardians:update'].entries()){
    for(const result of [{data:null,error:{message:'private fixture detail'}},()=>{throw new Error('private fixture detail');}]){
      const db=deliveryDatabase({[key]:result});const {state,response}=await deliver(db);
      assert.equal(response.status,503,key);assert.equal(db.calls.length,step+1);
      assert.deepEqual(state.logs,['Delivery event persistence unavailable']);
      assert.equal(await response.text(),'delivery persistence unavailable');
    }
  }
});

test('Resend suppressed or mismatched write receipts never acknowledge success',async()=>{
  for(const key of ['delivery_events:insert','outbound_messages:update','guardians:update','email_suppressions:upsert']){
    for(const data of [null,{}, ...(key==='delivery_events:insert'?[]:[{id:'wrong',email:'wrong@example.invalid'}])]){
      const db=deliveryDatabase({[key]:{data,error:null}});
      assert.equal((await deliver(db)).response.status,503,key);
    }
  }
});

test('Resend unmatched events still require an intake receipt and never guess a guardian from recipients',async()=>{
  const db=deliveryDatabase({'outbound_messages:select':{data:null,error:null}});
  const {response}=await deliver(db);assert.equal(response.status,200);
  assert.equal(db.calls.length,2);assert.equal(db.calls[1].payload[0].guardian_id,null);
  assert.equal(db.calls[1].payload[0].message_id,null);
});

test('Resend returning an old row with the correct identifier is still a failed write',async()=>{
  for(const [key,data] of [
    ['delivery_events:insert',{id:'event-fixture',type:'wrong',message_id:'message-fixture',guardian_id:'guardian-fixture'}],
    ['outbound_messages:update',{id:'message-fixture',delivery_error:null,last_error:null}],
    ['guardians:update',{id:'guardian-fixture',email:'Parent@Example.invalid',email_status:'ok',email_bounced_at:null}],
    ['email_suppressions:upsert',{email:'parent@example.invalid',reason:'wrong'}],
  ]){
    assert.equal((await deliver(deliveryDatabase({[key]:{data,error:null}}))).response.status,503,key);
  }
});

test('Resend delayed bounce suppresses the signed sent address, never the guardian replacement',async()=>{
  for(const data of [{id:'guardian-fixture',email:'replacement@example.invalid'},
    {id:'guardian-fixture',email:null},null]){
    const db=deliveryDatabase({'guardians:select':{data,error:null}});
    assert.equal((await deliver(db)).response.status,200);
    assert.equal(db.calls.length,5);assert.equal(db.calls[3].payload.email,'parent@example.invalid');
    assert.equal(db.calls.filter(c=>c.table==='guardians'&&c.operation==='update').length,0);
  }
});

test('Resend concurrent address change cannot receive a guardian write without the exact-email precondition',async()=>{
  const db=deliveryDatabase({'guardians:update':{data:null,error:null}});
  assert.equal((await deliver(db)).response.status,503);
  assert.deepEqual(db.calls[5].filters,[['id','guardian-fixture'],['email','Parent@Example.invalid']]);
  assert.equal(db.calls[3].payload.email,'parent@example.invalid');
});

test('Resend absent or ambiguous signed recipients retain verified audit and message failure without guessing an address',async()=>{
  // JSON serialization omits the symbol-valued field, exercising absent data.to.
  for(const to of [Symbol('absent'),null,[],['a@example.invalid','b@example.invalid'],[null],['invalid'],['Name <parent@example.invalid>']]){
    for(const type of ['email.bounced','email.complained']){
      const db=deliveryDatabase();assert.equal((await deliver(db,type,to)).response.status,200);
      assert.deepEqual(db.calls.map(c=>c.table+':'+c.operation),[
        'outbound_messages:select','delivery_events:insert','outbound_messages:update']);
      assert.equal(db.calls[1].payload[0].type,type);
      assert.equal(db.calls[2].payload.delivery_error,type==='email.bounced'?'hard bounce':'complaint');
      assert.equal(db.calls[2].payload.last_error,type==='email.bounced'?'hard bounce':'complaint');
    }
  }
});

test('Resend missing recipients never turn failed audit or message writes into a successful acknowledgment',async()=>{
  for(const key of ['delivery_events:insert','outbound_messages:update']){
    for(const result of [{data:null,error:null},{data:null,error:{message:'private detail'}},
      {data:{id:'wrong'},error:null}]){
      const db=deliveryDatabase({[key]:result});
      assert.equal((await deliver(db,'email.bounced',null)).response.status,503);
      assert.ok(db.calls.every(c=>!['guardians','email_suppressions'].includes(c.table)));
    }
  }
});

test('Resend database deadline ends a stalled lookup with503 and aborts its signal',async()=>{
  const db=deliveryDatabase({'outbound_messages:select':()=>new Promise(()=>{})});
  assert.equal((await deliver(db)).response.status,503);
  assert.equal(db.calls.length,1);assert.equal(db.calls[0].signal.aborted,true);
});

test('Resend signed malformed event and invalid email identifiers never reach database',async()=>{
  const state=await load('../resend-webhook/index.ts');
  for(const value of [null,[],{type:'email.bounced',data:{email_id:1}},
    {type:'email.bounced',data:{email_id:' '}},{type:'email.bounced',data:{email_id:'x'.repeat(201)}}]){
    const body=JSON.stringify(value);
    assert.equal((await state.handler(req(body,svix(body)))).status,400);
  }
  assert.equal(state.dbCalls,0);
});

test('Resend unsigned requests are rejected before reading even an oversized body',async()=>{
  const state=await load('../resend-webhook/index.ts');
  let reads=0;
  const response=await state.handler({method:'POST',headers:new Headers(),get body(){reads++;throw new Error('must not read');}});
  assert.equal(response.status,401);assert.equal(reads,0);assert.equal(state.dbCalls,0);
});

test('Resend raw signed body is capped by UTF-8 bytes before signature processing or database access',async()=>{
  const state=await load('../resend-webhook/index.ts');
  const body='é'.repeat(50_001);
  assert.equal((await state.handler(req(body,svix(body)))).status,413);
  assert.equal((await state.handler(req('{}',{...svix('{}'),'content-length':'100001'}))).status,413);
  assert.equal(state.dbCalls,0);
});

test('Resend stalled body ends with504, cancels the stream and never contacts database',async()=>{
  const state=await load('../resend-webhook/index.ts');let cancelled=false;
  const request=new Request('https://fixture.invalid/webhook',{method:'POST',headers:svix('{}'),duplex:'half',
    body:new ReadableStream({cancel(){cancelled=true;}})});
  assert.equal((await state.handler(request)).status,504);
  assert.equal(cancelled,true);assert.equal(request.body.locked,false);assert.equal(state.dbCalls,0);
});
