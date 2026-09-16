-- Disposable-database fixture for spec 12 SLICE 2 — conflict detection (12.3)
-- and cancellation (12.4). Migration 20260915_001069 on top of slice 1
-- (001050 … 001055, 001066). Never runs against production.
--
-- Reminders, ICS and publication (12.5/12.6) are slice 3 and have their own
-- fixture; nothing here calls them.
--
--     bash tools/run-sql-fixtures.sh 2026-09-16-spec12-slice2
--
-- RED-FIRST: run with the 001069 \ir line removed and group A fails on
-- "function public.detect_event_conflicts(uuid) does not exist" — that is the
-- RED evidence. With the include present every group must PASS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_sched_slicetwo' then
    raise exception 'refusing to run outside the disposable sporv_spec_sched_slicetwo database (got %)', current_database();
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

-- ── the migrations under test ───────────────────────────────────────────────
\ir ../../supabase/migrations/20260915_001050_venue_and_blackout.sql
\ir ../../supabase/migrations/20260915_001051_event_series.sql
\ir ../../supabase/migrations/20260915_001052_event.sql
\ir ../../supabase/migrations/20260915_001053_migration_quarantine.sql
\ir ../../supabase/migrations/20260915_001055_event_response_and_attendance.sql
\ir ../../supabase/migrations/20260915_001066_series_materializer.sql
\ir ../../supabase/migrations/20260915_001069_event_conflicts_and_cancellation.sql

-- ── fixture: org A (owner uA) with two teams, one shared field, one shared
--    coach, one dual-rostered athlete; org B (owner uB) ───────────────────────
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b');
insert into public.providers (id, owner_id, business_name) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC'),
  ('0b000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','Other Club');
insert into public.organization_members (id, organization_id, member_user_id, role) values
  ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001',null,'trainer'); -- the shared coach
insert into public.teams (id, provider_id, name) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight'),
  ('1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','16U Flight');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name, dob) values
  ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell','2013-04-02'),
  ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ben','Ortiz','2012-09-09'),
  ('3a000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Ava','Bell','2013-04-02'); -- dual-rostered
insert into public.guardians (id, provider_id, first_name, email_status) values
  ('4a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Renata','ok'),
  ('4a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Marcus','bounced');
insert into public.guardian_links (guardian_id, member_id, provider_id, is_payer) values
  ('4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001',true),
  ('4a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001',true);
insert into public.venue (id, provider_id, name, timezone) values
  ('5a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Northside Field','America/Chicago');
insert into public.blackout_window (id, provider_id, label, starts_at, ends_at) values
  ('6a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Spring break',
   now() + interval '10 days', now() + interval '10 days 2 hours');

-- e1: 14U at the field with the coach, inside the blackout; e2: 16U same field,
-- same coach, overlapping by 30 min; e3: 16U next week, no overlap; eB: org B.
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, venue_id, assigned_member_id) values
  ('7a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','14U practice',
   now() + interval '10 days', now() + interval '10 days 1 hour','America/Chicago','5a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001'),
  ('7a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','practice','16U practice',
   now() + interval '10 days 30 minutes', now() + interval '10 days 90 minutes','America/Chicago','5a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001'),
  ('7a000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','practice','16U next week',
   now() + interval '17 days', now() + interval '17 days 1 hour','America/Chicago','5a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', false);
insert into public.event (id, provider_id, kind, title, starts_at, ends_at, timezone) values
  ('7b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','practice','B practice',
   now() + interval '10 days', now() + interval '10 days 1 hour','America/Chicago');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);

-- A · all four classes fire on e1, exactly once each ─────────────────────────
do $$ declare kinds text[]; n int; begin
  select array_agg(conflict order by conflict), count(*) into kinds, n from public.detect_event_conflicts('7a000000-0000-4000-8000-000000000001');
  if kinds is distinct from array['athlete','blackout','staff','venue'] then
    raise exception 'FAIL A: expected athlete,blackout,staff,venue — got %', kinds; end if;
  raise notice 'PASS A: facility, staff, athlete and blackout conflicts all fire on the overlapping practice';
end $$;

