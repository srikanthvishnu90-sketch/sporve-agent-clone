-- Disposable-database fixture for audit 2026-09-17 P1-2 — conflicts on the event for the
-- people who coach it. Migration 20260915_001076 on top of 001069 + 001075.
--
--     bash tools/run-sql-fixtures.sh 2026-09-18-schedule-screen
--
-- RED-FIRST: remove the 001076 \ir line and group A fails on
-- "only organisation staff may read conflicts" (42501) for the coach.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_sched_screen' then
    raise exception 'refusing to run outside the disposable sporv_spec_sched_screen database (got %)', current_database();
  end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.providers (id uuid primary key default gen_random_uuid(), owner_id uuid, business_name text);
create table public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid references public.providers(id),
  member_user_id uuid, role text not null default 'admin', is_active boolean not null default true);
create or replace function public.is_org_admin(p_org uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = auth.uid())
      or exists (select 1 from public.organization_members m where m.organization_id = p_org and m.member_user_id = auth.uid()
                 and m.role in ('owner','admin') and m.is_active) $$;
create table public.teams (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), name text);
create table public.programs (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), title text, offering_type text default 'team', assigned_member_id uuid);
create table public.team_athletes (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams(id), provider_id uuid references public.providers(id),
  athlete_id uuid, first_name text, last_name text, dob date, status text not null default 'active');
create table public.guardians (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), user_id uuid, first_name text, email_status text not null default 'ok');
create table public.guardian_links (id uuid primary key default gen_random_uuid(), guardian_id uuid references public.guardians(id), member_id uuid references public.team_athletes(id),
  provider_id uuid, is_payer boolean not null default true);
create table public.sessions (id uuid primary key default gen_random_uuid(), program_id uuid references public.programs(id), title text, start_date date not null, end_date date,
  start_time text, end_time text, timezone text, address text, capacity integer, assigned_member_id uuid);
create table public.program_fixtures (id uuid primary key default gen_random_uuid(), program_id uuid references public.programs(id), starts_at timestamptz not null, ends_at timestamptz,
  kind text not null default 'game', opponent text, location text, home_away text, note text);
create table public.obligations (id uuid primary key default gen_random_uuid(), provider_id uuid, kind text, status text, title text, detail text, due_at timestamptz,
  source_kind text, source_ref text, inverse jsonb, member_id uuid, guardian_id uuid, run_id uuid, draft_type text, updated_at timestamptz default now());
create unique index uq_oblig_agent_source_ref on public.obligations (source_ref) where source_kind = 'agent' and status <> 'void';
create table public.outbound_messages (id uuid primary key default gen_random_uuid(), status text);
create or replace function public.agent_autodraft_on(p uuid) returns boolean language sql as $$ select true $$;
create table public.settings_audit (id uuid primary key default gen_random_uuid(), provider_id uuid, surface text, key text, old_value jsonb, new_value jsonb, changed_by uuid, changed_at timestamptz default now());
grant select, insert, update, delete on all tables in schema public to authenticated;
alter table public.providers add column bio text, add column sports text[], add column location text, add column provider_type text, add column status text default 'pending',
  add column verification_status text, add column background_check_status text, add column background_check_completed_at timestamptz, add column onboarding_completed boolean default false,
  add column stripe_onboarding_started boolean, add column stripe_charges_enabled boolean, add column plan text, add column plan_status text, add column plan_period_end timestamptz,
  add column coach_years_coaching integer, add column coach_years_played integer, add column credentials text[], add column avatar_url text, add column logo_url text;
alter table public.organization_members add column created_at timestamptz default now();
alter table public.providers enable row level security; alter table public.providers force row level security;
create policy providers_select_owner on public.providers for select to authenticated using (owner_id = auth.uid());
alter table public.organization_members enable row level security; alter table public.organization_members force row level security;
create policy organization_members_select_admin on public.organization_members for select to authenticated using (public.is_org_admin(organization_id));
alter table public.teams enable row level security; alter table public.teams force row level security;
create policy teams_select_owner on public.teams for select to authenticated using (exists (select 1 from public.providers p where p.id = teams.provider_id and p.owner_id = auth.uid()));
alter table public.team_athletes enable row level security; alter table public.team_athletes force row level security;
create policy team_athletes_all_owner on public.team_athletes for all to authenticated using (exists (select 1 from public.providers p where p.id = team_athletes.provider_id and p.owner_id = auth.uid()));

