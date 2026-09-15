-- Disposable-database fixture for spec 12 (scheduling + attendance), migrations
-- 20260915_001050 … 001058. Never runs against production.
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
\ir ../../supabase/migrations/20260915_001056_event_notices_and_reminders.sql
\ir ../../supabase/migrations/20260915_001057_series_materializer_and_conflicts.sql
\ir ../../supabase/migrations/20260915_001058_calendar_feed_tokens.sql

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
   where s.nspname='public' and c.relname in ('venue','blackout_window','event_series','event','event_response','attendance_record','calendar_feed_tokens','migration_quarantine')
     and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 8 then raise exception 'FAIL A: expected 8 tables with RLS enabled+forced, got %', n; end if;
  raise notice 'PASS A: 8 schedule tables exist with RLS forced';
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

-- E. publish seeds explicit no_response for every rostered athlete
do $$ declare n int; r int; begin
  n := public.publish_series('7a000000-0000-4000-8000-000000000001');
  select count(*) into r from public.event_response er join public.event e on e.id=er.event_id
   where e.series_id='7a000000-0000-4000-8000-000000000001' and er.response='no_response';
  if n <> 6 or r <> 12 then raise exception 'FAIL E: published=% no_response rows=% (want 6 / 12 = 6 events x 2 rostered)', n, r; end if;
  raise notice 'PASS E: publish seeds no_response (denominator) for 2 athletes x 6 events';
end $$;

-- F. unpublish is forbidden
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
  raise notice 'PASS G: guardian RSVP limited to linked athletes; no_response → yes recorded';
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
do $$ declare fut uuid; past uuid; r1 uuid; r2 uuid; begin
  select id into fut from public.event where series_local_date='2026-11-10';
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

-- J. cancellation: status, audit row, drafts (never sends), receipt
do $$ declare ev uuid; rc jsonb; begin
  select id into ev from public.event where series_local_date='2026-11-12';
  rc := public.cancel_event(ev, 'weather', true);
  if (select status from public.event where id=ev) <> 'cancelled' then raise exception 'FAIL J: not cancelled'; end if;
  if (rc->>'drafted_notices')::int < 2 then raise exception 'FAIL J: expected >=2 drafted notices, got %', rc; end if;
  if (select count(*) from public.obligations where draft_type='schedule_cancellation' and status='draft') < 2 then raise exception 'FAIL J: no cancellation drafts'; end if;
  if (select count(*) from public.settings_audit where key='event_cancelled') <> 1 then raise exception 'FAIL J: no audit row'; end if;
  if (select count(*) from public.outbound_messages) <> 0 then raise exception 'FAIL J: something was SENT — draft-first violated'; end if;
  if (select sequence from public.event where id=ev) < 1 then raise exception 'FAIL J: SEQUENCE not bumped on cancel'; end if;
  raise notice 'PASS J: cancel → status+reason, audit row, 2 drafts, 0 sends, SEQUENCE bumped (receipt %)', rc;
end $$;

-- K. reminders draft-first and dedupe
do $$ declare ev uuid; n int; begin
  insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, published_at)
    values ('8a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Tomorrow',
            ((current_date + 1) + time '18:00') at time zone 'America/Chicago', ((current_date + 1) + time '19:00') at time zone 'America/Chicago', 'America/Chicago', now());
  n := public.generate_event_reminders(null, true);
  if n <> 2 then raise exception 'FAIL K: expected 2 reminder drafts, got %', n; end if;
  if exists (select 1 from public.obligations where draft_type='event_reminder' and status <> 'draft') then raise exception 'FAIL K: reminder not in draft'; end if;
  if public.generate_event_reminders(null, true) <> 0 then raise exception 'FAIL K: reminders not deduped'; end if;
  if (select count(*) from public.outbound_messages) <> 0 then raise exception 'FAIL K: reminder bypassed the outbound path'; end if;
  raise notice 'PASS K: 2 reminder drafts, deduped on rerun, nothing sent';
end $$;

-- L. conflicts: all four classes fire; override records a reason
insert into public.blackout_window (provider_id, label, starts_at, ends_at) values ('0a000000-0000-4000-8000-000000000001','League dark week','2026-11-02','2026-11-05');
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, venue_id, assigned_member_id, published_at)
  select '8a000000-0000-4000-8000-000000000003', provider_id, '1a000000-0000-4000-8000-000000000002', 'practice', '16U overlap', starts_at, ends_at, timezone, venue_id,
         '0c000000-0000-4000-8000-000000000001', now()
  from public.event where series_local_date='2026-11-03';
update public.event set assigned_member_id='0c000000-0000-4000-8000-000000000001' where series_local_date='2026-11-03';
do $$ declare kinds text[]; begin
  select array_agg(distinct conflict order by conflict) into kinds from public.detect_event_conflicts('8a000000-0000-4000-8000-000000000003');
  if kinds <> array['athlete','blackout','staff','venue'] then raise exception 'FAIL L: conflicts fired = %', kinds; end if;
  perform public.record_conflict_override('8a000000-0000-4000-8000-000000000003', 'both coaches agreed to share the field');
  if (select count(*) from public.settings_audit where key='conflict_override') <> 1 then raise exception 'FAIL L: override not audited'; end if;
  begin perform public.record_conflict_override('8a000000-0000-4000-8000-000000000003', '  '); raise exception 'FAIL L: empty reason accepted';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS L: venue/staff/athlete/blackout conflicts all fire; override needs and records a reason';
end $$;

-- M. feed: token works, carries no athlete name, revoked → zero rows (404)
do $$ declare tok text; n int; bad int; begin
  tok := public.issue_calendar_feed_token('4a000000-0000-4000-8000-000000000001');
  if length(tok) <> 64 then raise exception 'FAIL M: token is not 256-bit hex (%)', length(tok); end if;
  select count(*) into n from public.calendar_feed_events(tok);
  if n < 6 then raise exception 'FAIL M: feed returned % rows', n; end if;
  select count(*) into bad from public.calendar_feed_events(tok) f
   where f.summary ilike '%Ava%' or f.summary ilike '%Bell%' or f.description ilike '%Ava%' or f.location ilike '%Bell%';
  if bad > 0 then raise exception 'FAIL M: athlete name leaked into the feed'; end if;
  if not exists (select 1 from public.calendar_feed_events(tok) f where f.status='CANCELLED') then raise exception 'FAIL M: cancelled event missing STATUS:CANCELLED'; end if;
  if not public.revoke_calendar_feed_token(tok) then raise exception 'FAIL M: revoke returned false'; end if;
  select count(*) into n from public.calendar_feed_events(tok);
  if n <> 0 then raise exception 'FAIL M: revoked token still returns % rows', n; end if;
  if (select count(*) from public.calendar_feed_events('deadbeef')) <> 0 then raise exception 'FAIL M: bogus token returned rows'; end if;
  raise notice 'PASS M: guardian-scoped feed, no athlete names, cancelled flagged, revoked/unknown token → nothing';
end $$;
