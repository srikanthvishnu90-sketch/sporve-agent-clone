-- ============================================================================
-- 20260915_001062 — SPEC 17 slice 1: every imported row leaves a record [G10]
-- Fable lane (D14). FILE ONLY — never applied (D5).
--
-- "Never silently drop a row. A silently dropped athlete is a child who does
-- not appear on a roster." Today the importer's dry run computes created /
-- matched / review / rejected in the browser, shows them once, and writes
-- only the created ones. The rejected and review rows live for one render.
-- After this file every parsed row is an import_row with a state, so
-- "zero rows silently dropped" and "a re-run creates zero duplicates" are
-- queries, not screenshots.
--
-- Corrections to the spec as written (verified against the live schema):
-- organization_id → provider_id (R1, no organizations table); target
-- 'athlete' → 'member' (roster identity is team_athletes.id; public.athletes
-- has 0 rows and is the retired family-owned identity); 'event' deferred
-- until spec 12's event table is applied; obligations gets
-- source_kind='migrated' (an existing CHECK), not a new source column.
-- ============================================================================

-- ── 1. import_batches learns where a file came from and what happened ─────
alter table public.import_batches
  add column if not exists source text not null default 'csv_generic'
    check (source in ('teamsnap','sports_connect','sportsengine','sheets','csv_generic','website')),
  add column if not exists mapping jsonb,
  add column if not exists stats jsonb;
comment on column public.import_batches.mapping is 'Header → field mapping the director confirmed. Remembered per org so a second upload from the same source needs zero clicks.';
comment on column public.import_batches.stats is 'Counts by import_row.state at commit: {"imported":312,"quarantined":41,"skipped":3,"conflict":2}. Shown to the director; never derived from memory.';

-- ── 2. one row per source row, whatever happened to it ────────────────────
create table if not exists public.import_row (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.import_batches(id) on delete cascade,
  provider_id     uuid not null references public.providers(id) on delete cascade,
  row_no          integer,
  source_row_hash text not null,
  raw             jsonb not null,
  target          text not null check (target in ('member','guardian','team','obligation')),
  resolved_id     uuid,
  state           text not null default 'pending'
                  check (state in ('pending','mapped','conflict','imported','quarantined','skipped')),
  problem         text,
  created_at      timestamptz not null default now(),
  unique (batch_id, source_row_hash)
);
comment on table public.import_row is
  'Spec 17.3. Every row of every upload, with what became of it. raw holds the source row (child names, DOBs, guardian contacts) and is org-scoped under RLS; it is deleted with its batch.';
create index if not exists idx_import_row_batch_state on public.import_row (batch_id, state);

alter table public.import_row enable row level security;
alter table public.import_row force row level security;
-- mirrors import_batches_all_owner: the org owner, and only for their org
create policy import_row_all_owner on public.import_row
  for all to authenticated
  using (exists (select 1 from public.providers pv where pv.id = import_row.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv where pv.id = import_row.provider_id and pv.owner_id = auth.uid()));
grant select, insert, update on public.import_row to authenticated;
grant all on public.import_row to service_role;

-- a row can only be filed under a batch of the same org
create or replace function public.enforce_import_row_batch()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.import_batches b where b.id = new.batch_id and b.provider_id = new.provider_id) then
    raise exception using errcode = '23514', message = 'import_row: batch belongs to a different organization';
  end if;
  return new;
end; $$;
drop trigger if exists trg_enforce_import_row_batch on public.import_row;
create trigger trg_enforce_import_row_batch before insert or update on public.import_row
  for each row execute function public.enforce_import_row_batch();

-- ── 3. the count a director sees is computed, never remembered ────────────
create or replace function public.import_batch_stats(p_batch uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb)
    from (select r.state, count(*) as n from public.import_row r where r.batch_id = p_batch group by r.state) s
$$;
revoke all on function public.import_batch_stats(uuid) from public, anon;
grant execute on function public.import_batch_stats(uuid) to authenticated, service_role;

-- ── 4. migrated debt is marked, so the ledger tells historical from new ────
alter table public.obligations drop constraint if exists obligations_source_kind_check;
alter table public.obligations add constraint obligations_source_kind_check
  check (source_kind in ('manual','email','pdf','sms','agent','migrated'));
