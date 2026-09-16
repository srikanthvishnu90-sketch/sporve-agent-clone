-- Disposable-database fixture for spec 12 SLICE 3 — publication (12.6), event
-- reminders, and the per-guardian ICS feed (12.5). Migration 20260915_001070 on
-- top of slices 1 and 2. Never runs against production.
--
--     bash tools/run-sql-fixtures.sh 2026-09-16-spec12-slice3
--
-- RED-FIRST: run with the 001070 \ir line removed and group A fails on
-- "function public.publish_series(uuid) does not exist". With the include
-- present every group must PASS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_sched_slicethree' then
    raise exception 'refusing to run outside the disposable sporv_spec_sched_slicethree database (got %)', current_database();
  end if;
end $$;

-- ── minimal stand-ins for what the migrations reference (same as slice 1) ──
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
create table public.provider_settings (provider_id uuid, key text, value jsonb);

\ir ../../supabase/migrations/20260915_001050_venue_and_blackout.sql
\ir ../../supabase/migrations/20260915_001051_event_series.sql
\ir ../../supabase/migrations/20260915_001052_event.sql
\ir ../../supabase/migrations/20260915_001053_migration_quarantine.sql
\ir ../../supabase/migrations/20260915_001055_event_response_and_attendance.sql
\ir ../../supabase/migrations/20260915_001066_series_materializer.sql
\ir ../../supabase/migrations/20260915_001069_event_conflicts_and_cancellation.sql
\ir ../../supabase/migrations/20260915_001070_publication_reminders_calendar_feed.sql

-- ── fixture: org A, two teams, Ava Bell on both (dual-rostered), Ben Ortiz on 14U;
--    Renata (payer, ok) is Ava's guardian; Marcus (bounced) is Ben's. ──────────
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b');
insert into public.providers (id, owner_id, business_name) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC'),
  ('0b000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','Other Club');
insert into public.teams (id, provider_id, name) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight'),
  ('1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','16U Flight');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name, dob) values
  ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell','2013-04-02'),
  ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ben','Ortiz','2012-09-09'),
  ('3a000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Ava','Bell','2013-04-02');
insert into public.guardians (id, provider_id, first_name, email_status) values
  ('4a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Renata','ok'),
  ('4a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Marcus','bounced');
insert into public.guardian_links (id, guardian_id, member_id, provider_id, is_payer) values
  ('8a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001',true),
  ('8a000000-0000-4000-8000-000000000002','4a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001',true);
insert into public.venue (id, provider_id, name, address, timezone) values
  ('5a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Northside Field','12 Field Rd, Rivertown','America/Chicago');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);
-- a Tue/Thu 18:00 series for 14U over the next weeks (materialised now), plus one 16U event tomorrow
insert into public.event_series (id, provider_id, team_id, kind, title, timezone, local_start_time, duration_minutes, rrule, series_start_date, series_end_date, venue_id)
values ('9a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Practice','America/Chicago','18:00',90,
        'FREQ=WEEKLY;BYDAY=TU,TH', current_date + 1, current_date + 28, '5a000000-0000-4000-8000-000000000001');
select public.materialize_event_series('9a000000-0000-4000-8000-000000000001', 60);
update public.event set arrival_offset_minutes = 15 where series_id = '9a000000-0000-4000-8000-000000000001';
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, location_text, notes) values
  ('7a000000-0000-4000-8000-000000000009','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','game','16U scrimmage',
   ((current_date + 1) + time '10:00') at time zone 'America/Chicago', ((current_date + 1) + time '11:30') at time zone 'America/Chicago','America/Chicago','Away gym','Ben Ortiz brings the balls');

-- A · unpublished events are invisible to the feed and carry no RSVP rows ───
do $$ declare tok text; n int; begin
  tok := public.issue_calendar_feed_token('4a000000-0000-4000-8000-000000000001');
  if tok !~ '^[0-9a-f]{64}$' then raise exception 'FAIL A: token is not 64-char lowercase hex'; end if;
  select count(*) into n from public.calendar_feed_events(tok);
  if n <> 0 then raise exception 'FAIL A: % unpublished events reached the feed', n; end if;
  select count(*) into n from public.event_response; if n <> 0 then raise exception 'FAIL A: RSVP rows exist before publication'; end if;
  raise notice 'PASS A: token is 256-bit hex; nothing is visible or seeded before publication';
end $$;

