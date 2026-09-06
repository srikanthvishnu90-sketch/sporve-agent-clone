// Executes the real handler with isolated database/provider doubles. These
// tests prove control flow, not live RLS, provider delivery, or receipt atomicity.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {resolveAction, modelForEvent, autoOrFallback, enforceLifecycleDraft} from './policy.ts';
import {withHttpDeadline as deadline, readBoundedJson} from '../_shared/http.ts';
import {enforceMessageDraftGuardrail} from '../message-draft/guardrail.ts';

const source = stripTypeScriptTypes((await readFile(new URL('./index.ts', import.meta.url), 'utf8'))
  .replace(/^import\s+[\s\S]*?;\n/gm, ''));
const message = {id:'message-fixture', provider_id:'org-a', approved_by:'owner-a', attempt_count:0,
  content:{body:'Fixture message', guardian_id:'guardian-a', to_email:'stale@example.invalid'}};
const guardian = {id:'guardian-a', provider_id:'org-a', email:'current@example.invalid', email_status:'ok', user_id:null};
const program={id:'fixture-program',provider_id:'org-a'};
const session={id:'fixture-session',program_id:program.id,programs:program,
  start_date:'2026-09-07',start_time:'10:00',address:'Fixture gym'};
const booking={id:'fixture-booking',session_id:session.id,program_id:program.id,athlete_id:'fixture-child',
  searcher_id:'fixture-parent',status:'completed',sessions:session,programs:program};

async function invoke(options={}) {
  const calls=[], external=[], models=[], deadlines=[];
  const rows=structuredClone(options.rows ?? [message]);
  const pending=structuredClone(options.pending ?? []);
  const database={rpc:async()=>({data:false,error:null}),from(table) {
    const call={table,operation:'select',filters:[],payload:null}; calls.push(call);
    const query={
      select(){return query;},
      update(payload){call.operation='update';call.payload=payload;return query;},
      insert(payload){call.operation='insert';call.payload=payload;return query;},
      eq(key,value){call.filters.push([key,value]);return query;},
      not(...args){call.filters.push(['not',...args]);return query;},
      is(...args){call.filters.push(['is',...args]);return query;},
      in(...args){call.filters.push(['in',...args]);return query;},
      abortSignal(signal){call.signal=signal;return query;},
      or(){return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        const result=options.override?.(call);
        if(result !== undefined) return result;
        let data=null;
        if(table==='outbound_messages') {
          if(call.operation==='update') {
            const row=[...rows,...pending].find(r=>r.id===call.filters.find(f=>f[0]==='id')?.[1]);
            data=row ? {...row,sent_at:null,...call.payload} : null;
          } else data=call.filters.some(f=>f[0]==='status' && f[1]==='pending') ? pending : rows;
        } else if(table==='provider_settings') {
          data=call.filters.some(f=>f[0]==='key' && f[1]==='send_window')
            ? {value:{start:'00:00',end:'23:59'}} : null;
        } else if(table==='guardians') data=guardian;
        else if(table==='providers') data={id:'org-a',business_name:'Fixture Club',owner_id:'owner-a'};
        else if(table==='lifecycle_message_prefs') data={mode:options.mode ?? 'auto'};
        else if(table==='athletes') data={id:'fixture-child',first_name:'Fixture child',parent_id:'fixture-parent'};
        else if(table==='bookings') data=booking;
        else if(table==='sessions') data=session;
        else if(table==='notifications') external.push({kind:'notification',payload:call.payload});
        else if(table!=='email_suppressions') throw new Error(`Unexpected table ${table}`);
        return {data,error:null};
      }).then(resolve,reject);},
    };return query;
  }};
  let handler;
  vm.runInNewContext(source,{
    Response, TextEncoder, Uint8Array, crypto:webcrypto,
    console:{error(){}}, createClient:()=>database,
    resolveAction, modelForEvent, autoOrFallback, enforceLifecycleDraft,
    buildCoachVoiceProfile:options.voiceProfile ?? (async()=>[]),
    readBoundedJson,
    withHttpDeadline:(work,ms)=>{deadlines.push(ms);return deadline(work,options.deadlineMs ?? Math.min(ms,80));},
    deliverPush:async()=>{external.push({kind:'push'});},
    fetch:async(url,init)=>{
      if(url==='https://fixture.invalid/functions/v1/ai-gateway') {
        models.push(JSON.parse(init.body));
        if(options.modelReply) return options.modelReply(init);
        return new Response(JSON.stringify({text:'Fixture draft for human review.',model:'fixture-model'}),{status:200});
      }
      assert.equal(url,'https://api.resend.com/emails');
      external.push({kind:'email',payload:JSON.parse(init.body)});
      return new Response(JSON.stringify({id:'resend-fixture'}),{status:200});
    },
    Deno:{serve:fn=>{handler=fn;},env:{get:key=>({
      SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-service-fixture',
      RESEND_API_KEY:options.noEmailKey ? '' : 'local-email-fixture',
    })[key]}},
  });
  const response=await handler(new Request('https://fixture.invalid/lifecycle',{
    method:'POST',headers:options.unauthorized ? {} : {Authorization:'Bearer local-service-fixture'},
  }));
  return {status:response.status,body:await response.json(),calls,external,models,deadlines};
}

function reviewReceipt(result,reason) {
  assert.equal(result.status,200);
  assert.equal(result.body.needsReview,1);
  assert.equal(result.body.emailed,0);
  assert.deepEqual(result.external,[]);
  const write=result.calls.find(c=>c.payload?.status==='needs_review');
  assert.equal(write?.payload.last_error,reason);
  for(const filter of [['id','message-fixture'],['provider_id','org-a'],['status','approved'],['approved_by','owner-a'],
    ['not','approved_by','is',null],['is','sent_at',null]]) {
    assert.ok(write.filters.some(f=>JSON.stringify(f)===JSON.stringify(filter)),JSON.stringify(filter));
  }
  assert.equal(result.calls.filter(c=>c.payload?.status==='processing').length,0);
}

