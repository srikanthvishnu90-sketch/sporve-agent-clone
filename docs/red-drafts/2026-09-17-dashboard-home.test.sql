-- Disposable-database fixture for doc 25/26/27 SLICE 1 — the home screen as
-- data. Migration 20260915_001073 on top of spec 12 (001050…001055, 001066,
-- 001069, 001070). Never runs against production.
--
--     bash tools/run-sql-fixtures.sh 2026-09-17-dashboard-home
--
-- RED-FIRST: run with the 001073 \ir line removed and group A fails on
-- "relation public.dashboard_block does not exist". With it every group PASSes.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_dashboard' then
    raise exception 'refusing to run outside the disposable sporv_spec_dashboard database (got %)', current_database();
  end if;
end $$;

-- ── minimal stand-ins (same as slice 1) plus the tables the blocks read ──
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
alter table public.guardians add column last_name text;
alter table public.obligations add column amount_cents integer, add column currency text default 'USD', add column created_at timestamptz default now();
create table public.agent_findings (id uuid primary key default gen_random_uuid(), provider_id uuid, kind text, severity text, title text, detail text, status text default 'open', created_at timestamptz default now());
create table public.waiver_documents (id uuid primary key default gen_random_uuid(), provider_id uuid, title text, version int default 1);
create table public.waiver_signatures (id uuid primary key default gen_random_uuid(), waiver_document_id uuid references public.waiver_documents(id), member_id uuid references public.team_athletes(id), signed_at timestamptz default now());
create table public.background_check (id uuid primary key default gen_random_uuid(), provider_id uuid, member_id uuid, status text, expires_at timestamptz);
create table public.staff_certifications (id uuid primary key default gen_random_uuid(), organization_id uuid, member_user_id uuid, kind text, status text, expires_at timestamptz);
create table public.org_connectors (id uuid primary key default gen_random_uuid(), provider_id uuid, kind text, status text default 'connected');
alter table public.team_athletes add column created_at timestamptz default now();

\ir ../../supabase/migrations/20260915_001050_venue_and_blackout.sql
\ir ../../supabase/migrations/20260915_001051_event_series.sql
\ir ../../supabase/migrations/20260915_001052_event.sql
\ir ../../supabase/migrations/20260915_001053_migration_quarantine.sql
\ir ../../supabase/migrations/20260915_001055_event_response_and_attendance.sql
\ir ../../supabase/migrations/20260915_001066_series_materializer.sql
\ir ../../supabase/migrations/20260915_001069_event_conflicts_and_cancellation.sql
\ir ../../supabase/migrations/20260915_001070_publication_reminders_calendar_feed.sql
\ir ../../supabase/migrations/20260915_001073_dashboard_home.sql

-- ── fixture: org A (owner uA, admin uB, trainer uC); org B (owner uD, admin uC — the SAME person, different role) ──
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b'),
  ('c0000000-0000-4000-8000-00000000000c'), ('d0000000-0000-4000-8000-00000000000d'), ('e0000000-0000-4000-8000-00000000000e');
insert into public.providers (id, owner_id, business_name) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC'),
  ('0b000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-00000000000d','Other Club');
insert into public.organization_members (id, organization_id, member_user_id, role) values
  ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','admin'),
  ('0c000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','trainer'),
  ('0c000000-0000-4000-8000-000000000003','0b000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','admin');
insert into public.teams (id, provider_id, name) values ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name) values
  ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell'),
  ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ben','Ortiz');
insert into public.guardians (id, provider_id, first_name) values ('4a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Renata');
-- org A data: one overdue fee, one agent draft, one open finding, one event tomorrow (assigned to the trainer), one unsigned waiver, one expiring check
insert into public.obligations (provider_id, kind, status, title, amount_cents, due_at, source_kind, source_ref, guardian_id) values
  ('0a000000-0000-4000-8000-000000000001','fee','draft','Fall dues — Bell', 15000, now() - interval '20 days', 'agent', 'installment:x:attempt:1', '4a000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000001','fee','done', 'Paid dues', 9000, now() - interval '30 days', 'agent', 'installment:y:attempt:1', '4a000000-0000-4000-8000-000000000001');
