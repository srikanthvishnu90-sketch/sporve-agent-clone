-- billing-ledger-detection.sql — find every billing/booking webhook event the
-- projection did NOT apply. Read-only. Run by hand (psql / SQL editor, service
-- role); never wired into the app. Pairs with the money gate in
-- supabase/functions/stripe-webhook/index.ts and the repair RPC
-- reprocess_billing_ledger_event (20260919_001109).
--
-- Reading the results
--   payment_event_ledger.outcome is CHECK-constrained to {'applied','ignored'}.
--   The RPC's text verdict ('stale', 'ignored_bad_plan:<plan>',
--   'ignored_unknown_status:<s>', 'provider_not_found') is NOT stored in the
--   ledger — only the coarse 'ignored'. After the return-map fix the exact
--   verdict lives in webhook_dead_letter.error_msg as
--   'BILLING_WEBHOOK_REJECTED: <verdict>'; rows from before that fix have no
--   dead-letter and show dead_letter_reason = NULL (these are the ones the
--   silent-200 bug hid). 'stale' verdicts are also outcome='ignored' but are
--   never dead-lettered on purpose — a newer snapshot already won.

-- 1. Every ledger row whose outcome is not 'applied', newest first, joined to
--    the dead-letter verdict when one exists.
select
  l.stripe_event_id,
  l.event_type,
  l.outcome,
  l.booking_id,                       -- null = billing (subscription) event
  l.stripe_object_id as stripe_subscription_or_object_id,
  l.amount_minor,
  l.currency,
  l.occurred_at,
  l.processed_at,
  d.error_msg      as dead_letter_reason,
  d.seen_count     as dead_letter_seen_count,
  d.first_seen_at  as dead_letter_first_seen_at,
  d.resolved_at    as dead_letter_resolved_at,
  s.provider_id    as mirror_provider_id,
  s.status         as mirror_status,
  s.stripe_price_id as mirror_price_id
from public.payment_event_ledger l
left join public.webhook_dead_letter d on d.stripe_event_id = l.stripe_event_id
left join public.billing_subscriptions s
       on l.booking_id is null and s.stripe_subscription_id = l.stripe_object_id
where l.outcome <> 'applied'
order by l.occurred_at desc nulls last, l.processed_at desc;

-- 2. Count by verdict class (quick health read).
select
  coalesce(split_part(d.error_msg, ': ', 2), '(no dead-letter: pre-fix or stale)') as verdict,
  count(*) as events,
  count(*) filter (where d.resolved_at is null and d.id is not null) as unresolved
from public.payment_event_ledger l
left join public.webhook_dead_letter d on d.stripe_event_id = l.stripe_event_id
where l.outcome <> 'applied'
group by 1
order by events desc;

-- 3. Dead-letters with NO ledger row at all: the RPC never ran or raised
--    (provider_unresolvable before the RPC, or a thrown handler error).
select d.stripe_event_id, d.event_type, d.error_msg, d.seen_count, d.first_seen_at, d.resolved_at
from public.webhook_dead_letter d
left join public.payment_event_ledger l on l.stripe_event_id = d.stripe_event_id
where l.id is null
order by d.first_seen_at desc;

-- Repair (owner, by hand, after the cause is fixed; see the migration header):
--   select public.reprocess_billing_ledger_event('evt_...');                 -- provider/status repairs
--   select public.reprocess_billing_ledger_event('evt_...', 'pro');          -- bad-plan repair, plan supplied
--   select public.reprocess_billing_ledger_event('evt_...', 'pro', 'active');-- and a status override
