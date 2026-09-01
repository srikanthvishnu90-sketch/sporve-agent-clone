-- Spec 03: apply_installment_event (idempotent, webhook-only) + 1/3/7 retry
-- ladder that DRAFTS follow-ups (never charges) + nightly cron. Applied to
-- prod 2026-08-31; see the applied migration spec03_installment_events for
-- the authoritative body (identical).
create or replace function public.apply_installment_event(
  p_event_id text, p_event_type text, p_installment_id uuid,
  p_stripe_object_id text, p_amount_minor bigint, p_currency text,
  p_payload_sha256 text, p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path to '' as $$
declare v_rows integer;
begin
  insert into public.payment_event_ledger
    (stripe_event_id, event_type, stripe_object_id, amount_minor, currency,
     payload_sha256, outcome, occurred_at)
  values (p_event_id, p_event_type, p_stripe_object_id, p_amount_minor,
          p_currency, p_payload_sha256, 'applied', p_occurred_at)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    update public.installments
       set status = 'paid', stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_stripe_object_id)
     where id = p_installment_id and status <> 'paid';
    update public.fee_schedules fs set status = 'complete'
     where fs.id = (select fee_schedule_id from public.installments where id = p_installment_id)
       and not exists (select 1 from public.installments i
                       where i.fee_schedule_id = fs.id and i.status not in ('paid','waived'));
  elsif p_event_type in ('checkout.session.async_payment_failed') then
    update public.installments
       set status = 'failed', attempt_count = attempt_count + 1, last_attempt_at = now()
     where id = p_installment_id;
  end if;
  return true;
end; $$;
revoke all on function public.apply_installment_event(text,text,uuid,text,bigint,text,text,timestamptz) from public, anon, authenticated;
create unique index if not exists uq_ledger_event on public.payment_event_ledger(stripe_event_id);
create or replace function public.generate_installment_followups()
returns integer
language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0;
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, amount_cents, currency,
     due_at, source_kind, source_ref, inverse)
  select fs.provider_id, 'fee', 'draft',
    'Installment ' || to_char(i.amount_cents/100.0,'FM$999,990.00')
      || ' overdue ' || (current_date - i.due_date) || 'd — attempt ' || (i.attempt_count + 1) || ' of 3',
    'Hi ' || coalesce((select g.first_name from public.guardian_links gl
                       join public.guardians g on g.id = gl.guardian_id
                       where gl.member_id = i.member_id and gl.is_payer
                       limit 1), 'there')
      || ' — the ' || to_char(i.due_date,'Mon DD') || ' installment of '
      || to_char(i.amount_cents/100.0,'FM$999,990.00')
      || ' has not come through. You can pay from the link in your original invite, or reply here if a different plan would help.',
    i.amount_cents, 'USD', i.due_date::timestamptz, 'agent',
    'installment:' || i.id || ':attempt:' || (i.attempt_count + 1),
    jsonb_build_object('action','void','reason','undo retry follow-up')
  from public.installments i
  join public.fee_schedules fs on fs.id = i.fee_schedule_id
  where i.status in ('due','failed')
    and fs.status = 'active'
    and i.due_date < current_date
    and i.attempt_count < 3
    and (current_date - i.due_date) >= (case i.attempt_count when 0 then 1 when 1 then 3 else 7 end)
    and not exists (select 1 from public.obligations o
                    where o.source_ref = 'installment:' || i.id || ':attempt:' || (i.attempt_count + 1)
                      and o.status <> 'void');
  get diagnostics inserted = row_count;
  update public.installments i
     set attempt_count = attempt_count + 1, last_attempt_at = now()
   where i.id in (select (split_part(o.source_ref,':',2))::uuid
                  from public.obligations o
                  where o.source_kind='agent' and o.source_ref like 'installment:%'
                    and o.created_at > now() - interval '1 minute');
  return inserted;
end; $$;
revoke all on function public.generate_installment_followups() from public, anon, authenticated;
do $$
begin
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-installment-followups';
    perform cron.schedule('sporv-installment-followups', '15 3 * * *',
      $job$ select public.generate_installment_followups(); $job$);
  exception when others then
    raise notice 'pg_cron unavailable (%)', sqlerrm;
  end;
end $$;
