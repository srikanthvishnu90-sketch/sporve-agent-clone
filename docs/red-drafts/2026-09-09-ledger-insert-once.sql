-- [CRITICAL-PATH] RED DRAFT — ledger stays strictly append-only; the RPCs stop
-- needing an UPDATE at all. SUPERSEDES docs/red-drafts/2026-09-08-ledger-promotion-fix.sql.
--
-- Codex is right and robin's first draft was the weaker fix. That draft loosened
-- trg_ledger_append_only to permit one outcome transition, which fails the launch
-- requirement that every ledger UPDATE and DELETE be denied and inserted rows
-- stay byte-identical. This draft leaves the trigger exactly as deployed and
-- fixes the callers instead.
--
-- The part Codex's note did not address: today's insert-first IS the concurrency
-- guard. Two concurrent deliveries of one event id serialize on the unique index
-- (the second blocks, then conflicts, then returns false), so simply moving the
-- insert to the end would let both do the work. This draft replaces that guard
-- with a transaction-scoped advisory lock keyed on the event id, which gives the
-- same mutual exclusion without writing a row that later has to change:
--
--   1. pg_advisory_xact_lock(hashtextextended(p_event_id, 0))  — same event ids
--      serialize; different ones never contend, and the lock releases on commit
--      or rollback.
--   2. inside the lock, an existence check on stripe_event_id is authoritative:
--      a redelivery returns the duplicate answer without touching anything.
--   3. the work runs, its result is captured, and the ledger row is inserted
--      ONCE with its final outcome. The unique index stays as a backstop; with
--      the lock held it can no longer fire.
--
-- Semantics preserved exactly: every early exit still records the event as seen
-- with outcome 'ignored' (a single exit point does the insert), the return values
-- are unchanged ('duplicate' / 'stale' / 'ignored_*' / 'applied:*' for billing,
-- boolean for bookings), and the booking transition guards (unpaid+pending,
-- session id, amount, currency match) are copied verbatim from production.
--
-- Also dropped: the legacy 9-argument apply_stripe_booking_event overload. The
-- webhook always passes p_application_fee_minor (stripe-webhook/index.ts:118-131),
-- so the 10-argument version is the only one reachable from production, while
-- having both makes any positional call ambiguous — proven on 2026-09-08 when a
-- positional probe failed with "function ... is not unique".
--
-- Inverse: re-create the three function bodies from the definitions captured in
-- docs/robin-review-2026-09-09-codex-handoff.md's predecessor query, or from
-- migrations 00000000000000_baseline.sql and 20260901_001015.
-- Verification after apply:
--   1. select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname='apply_stripe_booking_event';   -- 1
--   2. the rolled-back proof block at the end of this file: a simulated event
--      inserts exactly one row, a redelivery inserts none and returns the
--      duplicate answer, and no UPDATE is ever attempted (the strict trigger
--      would raise 55000 if one were).
--   3. stripe trigger checkout.session.completed against the test endpoint:
--      booking flips to paid, exactly one ledger row, outcome 'applied'.
--
-- ALREADY PROVEN (production, 2026-09-09, inside a rolled-back DO block that
-- replaced the billing function, exercised it, then raised to undo everything):
--   first delivery   -> 'applied:pro/active'
--   redelivery       -> 'duplicate'
--   ledger rows      -> exactly 1
--   provider plan    -> free -> pro (rolled back)
--   the strict trigger never fired, because no UPDATE was attempted. The same
--   call against today's deployed RPC raises 55000 at its promotion statement.
begin;

drop function if exists public.apply_stripe_booking_event(text, text, uuid, text, bigint, text, text, timestamptz, text);

create or replace function public.apply_stripe_booking_event(
  p_event_id text, p_event_type text, p_booking_id uuid,
  p_stripe_object_id text default null, p_amount_minor bigint default null,
  p_currency text default null, p_payload_sha256 text default null,
  p_occurred_at timestamptz default null, p_payment_intent_id text default null,
  p_application_fee_minor bigint default null)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_applied boolean := false; v_rows integer := 0; v_refund numeric(10,2);
