-- Disposable-database fixture for 2026-09-09-org-connectors.sql.
-- Never runs against production. Create the database first:
--
--     createdb sporv_org_connectors
--     psql -d sporv_org_connectors -f docs/red-drafts/2026-09-09-org-connectors.test.sql
--
-- or just: bash tools/run-sql-fixtures.sh 2026-09-09-org-connectors
--
-- WHAT THIS PROVES. The draft's whole value is in four constraints that are
-- easy to write and easy to silently break later. Each assertion below fails
-- loudly if the constraint is missing, so a future edit that widens one shows
-- up as a red fixture rather than as a connector that can suddenly send mail.

\set ON_ERROR_STOP on

do $$ begin
  if current_database() not like 'sporv%' then
    -- %% is a literal percent sign in RAISE; a bare % here would be read as a
    -- second placeholder and fail with "too few parameters".
    raise exception 'refusing to run outside a disposable sporv_%% database (got %)',
      current_database();
  end if;
end $$;

-- ── minimal stand-ins for the tables the draft references ────────────────
-- Deliberately the smallest shape that satisfies the foreign keys. This
-- fixture tests the DRAFT, not the production schema.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());

-- Supabase ships auth.uid(); a bare Postgres cluster does not. The policies in
-- the draft reference it, so the fixture provides the same shape. It returns
-- null here, which is correct: this fixture asserts that the policies EXIST and
-- that RLS is forced, not what a particular signed-in user can see.
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id));

create table public.import_batches (id uuid primary key default gen_random_uuid());
create table public.team_athletes  (id uuid primary key default gen_random_uuid());

create role anon;
create role authenticated;
create role service_role;

-- ── the draft under test ─────────────────────────────────────────────────
\ir 2026-09-09-org-connectors.sql

-- ── fixtures ─────────────────────────────────────────────────────────────
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into public.providers (id, owner_id)
  values ('22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111');

-- ── 1. I1 — a family-facing connector may never hold 'apply' ─────────────
-- This is the invariant "the agent never sends" expressed where it cannot be
-- argued with. If this insert succeeds, the constraint is gone.
do $$ begin
  begin
    insert into public.org_connectors (provider_id, kind, write_mode)
      values ('22222222-2222-2222-2222-222222222222','gmail','apply');
    raise exception 'FAIL I1: gmail accepted write_mode=apply';
  exception when check_violation then
    raise notice 'ok  I1: gmail rejects write_mode=apply';
  end;
end $$;

do $$ begin
  begin
    insert into public.org_connectors (provider_id, kind, write_mode)
      values ('22222222-2222-2222-2222-222222222222','sms','apply');
    raise exception 'FAIL I1: sms accepted write_mode=apply';
  exception when check_violation then
    raise notice 'ok  I1: sms rejects write_mode=apply';
  end;
end $$;

-- The enum itself must not contain a send mode. A constraint can be dropped;
-- an absent enum value has to be added on purpose, in a reviewable migration.
do $$
declare n int;
begin
  select count(*) into n from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'connector_write_mode' and e.enumlabel ilike '%send%';
  if n > 0 then raise exception 'FAIL I1: connector_write_mode contains a send value'; end if;
  raise notice 'ok  I1: connector_write_mode has no send value';
end $$;

-- Draft IS allowed — the point is that drafting works and sending does not.
insert into public.org_connectors (id, provider_id, kind, write_mode)
  values ('33333333-3333-3333-3333-333333333333',
          '22222222-2222-2222-2222-222222222222','gmail','draft');

-- ── 2. read-only connectors may not claim a write mode ───────────────────
do $$ begin
  begin
    insert into public.org_connectors (provider_id, kind, write_mode)
      values ('22222222-2222-2222-2222-222222222222','quickbooks','draft');
    raise exception 'FAIL: quickbooks accepted a write mode';
  exception when check_violation then
    raise notice 'ok  read-only kinds reject a write mode';
  end;
end $$;

-- ── 3. one live connection per kind per org ──────────────────────────────
do $$ begin
  begin
    insert into public.org_connectors (provider_id, kind, write_mode)
      values ('22222222-2222-2222-2222-222222222222','gmail','draft');
    raise exception 'FAIL: a second gmail connection was accepted';
  exception when unique_violation then
    raise notice 'ok  one live connection per kind per org';
  end;
end $$;

-- ── 4. RLS is on, forced, and anon holds nothing (I6) ────────────────────
do $$
declare r record;
begin
  for r in select tablename, rowsecurity, relforcerowsecurity
             from pg_tables t
             join pg_class c on c.relname = t.tablename
            where t.schemaname = 'public'
              and t.tablename in ('org_connectors','connector_sync_state')
  loop
    if not r.rowsecurity then
      raise exception 'FAIL I6: RLS not enabled on %', r.tablename; end if;
    if not r.relforcerowsecurity then
      raise exception 'FAIL I6: RLS not FORCEd on %', r.tablename; end if;
    raise notice 'ok  I6: RLS enabled and forced on %', r.tablename;
  end loop;
end $$;

do $$
declare n int;
begin
  select count(*) into n
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name in ('org_connectors','connector_sync_state');
  if n > 0 then raise exception 'FAIL: anon holds % grant(s) on the connector tables', n; end if;
  raise notice 'ok  anon holds no grant on the connector tables';
end $$;

-- Sync state has no client write policy: a compromised browser session must
-- not be able to forge a "last synced" that hides a broken connector.
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'connector_sync_state'
     and cmd in ('INSERT','UPDATE','DELETE','ALL');
  if n > 0 then raise exception 'FAIL: connector_sync_state has % client write policy(ies)', n; end if;
  raise notice 'ok  connector_sync_state is read-only to clients';
end $$;

-- ── 5. provenance columns landed on the real roster tables ───────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and column_name = 'source_connector_id'
     and table_name in ('team_athletes','import_batches');
  if n <> 2 then raise exception 'FAIL: provenance columns missing (found %)', n; end if;
  raise notice 'ok  provenance columns on team_athletes and import_batches';
end $$;

-- ── 6. deleting a connector keeps the rows it produced ───────────────────
-- Downgrade and disconnect never delete customer data (I11). The link goes
-- null; the athlete row survives.
insert into public.team_athletes (id, source_connector_id)
  values ('44444444-4444-4444-4444-444444444444',
          '33333333-3333-3333-3333-333333333333');
delete from public.org_connectors where id = '33333333-3333-3333-3333-333333333333';
do $$
declare v uuid; n int;
begin
  select count(*) into n from public.team_athletes
   where id = '44444444-4444-4444-4444-444444444444';
  if n <> 1 then raise exception 'FAIL I11: disconnecting deleted the athlete row'; end if;
  select source_connector_id into v from public.team_athletes
   where id = '44444444-4444-4444-4444-444444444444';
  if v is not null then raise exception 'FAIL: dangling connector reference'; end if;
  raise notice 'ok  I11: disconnecting keeps the data and nulls the link';
end $$;

select 'org-connectors fixture PASSED' as result;