-- B · publish the series in one action: every occurrence published, no_response seeded per rostered athlete, receipt lists conflicts ──
do $$ declare r jsonb; ev int; rs int; begin
  r := public.publish_series('9a000000-0000-4000-8000-000000000001');
  select count(*) into ev from public.event where series_id = '9a000000-0000-4000-8000-000000000001' and published_at is not null;
  if ev < 6 or (r->>'published')::int <> ev then raise exception 'FAIL B: published % of series, receipt %', ev, r->>'published'; end if;
  select count(*) into rs from public.event_response where response = 'no_response';
  if rs <> ev * 2 then raise exception 'FAIL B: expected % no_response rows (2 athletes × % events), got %', ev*2, ev, rs; end if;
  if jsonb_typeof(r->'conflicts') <> 'array' then raise exception 'FAIL B: receipt carries no conflicts array'; end if;
  if not exists (select 1 from public.settings_audit where key = 'series_published') then raise exception 'FAIL B: no audit row'; end if;
  r := public.publish_series('9a000000-0000-4000-8000-000000000001');
  if (r->>'published')::int <> 0 then raise exception 'FAIL B: re-publish published % again', r->>'published'; end if;
  raise notice 'PASS B: one action publishes the series, seeds a real RSVP denominator, reports conflicts, and is idempotent';
end $$;

-- C · publish a date range: only the 16U game tomorrow; its rostered athlete gets a no_response row ──
do $$ declare r jsonb; begin
  r := public.publish_events('0a000000-0000-4000-8000-000000000001', current_date + 1, current_date + 1);
  if (r->>'published')::int <> 1 then raise exception 'FAIL C: range publish hit % events', r->>'published'; end if;
  if not exists (select 1 from public.event_response where event_id = '7a000000-0000-4000-8000-000000000009' and member_id = '3a000000-0000-4000-8000-000000000003') then raise exception 'FAIL C: no RSVP seed for the 16U athlete'; end if;
  raise notice 'PASS C: a date range publishes in one action';
end $$;