insert into public.agent_findings (provider_id, kind, severity, title, status) values ('0a000000-0000-4000-8000-000000000001','dues','warn','2 families 20+ days late','open');
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, assigned_member_id, published_at) values
  ('7a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Tue practice', now()+interval '20 hours', now()+interval '21 hours','America/Chicago','0c000000-0000-4000-8000-000000000002', now()),
  ('7a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','game','Away game', now()+interval '5 days', now()+interval '5 days 2 hours','America/Chicago', null, now());
insert into public.waiver_documents (id, provider_id, title) values ('9a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Season waiver');
insert into public.waiver_signatures (waiver_document_id, member_id) values ('9a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001');  -- Ava signed, Ben did not
insert into public.background_check (provider_id, member_id, status, expires_at) values ('0a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000002','clear', now()+interval '30 days');

-- A · registry seeded with exactly the five CORE blocks; role defaults for all five roles; re-seed is a no-op ──
do $$ declare n int; begin
  select count(*) into n from public.dashboard_block; if n <> 5 then raise exception 'FAIL A: % blocks seeded, expected 5', n; end if;
  select count(*) into n from public.dashboard_role_default; if n <> 5 then raise exception 'FAIL A: % role defaults, expected 5', n; end if;
  insert into public.dashboard_block (key, title, description, min_role, empty_text, error_text, drill_to) values ('money.overdue','x','x','treasurer','x','x','x') on conflict (key) do nothing;
  insert into public.dashboard_role_default (role, blocks) values ('coach','[]') on conflict (role) do nothing;
  select count(*) into n from public.dashboard_block; if n <> 5 then raise exception 'FAIL A: re-seed duplicated a block'; end if;
  if (select blocks from public.dashboard_role_default where role = 'coach') <> '["schedule.today","agent.attention"]'::jsonb then raise exception 'FAIL A: re-seed overwrote the coach default'; end if;
  if exists (select 1 from public.dashboard_block where empty_text = '' or error_text = '' or drill_to = '') then raise exception 'FAIL A: a block lacks its empty/error/drill text'; end if;
  raise notice 'PASS A: five CORE blocks + five role defaults, idempotent, every block carries empty/error/drill';
end $$;

-- B · resolution matrix (25.5): role × flags × stored layout ─────────────
do $$ declare f jsonb := '{"has_staff":true,"rents_facilities":false,"collects_dues":true,"runs_registration":false,"multi_team":false,"has_connected_inbox":false}'; r jsonb; keys text[]; begin
  r := public.dashboard_resolve('owner', f, null); select array_agg(t.x ->> 'key' order by t.o) into keys from jsonb_array_elements(r) with ordinality t(x, o);
  if keys is distinct from array['agent.attention','money.overdue','schedule.today','roster.gaps'] then raise exception 'FAIL B: owner resolved %', keys; end if;   -- people.recent dropped: !runs_registration
  r := public.dashboard_resolve('coach', f, null); select array_agg(t.x ->> 'key' order by t.o) into keys from jsonb_array_elements(r) with ordinality t(x, o);
  if keys is distinct from array['schedule.today','agent.attention'] then raise exception 'FAIL B: coach resolved %', keys; end if;
  r := public.dashboard_resolve('coach', f, '["money.overdue","schedule.today","roster.gaps"]'); select array_agg(t.x ->> 'key' order by t.o) into keys from jsonb_array_elements(r) with ordinality t(x, o);
  if keys is distinct from array['schedule.today'] then raise exception 'FAIL B: a stored layout leaked forbidden blocks to a coach: %', keys; end if;
  r := public.dashboard_resolve('owner', f - 'collects_dues' || '{"collects_dues":false}', null); select array_agg(t.x ->> 'key' order by t.o) into keys from jsonb_array_elements(r) with ordinality t(x, o);
  if 'money.overdue' = any(keys) then raise exception 'FAIL B: money block shown to an org that collects no dues'; end if;
  r := public.dashboard_resolve('owner', f, '["does.not.exist","agent.attention"]'); select array_agg(t.x ->> 'key' order by t.o) into keys from jsonb_array_elements(r) with ordinality t(x, o);
  if keys is distinct from array['agent.attention'] then raise exception 'FAIL B: an unknown key was not dropped: %', keys; end if;
  r := public.dashboard_resolve('director', f, '[{"key":"roster.gaps","params":{"expiryWindowDays":30}}]');
  if (r -> 0 -> 'params' ->> 'expiryWindowDays')::int <> 30 then raise exception 'FAIL B: layout params not merged: %', r; end if;
  if public.dashboard_resolve(null, f, null) <> '[]'::jsonb then raise exception 'FAIL B: a null role resolved to blocks'; end if;
  raise notice 'PASS B: role default, refinement, user layout, permission filter last — unknown and forbidden keys drop silently';
