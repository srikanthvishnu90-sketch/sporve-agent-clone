-- Disposable PostgreSQL fixture. Executes the ACTUAL draft, not copied logic.
-- createdb sporv_entitlement_fixture
-- psql -X -v ON_ERROR_STOP=1 -d sporv_entitlement_fixture -f this-file.sql
-- Never run against Supabase or an existing application database.
\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'sporv_entitlement_fixture'
    or to_regclass('public.providers') is not null then
    raise exception 'Requires empty disposable sporv_entitlement_fixture database';
  end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role',true),'');
$$;
grant usage on schema auth to authenticated,anon,service_role;
create table public.plan_entitlements(
  plan text primary key check(plan in ('free','pro','enterprise')),
  ai_monthly_quota integer,seat_limit integer,
  workspace_enabled boolean not null default false,
  purchasable boolean not null default false,
  price_usd_month numeric(6,2),updated_at timestamptz not null default now()
);
insert into public.plan_entitlements(plan) values('free'),('pro'),('enterprise');
create table public.providers(
  id uuid primary key,owner_id uuid not null,
  plan text not null default 'free' check(plan in ('free','pro','enterprise'))
);
create table public.organization_members(
  organization_id uuid not null,member_user_id uuid, is_active boolean not null default true
);
insert into public.providers values
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','pro');

\ir 2026-09-08-plan-entitlements.sql

begin;
set local request.jwt.claim.role='service_role';
do $$
declare e jsonb;
begin
  if (select array_agg(plan order by plan) from public.plan_entitlements)
      <> array['free','organization','solo']::text[] then
    raise exception 'FAIL: exactly three canonical plan rows'; end if;
  if (select count(*) from public.plan_entitlements where
      display_name is null or member_cap is null or admin_cap is null or group_cap is null
      or connectors is null or jobs is null or modules is null or scan_mode is null
      or draft_quota_month is null or send_quota_month is null or ask_quota_month is null
      or branding_footer is null or camps_included is null)<>0 then
    raise exception 'FAIL: every entitlement field populated'; end if;
  if not exists(select 1 from public.plan_entitlements where plan='free'
      and member_cap=15 and admin_cap=1 and group_cap=1
      and draft_quota_month=20 and send_quota_month=20 and ask_quota_month=25
      and connectors=array['website','csv'] and branding_footer and not camps_included
      and scan_mode='nightly') then raise exception 'FAIL: Free catalog'; end if;
  if not exists(select 1 from public.plan_entitlements where plan='solo'
      and member_cap=100 and admin_cap=1 and group_cap=-1
      and draft_quota_month=-1 and send_quota_month=500 and ask_quota_month=500
      and price_usd_month=39 and price_usd_year=390
      and 'gmail'=any(connectors) and not ('outlook'=any(connectors))) then
    raise exception 'FAIL: Individual catalog'; end if;
  if not exists(select 1 from public.plan_entitlements where plan='organization'
      and member_cap=-1 and admin_cap=-1 and group_cap=-1
      and draft_quota_month=-1 and send_quota_month=-1 and ask_quota_month=-1
      and price_usd_month=449 and price_usd_year=4490
      and 'outlook'=any(connectors) and camps_included) then
    raise exception 'FAIL: Enterprise catalog'; end if;
  e:=public.get_provider_entitlements('10000000-0000-4000-8000-000000000001');
  if e->>'plan'<>'solo' or e->>'entitlement_source'<>'legacy' then
    raise exception 'FAIL: preserve legacy access without retroactive trial'; end if;
  update public.plan_entitlements set member_cap=123 where plan='solo';
  e:=public.get_provider_entitlements('10000000-0000-4000-8000-000000000001');
  if (e->>'member_cap')::int<>123 then raise exception 'FAIL: limit change is data only'; end if;
  insert into public.providers(id,owner_id) values
    ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002');
  e:=public.get_provider_entitlements('10000000-0000-4000-8000-000000000002');
  if e->>'plan'<>'organization' or e->>'entitlement_source'<>'trial' then
    raise exception 'FAIL: new org no-card Enterprise trial'; end if;
  if not exists(select 1 from public.provider_entitlement_assignments
      where provider_id='10000000-0000-4000-8000-000000000002'
      and ends_at-starts_at=interval '14 days') then raise exception 'FAIL: trial duration'; end if;
  update public.provider_entitlement_assignments set
    starts_at=now()-interval '14 days',ends_at=now()
    where provider_id='10000000-0000-4000-8000-000000000002';
  e:=public.get_provider_entitlements('10000000-0000-4000-8000-000000000002');
  if e->>'plan'<>'free' then raise exception 'FAIL: expiry boundary without cron dependency'; end if;
  if e->>'effective_plan'<>'free' or e->>'assigned_plan'<>'organization'
      or (e->>'assignment_expired')::boolean is not true then
    raise exception 'FAIL: assigned and effective trial state must be explicit'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on c.relnamespace=n.oid
    where n.nspname='public' and c.relname in ('billing_policy','provider_entitlement_assignments')
      and not c.relrowsecurity) then raise exception 'FAIL: new billing table RLS disabled'; end if;
  if has_function_privilege('authenticated','public.resolve_provider_entitlements_internal(uuid)','EXECUTE')
    or has_function_privilege('anon','public.resolve_provider_entitlements_internal(uuid)','EXECUTE') then
    raise exception 'FAIL: internal resolver exposed'; end if;
  begin
    perform public.get_provider_entitlements('10000000-0000-4000-8000-000000000099');
    raise exception 'FAIL: missing assignment accepted';
  exception when no_data_found then null; end;
  insert into public.organization_members values
    ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',true),
    ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',false);
  raise notice 'PASS: catalog, prices, legacy preservation, data-only edits, no-card trial and expiry';
end;
$$;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='20000000-0000-4000-8000-000000000001';
do $$ begin
  perform public.get_provider_entitlements('10000000-0000-4000-8000-000000000001');
  begin
    perform public.get_provider_entitlements('10000000-0000-4000-8000-000000000002');
    raise exception 'FAIL: cross-org entitlements visible';
  exception when insufficient_privilege then null; end;
  begin
    update public.provider_entitlement_assignments set plan_key='organization';
    raise exception 'FAIL: client could self-upgrade';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: owner read, cross-org denial, self-upgrade denial';
end $$;
set local request.jwt.claim.sub='30000000-0000-4000-8000-000000000001';
do $$ begin
  perform public.get_provider_entitlements('10000000-0000-4000-8000-000000000001');
  begin
    perform public.get_provider_entitlements('10000000-0000-4000-8000-000000000002');
    raise exception 'FAIL: inactive staff obtained org entitlements';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: active staff read and inactive membership denial';
end $$;
reset role;
set local request.jwt.claim.role='';
set local request.jwt.claim.sub='';
do $$ begin
  perform public.resolve_provider_entitlements_internal('10000000-0000-4000-8000-000000000001');
  raise notice 'PASS: internal cron resolver works without a user JWT';
end $$;
rollback;
