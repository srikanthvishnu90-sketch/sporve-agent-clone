-- Disposable-database fixture for audit 2026-09-17 P1-1 — staff can work in the
-- org that employs them. Migration 20260915_001075 on top of spec 12 slice 1.
--
--     bash tools/run-sql-fixtures.sh 2026-09-17-staff-access
--
-- RED-FIRST: remove the 001075 \ir line and group A fails on
-- "function public.my_workspace() does not exist".
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_staff' then
    raise exception 'refusing to run outside the disposable sporv_spec_staff database (got %)', current_database();
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
\ir ../../supabase/migrations/20260915_001075_staff_workspace_access.sql

-- ── org A (owner uA; trainer uC coaches team 1 only); org B (owner uD); uE has only an untouched auto-org ──
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('c0000000-0000-4000-8000-00000000000c'), ('d0000000-0000-4000-8000-00000000000d'), ('e0000000-0000-4000-8000-00000000000e');
insert into public.providers (id, owner_id, business_name, onboarding_completed, provider_type) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC', true, 'organization'),
  ('0c000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-00000000000c','Your organization', false, null),   -- the trainer's untouched auto-org
  ('0b000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-00000000000d','Other Club', true, 'organization'),
  ('0e000000-0000-4000-8000-000000000009','e0000000-0000-4000-8000-00000000000e','Your organization', false, null);
insert into public.organization_members (id, organization_id, member_user_id, role) values
  ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','trainer');
insert into public.teams (id, provider_id, name) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight'),
  ('1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','16U Flight');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name) values
  ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell'),
  ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ben','Ortiz'),
  ('3a000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Cara','Nguyen');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, assigned_member_id, published_at) values
  ('7a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','14U practice (mine)', now()-interval '1 hour', now()+interval '30 minutes','America/Chicago','0c000000-0000-4000-8000-000000000001', now()),
  ('7a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','practice','16U practice (not mine)', now()-interval '1 hour', now()+interval '30 minutes','America/Chicago',null, now());
insert into public.venue (id, provider_id, name, timezone) values ('5a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Field','America/Chicago');

-- A · my_workspace: trainer → employer org as coach; owner → own org; untouched-only user → own org; anon → nothing ──
do $$ declare r record; n int; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  select * into r from public.my_workspace();
  if r.provider_id <> '0a000000-0000-4000-8000-000000000001' or r.role <> 'coach' or r.member_id <> '0c000000-0000-4000-8000-000000000001' or r.business_name <> 'Rivertown FC'
    then raise exception 'FAIL A: trainer resolved to % % %', r.provider_id, r.role, r.business_name; end if;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  select * into r from public.my_workspace(); if r.role <> 'owner' or r.business_name <> 'Rivertown FC' then raise exception 'FAIL A: owner resolved to %', r.role; end if;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-00000000000e', true);
  select * into r from public.my_workspace(); if r.role <> 'owner' or r.provider_id <> '0e000000-0000-4000-8000-000000000009' then raise exception 'FAIL A: no-membership user resolved to %', r.provider_id; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into n from public.my_workspace(); if n <> 0 then raise exception 'FAIL A: anon got a workspace'; end if;
  raise notice 'PASS A: my_workspace — trainer lands in the employer org as coach; owners and unattached users in their own';
end $$;

-- B · the trainer reads THEIR team only: roster, teams, events; zero rows elsewhere; org B reads nothing ──
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true); perform set_config('role', 'authenticated', true);
  select count(*) into n from public.team_athletes; if n <> 2 then raise exception 'FAIL B: trainer sees % athletes, expected the 2 on 14U', n; end if;
  select count(*) into n from public.team_athletes where team_id = '1a000000-0000-4000-8000-000000000002'; if n <> 0 then raise exception 'FAIL B: trainer sees the other team''s roster'; end if;
  select count(*) into n from public.teams; if n <> 1 then raise exception 'FAIL B: trainer sees % teams', n; end if;
  select count(*) into n from public.event; if n <> 1 then raise exception 'FAIL B: trainer sees % events, expected only their own', n; end if;
  select count(*) into n from public.providers where id = '0a000000-0000-4000-8000-000000000001'; if n <> 1 then raise exception 'FAIL B: trainer cannot read the employer org row'; end if;
  select count(*) into n from public.organization_members; if n <> 1 then raise exception 'FAIL B: trainer sees % membership rows, expected own', n; end if;
  select count(*) into n from public.venue; if n <> 1 then raise exception 'FAIL B: trainer cannot read venues'; end if;
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-00000000000d', true);
  select count(*) into n from public.team_athletes; if n <> 0 then raise exception 'FAIL B: org B owner reads org A athletes'; end if;
  select count(*) into n from public.event; if n <> 0 then raise exception 'FAIL B: org B owner reads org A events'; end if;
  select count(*) into n from public.providers where id = '0a000000-0000-4000-8000-000000000001'; if n <> 0 then raise exception 'FAIL B: org B owner reads org A provider'; end if;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS B: coached team only — roster 2, teams 1, events 1; other team 0; org B 0 everywhere';
end $$;

-- C · attendance: the assigned coach may mark it on their event; refused on the other team's; the owner may mark both ──
do $$ declare r public.attendance_record; ok boolean := false; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  r := public.mark_attendance('7a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000001', 'present', gen_random_uuid());
  if r.marked_by <> 'c0000000-0000-4000-8000-00000000000c' then raise exception 'FAIL C: marked_by %', r.marked_by; end if;
  begin perform public.mark_attendance('7a000000-0000-4000-8000-000000000002', '3a000000-0000-4000-8000-000000000003', 'present', gen_random_uuid());
  exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL C: trainer marked attendance on a team they do not coach'; end if;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  r := public.mark_attendance('7a000000-0000-4000-8000-000000000002', '3a000000-0000-4000-8000-000000000003', 'present', gen_random_uuid());
  ok := false; perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-00000000000d', true);
  begin perform public.mark_attendance('7a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000001', 'present', gen_random_uuid()); exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL C: org B owner marked org A attendance'; end if;
  raise notice 'PASS C: attendance — assigned coach yes, other team no, owner yes, other org no';
end $$;

-- D · membership revoked: the next resolve falls back to the trainer''s own org; rows go to zero ──
do $$ declare r record; n int; begin
  update public.organization_members set is_active = false where id = '0c000000-0000-4000-8000-000000000001';
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  select * into r from public.my_workspace(); if r.provider_id <> '0c000000-0000-4000-8000-000000000009' or r.role <> 'owner' then raise exception 'FAIL D: revoked trainer still resolved to %', r.provider_id; end if;
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.team_athletes; if n <> 0 then raise exception 'FAIL D: revoked trainer still reads % athletes', n; end if;
  select count(*) into n from public.event; if n <> 0 then raise exception 'FAIL D: revoked trainer still reads events'; end if;
  perform set_config('role', 'postgres', true);
  update public.organization_members set is_active = true where id = '0c000000-0000-4000-8000-000000000001';
  raise notice 'PASS D: a revoked membership fails closed at the next request';
end $$;

-- E · anon holds nothing ──
do $$ declare n int; begin
  select count(*) into n from information_schema.role_routine_grants where grantee = 'anon' and specific_schema = 'public'
    and routine_name in ('my_workspace','is_org_member','my_member_id','coaches_team','coaches_event','mark_attendance');
  if n <> 0 then raise exception 'FAIL E: anon can execute % staff functions', n; end if;
  raise notice 'PASS E: no staff function is executable by anon';
end $$;
