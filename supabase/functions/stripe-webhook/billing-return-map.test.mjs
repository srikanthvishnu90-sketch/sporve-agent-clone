// The money gate: apply_stripe_billing_event RETURNS text and never raises
// ('duplicate','stale','ignored_bad_plan:<plan>','ignored_unknown_status:<s>',
// 'provider_not_found','applied:<plan>/<status>'). This file pins the handler's
// verdict -> HTTP map so no verdict can become a silent 200 again.
// Same vm harness as signature.test.mjs: production index.ts runs with the
// Stripe SDK and database replaced; nothing external is contacted.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const environment = {
  STRIPE_SECRET_KEY:'fixture-only', STRIPE_WEBHOOK_SECRET:'platform-fixture',
  SUPABASE_URL:'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY:'fixture-only',
};
const REJECTED='BILLING_WEBHOOK_REJECTED';
const NOT_FOUND='BILLING_PROVIDER_NOT_FOUND';

// rpc results keyed by function name; a function value may throw.
function database(results={}) {
  const calls=[];
  // The only table read on the billing path is the billing_subscriptions
  // provider fallback (metadata.provider_id absent): model "no row".
  return {calls, from(table){
      calls.push({name:'from:'+table});
      const q={select:()=>q, eq:()=>q, maybeSingle:()=>Promise.resolve({data:null,error:null})};
      return q;
    },
    rpc(name,args){
      calls.push({name,args});
      const r=results[name];
      if(typeof r==='function') return Promise.resolve().then(r);
      return Promise.resolve(r ?? {data:null,error:null});
    }};
}
async function load(db) {
  const source=await readFile(new URL('./index.ts',import.meta.url),'utf8');
  const code=stripTypeScriptTypes(source.replace(/^import\s+[\s\S]*?;\n/gm,''));
  const state={handler:null,logs:[]};
  class Stripe {
    static createFetchHttpClient(){return {};}
    static createSubtleCryptoProvider(){return {};}
    webhooks={constructEventAsync:async(raw)=>JSON.parse(raw)};
    subscriptions={retrieve:async()=>{throw new Error('no Stripe reads in this fixture');}};
    paymentIntents={retrieve:async()=>{throw new Error('no Stripe reads in this fixture');}};
  }
  vm.runInNewContext(code,{
    Stripe, Response, TextEncoder, Uint8Array, crypto:webcrypto, atob, btoa, JSON, Date,
    console:{error:(...args)=>state.logs.push(args.map(String).join(' ')),log(){}},
    createClient:()=>db,
    Deno:{serve:fn=>{state.handler=fn;},env:{get:key=>environment[key]}},
  });
  return state;
}
const subscriptionEvent=(overrides={})=>({
  id:'evt_fixture', type:'customer.subscription.updated', livemode:false, created:1700000000,
  data:{object:{id:'sub_fixture', status:'active', cancel_at_period_end:false,
    current_period_start:1700000000, current_period_end:1702600000,
    metadata:{provider_id:'10000000-0000-4000-8000-000000000001', plan:'pro'},
    items:{data:[{price:{id:'price_fixture', unit_amount:4900, currency:'usd'}}]}, ...overrides}},
});
async function deliver(results, event=subscriptionEvent()) {
  const db=database(results); const state=await load(db);
  const response=await state.handler(new Request('https://fixture.invalid/webhook',{
    method:'POST', headers:{'stripe-signature':'sdk-result-fixture'}, body:JSON.stringify(event)}));
  return {db,state,response,body:await response.json().catch(()=>null)};
}
const deadLetters=db=>db.calls.filter(c=>c.name==='record_webhook_dead_letter');

test('applied:* and duplicate acknowledge 200 with no dead-letter and no alert',async()=>{
  for(const verdict of ['applied:pro/active','applied:keep/past_due','applied:free/canceled','duplicate']){
    const {db,state,response}=await deliver({apply_stripe_billing_event:{data:verdict,error:null}});
    assert.equal(response.status,200,verdict);
    assert.equal(deadLetters(db).length,0,verdict);
    assert.equal(state.logs.some(l=>l.includes(REJECTED)),false,verdict);
  }
});