\ir ../../supabase/migrations/20260915_001050_venue_and_blackout.sql
\ir ../../supabase/migrations/20260915_001051_event_series.sql
\ir ../../supabase/migrations/20260915_001052_event.sql
\ir ../../supabase/migrations/20260915_001053_migration_quarantine.sql
\ir ../../supabase/migrations/20260915_001055_event_response_and_attendance.sql
\ir ../../supabase/migrations/20260915_001066_series_materializer.sql
\ir ../../supabase/migrations/20260915_001069_event_conflicts_and_cancellation.sql
\ir ../../supabase/migrations/20260915_001075_staff_workspace_access.sql
\ir ../../supabase/migrations/20260915_001076_member_conflicts.sql

-- ── org A: owner uA; trainer uC assigned to the 14U event; two events at ONE venue at the same time (venue conflict both ways); org B owner uD ──
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('c0000000-0000-4000-8000-00000000000c'), ('d0000000-0000-4000-8000-00000000000d');
insert into public.providers (id, owner_id, business_name, onboarding_completed, provider_type) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC', true, 'organization'),
  ('0b000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-00000000000d','Other Club', true, 'organization');
insert into public.organization_members (id, organization_id, member_user_id, role) values
  ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','trainer');
insert into public.teams (id, provider_id, name) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight'),
  ('1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','16U Flight');
insert into public.venue (id, provider_id, name, timezone) values ('5a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Field 1','America/Chicago');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, venue_id, assigned_member_id) values
  ('7a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','14U practice', now()+interval '1 day', now()+interval '1 day 1 hour','America/Chicago','5a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001'),
  ('7a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','practice','16U practice', now()+interval '1 day', now()+interval '1 day 1 hour','America/Chicago','5a000000-0000-4000-8000-000000000001',null);

-- A · the coach reads the conflicts on THEIR event only; the owner reads both; org B is refused; a revoked member is refused ──
do $$ declare n int; ok boolean; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  select count(*) into n from public.event_conflicts_in_range('0a000000-0000-4000-8000-000000000001', now(), now()+interval '7 days');
  if n <> 1 then raise exception 'FAIL A: coach saw % conflict rows, expected 1 (their own event)', n; end if;
  select count(*) into n from public.event_conflicts_in_range('0a000000-0000-4000-8000-000000000001', now(), now()+interval '7 days') where event_id = '7a000000-0000-4000-8000-000000000002';
  if n <> 0 then raise exception 'FAIL A: coach saw the other team''s conflict row'; end if;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  select count(*) into n from public.event_conflicts_in_range('0a000000-0000-4000-8000-000000000001', now(), now()+interval '7 days');
  if n <> 2 then raise exception 'FAIL A: owner saw % conflict rows, expected 2', n; end if;
  ok := false; perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-00000000000d', true);
  begin perform public.event_conflicts_in_range('0a000000-0000-4000-8000-000000000001', now(), now()+interval '7 days'); exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL A: org B owner read org A conflicts'; end if;
  update public.organization_members set is_active = false where id = '0c000000-0000-4000-8000-000000000001';
  ok := false; perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  begin perform public.event_conflicts_in_range('0a000000-0000-4000-8000-000000000001', now(), now()+interval '7 days'); exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL A: a revoked member still read conflicts'; end if;
  update public.organization_members set is_active = true where id = '0c000000-0000-4000-8000-000000000001';
  raise notice 'PASS A: conflicts — coach 1 (own event), owner 2, org B refused, revoked refused';
end $$;

-- B · the coach may not cancel (director''s call); the owner cancels in one call and gets a receipt; the cancelled event drops out of conflicts ──
do $$ declare ok boolean := false; r jsonb; n int; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  begin perform public.cancel_event('7a000000-0000-4000-8000-000000000001', 'rain', true); exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL B: coach cancelled an event'; end if;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  r := public.cancel_event('7a000000-0000-4000-8000-000000000002', 'field flooded', true);
  if (r->>'status') <> 'cancelled' or (r->>'already_cancelled')::boolean then raise exception 'FAIL B: receipt %', r; end if;
  select count(*) into n from public.event_conflicts_in_range('0a000000-0000-4000-8000-000000000001', now(), now()+interval '7 days');
  if n <> 0 then raise exception 'FAIL B: % conflict rows remain after the cancellation', n; end if;
  raise notice 'PASS B: cancel — coach refused, owner receipt %, conflicts cleared', r->>'status';
end $$;

-- C · anon holds nothing ──
do $$ declare n int; begin
  select count(*) into n from information_schema.role_routine_grants where grantee = 'anon' and specific_schema = 'public' and routine_name in ('event_conflicts_in_range','cancel_event','mark_attendance');
  if n <> 0 then raise exception 'FAIL C: anon can execute % schedule functions', n; end if;
  raise notice 'PASS C: no schedule function is executable by anon';
end $$;
