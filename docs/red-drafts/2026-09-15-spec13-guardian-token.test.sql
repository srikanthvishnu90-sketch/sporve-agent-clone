-- Disposable-database fixture for spec 13 slice 1 (guardian tokens), migration
-- 20260915_001059 + 001071 on top of spec 12 as merged on main (001050–001055, 001066, 001069, 001070). Never runs against production.
--
--     createdb sporv_spec_token
--     bash tools/run-sql-fixtures.sh 2026-09-15-spec12
--
-- RED-FIRST: run with the \ir lines below removed and every assertion fails on
-- "relation public.event does not exist" — that is the RED evidence. With the
-- includes present the same assertions must all PASS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_token' then
    raise exception 'refusing to run outside the disposable sporv_spec_token database (got %)', current_database();
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

-- ── fixture: org A (owner uA); Maria is linked to Ava (14U); James to Ben (14U); Ava also on 16U ──
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b');
insert into public.providers (id, owner_id, business_name) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Rivertown FC'),
  ('0b000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','Other Club');
insert into public.teams (id, provider_id, name) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','14U Flight'),
  ('1a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','16U Flight');
insert into public.team_athletes (id, team_id, provider_id, first_name, last_name, dob) values
  ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava','Bell','2013-04-02'),
  ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ben','Ortiz','2012-09-09');
insert into public.guardians (id, provider_id, first_name, email) values
  ('4a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Maria','maria@example.com'),
  ('4a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','James','james@example.com'),
  ('4b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','Outsider','x@example.com');
insert into public.guardian_links (guardian_id, member_id, provider_id) values
  ('4a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001'),
  ('4a000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001');
-- two published 14U events (A, B) and one 16U event (C)
insert into public.event (id, provider_id, team_id, kind, title, starts_at, ends_at, timezone, published_at) values
  ('8a000000-0000-4000-8000-00000000000a','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Tue practice', now()+interval '3 days', now()+interval '3 days 1 hour','America/Chicago',now()),
  ('8a000000-0000-4000-8000-00000000000b','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','practice','Thu practice', now()+interval '5 days', now()+interval '5 days 1 hour','America/Chicago',now()),
  ('8a000000-0000-4000-8000-00000000000c','0a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002','practice','16U practice',now()+interval '4 days', now()+interval '4 days 1 hour','America/Chicago',now());
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);   -- act as org A's owner

-- A. table + RLS forced; nothing readable by clients
do $$ begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='guardian_access_token' and c.relrowsecurity and c.relforcerowsecurity)
    then raise exception 'FAIL A: guardian_access_token missing or RLS not forced'; end if;
  if exists (select 1 from pg_policies where tablename='guardian_access_token') then raise exception 'FAIL A: a client policy exists — must be RPC-only'; end if;
  if (select array_agg(consrc) from (select pg_get_constraintdef(oid) consrc from pg_constraint where conrelid='public.guardian_access_token'::regclass and contype='c') s)::text !~ 'full|profile' then null; end if;
  raise notice 'PASS A: token table exists, RLS forced, no client policies';
end $$;

-- B. issue returns a 64-hex secret ONCE; only its sha256 is stored; scopes full/profile do not exist
do $$ declare tok text; begin
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','rsvp','event','8a000000-0000-4000-8000-00000000000a');
  if tok !~ '^[0-9a-f]{64}$' then raise exception 'FAIL B: secret shape %', tok; end if;
  if exists (select 1 from public.guardian_access_token where token_hash = tok) then raise exception 'FAIL B: raw secret stored'; end if;
  if not exists (select 1 from public.guardian_access_token where token_hash = public.guardian_token_hash(tok)) then raise exception 'FAIL B: hash not stored'; end if;
  begin perform public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','full'); raise exception 'FAIL B: full scope accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','profile'); raise exception 'FAIL B: profile scope accepted';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS B: secret emitted once, only sha256 stored, no full/profile scope';
end $$;