-- B · the non-overlapping event has no conflicts; org B''s event sees none of org A ──
do $$ declare n int; begin
  select count(*) into n from public.detect_event_conflicts('7a000000-0000-4000-8000-000000000003');
  if n <> 0 then raise exception 'FAIL B: next week''s practice reports % conflicts', n; end if;
  select count(*) into n from public.detect_event_conflicts('7b000000-0000-4000-8000-000000000001');
  if n <> 0 then raise exception 'FAIL B: org B''s event conflicts with org A''s (%)', n; end if;
  raise notice 'PASS B: no false positives across time or across tenants';
end $$;

-- C · conflicts are warnings: the overlapping rows were INSERTED, nothing blocked ──
do $$ declare n int; begin
  select count(*) into n from public.event where provider_id = '0a000000-0000-4000-8000-000000000001' and status = 'scheduled';
  if n <> 3 then raise exception 'FAIL C: a conflict blocked an insert (% of 3 rows)', n; end if;
  raise notice 'PASS C: conflicts warn, they do not block';
end $$;

-- D · override needs a reason, records it with the conflicts it waved through ──
do $$ declare v jsonb; ok boolean := false; begin
  begin perform public.record_conflict_override('7a000000-0000-4000-8000-000000000001', '  ');
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL D: an empty reason was accepted'; end if;
  perform public.record_conflict_override('7a000000-0000-4000-8000-000000000001', 'Field manager confirmed two halves; coach splits time');
  select new_value into v from public.settings_audit where key = 'conflict_override' and surface = 'schedule';
  if v is null or v->>'reason' not like 'Field manager%' or jsonb_array_length(v->'conflicts') <> 4
     or (select changed_by from public.settings_audit where key = 'conflict_override') <> 'a0000000-0000-4000-8000-00000000000a'
    then raise exception 'FAIL D: override audit row wrong: %', v; end if;
  ok := false;
  begin perform public.record_conflict_override('7a000000-0000-4000-8000-000000000003', 'nothing to see');
  exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception 'FAIL D: an override was recorded on an event with no conflicts'; end if;
  raise notice 'PASS D: override requires a reason and records reason + the four conflicts + who';
end $$;

-- E · org B cannot override or cancel org A''s event ─────────────────────────
do $$ declare ok boolean := false; begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  begin perform public.record_conflict_override('7a000000-0000-4000-8000-000000000001', 'x'); exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL E: org B overrode org A''s conflict'; end if;
  ok := false;
  begin perform public.cancel_event('7a000000-0000-4000-8000-000000000001', 'x', true); exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'FAIL E: org B cancelled org A''s event'; end if;
  raise notice 'PASS E: cross-tenant override and cancel are refused (42501)';
end $$;

-- F · cancel a PUBLISHED event: five effects ──────────────────────────────────
update public.event set published_at = now() where provider_id = '0a000000-0000-4000-8000-000000000001';
do $$ declare r jsonb; e public.event; n int; seq_before int; begin
  select sequence into seq_before from public.event where id = '7a000000-0000-4000-8000-000000000001';
  r := public.cancel_event('7a000000-0000-4000-8000-000000000001', 'Lightning within 8 miles', true);
  select * into e from public.event where id = '7a000000-0000-4000-8000-000000000001';
  -- 1 status + reason
  if e.status <> 'cancelled' or e.cancellation_reason <> 'Lightning within 8 miles' then raise exception 'FAIL F1: status=% reason=%', e.status, e.cancellation_reason; end if;
  -- 2 one cancellation DRAFT per rostered family (2 athletes on 14U; Ben''s payer bounced → still drafted, guardian null)
  select count(*) into n from public.obligations where draft_type = 'schedule_cancellation' and status = 'draft' and source_ref like 'event:7a000000-0000-4000-8000-000000000001:cancel:%';
  if n <> 2 or (r->>'drafted_notices')::int <> 2 then raise exception 'FAIL F2: % drafts, receipt says %', n, r->>'drafted_notices'; end if;
  if exists (select 1 from public.obligations where draft_type = 'schedule_cancellation' and detail not like '%is cancelled (Lightning within 8 miles).') then raise exception 'FAIL F2: draft text lacks the reason'; end if;
  if (select count(*) from public.outbound_messages) <> 0 then raise exception 'FAIL F2: something was queued to send — draft-first violated'; end if;
  -- 3 ICS: SEQUENCE bumped so a feed re-emits the event as changed
  if e.sequence <> seq_before + 1 or (r->>'sequence')::int <> e.sequence then raise exception 'FAIL F3: sequence % → % (receipt %)', seq_before, e.sequence, r->>'sequence'; end if;
  -- 4 audit row
  if not exists (select 1 from public.settings_audit where key = 'event_cancelled' and new_value->>'reason' = 'Lightning within 8 miles'
                 and (new_value->>'drafted_notices')::int = 2 and changed_by = 'a0000000-0000-4000-8000-00000000000a') then raise exception 'FAIL F4: no audit row'; end if;
  -- 5 facility released: e2 no longer conflicts with e1 on venue, staff or athlete.
  --   Its own blackout conflict (e2 starts 30 min into the window) is unrelated to e1 and must remain.
  if (select array_agg(conflict order by conflict) from public.detect_event_conflicts('7a000000-0000-4000-8000-000000000002')) is distinct from array['blackout']
     or (r->>'venue_released')::boolean is not true
    then raise exception 'FAIL F5: after cancel, e2 has % / venue_released=%',
      (select array_agg(conflict order by conflict) from public.detect_event_conflicts('7a000000-0000-4000-8000-000000000002')), r->>'venue_released'; end if;
  raise notice 'PASS F: cancel → status+reason, 2 family drafts (nothing sent), SEQUENCE+1, audit row, field released';