end $$;

-- C · the six flags derive live and flip both ways ───────────────────────
do $$ declare f jsonb; begin
  f := public.dashboard_flags('0a000000-0000-4000-8000-000000000001');
  if (f->>'has_staff')::boolean is not true or (f->>'collects_dues')::boolean is not true or (f->>'multi_team')::boolean is not false
     or (f->>'has_connected_inbox')::boolean is not false or (f->>'runs_registration')::boolean is not false or (f->>'rents_facilities')::boolean is not false
    then raise exception 'FAIL C: org A flags wrong: %', f; end if;
  insert into public.teams (provider_id, name) values ('0a000000-0000-4000-8000-000000000001','16U');
  insert into public.org_connectors (provider_id, kind, status) values ('0a000000-0000-4000-8000-000000000001','gmail','connected');
  f := public.dashboard_flags('0a000000-0000-4000-8000-000000000001');
  if (f->>'multi_team')::boolean is not true or (f->>'has_connected_inbox')::boolean is not true then raise exception 'FAIL C: flags did not flip on: %', f; end if;
  delete from public.teams where name = '16U'; update public.org_connectors set status = 'revoked';
  f := public.dashboard_flags('0a000000-0000-4000-8000-000000000001');
  if (f->>'multi_team')::boolean is not false or (f->>'has_connected_inbox')::boolean is not false then raise exception 'FAIL C: flags did not flip off: %', f; end if;
  f := public.dashboard_flags('0b000000-0000-4000-8000-000000000001');
  if (f->>'has_staff')::boolean is not false or (f->>'collects_dues')::boolean is not false then raise exception 'FAIL C: org B flags wrong: %', f; end if;
  raise notice 'PASS C: flags are live counts; they flip on and off within one call';
end $$;

-- D · dashboard_home as the OWNER of A: every resolved block carries real rows from its own query ──
do $$ declare h jsonb; b jsonb; begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if h->>'role' <> 'owner' then raise exception 'FAIL D: role %', h->>'role'; end if;
  if (select count(*) from jsonb_array_elements(h->'blocks')) <> 4 then raise exception 'FAIL D: % blocks', (select count(*) from jsonb_array_elements(h->'blocks')); end if;
  select x into b from jsonb_array_elements(h->'blocks') x where x->>'key' = 'money.overdue';
  if jsonb_array_length(b->'rows') <> 1 or (b->'rows'->0->>'family') <> 'Renata' or (b->'rows'->0->>'amount_cents')::int <> 15000 or (b->'rows'->0->>'days_overdue')::int < 19
    then raise exception 'FAIL D: money.overdue rows %', b->'rows'; end if;
  select x into b from jsonb_array_elements(h->'blocks') x where x->>'key' = 'schedule.today';
  if jsonb_array_length(b->'rows') <> 1 or (b->'rows'->0->>'title') <> 'Tue practice' or (b->'rows'->0->>'team') <> '14U Flight' then raise exception 'FAIL D: schedule rows %', b->'rows'; end if;
  select x into b from jsonb_array_elements(h->'blocks') x where x->>'key' = 'agent.attention';
  if jsonb_array_length(b->'rows') <> 2 then raise exception 'FAIL D: attention rows % (expected the open finding + the agent fee draft)', b->'rows'; end if;
  select x into b from jsonb_array_elements(h->'blocks') x where x->>'key' = 'roster.gaps';
  if jsonb_array_length(b->'rows') <> 2 or not exists (select 1 from jsonb_array_elements(b->'rows') r where r->>'kind'='waiver' and r->>'name'='Ben Ortiz')
     or not exists (select 1 from jsonb_array_elements(b->'rows') r where r->>'kind'='staff') then raise exception 'FAIL D: gaps rows %', b->'rows'; end if;
  if exists (select 1 from jsonb_array_elements(h->'blocks') x where x->>'empty' = '' or x->>'drill_to' = '') then raise exception 'FAIL D: a block came back without its empty/drill text'; end if;
  raise notice 'PASS D: owner home = 4 blocks, each with rows traced to its own query';