-- C. a token is BOUND to its subject: rsvp for event A cannot touch event B, and a
--    guardian with no athlete on the team is refused; cross-org subject refused at issue
do $$ declare tok text; rc jsonb; begin
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','rsvp','event','8a000000-0000-4000-8000-00000000000a');
  rc := public.guardian_token_rsvp(tok, 'yes');
  if (rc->>'event_id') <> '8a000000-0000-4000-8000-00000000000a' or jsonb_array_length(rc->'members') <> 1 then raise exception 'FAIL C: %', rc; end if;
  if (select response from public.event_response where event_id='8a000000-0000-4000-8000-00000000000a' and member_id='3a000000-0000-4000-8000-000000000001') <> 'yes'
    then raise exception 'FAIL C: RSVP not recorded through set_event_response'; end if;
  if exists (select 1 from public.event_response where event_id='8a000000-0000-4000-8000-00000000000b') then raise exception 'FAIL C: token for A touched B'; end if;
  -- Maria has nobody on 16U: a 16U rsvp token for her is issuable but unusable
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','rsvp','event','8a000000-0000-4000-8000-00000000000c');
  begin perform public.guardian_token_rsvp(tok, 'yes'); raise exception 'FAIL C: RSVP for a team the guardian has no athlete on';
  exception when sqlstate '42501' then null; end;
  -- an org-A event cannot be named by an org-B guardian's token, even by org B's own owner
  -- (the admin check runs first, so this must be exercised AS org B's owner; transaction-local)
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  begin perform public.issue_guardian_token('4b000000-0000-4000-8000-000000000001','rsvp','event','8a000000-0000-4000-8000-00000000000a'); raise exception 'FAIL C: cross-org subject accepted';
  exception when sqlstate '22023' then null; end;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  raise notice 'PASS C: token bound to one event; unlinked team refused; cross-org subject refused';
end $$;

-- D. GET never consumes: redeem twice is fine; a pay token is single-use and consume() spends it; after that redeem returns nothing
insert into public.obligations (id, provider_id, kind, status, title) values ('9a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','fee','draft','Dues');
do $$ declare tok text; n int; begin
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','pay','obligation','9a000000-0000-4000-8000-000000000001');
  select count(*) into n from public.redeem_guardian_token(tok); if n <> 1 then raise exception 'FAIL D: first redeem'; end if;
  select count(*) into n from public.redeem_guardian_token(tok); if n <> 1 then raise exception 'FAIL D: a GET consumed the token'; end if;
  if not public.consume_guardian_token(tok) then raise exception 'FAIL D: consume returned false on a live token'; end if;
  select count(*) into n from public.redeem_guardian_token(tok); if n <> 0 then raise exception 'FAIL D: spent single-use token still redeems'; end if;
  if public.consume_guardian_token(tok) then raise exception 'FAIL D: double consume'; end if;
  if (select single_use from public.guardian_access_token where token_hash=public.guardian_token_hash(tok)) is not true then raise exception 'FAIL D: pay not single-use'; end if;
  raise notice 'PASS D: redeem is read-only (safe on GET); pay is single-use and consume() spends it once';
end $$;

-- E. expiry and revocation: expired → nothing; revoke_guardian_tokens kills the live ones; a rotated phone revokes automatically
do $$ declare tok text; tok2 text; n int; begin
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000002','rsvp','event','8a000000-0000-4000-8000-00000000000a', 'email', interval '-1 second');
  select count(*) into n from public.redeem_guardian_token(tok); if n <> 0 then raise exception 'FAIL E: expired token redeemed'; end if;
  begin perform public.guardian_token_rsvp(tok,'yes'); raise exception 'FAIL E: expired token acted';
  exception when sqlstate '42501' then null; end;
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000002','rsvp','event','8a000000-0000-4000-8000-00000000000a');
  if public.revoke_guardian_tokens('4a000000-0000-4000-8000-000000000002','test') < 1 then raise exception 'FAIL E: revoke count'; end if;
  select count(*) into n from public.redeem_guardian_token(tok); if n <> 0 then raise exception 'FAIL E: revoked token redeemed'; end if;
  tok2 := public.issue_guardian_token('4a000000-0000-4000-8000-000000000002','rsvp','event','8a000000-0000-4000-8000-00000000000b');
  update public.guardians set phone = '+15550001111' where id='4a000000-0000-4000-8000-000000000002';
  select count(*) into n from public.redeem_guardian_token(tok2); if n <> 0 then raise exception 'FAIL E: phone change did not rotate tokens'; end if;
  raise notice 'PASS E: expired/revoked return nothing; contact change revokes outstanding links';
end $$;

-- F. scope mismatch: a pay token cannot RSVP; wrong response value rejected
do $$ declare tok text; begin
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','pay','obligation','9a000000-0000-4000-8000-000000000001');
  begin perform public.guardian_token_rsvp(tok,'yes'); raise exception 'FAIL F: pay token answered an RSVP';
  exception when sqlstate '42501' then null; end;
  tok := public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','rsvp','event','8a000000-0000-4000-8000-00000000000b');
  begin perform public.guardian_token_rsvp(tok,'attending'); raise exception 'FAIL F: bad response accepted';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS F: scope is enforced; response vocabulary is enforced';
end $$;

-- G. issuance ceiling: 10 per guardian per hour (Maria already used some above)
do $$ declare i int; hit boolean := false; begin
  for i in 1..12 loop
    begin perform public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','rsvp','event','8a000000-0000-4000-8000-00000000000b');
    exception when sqlstate '53400' then hit := true; exit; end;
  end loop;
  if not hit then raise exception 'FAIL G: no issuance ceiling'; end if;
  raise notice 'PASS G: issuance rate-limited per guardian per hour';
end $$;

-- H. org B's owner cannot issue for org A's guardian; anon/authenticated cannot read the table
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', false);
do $$ begin
  begin perform public.issue_guardian_token('4a000000-0000-4000-8000-000000000001','rsvp','event','8a000000-0000-4000-8000-00000000000a'); raise exception 'FAIL H: cross-org issue';
  exception when sqlstate '42501' then null; end;
  raise notice 'PASS H: only the guardian''s own organisation may issue';
end $$;
set role authenticated;
do $$ declare n int; begin
  begin select count(*) into n from public.guardian_access_token; raise exception 'FAIL H2: authenticated can read tokens (% rows)', n;
  exception when insufficient_privilege then null; end;
  raise notice 'PASS H2: token table is not readable by clients';
end $$;
reset role;

-- I · delivery half (001071): approving an event REMINDER draft queues a
--     practice_reminder that carries an rsvp token bound to that event; a
--     CANCELLATION draft queues a schedule_change with no token; the token
--     redeems for the right event and nothing else ─────────────────────────
do $$ declare ob uuid; msg uuid; c jsonb; r record; n int; begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  insert into public.obligations (provider_id, kind, status, title, detail, source_kind, source_ref, member_id, guardian_id, draft_type)
  values ('0a000000-0000-4000-8000-000000000001','schedule','draft','Tomorrow — Tue practice','Hi Maria — reminder: Tue practice is tomorrow at 06:00 PM.',
          'agent','event:8a000000-0000-4000-8000-00000000000a:reminder:member:3a000000-0000-4000-8000-000000000001',
          '3a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','event_reminder') returning id into ob;
  msg := public.approve_obligation_and_queue(ob);
  select content into c from public.outbound_messages where id = msg;
  if (select event_type from public.outbound_messages where id = msg) <> 'practice_reminder' then raise exception 'FAIL I: reminder mapped to %', (select event_type from public.outbound_messages where id = msg); end if;
  if c->>'rsvp_token' !~ '^[0-9a-f]{64}$' then raise exception 'FAIL I: no rsvp token on the reminder (%)', c; end if;
  select * into r from public.redeem_guardian_token(c->>'rsvp_token');
  if r.scope <> 'rsvp' or r.subject_id <> '8a000000-0000-4000-8000-00000000000a' or r.guardian_id <> '4a000000-0000-4000-8000-000000000001'
    then raise exception 'FAIL I: token resolves to the wrong grant (% % %)', r.scope, r.subject_id, r.guardian_id; end if;
  if exists (select 1 from public.guardian_access_token where token_hash = c->>'rsvp_token') then raise exception 'FAIL I: raw token stored in the table'; end if;
  if (select status from public.obligations where id = ob) <> 'approved' then raise exception 'FAIL I: draft not flipped'; end if;
  begin perform public.approve_obligation_and_queue(ob); raise exception 'FAIL I: approved twice';
  exception when others then if sqlerrm not like 'only a draft%' then raise; end if; end;
  -- cancellation: sendable, no link
  insert into public.obligations (provider_id, kind, status, title, detail, source_kind, source_ref, member_id, guardian_id, draft_type)
  values ('0a000000-0000-4000-8000-000000000001','schedule','draft','Cancelled — Thu practice','Hi Maria — Thu practice is cancelled (Lightning).',
          'agent','event:8a000000-0000-4000-8000-00000000000b:cancel:member:3a000000-0000-4000-8000-000000000001',
          '3a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','schedule_cancellation') returning id into ob;
  msg := public.approve_obligation_and_queue(ob);
  select content into c from public.outbound_messages where id = msg;
  if (select event_type from public.outbound_messages where id = msg) <> 'schedule_change' then raise exception 'FAIL I: cancel mapped wrong'; end if;
  if c ? 'rsvp_token' then raise exception 'FAIL I: a cancellation carries an RSVP link'; end if;
  -- the org owner of B cannot approve A's draft
  insert into public.obligations (provider_id, kind, status, title, detail, source_kind, source_ref, member_id, guardian_id, draft_type)
  values ('0a000000-0000-4000-8000-000000000001','schedule','draft','x','x','agent','event:8a000000-0000-4000-8000-00000000000a:change:member:3a000000-0000-4000-8000-000000000001',
          '3a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','schedule_change_notice') returning id into ob;
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  begin perform public.approve_obligation_and_queue(ob); raise exception 'FAIL I: org B approved org A''s draft';
  exception when others then if sqlerrm not like 'only the org owner%' then raise; end if; end;
  select count(*) into n from public.outbound_messages; if n <> 2 then raise exception 'FAIL I: % outbound rows, expected 2', n; end if;
  raise notice 'PASS I: approved reminder → practice_reminder + event-bound rsvp token; cancel → schedule_change, no link; owner-only';
end $$;
