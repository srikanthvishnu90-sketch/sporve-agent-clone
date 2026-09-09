-- Disposable PostgreSQL database test for 2026-09-08-entitlement-guards.sql.
-- Run: createdb sporv_entitlement_guard_test && psql -v ON_ERROR_STOP=1 -d
-- sporv_entitlement_guard_test -f docs/red-drafts/2026-09-08-entitlement-guards.test.sql
-- Then: dropdb sporv_entitlement_guard_test
-- These table definitions use the actual column names/types required by the
-- baseline and 20260831_001007/001010; no application-only stand-ins are used.

create extension if not exists pgcrypto;
-- Supabase exposes these helpers in production. The disposable PostgreSQL
-- harness supplies their unauthenticated equivalents solely so the trigger
-- follows its normal non-browser path; authenticated/RLS tests belong in the
-- Supabase integration suite.
create schema auth;
create function auth.role() returns text language sql stable as 'select null::text';
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create table public.providers (
  id uuid primary key, owner_id uuid not null
);
create table public.plan_entitlements (
  plan text primary key, public_slug text not null, sort_order integer not null,
  purchasable boolean not null, member_cap integer not null,
  admin_cap integer not null, group_cap integer not null
);
create table public.provider_entitlement_assignments (
  provider_id uuid primary key references public.providers(id), plan_key text not null
);
create table public.team_athletes (
  id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.providers(id),
  team_id uuid, athlete_id uuid, status text not null default 'active', first_name text
);
create table public.teams (
  id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.providers(id), name text not null
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.providers(id),
  member_user_id uuid, role text not null default 'trainer', is_active boolean not null default true
);
create or replace function public.resolve_provider_entitlements_internal(p_provider uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object('effective_plan',a.plan_key)
  from public.provider_entitlement_assignments a where a.provider_id=p_provider
$$;

\ir 2026-09-08-entitlement-guards.sql

insert into public.plan_entitlements values
 ('free','free',0,false,15,1,1),
 ('solo','individual',1,true,100,1,-1),
 ('organization','enterprise',2,true,-1,-1,-1);
insert into public.providers values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003');
insert into public.provider_entitlement_assignments values
 ('00000000-0000-0000-0000-000000000001','free'),
 ('00000000-0000-0000-0000-000000000002','solo'),
 ('00000000-0000-0000-0000-000000000003','organization');

-- Free allows exactly 15 stored members, including inactive rows, then returns
-- the typed 402 contract.
insert into public.team_athletes(provider_id,athlete_id,first_name)
select '00000000-0000-0000-0000-000000000001',gen_random_uuid(),'member-'||s from generate_series(1,14) s;
insert into public.team_athletes(provider_id,athlete_id,first_name,status)
  values('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'inactive-fifteen','inactive');
do $$ declare v_detail text; begin
  begin
    insert into public.team_athletes(provider_id,athlete_id,first_name)
      values('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'sixteen');
    raise exception 'expected member PT402';
  exception when sqlstate 'PT402' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm <> 'Entitlement limit reached'
       or v_detail::jsonb <> '{"reason":"member_cap","current_plan":"free","upgrade_to":"individual","limit":15,"current":15}'::jsonb then
      raise;
    end if;
  end;
end $$;

-- A move into a capped org is also checked; a status change does not silently
-- make a stored member free capacity, while deletion remains allowed.
insert into public.team_athletes(provider_id,athlete_id,first_name,status)
  values('00000000-0000-0000-0000-000000000002',gen_random_uuid(),'movable','inactive');
do $$ begin
  begin
    update public.team_athletes set provider_id='00000000-0000-0000-0000-000000000001',status='active'
      where first_name='movable';
    raise exception 'expected cross-org member PT402';
  exception when sqlstate 'PT402' then null;
  end;
end $$;
update public.team_athletes set status='inactive' where first_name='member-1';
delete from public.team_athletes where first_name='member-1';

-- Free includes its owner seat; an explicit owner row and trainers are not
-- extra admin seats, while a non-owner admin is blocked.
insert into public.organization_members(organization_id,member_user_id,role)
  values('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner');
insert into public.organization_members(organization_id,member_user_id,role)
  values('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','trainer');
do $$ begin
  begin
    update public.organization_members set role='admin'
     where organization_id='00000000-0000-0000-0000-000000000001'
       and member_user_id='20000000-0000-0000-0000-000000000002';
    raise exception 'expected trainer promotion PT402';
  exception when sqlstate 'PT402' then null;
  end;
end $$;
do $$ begin
  begin
    insert into public.organization_members(organization_id,member_user_id,role)
      values('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','admin');
    raise exception 'expected admin PT402';
  exception when sqlstate 'PT402' then null;
  end;
end $$;
insert into public.organization_members(organization_id,member_user_id,is_active,role)
  values('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',false,'admin');
-- Replacing the explicit owner user with a non-owner is an additional seat,
-- and Individual is correctly skipped because it retains the one-admin cap.
do $$ declare v_detail text; begin
  begin
    update public.organization_members
       set member_user_id='20000000-0000-0000-0000-000000000003'
     where organization_id='00000000-0000-0000-0000-000000000001'
       and member_user_id='10000000-0000-0000-0000-000000000001';
    raise exception 'expected owner replacement PT402';
  exception when sqlstate 'PT402' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail::jsonb->>'upgrade_to' <> 'enterprise' then raise; end if;
  end;
end $$;
delete from public.organization_members where organization_id='00000000-0000-0000-0000-000000000001' and member_user_id='20000000-0000-0000-0000-000000000001';

-- Free has one group; unlimited organization never receives PT402.
insert into public.teams(provider_id,name) values('00000000-0000-0000-0000-000000000001','first');
do $$ begin
  begin
    insert into public.teams(provider_id,name) values('00000000-0000-0000-0000-000000000001','second');
    raise exception 'expected group PT402';
  exception when sqlstate 'PT402' then null;
  end;
end $$;
insert into public.teams(provider_id,name)
select '00000000-0000-0000-0000-000000000003','unlimited-'||s from generate_series(1,20) s;

do $$ begin
  if (select count(*) from public.team_athletes where provider_id='00000000-0000-0000-0000-000000000001') <> 14 then
    raise exception 'member delete was not retained';
  end if;
  if (select count(*) from public.teams where provider_id='00000000-0000-0000-0000-000000000003') <> 20 then
    raise exception 'unlimited group cap failed';
  end if;
end $$;
