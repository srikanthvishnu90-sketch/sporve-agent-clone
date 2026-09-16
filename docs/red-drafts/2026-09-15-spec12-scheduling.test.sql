-- Disposable-database fixture for spec 12 SLICE 1 — the object model (12.1,
-- 12.2) and the migration of existing sessions (12.7). Migrations
-- 20260915_001050 … 001055 and 001066. Never runs against production.
--
-- Conflict detection and cancellation (12.3/12.4) and ICS and publication
-- (12.5/12.6) are slices 2 and 3 and have their own fixtures; nothing here
-- calls them, and this file must not grow to cover them.
--
--     createdb sporv_spec_sched
--     bash tools/run-sql-fixtures.sh 2026-09-15-spec12
--
-- RED-FIRST: run with the \ir lines below removed and every assertion fails on
-- "relation public.event does not exist" — that is the RED evidence. With the
-- includes present the same assertions must all PASS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_sched' then
    raise exception 'refusing to run outside the disposable sporv_spec_sched database (got %)', current_database();
  end if;
end $$;

-- ── minimal stand-ins for what the migrations reference ───────────────────
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

-- ── the migrations under test (remove these lines for the RED run) ─────────
\ir ../../supabase/migrations/20260915_001050_venue_and_blackout.sql
\ir ../../supabase/migrations/20260915_001051_event_series.sql
\ir ../../supabase/migrations/20260915_001052_event.sql
\ir ../../supabase/migrations/20260915_001053_migration_quarantine.sql
\ir ../../supabase/migrations/20260915_001055_event_response_and_attendance.sql
\ir ../../supabase/migrations/20260915_001066_series_materializer.sql

-- ── fixture data: org A (owner uA), org B (owner uB) ───────────────────────
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b'), ('c0000000-0000-4000-8000-00000000000c');
insert into public.providers (id, owner_id, business_name) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC'),
  ('0b000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','Other Club');
insert into public.organization_members (id, organization_id, member_user_id, role) values
  ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','admin');
insert into public.teams (id, provider_id, name) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight'),
  ('1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','16U Flight');
insert into public.programs (id, provider_id, title) values ('2a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','U14 Travel');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name, dob) values
  ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell','2013-04-02'),
  ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ben','Ortiz','2012-09-09'),
  ('3a000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Ava','Bell','2013-04-02'); -- dual-rostered
insert into public.guardians (id, provider_id, user_id, first_name) values
  ('4a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','Maria'), -- linked to Ava only
  ('4a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001',null,'James');
insert into public.guardian_links (guardian_id, member_id, provider_id) values
  ('4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001'),
  ('4a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001');
insert into public.sessions (id, program_id, title, start_date, start_time, end_time, timezone) values
  ('5a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Tue practice','2026-10-06','18:00','19:30',null),
  ('5a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000001','Thu practice','2026-10-08','05:00 PM','06:30 PM','America/Chicago'),
  ('5a000000-0000-4000-8000-000000000003','2a000000-0000-4000-8000-000000000001','Bad row','2026-10-09','tea time',null,null);
insert into public.program_fixtures (program_id, starts_at, kind, opponent, location) values
  ('2a000000-0000-4000-8000-000000000001','2026-10-10 15:00+00','game','Northside','Field 3');

-- A. tables + forced RLS
do $$ declare n int; begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relname in ('venue','blackout_window','event_series','event','event_response','attendance_record','migration_quarantine')
     and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 7 then raise exception 'FAIL A: expected 7 tables with RLS enabled+forced, got %', n; end if;
  raise notice 'PASS A: 7 schedule tables exist with RLS forced';
end $$;