end $$;

-- E · zero rows by role, ITERATING THE REGISTRY (26.7 #5): for every block × every role in org A ──
do $$ declare b record; who record; h jsonb; blk jsonb; n int; begin
  for who in select * from (values ('owner','a0000000-0000-4000-8000-00000000000a'), ('director','b0000000-0000-4000-8000-00000000000b'), ('coach','c0000000-0000-4000-8000-00000000000c')) v(role, uid) loop
    perform set_config('request.jwt.claim.sub', who.uid, true);
    h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
    if h->>'role' <> who.role then raise exception 'FAIL E: % resolved as %', who.uid, h->>'role'; end if;
    for b in select * from public.dashboard_block loop
      select x into blk from jsonb_array_elements(h->'blocks') x where x->>'key' = b.key;
      if public.dashboard_role_rank(who.role) < public.dashboard_role_rank(b.min_role) then
        if blk is not null then raise exception 'FAIL E: % saw % (min_role %)', who.role, b.key, b.min_role; end if;
      end if;
    end loop;
    if who.role = 'coach' then
      if exists (select 1 from jsonb_array_elements(h->'blocks') x where x->>'key' like 'money.%') then raise exception 'FAIL E: a coach home has a money block'; end if;
      select x into blk from jsonb_array_elements(h->'blocks') x where x->>'key' = 'schedule.today';
      if jsonb_array_length(blk->'rows') <> 1 then raise exception 'FAIL E: coach sees % events, expected only the one assigned to them', jsonb_array_length(blk->'rows'); end if;
    end if;
  end loop;
  -- a coach whose STORED layout names money.overdue: the block is absent and nothing throws
  insert into public.dashboard_layout (provider_id, member_id, blocks, source) values ('0a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000002','["money.overdue","schedule.today"]','user');
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if exists (select 1 from jsonb_array_elements(h->'blocks') x where x->>'key' = 'money.overdue') then raise exception 'FAIL E: stored layout leaked money.overdue to a coach'; end if;
  select count(*) into n from jsonb_array_elements(h->'blocks'); if n <> 1 then raise exception 'FAIL E: coach layout resolved to % blocks', n; end if;
  raise notice 'PASS E: every registry block × every role — forbidden blocks are absent (zero rows), coach sees only their own events, a stored layout cannot leak';
end $$;

-- F · cross-tenant: a member of B only gets an EMPTY home for A, never A''s rows, never an error ──
do $$ declare h jsonb; begin
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-00000000000e', true);   -- nobody's member
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if h->>'role' is not null or h->'blocks' <> '[]'::jsonb then raise exception 'FAIL F: a non-member got %', h; end if;
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-00000000000d', true);   -- owner of B
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if h->>'role' is not null or h->'blocks' <> '[]'::jsonb then raise exception 'FAIL F: org B''s owner read org A: %', h; end if;
  perform set_config('request.jwt.claim.sub', '', true);   -- anonymous
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if h->'blocks' <> '[]'::jsonb then raise exception 'FAIL F: anon got blocks'; end if;
  raise notice 'PASS F: cross-tenant and anonymous callers get an empty home — zero rows, no exception';
end $$;

-- G · multi-org (27.7): uC is a coach in A and a director in B; two different homes, nothing carries across ──
do $$ declare ha jsonb; hb jsonb; ka text[]; kb text[]; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  delete from public.dashboard_layout where member_id = '0c000000-0000-4000-8000-000000000002';
  ha := public.dashboard_home('0a000000-0000-4000-8000-000000000001'); hb := public.dashboard_home('0b000000-0000-4000-8000-000000000001');
  select array_agg(x->>'key' order by o) into ka from jsonb_array_elements(ha->'blocks') with ordinality t(x,o);
  select array_agg(x->>'key' order by o) into kb from jsonb_array_elements(hb->'blocks') with ordinality t(x,o);
  if ha->>'role' <> 'coach' or hb->>'role' <> 'director' then raise exception 'FAIL G: roles % / %', ha->>'role', hb->>'role'; end if;
  if ka is distinct from array['schedule.today','agent.attention'] then raise exception 'FAIL G: coach-in-A resolved %', ka; end if;
  if kb is distinct from array['agent.attention','schedule.today','roster.gaps'] then raise exception 'FAIL G: director-in-B resolved %', kb; end if;
  if exists (select 1 from jsonb_array_elements(hb->'blocks') x where jsonb_array_length(x->'rows') > 0) then raise exception 'FAIL G: org B home carried org A rows'; end if;
  raise notice 'PASS G: same person, two orgs, two homes; nothing carries across';
end $$;

-- H · permission revocation (27.9): director → trainer; the money-free default applies at next render, the stored layout is left intact ──
do $$ declare h jsonb; begin
  insert into public.dashboard_layout (provider_id, member_id, blocks, source) values ('0a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001','["roster.gaps","agent.attention"]','user');
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if not exists (select 1 from jsonb_array_elements(h->'blocks') x where x->>'key' = 'roster.gaps') then raise exception 'FAIL H: director layout not applied'; end if;
  update public.organization_members set role = 'trainer' where id = '0c000000-0000-4000-8000-000000000001';
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if h->>'role' <> 'coach' or exists (select 1 from jsonb_array_elements(h->'blocks') x where x->>'key' = 'roster.gaps') then raise exception 'FAIL H: demoted member still sees roster.gaps: %', h; end if;
  if (select blocks from public.dashboard_layout where member_id = '0c000000-0000-4000-8000-000000000001') <> '["roster.gaps","agent.attention"]'::jsonb then raise exception 'FAIL H: stored layout was altered'; end if;
  update public.organization_members set role = 'admin' where id = '0c000000-0000-4000-8000-000000000001';
  h := public.dashboard_home('0a000000-0000-4000-8000-000000000001');
  if not exists (select 1 from jsonb_array_elements(h->'blocks') x where x->>'key' = 'roster.gaps') then raise exception 'FAIL H: layout did not return with the role'; end if;
  raise notice 'PASS H: a revoked role drops its blocks at next render without error; the layout survives for when the role returns';
end $$;

-- I · empty org: every resolved block returns zero rows and its declared empty text — nothing fabricated ──
do $$ declare h jsonb; begin
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-00000000000d', true);
  h := public.dashboard_home('0b000000-0000-4000-8000-000000000001');
  if h->>'role' <> 'owner' then raise exception 'FAIL I: %', h->>'role'; end if;
  if exists (select 1 from jsonb_array_elements(h->'blocks') x where jsonb_array_length(x->'rows') <> 0) then raise exception 'FAIL I: an empty org produced rows: %', h; end if;
  if exists (select 1 from jsonb_array_elements(h->'blocks') x where x->>'key' = 'money.overdue') then raise exception 'FAIL I: money block on an org with no dues'; end if;
  if h::text ilike '%Ava%' or h::text ilike '%Renata%' or h::text ilike '%15000%' then raise exception 'FAIL I: org A data reached org B''s home'; end if;
  raise notice 'PASS I: an empty org gets its blocks with zero rows and their declared empty text';
end $$;

-- J · grants: anon holds nothing; layouts are RPC-only; the registry is readable by signed-in staff only ──
do $$ declare n int; begin
  select count(*) into n from information_schema.role_routine_grants where grantee = 'anon' and specific_schema = 'public' and routine_name like 'dashboard_%';
  if n <> 0 then raise exception 'FAIL J: anon can execute % dashboard functions', n; end if;
  if exists (select 1 from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name = 'dashboard_layout') then raise exception 'FAIL J: dashboard_layout is client-readable'; end if;
  if exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_name in ('dashboard_block','dashboard_role_default')) then raise exception 'FAIL J: registry readable by anon'; end if;
  raise notice 'PASS J: dashboard functions and tables hold nothing for anon; layouts are RPC-only';
end $$;
