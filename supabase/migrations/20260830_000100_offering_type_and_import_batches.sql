-- ============================================================================
-- Task 1 (forward migration) — offering type + import batches
-- Drafted 2026-08-30. RED: owner-applied. Prod project tseszaprvtvqrkfpditu.
--
-- PREMISE CORRECTION (rule 9): the brief's "zero .sql files, schema not
-- reconstructable" and "build org/person/membership/team/offering" are stale —
-- the full schema was captured to 00000000000000_baseline.sql today, and the
-- org model ALREADY EXISTS there: providers(provider_type='organization')=org,
-- profiles=person, organization_members(role, is_active, bg-check)=membership,
-- teams=team, team_athletes=team roster, programs=offering. So Task 1 is NOT a
-- from-scratch build. Only two things are genuinely missing, and this migration
-- adds exactly them — nothing else is safe to duplicate.
--
-- THE THREE ARCHITECTURAL CALLS (owner may overrule):
--  1. Multi-org membership: ALREADY YES. organization_members has no unique on
--     member_user_id alone, so one person is a member of many orgs today (a
--     coach at two clubs). No change needed — decision is "keep it."
--  2. RLS user→org resolution: SECURITY DEFINER helper, NOT a JWT claim (simpler,
--     correct, never stale). This migration scopes import_batches to the provider
--     OWNER (auth.uid() = providers.owner_id), which needs no new helper; the
--     existing is_org_admin(org) SECURITY DEFINER fn is the pattern for the later
--     org-wide surfaces (the obligation table).
--  3. COPPA posture: these objects store NO child PII and create NO athlete rows.
--     import_batches holds only batch metadata; the athlete↔batch link is a
--     nullable FK ON team_athletes, which already references the family-owned,
--     consent-gated athletes table. The existing trg_enforce_athlete_consent
--     stays the SOLE consent gate — we inherit the obligation by reference and
--     never build a second child-identity system (see the F1 org-members finding
--     for why parallel identity systems are the trap).
-- ============================================================================

-- ── 1. offering_type: stored, never inferred ───────────────────────────────
-- The taxonomy doc's core lesson (docs/offering-taxonomy.md): type was guessed
-- from a title regex by two classifiers that disagreed, and the "team" band went
-- permanently empty because every row was single_session. Fix = a real, stored,
-- CHECK-constrained column set at creation, decoupled from pricing_model.
alter table public.programs
  add column if not exists offering_type text not null default 'private'
    check (offering_type in ('private','camp','team'));

comment on column public.programs.offering_type is
  'private = solo coach 1:1/small-group; camp = time-boxed clinic/class (a format, either owner); team = org squad/season. Stored, never inferred from title or price. See docs/offering-taxonomy.md.';

-- One-time backfill from the signals the shipped ptypeOf() used, in priority
-- order (declared org type > camp format keywords > default private).
update public.programs p set offering_type = case
  when exists (select 1 from public.providers pv
              where pv.id = p.provider_id and pv.provider_type = 'organization') then 'team'
  when coalesce(p.title,'') ~* '\y(camp|clinic|intro|foundation|fundamental|learn.?to|basics)\y' then 'camp'
  else 'private'
end
where p.offering_type = 'private';   -- only rows still at the default

-- ── 2. import_batches: the roster-import undo spine (SPEC-01 durable half) ───
-- Client-side roster import writes shadow records today; when a real server-side
-- import lands, every row it creates is stamped with a batch id so undo deletes
-- exactly that batch and nothing else. This table + the FK below are that spine.
create table if not exists public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  provider_id     uuid not null references public.providers(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  source_filename text,
  row_count       integer not null default 0 check (row_count >= 0),
  undone_at       timestamptz,
  created_at      timestamptz not null default now()
);

comment on table public.import_batches is
  'One row per committed roster import. Undo (within 24h) deletes the batch and every team_athletes row carrying its import_batch_id. Holds NO child PII.';

-- Athlete↔batch link. Nullable so it does not disturb existing team_athletes
-- rows; ON DELETE SET NULL so undoing a batch never orphans an athlete record.
alter table public.team_athletes
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

create index if not exists idx_team_athletes_import_batch
  on public.team_athletes (import_batch_id) where import_batch_id is not null;

-- ── 3. RLS: coach owns their provider's batches (mirror session_notes) ──────
alter table public.import_batches enable row level security;

create policy import_batches_all_owner on public.import_batches
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = import_batches.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = import_batches.provider_id and pv.owner_id = auth.uid()));

grant select, insert, update, delete on public.import_batches to authenticated;

-- ── 4. Trigger: created_by is server-set, batch is append-then-undo only ────
-- Without this an owner could backdate created_by or flip undone_at on someone
-- else's batch (RLS scopes rows, not columns). Mirrors the enforce_* pattern.
create or replace function public.enforce_import_batch_write()
 returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;      -- service role: trusted
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.undone_at  := null;
    return new;
  end if;
  if new.provider_id is distinct from old.provider_id
   or new.created_by  is distinct from old.created_by
   or new.source_filename is distinct from old.source_filename
   or new.row_count   is distinct from old.row_count
   or new.created_at  is distinct from old.created_at then
    raise exception 'import_batches identity fields are immutable; only undone_at may change';
  end if;
  return new;
end; $$;

revoke all on function public.enforce_import_batch_write() from public, anon, authenticated;

create trigger trg_enforce_import_batch_write
  before insert or update on public.import_batches
  for each row execute function public.enforce_import_batch_write();

-- ============================================================================
-- VERIFY BEFORE APPLYING (needs a shell — currently disabled for Claude):
--   supabase db reset            # applies baseline + this from scratch
--   -- then, as two different users, assert:
--   --   coach A cannot SELECT coach B's import_batches (cross-owner denied)
--   --   a non-owner UPDATE of undone_at is denied
--   --   offering_type rejects a value outside {private,camp,team}
--   --   undoing a batch (delete) sets team_athletes.import_batch_id to null,
--   --     never deletes the athlete row
-- Do NOT db push until the local RLS assertions pass. This file is a DRAFT.
-- ============================================================================
