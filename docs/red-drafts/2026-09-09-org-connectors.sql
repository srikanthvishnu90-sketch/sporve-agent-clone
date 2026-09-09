-- RED DRAFT — NOT APPLIED. The owner applies this by hand.
-- 2026-09-09 · org_connectors + connector_sync_state
--
-- WHY THIS EXISTS
-- The signup Connect step (PR #395) renders eleven connector tiles and derives
-- every state from something else: Stripe's charges_enabled, a saved website
-- extraction, an import batch. That is honest but it does not scale past three
-- connectors, and it cannot record a failure, a last sync, or a scope grant.
-- These two tables are where a real connection lives.
--
-- CONSTITUTION CONSTRAINTS THIS ENCODES
--   I1  the agent never sends. Nothing here stores a send capability, and the
--       write_mode enum has no 'send' value at all — not disabled, absent.
--   I3  we never store a customer's password for TeamSnap/SportsEngine and
--       never drive a headless browser into their logged-in session. There is
--       no password column. OAuth tokens live in Vault, not in this table;
--       this table holds only the Vault secret id.
--   I6  RLS on every public table, enforced as a release gate.
--   I7  minors' data is compartmented — connectors never widen that.
--
-- APPLY WITH
--   supabase db push        (or paste into the SQL editor on the prod project
--                            tseszaprvtvqrkfpditu)
-- ROLLBACK is at the bottom.

begin;

-- ── enums ────────────────────────────────────────────────────────────────
-- Deliberately narrow. A connector that is not listed cannot be inserted, so
-- a typo in application code fails loudly instead of creating a ghost row.
do $$ begin
  create type public.connector_kind as enum (
    'stripe','website','file_import',
    'gmail','google_calendar','microsoft365','sms',
    'google_sheets','google_drive','quickbooks','google_business_profile');
exception when duplicate_object then null; end $$;

-- No 'send'. See I1. 'draft' is the strongest write a family-facing
-- connector may ever hold.
do $$ begin
  create type public.connector_write_mode as enum ('none','draft','apply');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connector_status as enum (
    'connected','revoked','expired','error','disconnected');
exception when duplicate_object then null; end $$;

-- ── org_connectors ───────────────────────────────────────────────────────
create table if not exists public.org_connectors (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.providers(id) on delete cascade,
  kind              public.connector_kind not null,
  status            public.connector_status not null default 'connected',
  write_mode        public.connector_write_mode not null default 'none',

  -- Identity of the connected account as the far side reports it, so the UI
  -- can say WHICH mailbox is connected. Never a credential.
  external_account  text,
  scopes            text[] not null default '{}',

  -- The OAuth refresh token lives in Supabase Vault. This is the id of that
  -- secret, never the secret. A leak of this table leaks no access.
  vault_secret_id   uuid,

  connected_by      uuid references auth.users(id) on delete set null,
  connected_at      timestamptz not null default now(),
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One live connection per kind per org. A second Gmail replaces the first
  -- rather than silently double-reading the same mailbox.
  constraint org_connectors_one_live_per_kind unique (provider_id, kind)
);

-- I1 as a check constraint, not a convention: the four family-facing kinds
-- may never hold 'apply'. A future migration that tries to widen this has to
-- drop a named constraint, which is visible in review.
alter table public.org_connectors drop constraint if exists org_connectors_no_send;
alter table public.org_connectors add constraint org_connectors_no_send check (
  case when kind in ('gmail','microsoft365','sms')
       then write_mode in ('none','draft')
       else true end);

-- A read-only connector may not claim a write mode.
alter table public.org_connectors drop constraint if exists org_connectors_readonly_kinds;
alter table public.org_connectors add constraint org_connectors_readonly_kinds check (
  case when kind in ('website','file_import','google_sheets','google_drive','quickbooks')
       then write_mode = 'none'
       else true end);

create index if not exists org_connectors_provider_idx
  on public.org_connectors (provider_id, status);

-- ── connector_sync_state ─────────────────────────────────────────────────
-- One row per connector. Holds where the last read got to and what went wrong,
-- so the Settings page can show a DATED failure instead of a silent nothing.
create table if not exists public.connector_sync_state (
  connector_id      uuid primary key
                      references public.org_connectors(id) on delete cascade,
  provider_id       uuid not null references public.providers(id) on delete cascade,
  cursor            text,
  last_success_at   timestamptz,
  last_attempt_at   timestamptz,
  last_error        text,
  last_error_at     timestamptz,
  items_seen        bigint not null default 0,
  updated_at        timestamptz not null default now()
);

create index if not exists connector_sync_state_provider_idx
  on public.connector_sync_state (provider_id);

-- ── provenance on ingested rows ──────────────────────────────────────────
-- Anything the agent reads from a connector must be traceable back to the
-- connector that produced it. Without this, a finding cannot cite its source
-- and an org cannot be told which mailbox a fact came from.
--
-- SCHEMA NOTE (checked 2026-09-09, not assumed): there is no public.members
-- table in this project. A roster person is public.athletes, and the roster
-- LINK — the row an import actually creates — is public.team_athletes, which
-- already carries import_batch_id from migration 20260830_000100. Connector
-- provenance sits beside it, on the same row, for the same reason.
alter table public.team_athletes
  add column if not exists source_connector_id uuid
    references public.org_connectors(id) on delete set null;

alter table public.import_batches
  add column if not exists source_connector_id uuid
    references public.org_connectors(id) on delete set null;

create index if not exists team_athletes_source_connector_idx
  on public.team_athletes (source_connector_id) where source_connector_id is not null;

-- ── RLS (I6) ─────────────────────────────────────────────────────────────
alter table public.org_connectors      enable row level security;
alter table public.connector_sync_state enable row level security;
alter table public.org_connectors      force row level security;
alter table public.connector_sync_state force row level security;

-- Owner of the provider record reads and manages its own connectors.
-- Deliberately NOT split into per-command policies with different predicates:
-- one predicate, four commands, so a future edit cannot widen one of them
-- without the others being obviously inconsistent.
drop policy if exists org_connectors_owner_all on public.org_connectors;
create policy org_connectors_owner_all on public.org_connectors
  for all to authenticated
  using (exists (select 1 from public.providers p
                  where p.id = org_connectors.provider_id
                    and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.providers p
                  where p.id = org_connectors.provider_id
                    and p.owner_id = (select auth.uid())));

drop policy if exists connector_sync_state_owner_read on public.connector_sync_state;
create policy connector_sync_state_owner_read on public.connector_sync_state
  for select to authenticated
  using (exists (select 1 from public.providers p
                  where p.id = connector_sync_state.provider_id
                    and p.owner_id = (select auth.uid())));

-- Sync state is written by the ingestion workers only, which run as
-- service_role. No client-side write policy exists, so a compromised browser
-- session cannot forge a "last synced" that hides a broken connector.

-- anon reads nothing here. Stated explicitly rather than left to the default,
-- because the default has been wrong in this project before.
revoke all on public.org_connectors       from anon;
revoke all on public.connector_sync_state from anon;

commit;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- begin;
--   drop index if exists public.team_athletes_source_connector_idx;
--   alter table public.team_athletes  drop column if exists source_connector_id;
--   alter table public.import_batches drop column if exists source_connector_id;
--   drop table if exists public.connector_sync_state;
--   drop table if exists public.org_connectors;
--   drop type  if exists public.connector_status;
--   drop type  if exists public.connector_write_mode;
--   drop type  if exists public.connector_kind;
-- commit;
