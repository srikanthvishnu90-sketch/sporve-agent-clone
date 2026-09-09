-- RED DRAFT — NOT APPLIED. The owner applies this by hand.
-- 2026-09-09 · the OAuth half of the connector spine
--
-- DEPENDS ON 2026-09-09-org-connectors.sql. Apply that one first; this adds
-- the three things an actual OAuth round trip needs and the first draft
-- deliberately left out:
--
--   1. connector_oauth_state — the one-time state parameter. Without a stored,
--      single-use, expiring state, the callback accepts any code anyone sends
--      it, which is CSRF against a mailbox connection.
--   2. Vault wrappers — the refresh token is the crown jewel. It goes into
--      Supabase Vault (encrypted at rest); org_connectors keeps only the
--      secret's uuid. These three functions are the ONLY path in or out, they
--      are service_role-only, and they exist so an edge function never needs
--      rights on the vault schema itself.
--   3. connector_claim_oauth_state — consumes the state and returns its
--      payload in one atomic statement, so a replayed callback finds nothing.
--
-- WHY A SEPARATE FILE. The first draft is already merged and reviewed. This is
-- additive and depends on it; keeping them apart means the review of each is
-- readable on its own.
--
-- APPLY WITH
--   supabase db push   (or the SQL editor on tseszaprvtvqrkfpditu)
-- ROLLBACK is at the bottom.

begin;

-- Vault ships with Supabase. Named here so a project without it fails loudly
-- at apply time rather than at the first connection attempt. The guard exists
-- for the disposable-cluster fixture, which stands up a vault stub: a bare
-- Postgres has no supabase_vault extension to install. In production the
-- lookup finds nothing, the CREATE EXTENSION runs, and a missing Vault still
-- aborts the migration.
do $$
begin
  if to_regprocedure('vault.create_secret(text,text,text)') is null then
    create extension if not exists supabase_vault with schema vault;
  end if;
end $$;

-- ── 1. one-time OAuth state ──────────────────────────────────────────────
create table if not exists public.connector_oauth_state (
  state         text primary key,
  provider_id   uuid not null references public.providers(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          public.connector_kind not null,
  redirect_to   text,
  created_at    timestamptz not null default now(),
  -- Ten minutes is longer than a consent screen takes and short enough that a
  -- state leaked from a browser history is useless.
  expires_at    timestamptz not null default now() + interval '10 minutes'
);

create index if not exists connector_oauth_state_expiry_idx
  on public.connector_oauth_state (expires_at);

alter table public.connector_oauth_state enable row level security;
alter table public.connector_oauth_state force row level security;
-- No policies at all: this table is service_role-only by construction. A
-- client that could read it could hijack a pending connection.
revoke all on public.connector_oauth_state from anon, authenticated;

-- ── 2. claim the state, exactly once ─────────────────────────────────────
-- The delete and the read are one statement, so two concurrent callbacks
-- cannot both succeed.
--
-- The data-modifying CTE sweeps expired rows on the way past. Nothing else
-- ever would: an abandoned consent screen leaves a row behind, and this table
-- has no other writer and no cron. The two DELETEs touch disjoint sets
-- (expired versus unexpired) so they cannot fight, and the expires_at index
-- makes the sweep cheap.
create or replace function public.connector_claim_oauth_state(p_state text)
returns table (provider_id uuid, user_id uuid, kind public.connector_kind, redirect_to text)
language sql
security definer
set search_path = public, pg_temp
as $$
  with swept as (
    delete from public.connector_oauth_state
     where expires_at <= now()
    returning 1
  )
  delete from public.connector_oauth_state s
   where s.state = p_state
     and s.expires_at > now()
  returning s.provider_id, s.user_id, s.kind, s.redirect_to;
$$;

revoke all on function public.connector_claim_oauth_state(text) from public, anon, authenticated;
grant execute on function public.connector_claim_oauth_state(text) to service_role;

-- ── 3. the Vault wrappers ────────────────────────────────────────────────
-- Store. Replaces any secret already held for this connector, so reconnecting
-- never leaves an orphaned token behind that still works.
create or replace function public.connector_store_secret(p_connector uuid, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare v_old uuid; v_new uuid;
begin
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'refusing to store an empty connector secret';
  end if;

  select vault_secret_id into v_old
    from public.org_connectors where id = p_connector for update;
  if not found then
    raise exception 'no such connector %', p_connector;
  end if;

  -- Drop the superseded secret FIRST. vault.secrets.name is unique, and the
  -- name is derived from the connector id, so creating before deleting would
  -- collide on every reconnect. A plpgsql function is one transaction, so if
  -- create_secret then fails the delete rolls back with it and the old token
  -- survives — the ordering costs nothing.
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;

  v_new := vault.create_secret(p_secret, 'connector:' || p_connector::text,
                               'OAuth refresh token for org_connectors row ' || p_connector::text);
  update public.org_connectors set vault_secret_id = v_new, updated_at = now()
   where id = p_connector;
  return v_new;
end $$;

revoke all on function public.connector_store_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.connector_store_secret(uuid, text) to service_role;

-- Read. The only way a refresh token leaves the database.
create or replace function public.connector_read_secret(p_connector uuid)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare v_id uuid; v_secret text;
begin
  select vault_secret_id into v_id from public.org_connectors
   where id = p_connector and status = 'connected';
  if v_id is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_id;
  return v_secret;
end $$;

revoke all on function public.connector_read_secret(uuid) from public, anon, authenticated;
grant execute on function public.connector_read_secret(uuid) to service_role;

-- Forget. Disconnecting must destroy the token, not merely hide the row —
-- otherwise "disconnect" is a lie the customer cannot check.
create or replace function public.connector_forget_secret(p_connector uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare v_id uuid;
begin
  select vault_secret_id into v_id from public.org_connectors
   where id = p_connector for update;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  update public.org_connectors
     set vault_secret_id = null, status = 'disconnected',
         revoked_at = now(), updated_at = now()
   where id = p_connector;
end $$;

revoke all on function public.connector_forget_secret(uuid) from public, anon, authenticated;
grant execute on function public.connector_forget_secret(uuid) to service_role;

-- ── 4. deleting a connector must not orphan its token ────────────────────
-- A plain DELETE on org_connectors would leave the Vault row behind forever.
create or replace function public.connector_drop_secret_tg()
returns trigger
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  if old.vault_secret_id is not null then
    delete from vault.secrets where id = old.vault_secret_id;
  end if;
  return old;
end $$;

drop trigger if exists org_connectors_drop_secret on public.org_connectors;
create trigger org_connectors_drop_secret
  before delete on public.org_connectors
  for each row execute function public.connector_drop_secret_tg();

commit;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- begin;
--   drop trigger if exists org_connectors_drop_secret on public.org_connectors;
--   drop function if exists public.connector_drop_secret_tg();
--   drop function if exists public.connector_forget_secret(uuid);
--   drop function if exists public.connector_read_secret(uuid);
--   drop function if exists public.connector_store_secret(uuid, text);
--   drop function if exists public.connector_claim_oauth_state(text);
--   drop table if exists public.connector_oauth_state;
-- commit;
