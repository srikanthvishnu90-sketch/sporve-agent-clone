-- ============================================================================
-- Spec 02 · migration 4 — LEDGER APPEND-ONLY, AT THE DATABASE (2026-08-31)
-- payment_event_ledger IS the ledger_entry table (mapping-first). This makes
-- the append-only rule a DATABASE fact rather than a convention: UPDATE and
-- DELETE fail for every role including the service role — a correction is a
-- new row with reverses_entry_id set. Balance is always SUM(), never stored.
-- ============================================================================
alter table public.payment_event_ledger
  add column if not exists reverses_entry_id uuid
    references public.payment_event_ledger(id) on delete restrict;
comment on column public.payment_event_ledger.reverses_entry_id is
  'A correction never edits history: it points at the row it reverses.';

create or replace function public.ledger_is_append_only()
 returns trigger language plpgsql as $$
begin
  raise exception 'payment_event_ledger is append-only: corrections are new rows with reverses_entry_id set';
end; $$;

drop trigger if exists trg_ledger_append_only on public.payment_event_ledger;
create trigger trg_ledger_append_only
  before update or delete on public.payment_event_ledger
  for each row execute function public.ledger_is_append_only();

-- and belt-plus-braces at the privilege layer:
revoke update, delete on public.payment_event_ledger from authenticated, anon;