test('unauthorized invocation cannot read the queue or deliver',async()=>{
  const r=await invoke({unauthorized:true});assert.equal(r.status,403);
  assert.deepEqual(r.calls,[]);assert.deepEqual(r.external,[]);
});
test('approved queue read failure is an honest503, not an empty successful tick',async()=>{
  const r=await invoke({override:c=>c.table==='outbound_messages' ? {data:null,error:{message:'fixture outage'}}:undefined});
  assert.equal(r.status,503);assert.deepEqual(r.external,[]);
});
for(const key of ['send_window','org_tz']) test(`${key} read outage prevents delivery with a review receipt`,async()=>{
  reviewReceipt(await invoke({override:c=>c.table==='provider_settings' && c.filters.some(f=>f[0]==='key'&&f[1]===key)
    ? {data:null,error:{message:'fixture outage'}}:undefined}),'delivery_settings_unavailable');
});
for(const [name,value] of [
  ['lookup error',{data:null,error:{message:'fixture outage'}}],['deleted guardian',{data:null,error:null}],
  ['wrong organization',{data:{...guardian,provider_id:'org-b'},error:null}],
  ['wrong guardian',{data:{...guardian,id:'guardian-b'},error:null}],
]) test(`${name} never falls back to the cached draft recipient`,async()=>{
  const r=await invoke({override:c=>c.table==='guardians'?value:undefined});
  reviewReceipt(r,'guardian_recipient_unavailable');
  assert.ok(r.calls.find(c=>c.table==='guardians').filters.some(f=>f[0]==='provider_id'&&f[1]==='org-a'));
});
for(const status of [null,'bounced','unsubscribed']) test(`guardian status ${status} blocks email`,async()=>{
  reviewReceipt(await invoke({override:c=>c.table==='guardians'?{data:{...guardian,email_status:status},error:null}:undefined}),
    'guardian_email_not_deliverable');
});
test('missing current guardian address never uses the stale draft address',async()=>{
  reviewReceipt(await invoke({override:c=>c.table==='guardians'?{data:{...guardian,email:null},error:null}:undefined}),
    'recipient_email_invalid');
});
for(const [table,reason] of [['provider_settings','delivery_settings_unavailable'],
  ['guardians','guardian_recipient_unavailable'],['email_suppressions','email_suppression_unavailable']]) {
  test(`${table} rejected read also fails closed with checked review receipt`,async()=>{
    reviewReceipt(await invoke({override:c=>{if(c.table===table) throw new Error('fixture transport rejected');}}),reason);
  });
}
test('missing email configuration produces a visible checked review receipt',async()=>{
  reviewReceipt(await invoke({noEmailKey:true}),'email_provider_not_configured');
});
for(const [name,value,reason] of [
  ['suppression outage',{data:null,error:{message:'fixture outage'}},'email_suppression_unavailable'],
  ['suppressed recipient',{data:{reason:'complaint'},error:null},'recipient_email_suppressed'],
]) test(`${name} cannot send`,async()=>{
  reviewReceipt(await invoke({override:c=>c.table==='email_suppressions'?value:undefined}),reason);
});
for(const [name,result] of [
  ['database error',{data:null,error:{message:'fixture outage'}}],
  ['silent no-op',{data:null,error:null}],
  ['wrong receipt',{data:{id:'message-fixture',status:'approved',last_error:'wrong'},error:null}],
]) test(`review receipt ${name} returns503 with zero external delivery`,async()=>{
  const r=await invoke({noEmailKey:true,override:c=>c.payload?.status==='needs_review'?result:undefined});
  assert.equal(r.status,503);assert.deepEqual(r.external,[]);assert.equal(r.body.needsReview,0);
});
for(const patch of [{provider_id:'org-b'},{approved_by:null},{approved_by:'different-owner'},
  {sent_at:'2026-09-05T12:00:00.000Z'}]) test(`review receipt identity mismatch ${JSON.stringify(patch)} returns503`,async()=>{
  const r=await invoke({noEmailKey:true,override:c=>c.payload?.status==='needs_review'
    ? {data:{...message,sent_at:null,...c.payload,...patch},error:null}:undefined});
  assert.equal(r.status,503);assert.deepEqual(r.external,[]);assert.equal(r.body.needsReview,0);
});
test('successful approved email uses current guardian address, preserving delivery',async()=>{
  const r=await invoke();assert.equal(r.status,200);assert.equal(r.body.emailed,1);
  assert.equal(r.external.length,1);assert.equal(r.external[0].kind,'email');
  assert.deepEqual(r.external[0].payload.to,['current@example.invalid']);
  assert.ok(r.calls.find(c=>c.table==='email_suppressions').filters.some(f=>f[0]==='email'&&f[1]==='current@example.invalid'));
});
test('claimed guardian keeps the in-app path when email is unavailable',async()=>{
  const r=await invoke({noEmailKey:true,override:c=>c.table==='guardians'
    ? {data:{...guardian,user_id:'claimed-user',email:null,email_status:'unsubscribed'},error:null}:undefined});
  assert.equal(r.status,200);assert.equal(r.body.inApp,1);
  assert.deepEqual(r.external.map(e=>e.kind),['notification','push']);
});
test('existing direct-email approved drafts still pass through suppression checks',async()=>{
  const r=await invoke({rows:[{...message,content:{body:'Fixture message',to_email:'direct@example.invalid'}}]});
  assert.equal(r.status,200);assert.equal(r.body.emailed,1);
  assert.deepEqual(r.external[0].payload.to,['direct@example.invalid']);
  assert.ok(r.calls.find(c=>c.table==='email_suppressions').filters.some(f=>f[0]==='email'&&f[1]==='direct@example.invalid'));
});
test('invalid approved content becomes visible review rather than an endless silent skip',async()=>{
  reviewReceipt(await invoke({rows:[{...message,content:{...message.content,body:' '}}]}),'delivery_content_invalid');
});

