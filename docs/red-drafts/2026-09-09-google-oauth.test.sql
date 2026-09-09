-- Disposable-database fixture for 2026-09-09-google-oauth.sql.
-- Never runs against production. Create the database first:
--
--     createdb sporv_google_oauth
--     psql -d sporv_google_oauth -f docs/red-drafts/2026-09-09-google-oauth.test.sql
--
-- or just: bash tools/run-sql-fixtures.sh 2026-09-09-google-oauth
--
-- WHAT THIS PROVES. Four things, each of which is a real attack if it stops
-- being true: a state can be claimed only once, an expired state cannot be
-- claimed at all, a signed-in customer cannot reach any of the secret
-- functions, and disconnecting or deleting a connector destroys the token
-- rather than orphaning it.

\set ON_ERROR_STOP on

do $$ begin
  if current_database() not like 'sporv%' then
    -- %% is a literal percent in RAISE; a bare % would be read as a placeholder.
    raise exception 'refusing to run outside a disposable sporv_%% database (got %)',
      current_database();
  end if;
end $$;

-- ── stand-ins ────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
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

-- A bare Postgres has no supabase_vault extension. This stub has the same
-- shape as the real thing for the three objects the draft touches, so the
-- fixture tests OUR functions rather than Supabase's.
create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE on purpose: real Supabase Vault enforces it, and without it here
  -- the stub hides a reconnect that would fail in production. CodeRabbit
  -- caught exactly that on PR #400.
  name text unique, description text, secret text,
  created_at timestamptz not null default now());
create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null,
                                               new_description text default '')
returns uuid language sql as $fn$
  insert into vault.secrets (secret, name, description)
  values (new_secret, new_name, new_description) returning id $fn$;

-- ── the drafts under test, in dependency order ───────────────────────────
\ir 2026-09-09-org-connectors.sql
\ir 2026-09-09-google-oauth.sql

-- ── fixtures ─────────────────────────────────────────────────────────────
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into public.providers (id, owner_id)
  values ('22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111');
insert into public.org_connectors (id, provider_id, kind, write_mode)
  values ('33333333-3333-3333-3333-333333333333',
          '22222222-2222-2222-2222-222222222222','gmail','draft');

-- ── 1. a state is claimable exactly once ─────────────────────────────────
insert into public.connector_oauth_state (state, provider_id, user_id, kind)
  values ('st-good','22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111','gmail');
do $$
declare n int;
begin
  select count(*) into n from public.connector_claim_oauth_state('st-good');
  if n <> 1 then raise exception 'FAIL: first claim returned % rows', n; end if;
  select count(*) into n from public.connector_claim_oauth_state('st-good');
  if n <> 0 then raise exception 'FAIL: a replayed state was accepted'; end if;
  raise notice 'ok  a state is claimable exactly once';
end $$;

-- ── 2. an expired state is never claimable ───────────────────────────────
insert into public.connector_oauth_state (state, provider_id, user_id, kind, expires_at)
  values ('st-old','22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111','gmail', now() - interval '1 minute');
do $$
declare n int;
begin
  select count(*) into n from public.connector_claim_oauth_state('st-old');
  if n <> 0 then raise exception 'FAIL: an expired state was accepted'; end if;
  -- And it is gone. Nothing else sweeps this table: an abandoned consent
  -- screen would otherwise leave a row behind forever.
  select count(*) into n from public.connector_oauth_state where state = 'st-old';
  if n <> 0 then raise exception 'FAIL: the expired state was left behind'; end if;
  raise notice 'ok  an expired state is never claimable, and is swept';
end $$;

-- ── 3. a signed-in customer cannot reach the secret functions ────────────
-- This is the whole point of security definer plus a revoke. If any of these
-- succeed as `authenticated`, a compromised browser session can read every
-- connected mailbox token in the database.
do $$
declare fn text;
begin
  foreach fn in array array[
    'connector_claim_oauth_state(text)',
    'connector_store_secret(uuid, text)',
    'connector_read_secret(uuid)',
    'connector_forget_secret(uuid)']
  loop
    if has_function_privilege('authenticated', 'public.' || fn, 'execute') then
      raise exception 'FAIL: authenticated may execute %', fn; end if;
    if has_function_privilege('anon', 'public.' || fn, 'execute') then
      raise exception 'FAIL: anon may execute %', fn; end if;
    if not has_function_privilege('service_role', 'public.' || fn, 'execute') then
      raise exception 'FAIL: service_role may NOT execute %', fn; end if;
  end loop;
  raise notice 'ok  secret functions are service_role-only';
