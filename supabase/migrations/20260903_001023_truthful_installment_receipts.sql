-- ============================================================================
-- G2 live-cutover finding 2: truthful installment receipts and retry accounting.
--
-- A receipt is appended only after the guarded installment transition. Applied
-- receipts require a Stripe object id, card and ACH failures both advance the
-- 1/3/7 retry state, and the two Stripe failure event shapes for one PaymentIntent
-- cannot count as two attempts.
-- ============================================================================

alter table public.payment_event_ledger
  add constraint payment_event_ledger_applied_object_required
  check (
    outcome <> 'applied'
    or nullif(btrim(stripe_object_id), '') is not null
  ) not valid;

create or replace function public.apply_installment_event(
  p_event_id text,
  p_event_type text,
  p_installment_id uuid,
  p_stripe_object_id text,
  p_amount_minor bigint,
  p_currency text,
  p_payload_sha256 text,
  p_occurred_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_applied boolean := false;
  v_rows integer := 0;
begin
  if coalesce(trim(p_event_id), '') = ''
     or p_installment_id is null
     or coalesce(trim(p_stripe_object_id), '') = '' then
    raise exception 'event id, installment id, and Stripe object id are required';
  end if;

  -- Object-level serialization prevents checkout.session.async_payment_failed
  -- and payment_intent.payment_failed for the same PI counting twice.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_stripe_object_id, 0)
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
    update public.installments
       set status = 'paid',
           stripe_payment_intent_id =
             coalesce(stripe_payment_intent_id, p_stripe_object_id)
     where id = p_installment_id
       and status <> 'paid';
    get diagnostics v_rows = row_count;
    v_applied := v_rows > 0;

    if v_applied then
      update public.fee_schedules fs
         set status = 'complete'
       where fs.id = (
         select fee_schedule_id
         from public.installments
         where id = p_installment_id
       )
         and not exists (
           select 1
           from public.installments i
           where i.fee_schedule_id = fs.id
             and i.status not in ('paid', 'waived')
         );
    end if;
  elsif p_event_type in (
    'checkout.session.async_payment_failed',
    'payment_intent.payment_failed'
  ) then
    if not exists (
      select 1
      from public.payment_event_ledger
      where stripe_object_id = p_stripe_object_id
        and outcome = 'applied'
        and event_type in (
          'checkout.session.async_payment_failed',
          'payment_intent.payment_failed'
        )
    ) then
      update public.installments
         set status = 'failed',
             attempt_count = least(attempt_count + 1, 3),
             last_attempt_at = coalesce(p_occurred_at, now())
       where id = p_installment_id
         and status <> 'paid'
         and attempt_count < 3;
      get diagnostics v_rows = row_count;
      v_applied := v_rows > 0;
    end if;

    if v_applied then
      insert into public.obligations (
        provider_id,
        kind,
        status,
        title,
        detail,
        amount_cents,
        currency,
        due_at,
        source_kind,
        source_ref,
        inverse,
        member_id,
        guardian_id,
        run_id
      )
      select
        fs.provider_id,
        'fee',
        'draft',
        'Payment failed — '
          || to_char(i.amount_cents / 100.0, 'FM$999,990.00')
          || ' installment',
        'Hi ' || coalesce(g.first_name, 'there') || ' — the '
          || to_char(i.due_date, 'Mon DD') || ' payment of '
          || to_char(i.amount_cents / 100.0, 'FM$999,990.00')
          || ' didn''t go through. No charge was made. You can retry from your '
          || 'original link, or reply if a different plan would help.',
        i.amount_cents,
        'USD',
        now(),
        'agent',
        'installment:' || i.id || ':attempt:' || i.attempt_count,
        jsonb_build_object(
          'action', 'void',
          'reason', 'undo failed-charge follow-up'
        ),
        i.member_id,
        g.id,
        gen_random_uuid()
      from public.installments i
      join public.fee_schedules fs on fs.id = i.fee_schedule_id
      left join lateral (
        select g2.id, g2.first_name
        from public.guardian_links gl
        join public.guardians g2 on g2.id = gl.guardian_id
        where gl.member_id = i.member_id
          and gl.is_payer
        limit 1
      ) g on true
      where i.id = p_installment_id
        and i.status = 'failed'
        and i.attempt_count <= 3
        and public.agent_autodraft_on(fs.provider_id)
      on conflict (source_ref)
        where source_kind = 'agent' and status <> 'void'
      do nothing;
    end if;
  end if;

  insert into public.payment_event_ledger (
    stripe_event_id,
    event_type,
    stripe_object_id,
    amount_minor,
    currency,
    payload_sha256,
    outcome,
    occurred_at
  ) values (
    p_event_id,
    p_event_type,
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

revoke all on function public.apply_installment_event(
  text, text, uuid, text, bigint, text, text, timestamptz
) from public, anon, authenticated;
