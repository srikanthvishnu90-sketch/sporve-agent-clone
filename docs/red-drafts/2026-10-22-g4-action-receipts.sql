-- ============================================================================
-- RED DRAFT — G4 durable action receipts (2026-10-22)
-- ============================================================================
-- NOT a migration. The owner applies this by hand (SQL editor) after review;
-- see docs/red-drafts/APPLY-ORDER.md, heading "G4 receipts".
--
-- Why: GATES.md G4 — every AI/approval write declares where its receipt is
-- written. src/mod-actions.js (window.SporvActions) verifies each write by
-- reading the row back, then POSTs one row here. Until this table exists the
-- client keeps receipts in the session and in the visible confirmation bubble,
-- and reports entry.durable = false (it never pretends a durable save).
--
-- Shape: append-only. Insert by the signed-in actor only; no UPDATE/DELETE
-- grant, so a receipt cannot be rewritten after the fact. The trigger stamps
-- actor_id and provider_id server-side — the client cannot self-report them.
--
-- Invariants: I1 untouched (this table holds evidence of a human-clicked write;
-- it writes no approved_by / sent_at and moves no money). I6: RLS enabled.
-- I9: rows are scoped to the actor's own org.
-- ============================================================================

begin;

create table if not exists public.action_receipts (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid references public.providers(id) on delete cascade,
  actor_id      uuid not null default auth.uid(),
  action        text not null check (length(action) between 1 and 64),
  receipt_store text not null check (length(receipt_store) between 1 and 200),
  receipt_id    text not null check (length(receipt_id) between 1 and 400),
  receipt       jsonb not null default '{}'::jsonb,
  reversible    boolean not null default false,
  verified_at   timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists action_receipts_provider_created_idx
  on public.action_receipts (provider_id, created_at desc);
create index if not exists action_receipts_receipt_idx
  on public.action_receipts (action, receipt_id);

-- Server-stamped identity: whatever the client sends for these is overwritten.
create or replace function public.action_receipts_stamp()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.actor_id := auth.uid();
  if new.actor_id is null then
    raise exception 'action_receipts: an authenticated actor is required';
  end if;
  select p.id into new.provider_id
    from public.providers p where p.owner_id = new.actor_id
    order by p.created_at limit 1;
  new.created_at := now();
  return new;
end; $$;
revoke all on function public.action_receipts_stamp() from public, anon, authenticated;

drop trigger if exists trg_action_receipts_stamp on public.action_receipts;
create trigger trg_action_receipts_stamp
  before insert on public.action_receipts
  for each row execute function public.action_receipts_stamp();

alter table public.action_receipts enable row level security;

revoke all on public.action_receipts from anon, authenticated;
grant select, insert on public.action_receipts to authenticated;

drop policy if exists action_receipts_insert_self on public.action_receipts;
create policy action_receipts_insert_self on public.action_receipts
  for insert to authenticated
  with check (actor_id = (select auth.uid()));

drop policy if exists action_receipts_select_org on public.action_receipts;
create policy action_receipts_select_org on public.action_receipts
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    or provider_id in (select p.id from public.providers p where p.owner_id = (select auth.uid()))
  );

commit;

-- ── Verification (run after apply; each must return the stated result) ──────
-- 1. RLS on:      select relrowsecurity from pg_class where oid = 'public.action_receipts'::regclass;  -> true
-- 2. No update:   select has_table_privilege('authenticated','public.action_receipts','UPDATE');        -> false
-- 3. No delete:   select has_table_privilege('authenticated','public.action_receipts','DELETE');        -> false
-- 4. Anon blind:  select has_table_privilege('anon','public.action_receipts','SELECT');                 -> false
-- 5. Live check:  approve one chat proposal in the coach dock, then
--                 select action, receipt_id, verified_at from public.action_receipts order by created_at desc limit 1;
--                 -> one row whose receipt_id matches the "Receipt:" line in the chat bubble.
--
-- Rollback (nothing else depends on it): drop table public.action_receipts; drop function public.action_receipts_stamp();