-- D · the feed: Renata sees BOTH teams (Ava is on both); no athlete name in any field; venue address; arrival note; staff notes never ──
do $$ declare tok text; n int; bad int; begin
  select token into tok from public.calendar_feed_tokens where guardian_id = '4a000000-0000-4000-8000-000000000001' and revoked_at is null;
  select count(*) into n from public.calendar_feed_events(tok);
  if n < 7 then raise exception 'FAIL D: expected the series + the 16U game, got %', n; end if;
  -- every fixture athlete name, first and last (carried CodeRabbit finding, PR #5)
  select count(*) into bad from public.calendar_feed_events(tok) f, public.team_athletes ta
    where f.summary ilike '%' || ta.first_name || '%' or f.summary ilike '%' || ta.last_name || '%'
       or coalesce(f.description,'') ilike '%' || ta.first_name || '%' or coalesce(f.description,'') ilike '%' || ta.last_name || '%'
       or coalesce(f.location,'') ilike '%' || ta.last_name || '%';
  if bad <> 0 then raise exception 'FAIL D: an athlete name reached the feed in % row(s)', bad; end if;
  if not exists (select 1 from public.calendar_feed_events(tok) where summary = '14U Flight — Practice' and location = '12 Field Rd, Rivertown' and description = 'Arrive 15 min early.' and status = 'CONFIRMED' and calname = 'Rivertown FC')
    then raise exception 'FAIL D: series row shape wrong'; end if;
  if exists (select 1 from public.calendar_feed_events(tok) where description ilike '%balls%') then raise exception 'FAIL D: staff notes leaked into the feed'; end if;
  if (select last_used_at from public.calendar_feed_tokens where token = tok) is null then raise exception 'FAIL D: last_used_at not stamped'; end if;
  raise notice 'PASS D: feed is team + title + venue + arrival; no athlete name, no staff notes';
end $$;

-- E · cancel one for weather → the feed emits CANCELLED with SEQUENCE+1; move another → SEQUENCE+1, CONFIRMED ──
do $$ declare tok text; e1 uuid; e2 uuid; s1 int; s2 int; f record; begin
  select token into tok from public.calendar_feed_tokens where guardian_id = '4a000000-0000-4000-8000-000000000001' and revoked_at is null;
  select id, sequence into e1, s1 from public.event where series_id = '9a000000-0000-4000-8000-000000000001' order by starts_at limit 1;
  select id, sequence into e2, s2 from public.event where series_id = '9a000000-0000-4000-8000-000000000001' order by starts_at offset 1 limit 1;
  perform public.cancel_event(e1, 'Lightning', true);
  update public.event set location_text = 'South Field', venue_id = null where id = e2;
  select * into f from public.calendar_feed_events(tok) where uid = e1;
  if f.status <> 'CANCELLED' or f.sequence <> s1 + 1 then raise exception 'FAIL E: cancelled row status=% seq=% (was %)', f.status, f.sequence, s1; end if;
  select * into f from public.calendar_feed_events(tok) where uid = e2;
  if f.status <> 'CONFIRMED' or f.sequence <> s2 + 1 or f.location <> 'South Field' then raise exception 'FAIL E: moved row status=% seq=% loc=%', f.status, f.sequence, f.location; end if;
  raise notice 'PASS E: cancel → STATUS:CANCELLED with SEQUENCE+1; move → SEQUENCE+1 with the new location';
end $$;

-- F · reminders: tomorrow's published events only, one draft per rostered family, idempotent, nothing sent ──
do $$ declare n int; m int; begin
  n := public.generate_event_reminders(null, true);
  -- tomorrow: the 16U game (1 athlete) and, if tomorrow is Tue/Thu, one 14U practice (2 athletes)
  select count(*) into m from public.event e cross join lateral public.event_family_recipients(e.id) r
    where e.published_at is not null and e.status = 'scheduled' and (e.starts_at at time zone e.timezone)::date = current_date + 1;
  if n <> m or m < 1 then raise exception 'FAIL F: drafted % reminders, expected %', n, m; end if;
  if (select count(*) from public.obligations where draft_type = 'event_reminder') <> m then raise exception 'FAIL F: draft count mismatch'; end if;
  if public.generate_event_reminders(null, true) <> 0 then raise exception 'FAIL F: second run duplicated reminders'; end if;
  if (select count(*) from public.outbound_messages) <> 0 then raise exception 'FAIL F: a reminder was queued to send'; end if;
  raise notice 'PASS F: % reminder draft(s) for tomorrow, idempotent, draft-first', n;
end $$;

-- G · token lifecycle: revoke → zero rows; reissue rotates; unlink the last athlete → revoked at once; org B cannot issue ──
do $$ declare tok text; tok2 text; n int; ok boolean := false; begin
  select token into tok from public.calendar_feed_tokens where guardian_id = '4a000000-0000-4000-8000-000000000001' and revoked_at is null;
  if not public.revoke_calendar_feed_token(tok) then raise exception 'FAIL G: revoke returned false'; end if;
  select count(*) into n from public.calendar_feed_events(tok); if n <> 0 then raise exception 'FAIL G: revoked token still serves % rows', n; end if;
  if public.revoke_calendar_feed_token(tok) then raise exception 'FAIL G: revoking twice returned true'; end if;
  tok2 := public.issue_calendar_feed_token('4a000000-0000-4000-8000-000000000001');
  if tok2 = tok then raise exception 'FAIL G: reissue returned the same token'; end if;
  select count(*) into n from public.calendar_feed_events(tok2); if n < 7 then raise exception 'FAIL G: new token serves % rows', n; end if;
  select count(*) into n from public.calendar_feed_events('zz' || left(tok2, 62)); if n <> 0 then raise exception 'FAIL G: malformed token served rows'; end if;
  delete from public.guardian_links where id = '8a000000-0000-4000-8000-000000000001';   -- Renata's only athlete link
  select count(*) into n from public.calendar_feed_events(tok2); if n <> 0 then raise exception 'FAIL G: unlinked guardian still has a feed (% rows)', n; end if;
  if (select revoked_at from public.calendar_feed_tokens where token = tok2) is null then raise exception 'FAIL G: token not revoked on unlink'; end if;
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  begin perform public.issue_calendar_feed_token('4a000000-0000-4000-8000-000000000002'); exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL G: org B issued a token for org A''s guardian'; end if;
  raise notice 'PASS G: revoke, rotate, malformed, unlink-revokes, cross-tenant refused';
end $$;

-- H · nothing here is reachable by anon or, for the feed reader, by authenticated ──
do $$ declare n int; begin
  select count(*) into n from information_schema.role_routine_grants where grantee = 'anon' and specific_schema = 'public'
    and routine_name in ('publish_series','publish_events','seed_no_response','generate_event_reminders','issue_calendar_feed_token','revoke_calendar_feed_token','calendar_feed_events','revoke_feed_on_unlink','draft_event_change_notices','agent_vocab');
  if n <> 0 then raise exception 'FAIL H: anon can execute % slice-3 functions', n; end if;
  if exists (select 1 from information_schema.role_routine_grants where grantee = 'authenticated' and routine_name = 'calendar_feed_events') then raise exception 'FAIL H: authenticated can read any feed'; end if;
  if exists (select 1 from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name = 'calendar_feed_tokens') then raise exception 'FAIL H: tokens table is readable'; end if;
  raise notice 'PASS H: feed reader is service_role only; tokens table is RPC only; anon holds nothing';
end $$;