-- B. backfill: two parseable sessions → event, one quarantined; fixture → event; idempotent
\ir ../../supabase/migrations/20260915_001054_backfill_sessions_and_fixtures.sql
do $$ declare e int; q int; f int; begin
  select count(*) into e from public.event where source_session_id is not null;
  select count(*) into q from public.migration_quarantine where source_table='sessions';
  select count(*) into f from public.event where source_fixture_id is not null;
  if e <> 2 or q <> 1 or f <> 1 then raise exception 'FAIL B: events-from-sessions=% quarantined=% events-from-fixtures=%', e, q, f; end if;
  if (select starts_at from public.event where source_session_id='5a000000-0000-4000-8000-000000000002') <> '2026-10-08 17:00 America/Chicago'::timestamptz
    then raise exception 'FAIL B: "05:00 PM" did not parse to 17:00 Chicago'; end if;
  raise notice 'PASS B: sessions/fixtures copied, bad row quarantined (never dropped)';
end $$;
\ir ../../supabase/migrations/20260915_001054_backfill_sessions_and_fixtures.sql
do $$ begin
  if (select count(*) from public.event) <> 3 then raise exception 'FAIL B2: backfill is not idempotent'; end if;
  raise notice 'PASS B2: re-running the backfill adds nothing';
end $$;

-- act as org A's owner for the staff paths
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);

-- C. DST: Tue/Thu 18:00 Chicago across 2026-11-01 stays 18:00 local; UTC shifts by an hour
insert into public.venue (id, provider_id, name) values ('6a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Field 1');
insert into public.event_series (id, provider_id, team_id, kind, title, timezone, local_start_time, duration_minutes, rrule, series_start_date, series_end_date, venue_id)
values ('7a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Tue/Thu practice',
        'America/Chicago','18:00',90,'FREQ=WEEKLY;BYDAY=TU,TH','2026-10-27','2026-11-12','6a000000-0000-4000-8000-000000000001');
do $$ declare n int; oct timestamptz; nov timestamptz; begin
  n := public.materialize_event_series('7a000000-0000-4000-8000-000000000001', 180);
  if n <> 6 then raise exception 'FAIL C: expected 6 occurrences (Oct 27,29 Nov 3,5,10,12), got %', n; end if;
  select starts_at into oct from public.event where series_local_date='2026-10-29';
  select starts_at into nov from public.event where series_local_date='2026-11-03';
  if to_char(oct at time zone 'America/Chicago','HH24:MI') <> '18:00' or to_char(nov at time zone 'America/Chicago','HH24:MI') <> '18:00'
    then raise exception 'FAIL C: local time drifted across DST (% / %)', oct, nov; end if;
  if extract(hour from oct at time zone 'UTC') = extract(hour from nov at time zone 'UTC')
    then raise exception 'FAIL C: UTC instant did not move across DST — series stored as UTC?'; end if;
  raise notice 'PASS C: 18:00 local on both sides of DST; UTC instants differ by the DST hour';
end $$;

-- D. an edited occurrence becomes an exception, bumps SEQUENCE, and survives re-materialisation
update public.event set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where series_local_date='2026-11-05';
do $$ declare seq int; exc boolean; n int; again timestamptz; begin
  select sequence, is_exception into seq, exc from public.event where series_local_date='2026-11-05';
  if seq <> 1 or not exc then raise exception 'FAIL D: sequence=% is_exception=%', seq, exc; end if;
  n := public.materialize_event_series('7a000000-0000-4000-8000-000000000001', 180);
  select starts_at into again from public.event where series_local_date='2026-11-05';
  if n <> 0 or to_char(again at time zone 'America/Chicago','HH24:MI') <> '19:00'
    then raise exception 'FAIL D: re-materialise inserted % rows / reverted the exception', n; end if;
  raise notice 'PASS D: exception detached from regeneration, SEQUENCE bumped';
end $$;

-- F. unpublish is forbidden. Publication (12.6) is slice 3, so the event is
-- published with a direct write here: the guard permits null -> a value and
-- refuses only the reverse, which is exactly what this asserts.
update public.event set published_at = now() where series_id='7a000000-0000-4000-8000-000000000001';
do $$ begin
  begin
    update public.event set published_at = null where series_local_date='2026-10-27';
    raise exception 'FAIL F: unpublish was allowed';
  exception when sqlstate '55000' then raise notice 'PASS F: unpublish rejected (cancel instead)'; end;