const pendingMessage={id:'pending-fixture',provider_id:'org-a',approved_by:null,approved_at:null,sent_at:null,
  status:'pending',event_type:'booking_confirmed',child_id:'fixture-child',booking_id:'fixture-booking',
  content:{guardian_id:'guardian-a',subject:'Fixture subject'}};
test('legacy auto logistics stages a human-review draft, never approves or delivers',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage]});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);assert.equal(r.body.autoSent,0);
  assert.deepEqual(r.external,[]);assert.deepEqual(r.models,[]);
  const draft=r.calls.find(c=>c.payload?.status==='drafted');
  assert.equal(draft.payload.content.auto,false);assert.equal(draft.payload.content.template,true);
  assert.equal(draft.payload.content.guardian_id,'guardian-a');
  assert.equal(draft.payload.content.subject,'Fixture subject');
  assert.match(draft.payload.content.body,/2026-09-07/);
  for(const filter of [['id','pending-fixture'],['provider_id','org-a'],['status','processing'],
    ['is','approved_by',null],['is','approved_at',null],['is','sent_at',null]]) {
    assert.ok(draft.filters.some(f=>JSON.stringify(f)===JSON.stringify(filter)));
  }
  for(const query of r.calls.filter(c=>c.table==='outbound_messages' &&
    (c.payload?.status==='processing' || c.filters.some(f=>f[0]==='status'&&f[1]==='pending')))) {
    assert.ok(query.filters.some(f=>JSON.stringify(f)===JSON.stringify(['is','approved_at',null])));
  }
  for(const call of r.calls.filter(c=>c.payload)) {
    for(const field of ['approved_by','approved_at','sent_at']) assert.equal(Object.hasOwn(call.payload,field),false);
    assert.notEqual(call.payload.status,'sent');assert.notEqual(call.payload.status,'approved');
  }
});
for(const mode of ['draft','auto']) test(`${mode} non-logistics keeps model drafting without external delivery`,async()=>{
  const r=await invoke({rows:[],mode,pending:[{...pendingMessage,event_type:'rebook_nudge'}]});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);assert.equal(r.models.length,1);
  assert.deepEqual(r.external,[]);
  assert.equal(r.calls.find(c=>c.payload?.status==='drafted').payload.content.guardian_id,'guardian-a');
});
test('off lifecycle preference produces neither a draft nor a send',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'off'});
  assert.equal(r.status,200);assert.equal(r.body.skipped,1);assert.equal(r.body.drafted,0);
  assert.deepEqual(r.external,[]);assert.deepEqual(r.models,[]);
});
for(const result of [{data:null,error:null},{data:null,error:{message:'fixture write failed'}},
  {data:{...pendingMessage,status:'drafted',content:{body:'wrong',auto:false}},error:null}]) {
  test(`draft receipt failure is loud with no send: ${JSON.stringify(result)}`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.payload?.status==='drafted'?result:undefined});
    assert.equal(r.status,500);assert.deepEqual(r.external,[]);assert.notEqual(r.body.ok,true);
  });
}
for(const patch of [{provider_id:'org-b'},{status:'pending'},{approved_by:'owner-a'},
  {approved_at:'2026-09-05T12:00:00Z'},{sent_at:'2026-09-05T12:00:00Z'}]) {
  test(`draft claim rejects inconsistent identity/state receipt ${JSON.stringify(patch)}`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.payload?.status==='processing'
      ? {data:{...pendingMessage,status:'processing',...patch},error:null}:undefined});
    assert.equal(r.status,503);assert.deepEqual(r.external,[]);assert.deepEqual(r.models,[]);
    assert.equal(r.calls.some(c=>c.payload?.status==='drafted'),false);
  });
}
for(const field of ['guardian_id','subject','body','auto','template']) {
  test(`draft receipt rejects modified ${field}`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.payload?.status==='drafted'
      ? {data:{...pendingMessage,...c.payload,content:{...c.payload.content,[field]:'changed'}},error:null}:undefined});
    assert.equal(r.status,500);assert.deepEqual(r.external,[]);
  });
}
test('draft receipt accepts reordered JSON keys but not stale approval evidence',async()=>{
  const valid=await invoke({rows:[],pending:[pendingMessage],override:c=>c.payload?.status==='drafted'
    ? {data:{...pendingMessage,...c.payload,content:Object.fromEntries(Object.entries(c.payload.content).reverse())},error:null}:undefined});
  assert.equal(valid.status,200);assert.equal(valid.body.drafted,1);
  const stale=await invoke({rows:[],pending:[pendingMessage],override:c=>c.payload?.status==='drafted'
    ? {data:{...pendingMessage,...c.payload,approved_at:'2026-09-05T12:00:00Z'},error:null}:undefined});
  assert.equal(stale.status,500);assert.deepEqual(stale.external,[]);
});

