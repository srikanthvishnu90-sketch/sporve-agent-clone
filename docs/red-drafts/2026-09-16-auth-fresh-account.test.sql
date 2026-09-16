-- Disposable-database fixture for migration 20260915_001065 (staff-only
-- signup, no anonymous org read). Never runs against production.
--     bash tools/run-sql-fixtures.sh 2026-09-16-auth
-- RED-FIRST: with the \ir line removed, assertions A and D fail (a signup
-- without metadata becomes a 'searcher' with no org; anon reads an approved org).
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_freshaccount' then
    raise exception 'refusing to run outside the disposable sporv_spec_freshaccount database (got %)', current_database();
  end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
do $$ begin create role anon nologin; create role authenticated nologin; create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.profiles (id uuid primary key, role text not null, first_name text, last_name text, email text, phone_number text);
create table public.providers (id uuid primary key default gen_random_uuid(), owner_id uuid not null unique, business_name text not null, status text not null default 'pending',
  onboarding_completed boolean not null default false, bio text, location text, background_check_status text not null default 'none');
create table public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.providers(id), member_user_id uuid,
  role text not null default 'trainer', background_check_status text not null default 'none', is_active boolean not null default true);
create table public.team_athletes (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id));
create table public.guardians (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id));
create table public.guardian_links (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id));
create table public.obligations (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id));
create table public.bookings (id uuid primary key default gen_random_uuid(), provider_id uuid);
create table public.import_batches (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id));
create table public.coach_invites (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), email text);
create or replace function public.is_org_admin(p_org uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = auth.uid()) $$;
-- the baseline, verbatim in the parts that matter: client-elected role defaulting to searcher; anon read of approved orgs
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path to '' as $$
declare the_role text := case when (new.raw_user_meta_data ->> 'role') in ('searcher','provider') then new.raw_user_meta_data ->> 'role' else 'searcher' end;
begin
  insert into public.profiles (id, role, first_name, email) values (new.id, the_role, split_part(coalesce(new.email,'member'),'@',1), new.email) on conflict (id) do nothing;
  if the_role = 'provider' then insert into public.providers (owner_id, business_name) values (new.id, coalesce(nullif(new.raw_user_meta_data->>'business_name',''),'My Academy')) on conflict (owner_id) do nothing; end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
alter table public.providers enable row level security;
create policy providers_select_owner on public.providers for select to authenticated using (owner_id = auth.uid());
create policy providers_select_public on public.providers for select to public using (status = 'approved');
grant select (id, business_name, bio, location, status) on public.providers to anon;
grant select on public.providers to authenticated;
alter table public.organization_members enable row level security;
create policy organization_members_select_public on public.organization_members for select to public using (background_check_status = 'verified' and is_active);
grant select on public.organization_members to anon, authenticated;
-- an existing approved org with a pending invite to a domain-mate: the thing a new signup must NOT be attached to
insert into public.providers (id, owner_id, business_name, status) values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Rivertown FC', 'approved');
insert into public.coach_invites (provider_id, email) values ('10000000-0000-4000-8000-00000000000a', 'newcoach@rivertownfc.org');

\ir ../../supabase/migrations/20260915_001065_staff_only_signup.sql

do $$
declare n integer; v_uid uuid := 'b0000000-0000-4000-8000-00000000000b'; v_org uuid;
begin
  -- A ── a signup with NO metadata is staff with its own org (never a searcher, never org-less)
  insert into auth.users (id, email) values (v_uid, 'newcoach@rivertownfc.org');
  if (select role from public.profiles where id = v_uid) <> 'provider' then raise exception 'FAIL A: new account is not staff'; end if;
  select id into v_org from public.providers where owner_id = v_uid;
  if v_org is null then raise exception 'FAIL A: new account has no organization'; end if;
  raise notice 'PASS A: every new account is staff with its own organization';

  -- B ── the client cannot elect a role
  insert into auth.users (id, email, raw_user_meta_data) values ('c0000000-0000-4000-8000-00000000000c', 'x@example.com', '{"role":"searcher"}');
  if (select role from public.profiles where id = 'c0000000-0000-4000-8000-00000000000c') <> 'provider' then raise exception 'FAIL B: client-supplied role honoured'; end if;
  raise notice 'PASS B: a client-supplied role is ignored';

  -- C ── ZERO attached records: same email domain as an approved org with an open invite to this very address, still nothing attached
  if v_org = '10000000-0000-4000-8000-00000000000a' then raise exception 'FAIL C: new account attached to the existing org'; end if;
  select count(*) into n from public.organization_members where member_user_id = v_uid or organization_id = v_org; if n <> 0 then raise exception 'FAIL C: % membership rows', n; end if;
  select count(*) into n from public.team_athletes where provider_id = v_org; if n <> 0 then raise exception 'FAIL C: athletes attached'; end if;
  select count(*) into n from public.guardians where provider_id = v_org; if n <> 0 then raise exception 'FAIL C: guardians attached'; end if;
  select count(*) into n from public.guardian_links where provider_id = v_org; if n <> 0 then raise exception 'FAIL C: links attached'; end if;
  select count(*) into n from public.obligations where provider_id = v_org; if n <> 0 then raise exception 'FAIL C: obligations attached'; end if;
  select count(*) into n from public.import_batches where provider_id = v_org; if n <> 0 then raise exception 'FAIL C: imports attached'; end if;
  if (select onboarding_completed from public.providers where id = v_org) then raise exception 'FAIL C: onboarding pre-completed'; end if;
  raise notice 'PASS C: a fresh account has ZERO attached records — the invite waits for an explicit acceptance';
end $$;

-- D ── no anonymous read of organizations or staff
set role anon;
do $$
declare n integer;
begin
  begin
    select count(*) into n from public.providers; raise exception 'FAIL D: anon can read providers (% rows)', n;
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into n from public.organization_members; raise exception 'FAIL D: anon can read organization_members';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS D: anon has no read path to organizations or staff';
end $$;
reset role;

-- E ── staff see their own org only
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', false);
do $$
declare n integer;
begin
  select count(*) into n from public.providers; if n <> 1 then raise exception 'FAIL E: staff sees % orgs', n; end if;
  if exists (select 1 from public.providers where business_name = 'Rivertown FC') then raise exception 'FAIL E: staff can read another approved org'; end if;
  raise notice 'PASS E: a signed-in staff member reads exactly their own organization';
end $$;
reset role;
