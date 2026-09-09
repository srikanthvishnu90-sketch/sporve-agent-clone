-- SUPERSEDED 2026-09-09 by docs/red-drafts/2026-09-09-ledger-insert-once.sql.
-- DO NOT APPLY THIS FILE. Codex objected, correctly, that loosening the trigger
-- fails the launch requirement that every ledger UPDATE and DELETE be denied and
-- inserted rows stay byte-identical. The replacement keeps this trigger exactly
-- as deployed and fixes the RPCs instead (advisory lock, then one insert with
-- the final outcome). Kept only as the fallback if that repair is rejected, and
-- as the record of how the defect was found.
--
-- [CRITICAL-PATH] RED DRAFT — payment ledger: allow the RPCs' one promotion.
-- Found by robin 2026-09-08 (webhook surface), confirmed live in prod.
--
-- What is broken: migration 20260907_001032 (applied 2026-09-07 with the
-- owner's "apply the red drafts") installed trg_ledger_append_only, whose
-- function raises on EVERY update of payment_event_ledger. But both money
-- RPCs — apply_stripe_booking_event (2 overloads) and apply_stripe_billing_event
-- — claim the event first (insert outcome='ignored') and, after the booking /
-- subscription update succeeds, promote that same row to outcome='applied'.
-- With the trigger live that promotion raises 55000, the RPC's transaction
-- rolls back (booking NOT marked paid), the webhook returns 500, Stripe
-- retries for 3 days, and no booking or subscription can ever confirm.
-- No real customer hit it: the last ledger event is 2026-09-01 and
-- webhook_dead_letter has 0 rows. Proof (rolled-back DO block, 2026-09-08):
--   today's trigger  → promotion RAISED [55000]
--   proposed trigger → promotion ALLOWED; money-column edit RAISED; delete RAISED
--
-- Fix: the trigger permits exactly ONE transition — outcome 'ignored' → 'applied'
-- with every other column unchanged. Money facts (amount, currency, event id,
-- booking, payload hash, occurred_at, reverses_entry_id) stay immutable and
-- deletes stay blocked. Grants from 001032 are untouched (the RPCs are
-- SECURITY DEFINER, so the trigger was the only thing stopping them).
-- Inverse: re-run the function body from 20260907_001032_ledger_append_only.sql.
-- Verification after apply:
--   node scripts/agent-golden.mjs is unrelated; instead run the checkout path in
--   test mode (owner-list D8) OR re-run the DO proof above with the live trigger:
--   promotion must say ALLOWED, money edit and delete must say RAISED.
begin;

create or replace function public.ledger_is_append_only()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'UPDATE'
     and old.outcome = 'ignored' and new.outcome = 'applied'
     and new.id is not distinct from old.id
     and new.stripe_event_id is not distinct from old.stripe_event_id
     and new.event_type is not distinct from old.event_type
     and new.booking_id is not distinct from old.booking_id
     and new.stripe_object_id is not distinct from old.stripe_object_id
     and new.amount_minor is not distinct from old.amount_minor
     and new.currency is not distinct from old.currency
     and new.payload_sha256 is not distinct from old.payload_sha256
     and new.occurred_at is not distinct from old.occurred_at
     and new.reverses_entry_id is not distinct from old.reverses_entry_id
  then
    return new;   -- the RPCs' claim → applied promotion, nothing else
  end if;
  raise exception using errcode='55000',
    message='payment_event_ledger is append-only: corrections are new rows with reverses_entry_id set';
end $fn$;

comment on function public.ledger_is_append_only() is
  'Append-only guard. The single allowed UPDATE is outcome ignored→applied with all other columns unchanged (the money RPCs claim the event first, then promote it). Deletes always raise.';

commit;
