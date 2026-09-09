-- Disposable PostgreSQL fixture. Executes the ACTUAL red drafts, never a copy.
-- createdb sporv_platform_billing_fixture
-- psql -X -v ON_ERROR_STOP=1 -d sporv_platform_billing_fixture -f this-file.sql
-- Never run against Supabase or an existing application database.
\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'sporv_platform_billing_fixture'
    or to_regclass('public.providers') is not null then
    raise exception 'Requires empty disposable sporv_platform_billing_fixture database';
  end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.role() returns text language sql stable as $$ select null::text $$;
create table public.plan_entitlements(plan text primary key);
insert into public.plan_entitlements values('free'),('solo'),('organization');
create table public.billing_policy(singleton boolean primary key,free_plan_key text not null references public.plan_entitlements(plan));
insert into public.billing_policy values(true,'free');
create table public.providers(
  id uuid primary key, owner_id uuid not null,
  plan_status text not null default 'none' check(plan_status in ('none','trialing','active','past_due','canceled','incomplete'))
);
create table public.provider_entitlement_assignments(
  provider_id uuid primary key references public.providers(id),plan_key text not null references public.plan_entitlements(plan),
  source text not null,starts_at timestamptz not null default now(),ends_at timestamptz,
  fallback_plan_key text not null references public.plan_entitlements(plan),revision bigint not null default 1,updated_at timestamptz not null default now()
);
insert into public.providers(id,owner_id) values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
insert into public.provider_entitlement_assignments(provider_id,plan_key,source,fallback_plan_key)
 values('10000000-0000-4000-8000-000000000001','free','legacy','free');
-- Queue schema subset verified against the live Doc 11 table. No outbound
-- draft/send surface is present in this fixture or in the projection writer.
create table public.agent_findings(
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id),kind text not null,
  code text not null,severity text not null check(severity in ('info','attention','warn','urgent')),
  title text not null,detail text,source_ref text not null,
  status text not null default 'open' check(status in ('open','dismissed')),
  subject_type text,evidence jsonb
);
create unique index uq_finding_ref on public.agent_findings(provider_id,source_ref)
  where status<>'dismissed';
alter table public.agent_findings enable row level security;

\ir 2026-09-08-platform-billing.sql

grant select on public.providers, public.provider_entitlement_assignments to service_role;
grant select,update on public.agent_findings to service_role;
insert into public.platform_billing_provider_bindings(provider_id,livemode,verified_at,verified_by)
 values('10000000-0000-4000-8000-000000000001',false,now(),'fixture');
insert into public.platform_billing_subscription_authorizations(provider_id,livemode,stripe_subscription_id,stripe_customer_id,state,verified_at,verified_by)
 values('10000000-0000-4000-8000-000000000001',false,'sub_fixture','cus_fixture','pending',now(),'fixture');
insert into public.platform_billing_customers(provider_id,livemode,stripe_customer_id,verified_at,verified_by)
 values('10000000-0000-4000-8000-000000000001',false,'cus_fixture',now(),'fixture');
insert into public.platform_billing_prices(livemode,stripe_price_id,plan_key,billing_interval,verified_at,verified_by)
 values(false,'price_fixturemonth','solo','month',now(),'fixture');

