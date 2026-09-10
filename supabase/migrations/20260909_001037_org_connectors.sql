-- Applied to production as migration version 20260909234439.
-- Written back into the repository 2026-09-10: this file is the EXACT
-- SQL the database recorded, pulled from supabase_migrations.schema_migrations
-- rather than retyped, so the repo can rebuild production byte-for-byte.

-- 2026-09-09 · org_connectors + connector_sync_state
-- Source: docs/red-drafts/2026-09-09-org-connectors.sql (owner-authorised apply)
--
-- I1  the agent never sends: the write-mode enum has no send value, and a
--     named check constraint stops the family-facing kinds holding 'apply'.
-- I3  no password or session column: we never hold a customer's login to
--     another tool. OAuth tokens live in Vault; this keeps only the secret id.
-- I6  RLS enabled AND forced on both tables; anon explicitly revoked.

do $$ begin
  create type public.connector_kind as enum (
    'stripe','website','file_import',
    'gmail','google_calendar','microsoft365','sms',
    'google_sheets','google_drive','quickbooks','google_business_profile');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connector_write_mode as enum ('none','draft','apply');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.connector_status as enum (
    'connected','revoked','expired','error','disconnected');
exception when duplicate_object then null; end $$;

create table if not exists public.org_connectors (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.providers(id) on delete cascade,
  kind              public.connector_kind not null,
  status            public.connector_status not null default 'connected',
  write_mode        public.connector_write_mode not null default 'none',
  external_account  text,
  scopes            text[] not null default '{}',
  vault_secret_id   uuid,
  connected_by      uuid references auth.users(id) on delete set null,
  connected_at      timestamptz not null default now(),
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint org_connectors_one_live_per_kind unique (provider_id, kind)
);

alter table public.org_connectors drop constraint if exists org_connectors_no_send;
alter table public.org_connectors add constraint org_connectors_no_send check (
  case when kind in ('gmail','microsoft365','sms')
       then write_mode in ('none','draft')
       else true end);

alter table public.org_connectors drop constraint if exists org_connectors_readonly_kinds;
alter table public.org_connectors add constraint org_connectors_readonly_kinds check (
  case when kind in ('website','file_import','google_sheets','google_drive','quickbooks')
       then write_mode = 'none'
       else true end);

create index if not exists org_connectors_provider_idx
  on public.org_connectors (provider_id, status);

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

-- Provenance. Checked, not assumed: there is no public.members table here.
-- The roster LINK an import creates is public.team_athletes, which already
-- carries import_batch_id from 20260830_000100.
alter table public.team_athletes
  add column if not exists source_connector_id uuid
    references public.org_connectors(id) on delete set null;

alter table public.import_batches
  add column if not exists source_connector_id uuid
    references public.org_connectors(id) on delete set null;

create index if not exists team_athletes_source_connector_idx
  on public.team_athletes (source_connector_id) where source_connector_id is not null;

alter table public.org_connectors      enable row level security;
alter table public.connector_sync_state enable row level security;
alter table public.org_connectors      force row level security;
alter table public.connector_sync_state force row level security;

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

-- Sync state is written by service_role workers only. No client write policy,
-- so a compromised browser session cannot forge a "last synced" that hides a
-- broken connector.

revoke all on public.org_connectors       from anon;
revoke all on public.connector_sync_state from anon;
