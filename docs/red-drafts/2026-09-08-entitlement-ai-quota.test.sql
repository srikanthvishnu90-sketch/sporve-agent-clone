-- DISPOSABLE DATABASE ONLY: sporv_entitlement_fixture must start empty.
-- Executes both actual drafts. Burst transport is a stub, NOT concurrency proof.
\set ON_ERROR_STOP on
\ir 2026-09-08-plan-entitlements.test.sql

create table public.ai_usage(
  id uuid primary key default gen_random_uuid(),provider_id uuid not null,
  kind text not null,used_at timestamptz not null default now()
);
create table public.test_burst_calls(actor text,scope text,lim integer,seconds integer);
create function public.consume_edge_rate_limit(text,text,integer,integer)
returns boolean language plpgsql as $$begin
  insert into public.test_burst_calls values($1,$2,$3,$4);
  return coalesce(nullif(current_setting('test.burst_allowed',true),''),'true')::boolean;
end$$;
\ir 2026-09-08-entitlement-ai-quota.sql

begin;
do $$ declare r jsonb; i integer; before_count integer; begin
  perform set_config('request.jwt.claim.sub','',true);
  if public.consume_ai_quota()->>'reason'<>'not_authenticated' then
    raise exception 'FAIL: unauthenticated metering'; end if;
  perform set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000099',true);
  if public.consume_ai_quota()->>'reason'<>'not_a_coach' then
    raise exception 'FAIL: unknown owner metering'; end if;

  -- Existing fixture owner has a legacy Solo assignment; change the assignment
  -- only to prove metering ignores the obsolete providers.plan cache.
  perform set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
  update public.provider_entitlement_assignments set plan_key='free'
    where provider_id='10000000-0000-4000-8000-000000000001';
  for i in 1..25 loop
    r:=public.consume_ai_quota();
    if r->>'allowed'<>'true' or (r->>'used')::int<>i then
      raise exception 'FAIL: Free admission %: %',i,r; end if;
  end loop;
  r:=public.consume_ai_quota();
  if r->>'allowed'<>'false' or r->>'reason'<>'quota_exhausted'
    or r->>'current_plan'<>'free' or r->>'upgrade_to'<>'individual'
    or (r->>'limit')::int<>25 or (r->>'current')::int<>25
    or (r->>'contract_version')::int<>2 then raise exception 'FAIL: Ask 26: %',r; end if;
  if (select count(*) from public.ai_usage)<>25 then raise exception 'FAIL: denied usage written'; end if;

  update public.provider_entitlement_assignments set plan_key='solo'
    where provider_id='10000000-0000-4000-8000-000000000001';
  insert into public.ai_usage(provider_id,kind)
    select '10000000-0000-4000-8000-000000000001'::uuid,'fixture' from generate_series(1,475);
  update public.plan_entitlements set purchasable=true,ask_quota_month=1000 where plan='free';
  r:=public.consume_ai_quota();
  if r->>'upgrade_to' is distinct from 'enterprise' or (r->>'limit')::int is distinct from 500 then
    raise exception 'FAIL: Solo limit 500: %',r; end if;
  update public.plan_entitlements set purchasable=false,ask_quota_month=25 where plan='free';
  update public.plan_entitlements set ask_quota_month=501 where plan='solo';
  if public.consume_ai_quota()->>'allowed'<>'true' then raise exception 'FAIL: data-only quota change'; end if;

  update public.provider_entitlement_assignments set plan_key='organization'
    where provider_id='10000000-0000-4000-8000-000000000001';
  r:=public.consume_ai_quota();
  if r->>'allowed'<>'true' or r->'quota'<>'null'::jsonb then raise exception 'FAIL: explicit unlimited'; end if;
  select count(*) into before_count from public.ai_usage;
  perform set_config('test.burst_allowed','false',true);
  r:=public.consume_ai_quota();
  if r->>'reason'<>'rate_limited' or (r->>'retry_after')::int not between 1 and 60 then
    raise exception 'FAIL: unlimited bypassed burst cap'; end if;
  if (select count(*) from public.ai_usage)<>before_count then raise exception 'FAIL: burst denial writes usage'; end if;
  perform set_config('test.burst_allowed','true',true);

  update public.provider_entitlement_assignments set source='trial',
    starts_at=now()-interval '14 days',ends_at=now()
    where provider_id='10000000-0000-4000-8000-000000000001';
  r:=public.consume_ai_quota();
  if r->>'current_plan'<>'free' or r->>'reason'<>'quota_exhausted' then
    raise exception 'FAIL: expired trial still unlimited'; end if;
  delete from public.provider_entitlement_assignments
    where provider_id='10000000-0000-4000-8000-000000000001';
  r:=public.consume_ai_quota();
  if r->>'current_plan' is distinct from 'free' or (r->>'limit')::int is distinct from 25 then
    raise exception 'FAIL: missing assignment quota fallback'; end if;
  insert into public.provider_entitlement_assignments(provider_id,plan_key,source,fallback_plan_key)
    values('10000000-0000-4000-8000-000000000001','organization','subscription','free');
  if exists(select from public.test_burst_calls where scope<>'coach-ai:minute' or lim<>12 or seconds<>60) then
    raise exception 'FAIL: burst configuration changed'; end if;
  raise notice 'PASS: Ask 25/26, 500 cap, unlimited, data-only changes, trial expiry, burst preservation';
end$$;

create function public.test_suppress_ai_usage() returns trigger language plpgsql as $$begin return null; end$$;
create trigger suppress_ai_usage before insert on public.ai_usage
for each row execute function public.test_suppress_ai_usage();
do $$ begin
  update public.provider_entitlement_assignments set ends_at=null
    where provider_id='10000000-0000-4000-8000-000000000001';
  begin
    perform public.consume_ai_quota();
    raise exception using errcode='23514',message='FAIL: silent usage no-op admitted';
  exception when raise_exception then
    if sqlerrm<>'AI usage receipt was not written' then raise; end if;
  end;
  raise notice 'PASS: missing usage receipt fails loudly';
end$$;
rollback;