begin;
set local role service_role;
do $$
declare a jsonb; d jsonb; s jsonb; rev bigint; start_epoch bigint := extract(epoch from now())::bigint;
begin
  s:=jsonb_build_object('subscription_id','sub_fixture','customer_id','cus_fixture',
    'price_id','price_fixturemonth','status','active','current_period_start',start_epoch,
    'current_period_end',start_epoch+2592000,'cancel_at_period_end',false);
  a:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture1',
    'event_type','customer.subscription.created','occurred_at',start_epoch+1,'livemode',false,
    'payload_sha256',repeat('a',64),'subscription',s));
  if a->>'outcome'<>'applied' or a->>'effective_plan'<>'solo'
    or (select plan_key from public.provider_entitlement_assignments where provider_id='10000000-0000-4000-8000-000000000001')<>'solo' then
    raise exception 'FAIL: verified price did not project paid entitlement'; end if;
  rev:=(a->>'assignment_revision')::bigint;
  d:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture1',
    'event_type','customer.subscription.created','occurred_at',start_epoch+1,'livemode',false,
    'payload_sha256',repeat('a',64),'subscription',s));
  if d->>'outcome'<>'duplicate' or (select count(*) from public.platform_billing_receipts)<>1
    or (d->>'assignment_revision')::bigint<>rev then raise exception 'FAIL: duplicate created another projection'; end if;
  begin
    perform public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture1',
      'event_type','customer.subscription.created','occurred_at',start_epoch+1,'livemode',false,
      'payload_sha256',repeat('b',64),'subscription',s));
    raise exception 'FAIL: reused event id with changed body accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture1',
      'event_type','customer.subscription.created','occurred_at',start_epoch+1,'livemode',false,
      'payload_sha256',repeat('a',64),'subscription',jsonb_set(s,'{customer_id}','"cus_other"'::jsonb)));
    raise exception 'FAIL: duplicate event id bound to a different customer';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.apply_platform_billing_event(jsonb_build_object('event_id',null));
    raise exception 'FAIL: null event fields accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.apply_platform_billing_event(jsonb_build_object('event_id','evt_unknownprice',
      'event_type','customer.subscription.updated','occurred_at',start_epoch+2,'livemode',false,
      'payload_sha256',repeat('8',64),'subscription',jsonb_set(s,'{price_id}','"price_unknown"'::jsonb)));
    raise exception 'FAIL: unknown price mapping silently no-oped';
  exception when no_data_found then
    if (select count(*) from public.platform_billing_receipts)<>1 then
      raise exception 'FAIL: unknown price wrote a receipt'; end if;
  end;
  s:=jsonb_set(s,'{cancel_at_period_end}','true'::jsonb);
  a:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture2',
    'event_type','customer.subscription.updated','occurred_at',start_epoch+2,'livemode',false,
    'payload_sha256',repeat('c',64),'subscription',s));
  if (select ends_at > now() from public.provider_entitlement_assignments where provider_id='10000000-0000-4000-8000-000000000001') is not true then
    raise exception 'FAIL: cancellation was not retained through period end'; end if;
  s:=jsonb_set(s,'{status}','"past_due"'::jsonb);
  a:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture3',
    'event_type','invoice.payment_failed','occurred_at',start_epoch+3,'livemode',false,
    'payload_sha256',repeat('d',64),'subscription',s));
  if a->>'effective_plan'<>'solo' or (select plan_status from public.providers where id='10000000-0000-4000-8000-000000000001')<>'past_due' then
    raise exception 'FAIL: dunning did not retain paid plan'; end if;
  if a->>'finding_id' is null or not exists(select 1 from public.agent_findings
    where id=(a->>'finding_id')::uuid and provider_id='10000000-0000-4000-8000-000000000001'
      and code='subscription_payment_failed' and kind='money'
      and evidence->>'stripe_event_id'='evt_fixture3') then
    raise exception 'FAIL: invoice failure missing tenant-bound queue evidence'; end if;
  update public.agent_findings set status='dismissed' where id=(a->>'finding_id')::uuid;
  d:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture3',
    'event_type','invoice.payment_failed','occurred_at',start_epoch+3,'livemode',false,
    'payload_sha256',repeat('d',64),'subscription',s));
  if d->>'outcome' is distinct from 'duplicate' or d->>'finding_id' is distinct from a->>'finding_id'
    or (select count(*) from public.agent_findings)<>1
    or (select status from public.agent_findings where id=(a->>'finding_id')::uuid)<>'dismissed' then
    raise exception 'FAIL: replay duplicated or reopened dismissed finding'; end if;
  s:=jsonb_set(s,'{status}','"unpaid"'::jsonb);
  a:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture4',
    'event_type','customer.subscription.updated','occurred_at',start_epoch+4,'livemode',false,
    'payload_sha256',repeat('e',64),'subscription',s));
  if a->>'effective_plan'<>'free' then raise exception 'FAIL: dunning closure did not fall to Free'; end if;
  s:=jsonb_set(s,'{status}','"active"'::jsonb);
  a:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_fixture0',
    'event_type','customer.subscription.updated','occurred_at',start_epoch,'livemode',false,
    'payload_sha256',repeat('f',64),'subscription',s));
  if a->>'outcome'<>'superseded' or (select plan_key from public.provider_entitlement_assignments where provider_id='10000000-0000-4000-8000-000000000001')<>'free' then
    raise exception 'FAIL: older event reverted current entitlement'; end if;
  a:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_stalefailure',
    'event_type','invoice.payment_failed','occurred_at',start_epoch,'livemode',false,
    'payload_sha256',repeat('6',64),'subscription',s));
  if a->>'outcome' is distinct from 'superseded' or a->>'finding_id' is null
    or not exists(select 1 from public.agent_findings where id=(a->>'finding_id')::uuid
      and evidence->>'stripe_event_id'='evt_stalefailure')
    or (select count(*) from public.agent_findings)<>2 then
    raise exception 'FAIL: stale invoice did not retain historical failure finding'; end if;
  d:=public.apply_platform_billing_event(jsonb_build_object('event_id','evt_stalefailure',
    'event_type','invoice.payment_failed','occurred_at',start_epoch,'livemode',false,
    'payload_sha256',repeat('6',64),'subscription',s));
  if d->>'finding_id' is distinct from a->>'finding_id' or (select count(*) from public.agent_findings)<>2 then
    raise exception 'FAIL: stale invoice retry duplicated finding'; end if;
  begin insert into public.platform_billing_receipts default values; raise exception 'FAIL: direct service receipt insert allowed';
  exception when insufficient_privilege then null; end;
  begin update public.platform_billing_receipts set outcome='applied'; raise exception 'FAIL: service receipt update allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.platform_billing_receipts; raise exception 'FAIL: service receipt delete allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.apply_platform_billing_event(jsonb_build_object('event_id','evt_badmode',
      'event_type','customer.subscription.updated','occurred_at',start_epoch+5,'livemode',true,
      'payload_sha256',repeat('9',64),'subscription',s));
    raise exception 'FAIL: an unbound live mode changed the test provider';
  exception when no_data_found then null; end;
  raise notice 'PASS: platform projection, idempotency, malformed/null rejection, customer-bound duplicate, fail-closed unknown price, dunning, cancellation, stale-event and service receipt denial';