begin
  if coalesce(trim(p_event_id), '') = '' or p_booking_id is null then
    raise exception 'event id and booking id are required';
  end if;

  -- (1) serialize concurrent deliveries of THIS event id only
  perform pg_advisory_xact_lock(hashtextextended(p_event_id, 0));

  -- (2) a redelivery is a no-op, decided before any write
  if exists (select 1 from public.payment_event_ledger where stripe_event_id = p_event_id) then
    return false;
  end if;

  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    update public.bookings
       set payment_status = 'paid', status = 'confirmed',
           stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
           platform_fee = case when p_application_fee_minor is not null
                               then round(p_application_fee_minor::numeric / 100, 2) end,
           platform_fee_bps = case when p_application_fee_minor is not null
                                    and coalesce(p_amount_minor,0) > 0
                               then round(p_application_fee_minor::numeric * 10000 / p_amount_minor) end,
           provider_payout = case when p_application_fee_minor is not null
                               then round((coalesce(p_amount_minor,0) - p_application_fee_minor)::numeric / 100, 2) end,
           fee_recorded_at = case when p_application_fee_minor is not null then now() end
     where id = p_booking_id
       and payment_status = 'unpaid'
       and status = 'pending'
       and stripe_checkout_session_id = p_stripe_object_id
       and round(final_price * 100)::bigint = p_amount_minor
       and upper(currency) = upper(p_currency);
  elsif p_event_type = 'checkout.session.expired' then
    update public.bookings
       set payment_status = 'failed', status = 'expired'
     where id = p_booking_id
       and stripe_checkout_session_id = p_stripe_object_id
       and payment_status = 'unpaid' and status = 'pending';
  elsif p_event_type in ('charge.refunded','refund.updated') then
    v_refund := round(coalesce(p_amount_minor, 0)::numeric / 100, 2);
    update public.bookings
       set refund_amount = greatest(refund_amount, least(final_price, v_refund)),
           refunded_at = coalesce(p_occurred_at, now()),
           payment_status = case when v_refund >= final_price then 'refunded'
                                 else 'partially_refunded' end
     where id = p_booking_id
       and stripe_payment_intent_id = p_payment_intent_id
       and payment_status in ('paid','partially_refunded','refunded');
  end if;
  get diagnostics v_rows = row_count;
  v_applied := v_rows > 0;

  -- (3) one row, final outcome, never revisited
  insert into public.payment_event_ledger(
    stripe_event_id, event_type, booking_id, stripe_object_id, amount_minor,
    currency, payload_sha256, outcome, occurred_at
  ) values (
    p_event_id, p_event_type, p_booking_id, p_stripe_object_id, p_amount_minor,
    upper(p_currency), p_payload_sha256,
    case when v_applied then 'applied' else 'ignored' end, p_occurred_at
  );
  return v_applied;
end;
$function$;

create or replace function public.apply_stripe_billing_event(
  p_event_id text, p_event_type text, p_provider_id uuid, p_subscription_id text,
  p_price_id text, p_status text, p_plan text, p_period_start timestamptz,
  p_period_end timestamptz, p_cancel_at_period_end boolean, p_coupon text,
  p_amount_minor bigint, p_currency text, p_payload_sha256 text,
  p_occurred_at timestamptz)