for(const [name,result] of [['database error',{data:null,error:{message:'private fixture diagnostic'}}],
  ['malformed mode',{data:{mode:'send-everything'},error:null}],['missing mode',{data:{},error:null}]]) {
  test(`preference ${name} fails before claiming or model generation`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.table==='lifecycle_message_prefs'?result:undefined});
    assert.equal(r.status,503);assert.deepEqual(r.external,[]);assert.deepEqual(r.models,[]);
    assert.equal(r.calls.some(c=>c.operation==='update'),false);
    assert.equal(JSON.stringify(r.body).includes('private fixture'),false);
  });
}
test('rejected preference transport leaves the pending row unclaimed',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],override:c=>{
    if(c.table==='lifecycle_message_prefs') throw new Error('private fixture transport');
  }});
  assert.equal(r.status,503);assert.equal(r.calls.some(c=>c.operation==='update'),false);
  assert.deepEqual(r.models,[]);assert.deepEqual(r.external,[]);
});
test('confirmed absent preference row retains the documented draft default',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.table==='lifecycle_message_prefs'
    ? {data:null,error:null}:undefined});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);assert.equal(r.models.length,1);
  assert.deepEqual(r.external,[]);
});
function generationTransition(r,status,reason) {
  const write=r.calls.find(c=>c.payload?.status===status);
  assert.equal(write?.payload.last_error,reason);
  for(const filter of [['id','pending-fixture'],['provider_id','org-a'],['status','processing'],
    ['is','approved_by',null],['is','approved_at',null],['is','sent_at',null]]) {
    assert.ok(write.filters.some(f=>JSON.stringify(f)===JSON.stringify(filter)),JSON.stringify(filter));
  }
  assert.deepEqual(r.external,[]);
}
test('off skip has an exact guarded receipt and records why',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'off'});
  assert.equal(r.status,200);assert.equal(r.body.skipped,1);
  generationTransition(r,'skipped','lifecycle_mode_off');
});
for(const [name,modelReply,reason] of [
  ['HTTP failure',()=>new Response(JSON.stringify({error:'private model diagnostic'}),{status:503}),'draft_generation_unavailable'],
  ['transport rejection',()=>{throw new Error('private model diagnostic');},'draft_generation_unavailable'],
  ['invalid JSON',()=>new Response('{invalid',{status:200}),'draft_generation_unavailable'],
  ['missing text',()=>new Response('{}',{status:200}),'draft_generation_unavailable'],
  ['empty text',()=>new Response(JSON.stringify({text:' '}),{status:200}),'draft_generation_empty'],
  ['unsafe-only text',()=>new Response(JSON.stringify({text:'I am certified.'}),{status:200}),'draft_generation_empty'],
]) test(`generation ${name} requeues only with verified receipt and no delivery`,async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'draft',modelReply});
  assert.equal(r.status,200);assert.equal(r.body.failed,1);assert.equal(r.body.drafted,0);
  generationTransition(r,'pending',reason);
  assert.equal(JSON.stringify(r.calls).includes('private model diagnostic'),false);
});
for(const status of ['skipped','pending']) {
  for(const [name,result] of [['no-op',{data:null,error:null}],['error',{data:null,error:{message:'private fixture diagnostic'}}],
    ['wrong receipt',{data:{...pendingMessage,status,provider_id:'org-b',last_error:'wrong'},error:null}]]) {
    test(`${status} transition ${name} cannot report success`,async()=>{
      const r=await invoke({rows:[],pending:[pendingMessage],mode:status==='skipped'?'off':'draft',
        modelReply:()=>new Response('{}',{status:503}),override:c=>c.payload?.status===status?result:undefined});
      assert.equal(r.status,500);assert.notEqual(r.body.ok,true);assert.deepEqual(r.external,[]);
      assert.equal(JSON.stringify(r.body).includes('private fixture'),false);
    });
  }
}
test('draft success clears a previous generation error and verifies that clearing',async()=>{
  const prior={...pendingMessage,last_error:'draft_generation_empty'};
  const r=await invoke({rows:[],pending:[prior]});
  assert.equal(r.status,200);assert.equal(r.calls.find(c=>c.payload?.status==='drafted').payload.last_error,null);
  const stale=await invoke({rows:[],pending:[prior],override:c=>c.payload?.status==='drafted'
    ? {data:{...prior,...c.payload,last_error:prior.last_error},error:null}:undefined});
  assert.equal(stale.status,500);assert.deepEqual(stale.external,[]);
});
for(const table of ['providers','athletes','bookings','sessions']) {
  for(const failure of ['error','missing','rejected']) test(`${table} ${failure} releases generation claim with a checked receipt`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],override:c=>{
      if(c.table!==table) return;
      if(failure==='rejected') throw new Error('private context diagnostic');
      return {data:null,error:failure==='error'?{message:'private context diagnostic'}:null};
    }});
    assert.equal(r.status,200);assert.equal(r.body.failed,1);assert.equal(r.body.drafted,0);
    assert.deepEqual(r.models,[]);generationTransition(r,'pending','draft_context_unavailable');
    assert.equal(JSON.stringify(r.calls).includes('private context diagnostic'),false);
  });
}
test('failed context recovery receipt is loud instead of claiming the row was requeued',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],override:c=>{
    if(c.table==='providers') return {data:null,error:{message:'fixture outage'}};
    if(c.payload?.status==='pending') return {data:null,error:null};
  }});
  assert.equal(r.status,500);assert.notEqual(r.body.ok,true);
  assert.deepEqual(r.external,[]);assert.deepEqual(r.models,[]);
});
function blockedContext(r) {
  assert.equal(r.status,200);assert.equal(r.body.failed,1);assert.equal(r.body.drafted,0);
  assert.deepEqual(r.models,[]);generationTransition(r,'pending','draft_context_unavailable');
}
for(const [name,patch] of [
  ['wrong booking id',{id:'other-booking'}],['other org session',{sessions:{...session,programs:{...program,provider_id:'org-b'}}}],
  ['wrong session link',{session_id:'other-session'}],['conflicting program',{program_id:'other-program'}],
  ['wrong child',{athlete_id:'other-child'}],['missing purchaser',{searcher_id:null}],
]) test(`${name} is rejected before child details or model access`,async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.table==='bookings'
    ? {data:{...booking,...patch},error:null}:undefined});
  blockedContext(r);assert.equal(r.calls.some(c=>c.table==='athletes'),false);
});
for(const [name,patch] of [['wrong id',{id:'other-session'}],['wrong program',{program_id:'other-program'}],
  ['wrong owner',{programs:{...program,provider_id:'org-b'}}]]) test(`session ${name} blocks child/model access`,async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.table==='sessions'
    ? {data:{...session,...patch},error:null}:undefined});
  blockedContext(r);assert.equal(r.calls.some(c=>c.table==='athletes'),false);
});
for(const patch of [{id:'other-child'},{parent_id:'other-family'}]) test(`child/family mismatch ${JSON.stringify(patch)} cannot draft`,async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.table==='athletes'
    ? {data:{id:'fixture-child',parent_id:'fixture-parent',first_name:'Other private child',...patch},error:null}:undefined});
  blockedContext(r);
});
test('same-org booking proof scopes all data reads and preserves a valid logistics draft',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage]});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);
  for(const [table,filter] of [['bookings',['sessions.programs.provider_id','org-a']],
    ['sessions',['programs.provider_id','org-a']],['sessions',['program_id','fixture-program']],
    ['athletes',['parent_id','fixture-parent']]]) {
    assert.ok(r.calls.find(c=>c.table===table).filters.some(f=>JSON.stringify(f)===JSON.stringify(filter)));
  }
  assert.ok(r.calls.findIndex(c=>c.table==='bookings')<r.calls.findIndex(c=>c.table==='athletes'));
});
test('legacy null booking.program_id retains ownership through session.program',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.table==='bookings'
    ? {data:{...booking,program_id:null},error:null}:undefined});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);assert.deepEqual(r.external,[]);
});
test('booking-less rebook nudge keeps working through completed same-org history',async()=>{
  const r=await invoke({rows:[],pending:[{...pendingMessage,booking_id:null,event_type:'rebook_nudge'}]});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);assert.equal(r.models.length,1);
  const query=r.calls.find(c=>c.table==='bookings');
  for(const filter of [['athlete_id','fixture-child'],['status','completed'],['programs.provider_id','org-a']]) {
    assert.ok(query.filters.some(f=>JSON.stringify(f)===JSON.stringify(filter)));
  }
  assert.equal(r.calls.some(c=>c.table==='sessions'),false);
});
for(const [name,data] of [['absent',null],['other org',{...booking,programs:{...program,provider_id:'org-b'}}],
  ['other child',{...booking,athlete_id:'other-child'}],['not completed',{...booking,status:'pending'}]]) {
  test(`rebook history ${name} blocks child/model access`,async()=>{
    const r=await invoke({rows:[],pending:[{...pendingMessage,booking_id:null,event_type:'rebook_nudge'}],
      override:c=>c.table==='bookings'?{data,error:null}:undefined});
    blockedContext(r);assert.equal(r.calls.some(c=>c.table==='athletes'),false);
  });
}
test('organization-only draft does not invent or read a child relationship',async()=>{
  const r=await invoke({rows:[],pending:[{...pendingMessage,booking_id:null,child_id:null,event_type:'dues_reminder'}]});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);
  assert.equal(r.calls.some(c=>['athletes','bookings','sessions'].includes(c.table)),false);
});
test('missing outbound child cannot borrow a booking with an identified child',async()=>{
  const r=await invoke({rows:[],pending:[{...pendingMessage,child_id:null}]});
  blockedContext(r);assert.equal(r.calls.some(c=>c.table==='athletes'),false);
});
test('legacy name-only booking remains usable when both child identities are null',async()=>{
  const r=await invoke({rows:[],pending:[{...pendingMessage,child_id:null}],override:c=>c.table==='bookings'
    ? {data:{...booking,athlete_id:null,athlete_first_name:'Fixture name only'},error:null}:undefined});
  assert.equal(r.status,200);assert.equal(r.body.drafted,1);
  assert.equal(r.calls.some(c=>c.table==='athletes'),false);assert.deepEqual(r.external,[]);
});
test('non-rebook child-only row cannot use completed history to invent missing booking context',async()=>{
  const r=await invoke({rows:[],pending:[{...pendingMessage,booking_id:null}]});
  blockedContext(r);assert.equal(r.calls.some(c=>['athletes','bookings','sessions'].includes(c.table)),false);
});
for(const sessions of [null,[],[session],{...session,programs:[]},{...session,programs:{provider_id:'org-a'}}]) {
  test(`malformed nested booking relationship ${JSON.stringify(sessions)} cannot reach child/model`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],override:c=>c.table==='bookings'
      ? {data:{...booking,sessions},error:null}:undefined});
    blockedContext(r);assert.equal(r.calls.some(c=>c.table==='athletes'),false);
  });
}
for(const table of ['lifecycle_message_prefs','providers','bookings','sessions','athletes']) {
  test(`stalled ${table} read is bounded and cancels its signal`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],deadlineMs:15,
      override:c=>c.table===table?new Promise(()=>{}):undefined});
    assert.equal(r.status,table==='lifecycle_message_prefs'?503:200);
    assert.equal(r.calls.find(c=>c.table===table).signal.aborted,true);
    assert.deepEqual(r.models,[]);assert.deepEqual(r.external,[]);
    if(table!=='lifecycle_message_prefs') generationTransition(r,'pending','draft_context_unavailable');
  });
}
test('stalled pending queue read times out after the approved queue completes',async()=>{
  const r=await invoke({rows:[],deadlineMs:15,override:c=>c.table==='outbound_messages'&&c.operation==='select'&&
    c.filters.some(f=>f[0]==='status'&&f[1]==='pending')?new Promise(()=>{}):undefined});
  assert.equal(r.status,500);assert.notEqual(r.body.ok,true);
  const pending=r.calls.find(c=>c.table==='outbound_messages'&&c.filters.some(f=>f[0]==='status'&&f[1]==='pending'));
  assert.equal(pending.signal.aborted,true);
  assert.equal(r.calls.some(c=>c.operation==='update'),false);
  assert.deepEqual(r.models,[]);assert.deepEqual(r.external,[]);
});
for(const status of ['processing','drafted','skipped','pending']) {
  test(`stalled ${status} write fails loudly without assuming rollback`,async()=>{
    const r=await invoke({rows:[],pending:[pendingMessage],deadlineMs:15,
      mode:status==='skipped'?'off':status==='pending'?'draft':'auto',
      modelReply:()=>new Response('{}',{status:503}),
      override:c=>c.payload?.status===status?new Promise(()=>{}):undefined});
    assert.equal(r.status,500);assert.notEqual(r.body.ok,true);assert.deepEqual(r.external,[]);
    assert.equal(r.calls.find(c=>c.payload?.status===status).signal.aborted,true);
    if(['processing','drafted'].includes(status)) assert.equal(r.calls.some(c=>c.payload?.status==='pending'),false);
  });
}
test('model transport timeout aborts and uses a verified retry receipt',async()=>{
  let signal;
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'draft',deadlineMs:15,
    modelReply:init=>{signal=init.signal;assert.equal(init.redirect,'error');return new Promise(()=>{});}});
  assert.equal(r.status,200);assert.equal(r.body.failed,1);assert.equal(signal.aborted,true);
  generationTransition(r,'pending','draft_generation_unavailable');
  assert.ok(r.deadlines.includes(8_000));assert.ok(r.deadlines.includes(20_000));
});
test('stalled model body is cancelled within the generation deadline',async()=>{
  let cancelled=false;
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'draft',deadlineMs:15,
    modelReply:()=>new Response(new ReadableStream({start(){},cancel(){cancelled=true;}}))});
  assert.equal(r.status,200);assert.equal(r.body.failed,1);assert.equal(cancelled,true);
  generationTransition(r,'pending','draft_generation_unavailable');
});
test('oversized UTF-8 model response never becomes a successful draft',async()=>{
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'draft',
    modelReply:()=>new Response(JSON.stringify({text:'é'.repeat(33_000)}))});
  assert.equal(r.status,200);assert.equal(r.body.drafted,0);
  generationTransition(r,'pending','draft_generation_unavailable');
});
test('late voice result cannot start a model request after timeout',async()=>{
  let release,signal;
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'draft',deadlineMs:15,
    voiceProfile:(_admin,_provider,s)=>{signal=s;return new Promise(resolve=>{release=resolve;});}});
  assert.equal(r.status,200);assert.equal(r.body.failed,1);assert.equal(signal.aborted,true);
  release(['late fixture sample']);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(r.models,[]);assert.equal(r.calls.some(c=>c.payload?.status==='drafted'),false);
});
test('late provider result cannot continue context reads after timeout',async()=>{
  let release;
  const r=await invoke({rows:[],pending:[pendingMessage],deadlineMs:15,
    override:c=>c.table==='providers'?new Promise(resolve=>{release=resolve;}):undefined});
  assert.equal(r.status,200);assert.equal(r.body.failed,1);
  release({data:{id:'org-a',owner_id:'owner-a'},error:null});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.calls.some(c=>['athletes','bookings','sessions'].includes(c.table)),false);
  assert.deepEqual(r.models,[]);
});
test('late model response cannot store a draft after the claim was requeued',async()=>{
  let release;
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'draft',deadlineMs:15,
    modelReply:()=>new Promise(resolve=>{release=resolve;})});
  assert.equal(r.status,200);assert.equal(r.body.failed,1);
  release(new Response(JSON.stringify({text:'late fixture draft'})));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.calls.some(c=>c.payload?.status==='drafted'),false);assert.deepEqual(r.external,[]);
});