end $$;

-- G. a guardian cannot RSVP for an athlete they are not linked to
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', false); -- Maria (linked to Ava only); also an admin member → make her a plain guardian for this test
update public.organization_members set is_active = false where member_user_id='c0000000-0000-4000-8000-00000000000c';
do $$ declare ev uuid; begin
  select id into ev from public.event where series_local_date='2026-11-03';
  perform public.set_event_response(ev, '3a000000-0000-4000-8000-000000000001', 'yes', 'web');   -- Ava: linked → ok
  begin
    perform public.set_event_response(ev, '3a000000-0000-4000-8000-000000000002', 'yes', 'web'); -- Ben: NOT linked
    raise exception 'FAIL G: guardian RSVP''d for an unlinked athlete';
  exception when sqlstate '42501' then null; end;
  if (select response from public.event_response where event_id=ev and member_id='3a000000-0000-4000-8000-000000000001') <> 'yes'
    then raise exception 'FAIL G: linked RSVP not recorded'; end if;
  raise notice 'PASS G: guardian RSVP limited to linked athletes; the linked one is recorded';
end $$;
update public.organization_members set is_active = true where member_user_id='c0000000-0000-4000-8000-00000000000c';

-- H. org B reads ZERO of org A's events through RLS (as the authenticated role)
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', false);
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.event;
  if n <> 0 then raise exception 'FAIL H: org B can read % of org A''s events', n; end if;
  select count(*) into n from public.event_response; if n <> 0 then raise exception 'FAIL H: org B reads RSVPs'; end if;
  raise notice 'PASS H: cross-tenant read returns zero rows, not an error';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);

-- I. attendance: not before start; idempotent by client_id; append-only
-- The "future" event is created relative to now(), never a fixed date: a
-- calendar date hardcoded as future stops being future, and the fixture would
-- start failing on its own the day it passed (CodeRabbit, PR #5).
do $$ declare fut uuid; past uuid; r1 uuid; r2 uuid; begin
  insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, published_at)
    values ('8a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Tomorrow',
            now() + interval '1 day', now() + interval '25 hours', 'America/Chicago', now())
  returning id into fut;
  begin
    perform public.mark_attendance(fut, '3a000000-0000-4000-8000-000000000001', 'present', '9a000000-0000-4000-8000-000000000001');
    raise exception 'FAIL I: attendance accepted before the event started';
  exception when sqlstate '22023' then null; end;
  insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, published_at)
    values ('8a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Yesterday',
            now() - interval '1 day', now() - interval '23 hours', 'America/Chicago', now() - interval '2 days');
  past := '8a000000-0000-4000-8000-000000000001';
  r1 := (public.mark_attendance(past, '3a000000-0000-4000-8000-000000000001', 'present', '9a000000-0000-4000-8000-000000000002')).id;
  r2 := (public.mark_attendance(past, '3a000000-0000-4000-8000-000000000001', 'present', '9a000000-0000-4000-8000-000000000002')).id; -- offline replay
  if r1 <> r2 or (select count(*) from public.attendance_record) <> 1 then raise exception 'FAIL I: replay produced a second row'; end if;
  perform public.mark_attendance(past, '3a000000-0000-4000-8000-000000000001', 'late', '9a000000-0000-4000-8000-000000000003');
  if (select state from public.attendance_current where event_id=past and member_id='3a000000-0000-4000-8000-000000000001') <> 'late'
    then raise exception 'FAIL I: read model did not take the latest row'; end if;
  begin
    update public.attendance_record set state='absent' where client_id='9a000000-0000-4000-8000-000000000002';
    raise exception 'FAIL I: attendance row was updated';
  exception when sqlstate '55000' then null; end;
  if exists (select 1 from public.event_response er where er.event_id=past) then raise exception 'FAIL I: attendance wrote an RSVP'; end if;
  raise notice 'PASS I: no attendance before start; replay-safe; append-only; RSVP untouched';
end $$;