returns text language plpgsql security definer set search_path to '' as $function$
declare
  v_new_plan text; v_new_status text; v_result text; v_outcome text := 'ignored';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event_id, 0));
  if exists (select 1 from public.payment_event_ledger where stripe_event_id = p_event_id) then
    return 'duplicate';
  end if;

  -- Single exit point: every branch sets v_result, then the ledger row is
  -- inserted once. Early RETURNs are deliberately absent so that a 'stale' or
  -- 'ignored_*' verdict is still recorded as a seen event, exactly as the
  -- insert-first version recorded it.
  <<project>>
  begin
    if p_subscription_id is not null then
      insert into public.billing_subscriptions
        (provider_id, stripe_subscription_id, stripe_price_id, status,
         current_period_start, current_period_end, cancel_at_period_end, coupon, updated_at)
      values
        (p_provider_id, p_subscription_id, coalesce(p_price_id,''), coalesce(p_status,'unknown'),
         p_period_start, p_period_end, coalesce(p_cancel_at_period_end,false),
         p_coupon, coalesce(p_occurred_at, now()))
      on conflict (stripe_subscription_id) do update
        set stripe_price_id=excluded.stripe_price_id, status=excluded.status,
            current_period_start=excluded.current_period_start,
            current_period_end=excluded.current_period_end,
            cancel_at_period_end=excluded.cancel_at_period_end,
            coupon=excluded.coupon, updated_at=excluded.updated_at
        where public.billing_subscriptions.updated_at <= excluded.updated_at;
      if not found then v_result := 'stale'; exit project; end if;
    end if;

    if p_status in ('active','trialing') then
      if p_plan in ('pro','enterprise') then
        v_new_plan := p_plan; v_new_status := p_status;
      else
        v_result := 'ignored_bad_plan:' || coalesce(p_plan,'null'); exit project;
      end if;
    elsif p_status in ('past_due','unpaid') then
      v_new_plan := null; v_new_status := 'past_due';
    elsif p_status = 'incomplete' then
      v_new_plan := null; v_new_status := 'incomplete';
    elsif p_status in ('canceled','incomplete_expired') then
      v_new_plan := 'free'; v_new_status := 'canceled';
    else
      v_result := 'ignored_unknown_status:' || coalesce(p_status,'null'); exit project;
    end if;

    update public.providers
      set plan = coalesce(v_new_plan, plan),
          plan_status = v_new_status,
          plan_period_end = p_period_end
      where id = p_provider_id;
    if not found then v_result := 'provider_not_found'; exit project; end if;

    v_outcome := 'applied';
    v_result := 'applied:' || coalesce(v_new_plan,'keep') || '/' || v_new_status;
  end;

  insert into public.payment_event_ledger
    (stripe_event_id, event_type, booking_id, stripe_object_id,
     amount_minor, currency, payload_sha256, outcome, occurred_at)
  values
    (p_event_id, p_event_type, null, p_subscription_id,
     p_amount_minor, p_currency, p_payload_sha256, v_outcome, p_occurred_at);
  return v_result;
end $function$;

-- Grants are unchanged: both functions were already service_role-only and
-- SECURITY DEFINER, so no role gains anything here. Restated for the reviewer.
revoke all on function public.apply_stripe_booking_event(text, text, uuid, text, bigint, text, text, timestamptz, text, bigint) from public, anon, authenticated;
grant execute on function public.apply_stripe_booking_event(text, text, uuid, text, bigint, text, text, timestamptz, text, bigint) to service_role;

commit;

-- ── Proof block (run separately; it rolls itself back) ───────────────────────
-- Expected: first call inserts exactly ONE row with a final outcome, the
-- redelivery inserts none, and the strict trigger never fires because no UPDATE
-- is attempted.
--
-- do $$
-- declare a text; b text; n integer;
-- begin
--   a := public.apply_stripe_billing_event('evt_proof_once','customer.subscription.updated',
--          (select id from public.providers limit 1), 'sub_proof', 'price_x', 'active', 'pro',
--          now(), now()+interval '30 days', false, null, 1000, 'usd', 'sha', now());
--   b := public.apply_stripe_billing_event('evt_proof_once','customer.subscription.updated',
--          (select id from public.providers limit 1), 'sub_proof', 'price_x', 'active', 'pro',
--          now(), now()+interval '30 days', false, null, 1000, 'usd', 'sha', now());
--   select count(*) into n from public.payment_event_ledger where stripe_event_id='evt_proof_once';
--   raise exception 'ROLLBACK first=% second=% rows=%', a, b, n;
-- end $$;