end $$;
commit;

-- A suppressed finding INSERT must roll back the entire entitlement/receipt
-- transaction. This catches a silent trigger no-op, not just a thrown error.
create function public.fixture_projection_state() returns jsonb language sql as $$
  select jsonb_build_object(
    'providers',(select jsonb_agg(to_jsonb(t) order by id) from public.providers t),
    'assignments',(select jsonb_agg(to_jsonb(t) order by provider_id) from public.provider_entitlement_assignments t),
    'subscriptions',(select jsonb_agg(to_jsonb(t) order by stripe_subscription_id) from public.platform_billing_subscriptions t),
    'cursors',(select jsonb_agg(to_jsonb(t) order by provider_id) from public.platform_billing_provider_projection t),
    'findings',(select jsonb_agg(to_jsonb(t) order by id) from public.agent_findings t),
    'receipts',(select jsonb_agg(to_jsonb(t) order by receipt_id) from public.platform_billing_receipts t));
$$;
create function public.fixture_suppress_finding() returns trigger language plpgsql
as $$ begin return null; end $$;
create trigger suppress_finding before insert on public.agent_findings
for each row execute function public.fixture_suppress_finding();
do $$ declare before_revision bigint; before_receipts bigint; before_state jsonb; begin
  before_state:=public.fixture_projection_state();
  select revision into before_revision from public.provider_entitlement_assignments
    where provider_id='10000000-0000-4000-8000-000000000001';
  select count(*) into before_receipts from public.platform_billing_receipts;
  begin
    perform public.apply_platform_billing_event(jsonb_build_object('event_id','evt_suppressedfinding',
      'event_type','invoice.payment_failed','occurred_at',extract(epoch from now())::bigint+100,
      'livemode',false,'payload_sha256',repeat('7',64),'subscription',jsonb_build_object(
        'subscription_id','sub_fixture','customer_id','cus_fixture','price_id','price_fixturemonth',
        'status','past_due','current_period_start',extract(epoch from now())::bigint,
        'current_period_end',extract(epoch from now())::bigint+2592000,'cancel_at_period_end',false)));
    raise exception 'FAIL: suppressed finding was acknowledged';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'Subscription failure finding was not written' then raise; end if;
  end;
  if (select revision from public.provider_entitlement_assignments
      where provider_id='10000000-0000-4000-8000-000000000001')<>before_revision
    or (select count(*) from public.platform_billing_receipts)<>before_receipts then
    raise exception 'FAIL: missing finding left a partial projection or receipt'; end if;
  if public.fixture_projection_state() is distinct from before_state then
    raise exception 'FAIL: suppressed finding changed stored projection, provider, finding or receipt state'; end if;
  raise notice 'PASS: invoice finding suppression rolls back entitlement and receipt';
end $$;
drop trigger suppress_finding on public.agent_findings;

-- The migration owner can bypass table grants, but cannot link another org's
-- finding to this org's billing receipt: the composite foreign key is decisive.
do $$ declare other_finding uuid; begin
  insert into public.providers(id,owner_id) values
    ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002');
  insert into public.agent_findings(provider_id,kind,code,severity,title,source_ref)
    values('10000000-0000-4000-8000-000000000002','money','fixture','warn','Other org','fixture:other')
    returning id into other_finding;
  begin
    insert into public.platform_billing_receipts(livemode,stripe_event_id,event_type,occurred_at,
      payload_sha256,provider_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,
      subscription_snapshot,outcome,finding_id)
    values(false,'evt_crossorg','invoice.payment_failed',now(),repeat('0',64),
      '10000000-0000-4000-8000-000000000001','cus_fixture','sub_fixture','price_fixturemonth',
      '{}'::jsonb,'applied',other_finding);
    raise exception 'FAIL: receipt referenced another org finding';
  exception when foreign_key_violation then null; end;
  raise notice 'PASS: composite receipt/finding tenant identity enforced';
end $$;

-- The migration owner still cannot mutate the receipt: append-only is enforced
-- by the trigger, independently of table grants and service-role RLS bypass.
do $$ begin
  begin update public.platform_billing_receipts set outcome='applied'; raise exception 'FAIL: owner receipt update allowed';
  exception when object_not_in_prerequisite_state then null; end;
  begin delete from public.platform_billing_receipts; raise exception 'FAIL: owner receipt delete allowed';
  exception when object_not_in_prerequisite_state then null; end;
  raise notice 'PASS: receipt trigger blocks owner mutation';
end $$;

do $$ begin
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'platform_billing_%' and not c.relrowsecurity) then
    raise exception 'FAIL: platform billing table missing RLS'; end if;
  if has_table_privilege('authenticated','public.platform_billing_receipts','SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated','public.apply_platform_billing_event(jsonb)','EXECUTE') then
    raise exception 'FAIL: client platform billing privilege'; end if;
  raise notice 'PASS: RLS and service-only projection surface';
end $$;