end $$;

-- G · cancelling twice is a no-op receipt; a silent cancel drafts nothing ───
do $$ declare r jsonb; n int; begin
  r := public.cancel_event('7a000000-0000-4000-8000-000000000001', 'again', true);
  if (r->>'already_cancelled')::boolean is not true or (r->>'drafted_notices')::int <> 0 then raise exception 'FAIL G: second cancel: %', r; end if;
  select count(*) into n from public.obligations where draft_type = 'schedule_cancellation';
  if n <> 2 then raise exception 'FAIL G: second cancel added drafts (%)', n; end if;
  r := public.cancel_event('7a000000-0000-4000-8000-000000000003', null, false);
  select count(*) into n from public.obligations where source_ref like 'event:7a000000-0000-4000-8000-000000000003:%';
  if n <> 0 or (r->>'drafted_notices')::int <> 0 then raise exception 'FAIL G: silent cancel drafted % notices', n; end if;
  if (select status from public.event where id = '7a000000-0000-4000-8000-000000000003') <> 'cancelled' then raise exception 'FAIL G: silent cancel did not cancel'; end if;
  if not exists (select 1 from public.settings_audit where key = 'event_cancelled' and (new_value->>'notify')::boolean = false) then raise exception 'FAIL G: silent cancel wrote no audit row'; end if;
  raise notice 'PASS G: idempotent receipt; notify=false cancels with an audit row and no drafts';
end $$;

-- H · moving a published future event drafts a change notice; an unpublished one tells nobody ──
do $$ declare n int; begin
  update public.event set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = '7a000000-0000-4000-8000-000000000002';
  select count(*) into n from public.obligations where draft_type = 'schedule_change_notice' and source_ref like 'event:7a000000-0000-4000-8000-000000000002:change:%';
  if n <> 1 then raise exception 'FAIL H: expected 1 change draft (16U has one rostered athlete), got %', n; end if;
  update public.event set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = '7a000000-0000-4000-8000-000000000002';
  select count(*) into n from public.obligations where draft_type = 'schedule_change_notice';
  if n <> 1 then raise exception 'FAIL H: a second move duplicated the draft (%)', n; end if;
  insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone) values
    ('7a000000-0000-4000-8000-000000000004','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','unpublished',
     now() + interval '20 days', now() + interval '20 days 1 hour','America/Chicago');
  update public.event set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = '7a000000-0000-4000-8000-000000000004';
  select count(*) into n from public.obligations where source_ref like 'event:7a000000-0000-4000-8000-000000000004:%';
  if n <> 0 then raise exception 'FAIL H: an unpublished event drafted % notices', n; end if;
  raise notice 'PASS H: change notice drafted once per family for a published move; unpublished moves are silent';
end $$;

-- I · anon holds nothing here ────────────────────────────────────────────────
do $$ declare n int; begin
  select count(*) into n from information_schema.role_routine_grants where grantee = 'anon' and specific_schema = 'public'
    and routine_name in ('detect_event_conflicts','event_conflicts_in_range','record_conflict_override','event_family_recipients','cancel_event');
  if n <> 0 then raise exception 'FAIL I: anon can execute % slice-2 functions', n; end if;
  raise notice 'PASS I: no slice-2 function is executable by anon';
end $$;
