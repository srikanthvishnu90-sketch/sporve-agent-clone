-- Disposable-database fixture for audit 2026-09-17 P1-3 — money has a screen
-- for dues. Migration 20260915_001077 on top of 001073 (dashboard_caller).
--
--     bash tools/run-sql-fixtures.sh 2026-09-18-money-screen
--
-- RED-FIRST: remove the 001077 \ir line and group A fails on
-- "function public.money_aged_balances(uuid) does not exist".
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_money' then
    raise exception 'refusing to run outside the disposable sporv_spec_money database (got %)', current_database();
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
alter table public.obligations add column done_at timestamptz;
create table public.fee_schedules (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), member_id uuid references public.team_athletes(id), total_cents integer);
create table public.installments (id uuid primary key default gen_random_uuid(), fee_schedule_id uuid references public.fee_schedules(id), member_id uuid references public.team_athletes(id),
  due_date date, amount_cents integer, status text not null default 'due', attempt_count integer not null default 0, last_attempt_at timestamptz);
\ir ../../supabase/migrations/20260915_001050_venue_and_blackout.sql
\ir ../../supabase/migrations/20260915_001051_event_series.sql
\ir ../../supabase/migrations/20260915_001052_event.sql
\ir ../../supabase/migrations/20260915_001053_migration_quarantine.sql
\ir ../../supabase/migrations/20260915_001055_event_response_and_attendance.sql
\ir ../../supabase/migrations/20260915_001066_series_materializer.sql
\ir ../../supabase/migrations/20260915_001069_event_conflicts_and_cancellation.sql
\ir ../../supabase/migrations/20260915_001070_publication_reminders_calendar_feed.sql
\ir ../../supabase/migrations/20260915_001073_dashboard_home.sql
\ir ../../supabase/migrations/20260915_001077_money_aged_balances.sql

-- ── org A: owner uA, admin uB (treasurer/director), trainer uC; org B owner uD. Two families, one obligation with no family ──
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b'), ('c0000000-0000-4000-8000-00000000000c'), ('d0000000-0000-4000-8000-00000000000d');
insert into public.providers (id, owner_id, business_name) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC'),
  ('0b000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-00000000000d','Other Club');
insert into public.organization_members (id, organization_id, member_user_id, role) values
  ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','admin'),
  ('0c000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','trainer');
insert into public.teams (id, provider_id, name) values ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name) values
  ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell'),
  ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ben','Ortiz');
insert into public.guardians (id, provider_id, first_name, last_name) values
  ('4a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Renata','Bell'),
  ('4a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Marco','Ortiz');
insert into public.obligations (id, provider_id, kind, status, title, amount_cents, due_at, source_kind, source_ref, guardian_id, member_id, done_at) values
  ('6a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','fee','approved','Spring dues · Ava', 12000, now()-interval '45 days','manual','fee:1','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001',null),
  ('6a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','fee','draft',   'Tournament fee · Ava', 3000, now()-interval '10 days','agent','fee:2','4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001',null),
  ('6a000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000001','fee','approved','Spring dues · Ben', 12000, now()+interval '20 days','manual','fee:3','4a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002',null),
  ('6a000000-0000-4000-8000-000000000004','0a000000-0000-4000-8000-000000000001','fee','approved','Uniform · unassigned', 5000, now()-interval '100 days','pdf','fee:4',null,null,null),
  ('6a000000-0000-4000-8000-000000000005','0a000000-0000-4000-8000-000000000001','fee','done',    'Winter dues · Ben', 9000, now()-interval '80 days','manual','fee:5','4a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002', now()-interval '30 days'),
  ('6a000000-0000-4000-8000-000000000006','0a000000-0000-4000-8000-000000000001','fee','void',    'Voided', 99900, now()-interval '5 days','manual','fee:6','4a000000-0000-4000-8000-000000000002',null,null),
  ('6a000000-0000-4000-8000-000000000007','0a000000-0000-4000-8000-000000000001','deadline','approved','Not money', null, now()-interval '5 days','manual','dl:1',null,null,null),
  ('6b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','fee','approved','Org B dues', 77700, now()-interval '5 days','manual','fee:b1',null,null,null);
insert into public.fee_schedules (id, provider_id, member_id, total_cents) values ('8a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002',24000);
insert into public.installments (id, fee_schedule_id, member_id, due_date, amount_cents, status, attempt_count, last_attempt_at) values
  ('9a000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002', current_date-7, 6000, 'failed', 2, now()-interval '1 day'),
  ('9a000000-0000-4000-8000-000000000002','8a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002', current_date+21, 6000, 'due', 0, null);

