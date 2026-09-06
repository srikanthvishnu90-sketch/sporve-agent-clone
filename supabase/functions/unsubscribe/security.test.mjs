// Actual handler + real HMAC; PostgREST is doubled. No external writes/emails.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto,createHmac} from 'node:crypto';
import vm from 'node:vm';
import {withHttpDeadline} from '../_shared/http.ts';

const gid='10000000-0000-0000-0000-000000000001';
const secret='local-unsubscribe-fixture-only';
const token=createHmac('sha256',secret).update(gid).digest('hex').slice(0,32);
const signed=`?g=${gid}&t=${token}`;
const legacy='?email=parent%40example.invalid';
const url='https://fixture.invalid/unsubscribe';
function database(overrides={}) {
  const calls=[];
  return {calls,from(table){
    const call={table,op:null,filters:[],signal:null,body:null,limit:null};calls.push(call);
    const query={
      select(){call.op ||= 'select';return query;},
      update(body){call.op='update';call.body=body;return query;},
      upsert(body){call.op='upsert';call.body=body;return query;},
      eq(key,value){call.filters.push(['eq',key,value]);return query;},
      is(key,value){call.filters.push(['is',key,value]);return query;},
      or(value){call.filters.push(['or',value]);return query;},
      limit(n){call.limit=n;return query;},
      abortSignal(signal){call.signal=signal;return query;},
      single(){call.single=true;return finish();},
      maybeSingle(){call.single=true;return finish();},
      then(resolve,reject){return Promise.resolve().then(finish).then(resolve,reject);},
    };
    function finish(){
      const key=table+':'+call.op;
      if(Object.hasOwn(overrides,key))return typeof overrides[key]==='function'?overrides[key](call):overrides[key];
      let data;
      if(key==='email_suppressions:upsert')data={...call.body};
      else if(key==='guardians:select')data=call.single?{id:gid,email:'Parent@Example.invalid'}:[];
      else if(key==='guardians:update'){
        const email=call.filters.find(x=>x[1]==='email')?.[2];
        const row={id:gid,email,...call.body};data=call.single?row:[row];
      }else throw new Error('Unexpected database operation '+key);
      return {data,error:null};
    }
    return query;
  }};
}
async function load(db=database(),env={}){
  const src=await readFile(new URL('./index.ts',import.meta.url),'utf8');
  const state={handler:null,logs:[],clients:[],db};
  vm.runInNewContext(stripTypeScriptTypes(src.replace(/^import\s+[\s\S]*?;\n/gm,'')),{
    Response,URL,TextEncoder,Uint8Array,crypto:webcrypto,
    withHttpDeadline:(work,ms)=>withHttpDeadline(work,Math.min(ms,40)),
    createClient:(...args)=>{state.clients.push(args);return db;},
    console:{error:(...args)=>state.logs.push(args.join(' '))},
    Deno:{env:{get:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:secret,...env})[key]},
      serve:handler=>{state.handler=handler;}},
  });
  return state;
}
const invoke=(state,query=signed,method='GET')=>state.handler(new Request(url+query,{method}));
async function failed(response){assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/You're unsubscribed/);}

test('unsubscribe preserves GET/POST signed links with real HMAC and verified receipts',async()=>{
  for(const method of ['GET','POST']){
    const state=await load();const response=await invoke(state,signed,method);
    assert.equal(response.status,200);assert.match(await response.text(),/You're unsubscribed/);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.equal(state.db.calls.length,3);
    assert.equal(state.db.calls[1].body.email,'parent@example.invalid');
    assert.equal(state.db.calls[1].body.reason,'unsubscribed');
    assert.deepEqual(state.db.calls[2].filters,[['eq','id',gid],['eq','email','Parent@Example.invalid']]);
    assert.ok(state.db.calls.every(c=>c.signal));assert.deepEqual(state.logs,[]);
  }
});

test('unsubscribe rejects unsupported methods, malformed UUIDs and forged/partial signed links without DB access',async()=>{
  for(const query of ['','?g='+gid,`?g=${gid}&t=forged`,`?g=${'-'.repeat(36)}&t=${token}`,
    `?g=${gid}&t=${token.slice(0,-1)}0&email=parent@example.invalid`]){
    const state=await load();assert.equal((await invoke(state,query)).status,400);assert.equal(state.db.calls.length,0);
  }
  const state=await load();assert.equal((await invoke(state,signed,'DELETE')).status,405);assert.equal(state.clients.length,0);
});

test('unsubscribe missing configuration fails without constructing a database client',async()=>{
  for(const env of [{SUPABASE_URL:''},{SUPABASE_SERVICE_ROLE_KEY:''}]){
    const state=await load(database(),env);await failed(await invoke(state));assert.equal(state.clients.length,0);
  }
});

test('signed unsubscribe cannot acknowledge lookup failures or a deleted guardian',async()=>{
  for(const result of [{data:null,error:null},{data:null,error:{message:'private detail'}},
    {data:{id:'wrong',email:'parent@example.invalid'},error:null},()=>{throw new Error('private detail');}]){
    const db=database({'guardians:select':result});const state=await load(db);
    await failed(await invoke(state));assert.equal(db.calls.length,1);
    assert.deepEqual(state.logs,['Unsubscribe persistence unavailable']);
  }
});

test('signed unsubscribe rejects missing or unchanged suppression and guardian receipts',async()=>{
  for(const [key,values] of [
    ['email_suppressions:upsert',[null,{}, {email:'parent@example.invalid',reason:'bounced'}]],
    ['guardians:update',[null,{}, {id:gid,email:'Parent@Example.invalid',email_status:'ok'},
      {id:gid,email:'replacement@example.invalid',email_status:'unsubscribed'}]],
  ])for(const data of values){
    const state=await load(database({[key]:{data,error:null}}));await failed(await invoke(state));
  }
});

test('signed unsubscribe stops on explicit errors or thrown writes without exposing database details',async()=>{
  for(const key of ['email_suppressions:upsert','guardians:update']){
    for(const result of [{data:null,error:{message:'private detail'}},()=>{throw new Error('private detail');}]){
      const state=await load(database({[key]:result}));await failed(await invoke(state));
      assert.deepEqual(state.logs,['Unsubscribe persistence unavailable']);
    }
  }
});

test('signed unsubscribe null-email guardian uses a null-safe condition and still requires status receipt',async()=>{
  const db=database({'guardians:select':{data:{id:gid,email:null},error:null}});
  const state=await load(db);assert.equal((await invoke(state)).status,200);assert.equal(db.calls.length,2);
  assert.deepEqual(db.calls[1].filters,[['eq','id',gid],['is','email',null]]);
});

test('legacy opt-out remains available with zero guardians and persists normalized address first',async()=>{
  for(const method of ['GET','POST']){
    const db=database({'guardians:update':{data:[],error:null}});const state=await load(db);
    assert.equal((await invoke(state,'?email=Parent%40Example.invalid',method)).status,200);
    assert.equal(db.calls.length,3);assert.equal(db.calls[0].body.email,'parent@example.invalid');
    assert.equal(db.calls[0].body.reason,'unsubscribed');assert.equal(db.calls[2].limit,1);
    assert.ok(db.calls[2].filters.some(x=>x[0]==='or'&&x[1]==='email_status.is.null,email_status.neq.unsubscribed'));
  }
});

test('legacy opt-out rejects every write/read error and unchanged returned statuses',async()=>{
  for(const [key,result] of [
    ['email_suppressions:upsert',{data:null,error:{message:'private detail'}}],
    ['guardians:update',{data:null,error:{message:'private detail'}}],
    ['guardians:update',{data:[{id:gid,email:'parent@example.invalid',email_status:'ok'}],error:null}],
    ['guardians:select',{data:null,error:{message:'private detail'}}],
    ['guardians:select',{data:[{id:gid}],error:null}],
  ]){const state=await load(database({[key]:result}));await failed(await invoke(state,legacy));}
});

test('legacy suppressed update returning zero rows fails when a matching guardian remains opted in',async()=>{
  const state=await load(database({'guardians:update':{data:[],error:null},'guardians:select':{data:[{id:gid}],error:null}}));
  await failed(await invoke(state,legacy));
});

test('opt-out requests are bounded, abort stalled DB calls, and never send email',async()=>{
  for(const query of [signed,legacy]){
    const key=query===signed?'guardians:select':'email_suppressions:upsert';
    const db=database({[key]:()=>new Promise(()=>{})});const state=await load(db);
    await failed(await invoke(state,query));assert.equal(db.calls.length,1);assert.equal(db.calls[0].signal.aborted,true);
  }
});

test('repeated opt-outs are safe, retain both link types, and do not restore consent',async()=>{
  for(const query of [signed,legacy]){
    const state=await load();for(let i=0;i<2;i++)assert.equal((await invoke(state,query)).status,200);
    for(const call of state.db.calls){
      if(call.op==='upsert')assert.equal(call.body.reason,'unsubscribed');
      if(call.op==='update')assert.equal(call.body.email_status,'unsubscribed');
    }
  }
});
