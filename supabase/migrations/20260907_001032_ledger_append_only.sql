-- 20260907_001032 — ledger append-only ACL hardening (red draft 2026-09-06, owner-approved)
-- [CRITICAL-PATH] REVIEWABLE DRAFT ONLY. Not applied to any shared database.
-- S01: payment_event_ledger must accept corrections only as new reversal rows.
-- Preconditions: inspect the current ACL/trigger, take a schema backup, and
-- apply only after the canonical baseline and migration owner are confirmed.
-- Inverse: compare the saved ACL and trigger definition; restore only with an
-- owner-approved rollback after verifying no ledger writes are in flight.

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='payment_event_ledger'
      and c.relkind='r' and c.relrowsecurity
  ) then
    raise exception 'ledger preflight: public.payment_event_ledger missing or RLS disabled';
  end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.payment_event_ledger'::regclass
      and not t.tgisinternal and t.tgname='trg_ledger_append_only'
  ) then
    raise exception 'ledger preflight: append-only trigger missing';
  end if;
end $$;

-- The owner is protected by the trigger; non-owner clients must also lack the
-- table privileges so an ACL change cannot turn a rejected mutation into a
-- successful one if the trigger is accidentally replaced later.
revoke update, delete, truncate, references, trigger
  on table public.payment_event_ledger from public, anon, authenticated, service_role;

-- Stripe/webhook workers may append and reconcile, never mutate history.
grant insert, select on table public.payment_event_ledger to service_role;

-- Re-assert the trigger body and search path explicitly. A correction is a new
-- INSERT carrying reverses_entry_id; original rows remain byte-identical.
create or replace function public.ledger_is_append_only()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='55000',
    message='payment_event_ledger is append-only: corrections are new rows with reverses_entry_id set';
end $$;
revoke all on function public.ledger_is_append_only() from public, anon, authenticated;