-- A · the owner: totals, buckets, families aged and ordered, items traceable, failed and collected ──
do $$ declare r jsonb; f jsonb; begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  r := public.money_aged_balances('0a000000-0000-4000-8000-000000000001');
  if (r->>'role') <> 'owner' then raise exception 'FAIL A: role %', r->>'role'; end if;
  if (r->'totals'->>'outstanding_cents')::int <> 32000 then raise exception 'FAIL A: outstanding % (void, done, deadline and org B must not count)', r->'totals'->>'outstanding_cents'; end if;
  if (r->'totals'->>'overdue_cents')::int <> 20000 or (r->'totals'->>'overdue_count')::int <> 3 then raise exception 'FAIL A: overdue % / %', r->'totals'->>'overdue_cents', r->'totals'->>'overdue_count'; end if;
  if (r->'totals'->'buckets'->>'current')::int <> 12000 or (r->'totals'->'buckets'->>'d1_30')::int <> 3000 or (r->'totals'->'buckets'->>'d31_60')::int <> 12000
     or (r->'totals'->'buckets'->>'d61_90')::int <> 0 or (r->'totals'->'buckets'->>'d90_plus')::int <> 5000 then raise exception 'FAIL A: buckets %', r->'totals'->'buckets'; end if;
  if jsonb_array_length(r->'families') <> 3 then raise exception 'FAIL A: % families, expected Bell, Ortiz and the unassigned row', jsonb_array_length(r->'families'); end if;
  f := r->'families'->0;
  if (f->>'family') <> 'Renata Bell' or (f->>'balance_cents')::int <> 15000 or (f->>'overdue_cents')::int <> 15000 or (f->>'athletes') <> 'Ava Bell' then raise exception 'FAIL A: first family %', f; end if;
  if (r->'families'->2->>'family') <> 'Marco Ortiz' or (r->'families'->2->>'overdue_cents')::int <> 0 then raise exception 'FAIL A: the current-only family sorts last: %', r->'families'->2; end if;
  if jsonb_array_length(r->'items') <> 4 or (r->'items'->0->>'source_kind') <> 'pdf' then raise exception 'FAIL A: items %', r->'items'; end if;
  if jsonb_array_length(r->'failed') <> 1 or (r->'failed'->0->>'attempt_count')::int <> 2 or (r->'failed'->0->>'athlete') <> 'Ben Ortiz' then raise exception 'FAIL A: failed %', r->'failed'; end if;
  if jsonb_array_length(r->'collected') <> 1 or (r->>'collected_90d_cents')::int <> 9000 then raise exception 'FAIL A: collected %', r->'collected'; end if;
  raise notice 'PASS A: owner — outstanding 32000, overdue 20000/3, buckets right, families aged, items traceable, 1 failed, 9000 collected';
end $$;

-- B · a director (admin member) sees the same money; a coach gets zero rows; org B''s owner gets zero rows; org B''s own money is its own ──
do $$ declare r jsonb; begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  r := public.money_aged_balances('0a000000-0000-4000-8000-000000000001');
  if (r->>'role') <> 'director' or (r->'totals'->>'outstanding_cents')::int <> 32000 then raise exception 'FAIL B: director got %', r->'totals'; end if;
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  r := public.money_aged_balances('0a000000-0000-4000-8000-000000000001');
  if (r->>'role') <> 'coach' or r->'totals' <> 'null'::jsonb or jsonb_array_length(r->'families') <> 0 or jsonb_array_length(r->'items') <> 0 or jsonb_array_length(r->'failed') <> 0 then raise exception 'FAIL B: coach saw money %', r; end if;
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-00000000000d', true);
  r := public.money_aged_balances('0a000000-0000-4000-8000-000000000001');
  if r->>'role' is not null or jsonb_array_length(r->'families') <> 0 then raise exception 'FAIL B: org B owner saw org A money %', r; end if;
  r := public.money_aged_balances('0b000000-0000-4000-8000-000000000001');
  if (r->'totals'->>'outstanding_cents')::int <> 77700 then raise exception 'FAIL B: org B own money %', r->'totals'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.money_aged_balances('0a000000-0000-4000-8000-000000000001');
  if r->>'role' is not null or jsonb_array_length(r->'families') <> 0 then raise exception 'FAIL B: anonymous saw money'; end if;
  raise notice 'PASS B: director same; coach, org B and anon zero rows — no error';
end $$;

-- C · anon holds no grant; nothing is written ──
do $$ declare n int; begin
  select count(*) into n from information_schema.role_routine_grants where grantee = 'anon' and specific_schema = 'public' and routine_name = 'money_aged_balances';
  if n <> 0 then raise exception 'FAIL C: anon can execute money_aged_balances'; end if;
  if (select provolatile from pg_proc where proname = 'money_aged_balances') <> 's' then raise exception 'FAIL C: the function is not STABLE (read-only)'; end if;
  raise notice 'PASS C: no anon grant; STABLE';
end $$;
