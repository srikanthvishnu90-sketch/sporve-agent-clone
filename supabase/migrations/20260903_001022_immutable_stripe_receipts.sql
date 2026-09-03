-- ============================================================================
-- G2 live-cutover finding 1: finalize Stripe receipts with one immutable INSERT.
--
-- 20260831_001004 makes payment_event_ledger append-only for every role. The
-- baseline booking and billing RPCs inserted 'ignored' and then updated the row
-- to 'applied', so their finalization path conflicts with that trigger. These
-- definitions serialize each Stripe event, perform the guarded transition, and
-- append the final outcome once. This migration does not change money movement.
-- ============================================================================

create or replace function public.apply_stripe_billing_event(
  p_event_id text,
  p_event_type text,
  p_provider_id uuid,
  p_subscription_id text,
  p_price_id text,
  p_status text,
  p_plan text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_coupon text,
  p_amount_minor bigint,
  p_currency text,
  p_payload_sha256 text,
  p_occurred_at timestamptz
) returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_new_plan text;
  v_new_status text;
  v_applied boolean := false;
  v_result text := 'ignored';
begin
  if coalesce(trim(p_event_id), '') = ''
     or p_provider_id is null
     or coalesce(trim(p_subscription_id), '') = '' then
    raise exception 'event id, provider id, and subscription id are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_event_id, 0)
  );
  if exists (
    select 1 from public.payment_event_ledger
    where stripe_event_id = p_event_id
  ) then
    return 'duplicate';
  end if;

  <<project_event>>
  begin
    insert into public.billing_subscriptions (
      provider_id,
      stripe_subscription_id,
      stripe_price_id,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      coupon,
      updated_at
    ) values (
      p_provider_id,
      p_subscription_id,
      coalesce(p_price_id, ''),
      coalesce(p_status, 'unknown'),
      p_period_start,
      p_period_end,
      coalesce(p_cancel_at_period_end, false),
      p_coupon,
      coalesce(p_occurred_at, now())
    )
    on conflict (stripe_subscription_id) do update
      set stripe_price_id = excluded.stripe_price_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          coupon = excluded.coupon,
          updated_at = excluded.updated_at
      where public.billing_subscriptions.updated_at <= excluded.updated_at;
    if not found then
      v_result := 'stale';
      exit project_event;
    end if;

    if p_status in ('active', 'trialing') then
      if p_plan in ('pro', 'enterprise') then
        v_new_plan := p_plan;
        v_new_status := p_status;
      else
        v_result := 'ignored_bad_plan:' || coalesce(p_plan, 'null');
        exit project_event;
      end if;
    elsif p_status in ('past_due', 'unpaid') then
      v_new_plan := null;
      v_new_status := 'past_due';
    elsif p_status = 'incomplete' then
      v_new_plan := null;
      v_new_status := 'incomplete';
    elsif p_status in ('canceled', 'incomplete_expired') then
      v_new_plan := 'free';
      v_new_status := 'canceled';
    else
      v_result := 'ignored_unknown_status:' || coalesce(p_status, 'null');
      exit project_event;
    end if;

    update public.providers
       set plan = coalesce(v_new_plan, plan),
           plan_status = v_new_status,
           plan_period_end = p_period_end
     where id = p_provider_id;
    if not found then
      v_result := 'provider_not_found';
      exit project_event;
    end if;

    v_applied := true;
    v_result := 'applied:' || coalesce(v_new_plan, 'keep') || '/' || v_new_status;
  end project_event;

  insert into public.payment_event_ledger (
    stripe_event_id,
    event_type,
    booking_id,
    stripe_object_id,
    amount_minor,
    currency,
    payload_sha256,
    outcome,
    occurred_at
  ) values (
    p_event_id,
    p_event_type,
    null,
    p_subscription_id,
    p_amount_minor,
    p_currency,
    p_payload_sha256,
    case when v_applied then 'applied' else 'ignored' end,
    p_occurred_at
  );

  return v_result;
end;
$$;

revoke all on function public.apply_stripe_billing_event(
  text, text, uuid, text, text, text, text, timestamptz, timestamptz,
  boolean, text, bigint, text, text, timestamptz
) from public, anon, authenticated;

