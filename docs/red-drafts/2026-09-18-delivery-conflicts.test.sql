-- Disposable-database fixture for audit 2026-09-17 P2-7 / P2-8 — errors a
-- client can act on (429 for the token ceiling) and edits that cannot silently
-- overwrite each other (409 on a stale sequence). Migration 20260915_001079 on
-- top of 001059, 001069, 001070, 001071, 001075.
--
--     bash tools/run-sql-fixtures.sh 2026-09-18-delivery-conflicts
--
-- RED-FIRST: remove the 001079 \ir line and group A fails on
-- "FAIL A: the ceiling still raises 53400, not PT429".
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_conflicts' then
    raise exception 'refusing to run outside the disposable sporv_spec_conflicts database (got %)', current_database();
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
create table public.outbound_messages (id uuid primary key default gen_random_uuid(), provider_id uuid, event_type text, status text, scheduled_for timestamptz, obligation_id uuid, content jsonb, created_at timestamptz default now());
create or replace function public.agent_autodraft_on(p uuid) returns boolean language sql as $$ select true $$;
create table public.settings_audit (id uuid primary key default gen_random_uuid(), provider_id uuid, surface text, key text, old_value jsonb, new_value jsonb, changed_by uuid, changed_at timestamptz default now());
grant select, insert, update, delete on all tables in schema public to authenticated;