// Exercise the shared helper itself too, not only the injected handler stub.
const voiceSource=stripTypeScriptTypes((await readFile(new URL('../_shared/coach_voice.ts',import.meta.url),'utf8'))
  .replace(/^import\s+[\s\S]*?;\n/gm,'').replace('export async function buildCoachVoiceProfile','async function buildCoachVoiceProfile'));
const voiceFamily={childId:'fixture-child',guardianUserId:'fixture-parent'};
const voiceUpdate={id:'update-a',provider_id:'org-a',child_id:'fixture-child',athletes:{id:'fixture-child',parent_id:'fixture-parent'},approved_by:'owner-a',approved_at:'2026-09-02T00:00:00Z',
  status:'approved',summary_body:'Fixture parent update.',created_at:'2026-09-02'};
const voiceMessage={id:'message-a',sender_id:'owner-a',conversation_id:'conversation-a',body:'Fixture coach message.',created_at:'2026-09-01',
  conversations:{id:'conversation-a',provider_id:'owner-a',searcher_id:'fixture-parent',program_id:'program-a',programs:{id:'program-a',provider_id:'org-a'}}};
function voiceFixture(hangTable,results={}) {
  const calls=[];let release;
  const admin={from(table){
    const call={table,filters:[],signal:null};calls.push(call);
    const q={select(fields){call.select=fields;return q;},eq(...f){call.filters.push(f);return q;},in(...f){call.filters.push(['in',...f]);return q;},not(...f){call.filters.push(['not',...f]);return q;},
      order(){return q;},limit(){return q;},maybeSingle(){return q;},abortSignal(s){call.signal=s;return q;},
      then(resolve,reject){
        const data=table==='providers'?{id:'org-a',owner_id:'owner-a'}:table==='parent_updates'?[voiceUpdate]:[voiceMessage];
        const result=Object.hasOwn(results,table)?results[table]:{data,error:null};
        return (table===hangTable?new Promise(r=>{release=()=>r(result);}):Promise.resolve().then(()=>typeof result==='function'?result(call):result)).then(resolve,reject);
      }};return q;
  }};
  const context={AbortController};vm.runInNewContext(voiceSource+'\nglobalThis.voice=buildCoachVoiceProfile;',context);
  // Most cases exercise a verified target; unscopedVoice exposes the exact
  // production call for legacy callers with no verified recipient identity.
  return {calls,admin,voice:(a,p,s)=>context.voice(a,p,s,voiceFamily),unscopedVoice:context.voice,release:()=>release()};
}
test('voice helper preserves verified-target samples and provider/author filters',async()=>{
  const f=voiceFixture();const samples=await f.voice(f.admin,'org-a');
  assert.deepEqual(Array.from(samples),['Fixture parent update.','Fixture coach message.']);
  assert.ok(f.calls.find(c=>c.table==='parent_updates').filters.some(v=>v[0]==='provider_id'&&v[1]==='org-a'));
  assert.ok(f.calls.find(c=>c.table==='messages').filters.some(v=>v[0]==='sender_id'&&v[1]==='owner-a'));
});
for(const table of ['providers','parent_updates','messages']) test(`voice abort during ${table} does not continue best-effort reads`,async()=>{
  const f=voiceFixture(table),controller=new AbortController();
  const pending=f.voice(f.admin,'org-a',controller.signal);
  await new Promise(resolve=>setImmediate(resolve));
  controller.abort();f.release();
  await assert.rejects(pending);
  assert.equal(f.calls.at(-1).table,table);
  assert.equal(f.calls.at(-1).signal,controller.signal);
});
test('already-aborted voice request performs no database reads',async()=>{
  const f=voiceFixture(),controller=new AbortController();controller.abort();
  await assert.rejects(f.voice(f.admin,'org-a',controller.signal));assert.deepEqual(f.calls,[]);
});
test('one owner across two orgs never mixes message or parent-update tone samples',async()=>{
  const bUpdate={...voiceUpdate,id:'update-b',provider_id:'org-b',summary_body:'Other organization private update.'};
  const bMessage={...voiceMessage,id:'message-b',body:'Other organization private message.',conversation_id:'conversation-b',
    conversations:{id:'conversation-b',provider_id:'owner-a',searcher_id:'fixture-parent',program_id:'program-b',programs:{id:'program-b',provider_id:'org-b'}}};
  const f=voiceFixture(undefined,{parent_updates:{data:[voiceUpdate,bUpdate],error:null},messages:{data:[voiceMessage,bMessage],error:null}});
  assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),['Fixture parent update.','Fixture coach message.']);
  const messages=f.calls.find(c=>c.table==='messages');
  for(const filter of [['sender_id','owner-a'],['conversations.provider_id','owner-a'],['conversations.programs.provider_id','org-a']]) {
    assert.ok(messages.filters.some(v=>JSON.stringify(v)===JSON.stringify(filter)));
  }
  assert.match(messages.select,/conversations!inner/);assert.match(messages.select,/programs!inner/);
});
for(const [name,patch] of [['wrong sender',{sender_id:'other-owner'}],['wrong conversation',{conversation_id:'other-conversation'}],
  ['unlinked conversation',{conversations:{...voiceMessage.conversations,program_id:null,programs:null}}],
  ['wrong conversation owner',{conversations:{...voiceMessage.conversations,provider_id:'other-owner'}}],
  ['wrong program identity',{conversations:{...voiceMessage.conversations,program_id:'other-program'}}],
  ['malformed relationship',{conversations:[]}],['non-text body',{body:{private:'fixture'}}]]) {
  test(`voice message ${name} is not sampled`,async()=>{
    const f=voiceFixture(undefined,{parent_updates:{data:[],error:null},messages:{data:[{...voiceMessage,...patch}],error:null}});
    assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),[]);
  });
}
for(const [name,patch] of [['wrong org',{provider_id:'org-b'}],['other approver',{approved_by:'other-owner'}],
  ['no approver',{approved_by:null}],['no approval time',{approved_at:null}],['invalid approval time',{approved_at:'invalid'}],
  ['draft status',{status:'draft'}],['non-text summary',{summary_body:{private:'fixture'}}]]) {
  test(`voice parent update ${name} is not sampled`,async()=>{
    const f=voiceFixture(undefined,{messages:{data:[],error:null},parent_updates:{data:[{...voiceUpdate,...patch}],error:null}});
    assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),[]);
    const q=f.calls.find(c=>c.table==='parent_updates');
    assert.ok(q.filters.some(v=>v[0]==='approved_by'&&v[1]==='owner-a'));
    assert.ok(q.filters.some(v=>JSON.stringify(v)===JSON.stringify(['not','approved_at','is',null])));
  });
}
for(const [name,result] of [['missing',{data:null,error:null}],['wrong org',{data:{id:'org-b',owner_id:'owner-a'},error:null}],
  ['error with data',{data:{id:'org-a',owner_id:'owner-a'},error:{message:'fixture outage'}}],
  ['missing owner',{data:{id:'org-a',owner_id:null},error:null}],['rejected',()=>{throw new Error('fixture outage');}]]) {
  test(`unverified voice provider ${name} stops before reading text sources`,async()=>{
    const f=voiceFixture(undefined,{providers:result});
    assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),[]);assert.equal(f.calls.length,1);
  });
}
for(const table of ['parent_updates','messages']) test(`voice ${table} error discards returned text but keeps the other verified source`,async()=>{
  const f=voiceFixture(undefined,{[table]:{data:table==='parent_updates'?[voiceUpdate]:[voiceMessage],error:{message:'fixture outage'}}});
  assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),table==='parent_updates'?['Fixture coach message.']:['Fixture parent update.']);
});
test('verified voice samples still deduplicate, sort and cap at three',async()=>{
  const updates=[voiceUpdate,{...voiceUpdate,id:'update-c',summary_body:'Second fixture update.',created_at:'2026-09-03'},
    {...voiceUpdate,id:'update-d',summary_body:'Third fixture update.',created_at:'2026-09-04'}];
  const f=voiceFixture(undefined,{parent_updates:{data:updates,error:null},messages:{data:[{...voiceMessage,body:voiceUpdate.summary_body}],error:null}});
  assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),['Third fixture update.','Second fixture update.','Fixture parent update.']);
});
test('unknown recipient preserves drafting compatibility without reading raw historical samples',async()=>{
  const f=voiceFixture();assert.deepEqual(Array.from(await f.unscopedVoice(f.admin,'org-a')),[]);
  assert.deepEqual(f.calls,[]);
});
test('same organization different family cannot supply historical tone samples',async()=>{
  const f=voiceFixture(undefined,{parent_updates:{data:[{...voiceUpdate,child_id:'other-child',athletes:{id:'other-child',parent_id:'other-parent'}}],error:null},
    messages:{data:[{...voiceMessage,conversations:{...voiceMessage.conversations,searcher_id:'other-parent'}}],error:null}});
  assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),[]);
  assert.ok(f.calls.find(c=>c.table==='messages').filters.some(v=>v[0]==='conversations.searcher_id'&&v[1]==='fixture-parent'));
  const updates=f.calls.find(c=>c.table==='parent_updates');
  assert.ok(updates.filters.some(v=>v[0]==='child_id'&&v[1]==='fixture-child'));
  assert.ok(updates.filters.some(v=>v[0]==='athletes.parent_id'&&v[1]==='fixture-parent'));
});
test('borrowed child approval with mismatched guardian cannot supply a tone sample',async()=>{
  const f=voiceFixture(undefined,{parent_updates:{data:[{...voiceUpdate,athletes:{id:'fixture-child',parent_id:'other-parent'}}],error:null},messages:{data:[],error:null}});
  assert.deepEqual(Array.from(await f.voice(f.admin,'org-a')),[]);
});
test('lifecycle passes only its verified child/guardian pair to voice retrieval',async()=>{
  let target;
  const r=await invoke({rows:[],pending:[pendingMessage],mode:'draft',voiceProfile:async(_a,_p,_s,t)=>{target=t;return [];}});
  assert.equal(r.status,200);assert.deepEqual(JSON.parse(JSON.stringify(target)),voiceFamily);
  let orgTarget='unset';
  const org=await invoke({rows:[],pending:[{...pendingMessage,child_id:null,booking_id:null,event_type:'dues_reminder'}],
    voiceProfile:async(_a,_p,_s,t)=>{orgTarget=t;return [];}});
  assert.equal(org.status,200);assert.equal(orgTarget,undefined);assert.equal(org.body.drafted,1);
});
test('real message-draft remains functional without importing historical family data',async()=>{
  const code=stripTypeScriptTypes((await readFile(new URL('../message-draft/index.ts',import.meta.url),'utf8'))
    .replace(/^import\s+[\s\S]*?;\n/gm,''));
  const calls=[],modelRequests=[];let handler;
  const admin={from(table){
    calls.push(table);assert.equal(table,'providers','no historical text lookup without a verified recipient');
    const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{id:'org-a'},error:null})};return q;
  }};
  vm.runInNewContext(code,{
    Response,console:{error(){}},enforceMessageDraftGuardrail,
    buildCoachVoiceProfile:voiceFixture().unscopedVoice,
    createClient:(_url,key)=>key==='public-fixture'?{auth:{getUser:async()=>({data:{user:{id:'owner-a'}},error:null})}}:admin,
    fetch:async(_url,init)=>{modelRequests.push(JSON.parse(init.body));return new Response(JSON.stringify({
      model:'fixture-model',toolCalls:[{input:{drafts:[{text:'Thanks for getting in touch. What time works for you?'}]}}],
    }));},
    Deno:{serve:fn=>{handler=fn;},env:{get:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'public-fixture',
      SUPABASE_SERVICE_ROLE_KEY:'service-fixture'})[key]}},
  });
  const response=await handler(new Request('https://fixture.invalid/message-draft',{method:'POST',
    headers:{Authorization:'Bearer fixture-user','Content-Type':'application/json'},
    body:JSON.stringify({providerId:'org-a',threadContext:[{role:'parent',body:'Could we find another time?'}]})}));
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.usedToneAnchors,0);assert.equal(result.result.type,'drafts');assert.equal(result.result.drafts.length,1);
  assert.deepEqual(calls,['providers']);assert.equal(modelRequests.length,1);
  const prompt=modelRequests[0].messages[0].content[0].text;
  assert.match(prompt,/Could we find another time/);assert.doesNotMatch(prompt,/Tone anchors/);
});