create or replace function public.apply_stripe_booking_event(
  p_event_id text,
  p_event_type text,
  p_booking_id uuid,
  p_stripe_object_id text default null,
  p_amount_minor bigint default null,
  p_currency text default null,
  p_payload_sha256 text default null,
  p_occurred_at timestamptz default null,
  p_payment_intent_id text default null,
  p_application_fee_minor bigint default null
) returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_applied boolean := false;
  v_rows integer := 0;
  v_refund numeric(10, 2);
begin
  if coalesce(trim(p_event_id), '') = ''
     or p_booking_id is null
     or coalesce(trim(p_stripe_object_id), '') = '' then
    raise exception 'event id, booking id, and Stripe object id are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_event_id, 0)
  );
  if exists (
    select 1 from public.payment_event_ledger
    where stripe_event_id = p_event_id
  ) then
    return false;
  end if;

  if p_event_type in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded'
  ) then
    update public.bookings
       set payment_status = 'paid',
           status = 'confirmed',
           stripe_payment_intent_id =
             coalesce(p_payment_intent_id, stripe_payment_intent_id),
           platform_fee = case
             when p_application_fee_minor is not null
             then round(p_application_fee_minor::numeric / 100, 2)
           end,
           platform_fee_bps = case
             when p_application_fee_minor is not null
                  and coalesce(p_amount_minor, 0) > 0
             then round(
               p_application_fee_minor::numeric * 10000 / p_amount_minor
             )
           end,
           provider_payout = case
             when p_application_fee_minor is not null
             then round(
               (coalesce(p_amount_minor, 0) - p_application_fee_minor)::numeric
                 / 100,
               2
             )
           end,
           fee_recorded_at = case
             when p_application_fee_minor is not null then now()
           end
     where id = p_booking_id
       and payment_status = 'unpaid'
       and status = 'pending'
       and stripe_checkout_session_id = p_stripe_object_id
       and round(final_price * 100)::bigint = p_amount_minor
       and upper(currency) = upper(p_currency);
  elsif p_event_type = 'checkout.session.expired' then
    update public.bookings
       set payment_status = 'failed',
           status = 'expired'
     where id = p_booking_id
       and stripe_checkout_session_id = p_stripe_object_id
       and payment_status = 'unpaid'
       and status = 'pending';
  elsif p_event_type in ('charge.refunded', 'refund.updated') then
    v_refund := round(coalesce(p_amount_minor, 0)::numeric / 100, 2);
    update public.bookings
       set refund_amount = greatest(
             refund_amount,
             least(final_price, v_refund)
           ),
           refunded_at = coalesce(p_occurred_at, now()),
           payment_status = case
             when v_refund >= final_price then 'refunded'
             else 'partially_refunded'
           end
     where id = p_booking_id
       and stripe_payment_intent_id = p_payment_intent_id
       and payment_status in ('paid', 'partially_refunded', 'refunded');
  end if;

  get diagnostics v_rows = row_count;
  v_applied := v_rows > 0;

  insert into public.payment_event_ledger (
    stripe_event_id,
    event_type,
    booking_id,
    stripe_object_id,
    amount_minor,
    currency,
    payload_sha256,
    outcome,
    occurred_at
  ) values (
    p_event_id,
    p_event_type,
    p_booking_id,
    p_stripe_object_id,
    p_amount_minor,
    upper(p_currency),
    p_payload_sha256,
    case when v_applied then 'applied' else 'ignored' end,
    p_occurred_at
  );

  return v_applied;
end;
$$;

revoke all on function public.apply_stripe_booking_event(
  text, text, uuid, text, bigint, text, text, timestamptz, text, bigint
) from public, anon, authenticated;

-- Preserve the historical 9-argument RPC surface without duplicating a ledger
-- implementation. New webhook code calls the 10-argument function above.
create or replace function public.apply_stripe_booking_event(
  p_event_id text,
  p_event_type text,
  p_booking_id uuid,
  p_stripe_object_id text default null,
  p_amount_minor bigint default null,
  p_currency text default null,
  p_payload_sha256 text default null,
  p_occurred_at timestamptz default null,
  p_payment_intent_id text default null
) returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  return public.apply_stripe_booking_event(
    p_event_id,
    p_event_type,
    p_booking_id,
    p_stripe_object_id,
    p_amount_minor,
    p_currency,
    p_payload_sha256,
    p_occurred_at,
    p_payment_intent_id,
    null::bigint
  );
end;
$$;

revoke all on function public.apply_stripe_booking_event(
  text, text, uuid, text, bigint, text, text, timestamptz, text
) from public, anon, authenticated;