end $$;

do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
   where grantee in ('anon','authenticated')
     and table_schema = 'public' and table_name = 'connector_oauth_state';
  if n > 0 then raise exception 'FAIL: clients hold % grant(s) on connector_oauth_state', n; end if;
  raise notice 'ok  connector_oauth_state is unreachable from a client';
end $$;

-- ── 4. storing replaces, reading returns, and neither leaks ──────────────
do $$
declare v1 uuid; v2 uuid; s text; n int;
begin
  v1 := public.connector_store_secret('33333333-3333-3333-3333-333333333333','refresh-one');
  s  := public.connector_read_secret('33333333-3333-3333-3333-333333333333');
  if s <> 'refresh-one' then raise exception 'FAIL: read back %, expected refresh-one', s; end if;

  -- Reconnecting must not leave the old token working.
  v2 := public.connector_store_secret('33333333-3333-3333-3333-333333333333','refresh-two');
  if v1 = v2 then raise exception 'FAIL: reconnect reused the same vault row'; end if;
  select count(*) into n from vault.secrets where id = v1;
  if n <> 0 then raise exception 'FAIL: the superseded token survived'; end if;
  s := public.connector_read_secret('33333333-3333-3333-3333-333333333333');
  if s <> 'refresh-two' then raise exception 'FAIL: read back % after reconnect', s; end if;
  raise notice 'ok  storing replaces the old token and reading returns the new one';
end $$;

-- Reconnect twice more. With vault.secrets.name unique and the name derived
-- from the connector id, a create-before-delete ordering fails here on the
-- second pass — which is what production would have done.
do $$
declare s text;
begin
  perform public.connector_store_secret('33333333-3333-3333-3333-333333333333','refresh-three');
  perform public.connector_store_secret('33333333-3333-3333-3333-333333333333','refresh-four');
  s := public.connector_read_secret('33333333-3333-3333-3333-333333333333');
  if s <> 'refresh-four' then raise exception 'FAIL: read back % after two reconnects', s; end if;
  raise notice 'ok  repeated reconnects do not collide on the secret name';
end $$;

-- An empty secret is a bug upstream, never a valid state. The handler asserts
-- the EXACT message: catching any error here would let an unrelated failure
-- (a missing column, a permission change) pass as a working guard.
do $$ begin
  begin
    perform public.connector_store_secret('33333333-3333-3333-3333-333333333333','');
    raise exception 'FAIL: an empty secret was stored';
  exception when raise_exception then
    if sqlerrm <> 'refusing to store an empty connector secret' then raise; end if;
    raise notice 'ok  an empty secret is refused';
  end;
end $$;

-- ── 5. disconnecting destroys the token ──────────────────────────────────
do $$
declare n int; st public.connector_status;
begin
  perform public.connector_forget_secret('33333333-3333-3333-3333-333333333333');
  select count(*) into n from vault.secrets;
  if n <> 0 then raise exception 'FAIL: disconnect left % token(s) behind', n; end if;
  select status into st from public.org_connectors
   where id = '33333333-3333-3333-3333-333333333333';
  if st <> 'disconnected' then raise exception 'FAIL: status is % after disconnect', st; end if;
  raise notice 'ok  disconnecting destroys the token and marks the row';
end $$;

-- ── 6. deleting the row destroys the token too ───────────────────────────
do $$
declare n int;
begin
  perform public.connector_store_secret('33333333-3333-3333-3333-333333333333','refresh-three');
  delete from public.org_connectors where id = '33333333-3333-3333-3333-333333333333';
  select count(*) into n from vault.secrets;
  if n <> 0 then raise exception 'FAIL: deleting a connector orphaned % token(s)', n; end if;
  raise notice 'ok  deleting a connector destroys its token';
end $$;

select 'google-oauth fixture PASSED' as result;