test('stale acknowledges 200 and is logged, never dead-lettered',async()=>{
  const {db,state,response}=await deliver({apply_stripe_billing_event:{data:'stale',error:null}});
  assert.equal(response.status,200);
  assert.equal(deadLetters(db).length,0);
  assert.ok(state.logs.some(l=>l.includes('stale') && l.includes('evt_fixture')), state.logs.join('|'));
});

for(const verdict of ['ignored_bad_plan:solo','ignored_unknown_status:paused']){
  test(`${verdict} is REJECTED: durable dead-letter row + alert marker, never a silent 200`,async()=>{
    const {db,state,response,body}=await deliver({apply_stripe_billing_event:{data:verdict,error:null}});
    const dl=deadLetters(db);
    assert.equal(dl.length,1,'dead-letter recorded');
    assert.equal(dl[0].args.p_event_id,'evt_fixture');
    assert.equal(dl[0].args.p_event_type,'customer.subscription.updated');
    assert.match(dl[0].args.p_error,new RegExp(`${REJECTED}.*${verdict.replace(/[:]/g,'\\$&')}`));
    assert.ok(state.logs.some(l=>l.includes(REJECTED)&&l.includes(verdict)),'alert logged');
    // Acknowledged so Stripe stops retrying (the ledger already recorded the
    // event; a retry only returns 'duplicate'), but the body says rejected.
    assert.equal(response.status,200);
    assert.equal(body?.rejected,verdict);
  });
}

test('provider_not_found is REJECTED with the loud provider marker',async()=>{
  const {db,state,response,body}=await deliver({apply_stripe_billing_event:{data:'provider_not_found',error:null}});
  const dl=deadLetters(db);
  assert.equal(dl.length,1);
  assert.match(dl[0].args.p_error,new RegExp(`${REJECTED}.*provider_not_found`));
  assert.ok(state.logs.some(l=>l.includes(NOT_FOUND)&&l.includes('evt_fixture')),state.logs.join('|'));
  assert.equal(response.status,200); assert.equal(body?.rejected,'provider_not_found');
});

test('an unrecognized verdict (or no verdict) is REJECTED, never assumed applied',async()=>{
  for(const data of ['applied','ok',true,'',null,undefined,{outcome:'applied'}]){
    const {db,response,body}=await deliver({apply_stripe_billing_event:{data,error:null}});
    assert.equal(deadLetters(db).length,1,JSON.stringify(data));
    assert.equal(response.status,200); assert.equal(typeof body?.rejected,'string');
  }
});

test('a REJECTED verdict whose dead-letter write fails is 500 so nothing is lost silently',async()=>{
  for(const failure of [{data:null,error:{message:'private detail'}},()=>{throw new Error('private detail');}]){
    const {response}=await deliver({apply_stripe_billing_event:{data:'ignored_bad_plan:solo',error:null},
      record_webhook_dead_letter:failure});
    assert.equal(response.status,500);
  }
});

test('an RPC error is still 500 (a thrown exception is never converted into 200)',async()=>{
  const {response}=await deliver({apply_stripe_billing_event:{data:null,error:{message:'private detail'}}});
  assert.equal(response.status,500);
});

test('an unresolvable provider before the RPC is REJECTED the same way, not a bare log',async()=>{
  const {db,state,response,body}=await deliver({}, subscriptionEvent({metadata:{plan:'pro'}}));
  assert.equal(db.calls.filter(c=>c.name==='apply_stripe_billing_event').length,0);
  assert.equal(db.calls.filter(c=>c.name==='from:billing_subscriptions').length,1);
  assert.equal(deadLetters(db).length,1);
  assert.ok(state.logs.some(l=>l.includes(NOT_FOUND)));
  assert.equal(response.status,200); assert.equal(body?.rejected,'provider_unresolvable');
});