-- stand-ins spec 13 needs beyond spec 12's
-- Supabase keeps pgcrypto in the `extensions` schema and puts that schema on the
-- database search_path; the shared stand-in header created it in public. Mirror
-- production so the migration's explicit `extensions.digest` resolves.
create schema if not exists extensions;
alter extension pgcrypto set schema extensions;
set search_path = public, extensions;
create table public.edge_rate_limits (actor_key text, scope text, window_start timestamptz, request_count int, primary key (actor_key, scope, window_start));
create or replace function public.consume_edge_rate_limit(p_actor_key text, p_scope text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path to '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds); c int;
begin
  insert into public.edge_rate_limits values (p_actor_key, p_scope, w, 1)
    on conflict (actor_key, scope, window_start) do update set request_count = public.edge_rate_limits.request_count + 1
    returning request_count into c;
  return c <= p_limit;
end $$;
alter table public.guardians add column email text, add column phone text;
create table public.provider_settings (provider_id uuid, key text, value jsonb);
\ir ../../supabase/migrations/20260915_001050_venue_and_blackout.sql
\ir ../../supabase/migrations/20260915_001051_event_series.sql
\ir ../../supabase/migrations/20260915_001052_event.sql
\ir ../../supabase/migrations/20260915_001053_migration_quarantine.sql
\ir ../../supabase/migrations/20260915_001055_event_response_and_attendance.sql
\ir ../../supabase/migrations/20260915_001066_series_materializer.sql
\ir ../../supabase/migrations/20260915_001069_event_conflicts_and_cancellation.sql
\ir ../../supabase/migrations/20260915_001070_publication_reminders_calendar_feed.sql
\ir ../../supabase/migrations/20260915_001059_guardian_access_token.sql
\ir ../../supabase/migrations/20260915_001071_event_drafts_deliverable.sql
\ir ../../supabase/migrations/20260915_001079_delivery_and_edit_conflicts.sql

insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b');
insert into public.providers (id, owner_id, business_name) values ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC');
insert into public.teams (id, provider_id, name) values ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name) values ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell');
insert into public.guardians (id, provider_id, first_name) values ('4a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Renata');
insert into public.guardian_links (guardian_id, member_id, provider_id) values ('4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, published_at) values
  ('7a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Tuesday practice', now()+interval '2 days', now()+interval '2 days 1 hour','America/Chicago', now()),
  ('7a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Thursday practice', now()+interval '4 days', now()+interval '4 days 1 hour','America/Chicago', now());

-- A · the issuance ceiling is a 429 the client can act on; the approve RPC still degrades the link, not the message ──
do $$ declare i int; code text := null; msg text; v_ob uuid; v_msg uuid; c jsonb; begin
  for i in 1..12 loop
    begin perform public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','rsvp','event','7a000000-0000-4000-8000-000000000001');
    exception when others then code := sqlstate; msg := sqlerrm; exit; end;
  end loop;
  if code is null then raise exception 'FAIL A: no issuance ceiling'; end if;
  if code <> 'PT429' then raise exception 'FAIL A: the ceiling still raises %, not PT429', code; end if;
  if msg not like '%try again in an hour%' then raise exception 'FAIL A: message % is not actionable', msg; end if;
  insert into public.obligations (id, provider_id, kind, status, title, detail, source_kind, source_ref, guardian_id, member_id)
    values ('6a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','schedule','draft','Reminder','Practice Tuesday','agent','event:7a000000-0000-4000-8000-000000000001:reminder:4a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001');
  v_msg := public.approve_obligation_and_queue('6a000000-0000-4000-8000-000000000001');
  select content into c from public.outbound_messages where id = v_msg;
  if c ->> 'rsvp_link_omitted' <> 'issuance_ceiling' or c ? 'rsvp_token' then raise exception 'FAIL A: under the ceiling the message must go without a link: %', c; end if;
  raise notice 'PASS A: ceiling → PT429 with an actionable message; approve still queues the message, link omitted';
end $$;

-- B · cancel with a stale sequence is refused with PT409; with the current sequence it proceeds; without one it still works (older clients) ──
do $$ declare code text := null; r jsonb; seq int; begin
  update public.event set title = 'Tuesday practice (moved)' where id = '7a000000-0000-4000-8000-000000000001';   -- someone else's edit bumps sequence to 1
  select sequence into seq from public.event where id = '7a000000-0000-4000-8000-000000000001';
  if seq <> 1 then raise exception 'FAIL B: sequence % after an edit', seq; end if;
  begin perform public.cancel_event('7a000000-0000-4000-8000-000000000001', 'rain', true, 0); exception when others then code := sqlstate; end;
  if code <> 'PT409' then raise exception 'FAIL B: stale cancel answered % instead of PT409', coalesce(code,'success'); end if;
  if (select status from public.event where id = '7a000000-0000-4000-8000-000000000001') <> 'scheduled' then raise exception 'FAIL B: a refused cancel changed the row'; end if;
  r := public.cancel_event('7a000000-0000-4000-8000-000000000001', 'rain', true, 1);
  if (r ->> 'status') <> 'cancelled' then raise exception 'FAIL B: current-sequence cancel failed %', r; end if;
  r := public.cancel_event('7a000000-0000-4000-8000-000000000002', null, false);
  if (r ->> 'status') <> 'cancelled' then raise exception 'FAIL B: three-argument cancel (older client) failed %', r; end if;
  raise notice 'PASS B: stale cancel → PT409 and nothing changed; current sequence cancels; older callers still work';
end $$;

-- C · edit_event: admin only; stale sequence refused; a real edit bumps the sequence and returns it; unknown fields refused ──
do $$ declare code text; r jsonb; begin
  insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, published_at) values
    ('7a000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','game','Saturday game', now()+interval '6 days', now()+interval '6 days 2 hours','America/Chicago', now());
  r := public.edit_event('7a000000-0000-4000-8000-000000000003', 0, '{"title":"Saturday game vs Northside","location_text":"Field 2"}');
  if (r ->> 'sequence')::int <> 1 or not (r ->> 'changed')::boolean then raise exception 'FAIL C: edit receipt %', r; end if;
  code := null; begin perform public.edit_event('7a000000-0000-4000-8000-000000000003', 0, '{"title":"second editor"}'); exception when others then code := sqlstate; end;
  if code <> 'PT409' then raise exception 'FAIL C: the second editor with a stale sequence got %, expected PT409', coalesce(code,'success'); end if;
  if (select title from public.event where id = '7a000000-0000-4000-8000-000000000003') <> 'Saturday game vs Northside' then raise exception 'FAIL C: the stale edit overwrote the first'; end if;
  code := null; begin perform public.edit_event('7a000000-0000-4000-8000-000000000003', 1, '{"status":"completed"}'); exception when others then code := sqlstate; end;
  if code <> '22023' then raise exception 'FAIL C: status is not an editable field here, got %', coalesce(code,'success'); end if;
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  code := null; begin perform public.edit_event('7a000000-0000-4000-8000-000000000003', 1, '{"title":"x"}'); exception when others then code := sqlstate; end;
  if code <> '42501' then raise exception 'FAIL C: a non-member edited an event (%)', coalesce(code,'success'); end if;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  raise notice 'PASS C: edit_event — first editor wins with a receipt, stale editor gets PT409, unknown fields 22023, non-member 42501';
end $$;

-- D · anon holds nothing ──
do $$ declare n int; begin
  select count(*) into n from information_schema.role_routine_grants where grantee = 'anon' and specific_schema = 'public' and routine_name in ('edit_event','cancel_event','issue_guardian_token','approve_obligation_and_queue');
  if n <> 0 then raise exception 'FAIL D: anon can execute % of these', n; end if;
  raise notice 'PASS D: no anon grants';
end $$;
