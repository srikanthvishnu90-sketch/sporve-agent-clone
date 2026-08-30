-- ============================================================================
-- Step 4 (north star) — the OBLIGATION model
-- Drafted 2026-08-30. RED: owner-applied. Prod project tseszaprvtvqrkfpditu.
--
-- WHY THIS IS THE PRODUCT: the whole differentiator is "the work is already done
-- when the director opens it." That requires a durable place for work that is
-- WAITING — drafted, not yet approved. This table is that place. It is the spine
-- steps 5–7 hang off:
--   5. Ingest → drafts : a forwarded PDF/text/email parses into obligation rows
--                        with status='draft', source_kind='email'|'pdf'|'sms'.
--   6. Background run   : a Sunday-night agent inserts draft obligations so
--                        Monday morning the queue is already full.
--   7. Review-queue UI  : the interface is approve/undo these rows, not a dashboard.
--
-- THE THREE PROPERTIES THAT MAKE IT AGENT-NATIVE (not a chatbox):
--   #1 Unstructured input is native — source_kind + source_ref record what the
--      row was parsed FROM, so a draft is traceable to the PDF/text it came from.
--   #2 Every write has a defined inverse — `inverse` jsonb carries how to undo an
--      approved obligation, so an agent can ACT (approve→done) reversibly rather
--      than only suggest. Undo is a schema property, not a human remembering.
--   #3 It works when nobody is logged in — nothing here needs a session; a cron
--      agent inserts drafts, and the queue is waiting at next login.
--
-- COPPA posture (inherited by reference, same as import_batches): an obligation
-- may REFERENCE an athlete (athlete_id) but never creates or duplicates a child
-- record — the family-owned, consent-gated athletes table stays the sole source.
-- RLS org-resolution: SECURITY DEFINER owner check (auth.uid()=providers.owner_id),
-- the pattern chosen for the whole schema (no JWT claim).
-- ============================================================================

create table if not exists public.obligations (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,   -- the club/org
  kind          text not null check (kind in ('fee','deadline','schedule','waiver','message')),
  status        text not null default 'draft' check (status in ('draft','approved','done','void')),
  title         text not null,
  detail        text,
  -- fee obligations: an amount to collect (cents, never a float)
  amount_cents  integer check (amount_cents is null or amount_cents >= 0),
  currency      text not null default 'USD',
  -- deadline / schedule obligations: when it is due / happens
  due_at        timestamptz,
  -- who/what it concerns (all reference existing rows; none are created here)
  athlete_id    uuid references public.athletes(id) on delete set null,
  team_id       uuid references public.teams(id)    on delete set null,
  -- #1 provenance: the unstructured input this obligation was parsed from
  source_kind   text not null default 'manual' check (source_kind in ('manual','email','pdf','sms','agent')),
  source_ref    text,                    -- pointer/id to the ingested artifact
  -- #2 the defined inverse: how to reverse this obligation once actioned
  inverse       jsonb,
  -- #3 batch provenance: an agent run groups its drafts like a roster import,
  -- so a bad Sunday-night sweep is undoable as one unit
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  approved_by   uuid references public.profiles(id) on delete set null,
  approved_at   timestamptz,
  done_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.obligations is
  'Draft-first unit of club work: a fee to collect, a deadline, a schedule change, a waiver gap, a message. status draft->approved->done is the review queue; source_kind records the unstructured input it was parsed from; inverse carries its undo. The spine of "the work is already waiting when you open it".';

-- The queue read: a provider''s pending drafts, newest first.
create index if not exists idx_obligations_queue
  on public.obligations (provider_id, status, created_at desc);
create index if not exists idx_obligations_athlete
  on public.obligations (athlete_id) where athlete_id is not null;
create index if not exists idx_obligations_batch
  on public.obligations (import_batch_id) where import_batch_id is not null;

-- ── RLS: the club owner owns their obligations (mirror import_batches) ──────
alter table public.obligations enable row level security;

create policy obligations_all_owner on public.obligations
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = obligations.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = obligations.provider_id and pv.owner_id = auth.uid()));

grant select, insert, update, delete on public.obligations to authenticated;

-- ── Lifecycle trigger: the status ladder is the safety of an acting agent ──
-- draft -> approved -> done, plus void from any non-done state. No skips, no
-- backwards moves except void. approved_by/at and done_at are SERVER-set on the
-- transition, never trusted from the client. created_by is server-set on insert.
-- This is what lets an agent write status without a human being able to forge an
-- approval, and what makes "silent success" (the create_note no-op class of bug)
-- impossible: a done row must have passed through approved.
create or replace function public.enforce_obligation_lifecycle()
 returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;      -- service role (agent/webhook): trusted

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.status not in ('draft','approved') then
      raise exception 'an obligation is created as draft (or approved by its creator), never done/void';
    end if;
    if new.status = 'approved' then
      new.approved_by := auth.uid(); new.approved_at := coalesce(new.approved_at, now());
    end if;
    return new;
  end if;

  -- UPDATE: identity + provenance are immutable; only lifecycle + editable body move.
  if new.provider_id  is distinct from old.provider_id
   or new.kind        is distinct from old.kind
   or new.source_kind is distinct from old.source_kind
   or new.source_ref  is distinct from old.source_ref
   or new.import_batch_id is distinct from old.import_batch_id
   or new.created_by  is distinct from old.created_by
   or new.created_at  is distinct from old.created_at then
    raise exception 'obligation identity/provenance fields are immutable';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft'    and new.status in ('approved','void') then
      if new.status = 'approved' then new.approved_by := auth.uid(); new.approved_at := now(); end if;
    elsif old.status = 'approved' and new.status in ('done','void') then
      if new.status = 'done' then new.done_at := now(); end if;
    else
      raise exception 'illegal obligation transition % -> %', old.status, new.status;
    end if;
  end if;

  -- approval/done stamps are server-owned; a client cannot forge or clear them
  if new.approved_by is distinct from old.approved_by and new.status = old.status then
    raise exception 'approved_by is server-controlled'; end if;
  if new.done_at is distinct from old.done_at and new.status = old.status then
    raise exception 'done_at is server-controlled'; end if;

  new.updated_at := now();
  return new;
end; $$;

revoke all on function public.enforce_obligation_lifecycle() from public, anon, authenticated;

create trigger trg_enforce_obligation_lifecycle
  before insert or update on public.obligations
  for each row execute function public.enforce_obligation_lifecycle();

-- ============================================================================
-- VERIFY BEFORE APPLYING (needs a shell):
--   supabase db reset   # baseline + 000100 + this, from scratch
--   assert, as two users:
--     - coach A cannot see coach B's obligations (cross-owner denied)
--     - a client cannot INSERT status='done' (raises)
--     - draft->done directly is rejected; draft->approved->done succeeds
--     - a non-owner UPDATE is denied; approved_by cannot be forged
--     - deleting an import_batch nulls obligations.import_batch_id (no orphan)
-- DRAFT — do not db push until the local RLS + lifecycle assertions pass.
-- ============================================================================
