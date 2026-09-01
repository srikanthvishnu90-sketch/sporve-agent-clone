-- ============================================================================
-- Spec 03 · migration 1 — BILLING SHAPES + WITHDRAWAL + AR VIEW (2026-08-31)
-- The three shapes drive off programs.offering_type; everything downstream is
-- shared. Refund policy is configured per ORG and snapshotted onto the fee
-- schedule at creation (the mod-payments rule: follow the record, not today's
-- setting). Withdrawal COMPUTES; a human confirms; nothing auto-refunds.
-- ============================================================================

-- org-level refund policy (snapshotted onto schedules at creation)
alter table public.providers
  add column if not exists refund_policy text not null default 'prorate_weeks'
    check (refund_policy in ('none_after_start','prorate_weeks','minus_deposit')),
  add column if not exists refund_deposit_cents integer not null default 0
    check (refund_deposit_cents >= 0);

alter table public.fee_schedules
  add column if not exists refund_policy text,
  add column if not exists refund_deposit_cents integer,
  add column if not exists status text not null default 'active'
    check (status in ('active','withdrawn','complete'));

-- ── Shape generator: one call builds the plan for any offering type ─────────
create or replace function public.create_member_fee_schedule(
  p_provider_id uuid, p_program_id uuid, p_member_id uuid, p_season_id uuid,
  p_total_cents integer, p_installment_count integer default null,
  p_first_due date default null
) returns uuid
language plpgsql security definer set search_path to '' as $$
declare
  v_type text; v_count integer; v_fs uuid; v_per integer; v_rem integer;
  v_due date := coalesce(p_first_due, current_date + 7);
  v_pol text; v_dep integer;
begin
  select offering_type into v_type from public.programs where id = p_program_id;
  select refund_policy, refund_deposit_cents into v_pol, v_dep
    from public.providers where id = p_provider_id;
  -- the shape decides the count: private/camp = one charge; team = N pieces
  v_count := case
    when v_type = 'team' then greatest(coalesce(p_installment_count, 3), 1)
    else 1 end;
  insert into public.fee_schedules
    (provider_id, program_id, member_id, season_id, total_cents,
     installment_count, refund_policy, refund_deposit_cents)
  values (p_provider_id, p_program_id, p_member_id, p_season_id,
          p_total_cents, v_count, v_pol, v_dep)
  returning id into v_fs;
  v_per := p_total_cents / v_count;          -- integer cents; remainder on first
  v_rem := p_total_cents - v_per * v_count;
  insert into public.installments (fee_schedule_id, member_id, due_date, amount_cents)
  select v_fs, p_member_id, v_due + (n * 30),
         v_per + case when n = 0 then v_rem else 0 end
  from generate_series(0, v_count - 1) n;
  return v_fs;
end; $$;
revoke all on function public.create_member_fee_schedule(uuid,uuid,uuid,uuid,integer,integer,date) from public, anon;
grant execute on function public.create_member_fee_schedule(uuid,uuid,uuid,uuid,integer,integer,date) to authenticated;

-- ── Withdrawal: COMPUTE the refund per the SNAPSHOTTED policy ───────────────
create or replace function public.compute_withdrawal(p_fee_schedule_id uuid)
returns table (paid_cents bigint, future_cents bigint, refund_cents bigint, policy text)
language plpgsql stable security definer set search_path to '' as $$
declare
  v fs record; v_pol text; v_dep integer;
  v_paid bigint; v_future bigint; v_refund bigint;
  v_start date; v_end date; v_weeks_total numeric; v_weeks_left numeric;
begin
  select f.*, coalesce(f.refund_policy, p.refund_policy) as pol,
         coalesce(f.refund_deposit_cents, p.refund_deposit_cents) as dep,
         s.start_date, s.end_date
    into v
    from public.fee_schedules f
    join public.providers p on p.id = f.provider_id
    left join public.seasons s on s.id = f.season_id
   where f.id = p_fee_schedule_id;
  if v.id is null then raise exception 'no such fee schedule'; end if;
  select coalesce(sum(amount_cents),0) filter (where status='paid'),
         coalesce(sum(amount_cents),0) filter (where status in ('due','failed','processing'))
    into v_paid, v_future
    from public.installments where fee_schedule_id = p_fee_schedule_id;
  v_refund := case v.pol
    when 'none_after_start' then
      case when v.start_date is not null and current_date >= v.start_date then 0 else v_paid end
    when 'minus_deposit' then greatest(v_paid - v.dep, 0)
    else -- prorate_weeks
      case when v.start_date is null or v.end_date is null or v.end_date <= v.start_date then v_paid
           when current_date <= v.start_date then v_paid
           when current_date >= v.end_date then 0
           else (v_paid * (v.end_date - current_date) / (v.end_date - v.start_date))::bigint
      end
  end;
  return query select v_paid, v_future, v_refund, v.pol;
end; $$;
revoke all on function public.compute_withdrawal(uuid) from public, anon;
grant execute on function public.compute_withdrawal(uuid) to authenticated;

-- ── The one director action (post-confirmation): cancel + record ────────────
-- Cancels every future installment, marks the schedule withdrawn, and writes
-- the append-only ledger record of the DECISION. The Stripe refund itself goes
-- out through the payment path (edge fn) which records its own charge.refunded
-- event — this function never moves money.
create or replace function public.withdraw_member(p_fee_schedule_id uuid)
returns table (cancelled_installments integer, refund_due_cents bigint)
language plpgsql security definer set search_path to '' as $$
declare v_n integer; v_refund bigint; v_provider uuid;
begin
  -- caller must own the org (RLS does not apply inside definer fns)
  select provider_id into v_provider from public.fee_schedules where id = p_fee_schedule_id;
  if auth.uid() is not null and not exists (
    select 1 from public.providers where id = v_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may withdraw a member';
  end if;
  select refund_cents into v_refund from public.compute_withdrawal(p_fee_schedule_id);
  update public.installments set status='waived'
   where fee_schedule_id = p_fee_schedule_id and status in ('due','failed');
  get diagnostics v_n = row_count;
  update public.fee_schedules set status='withdrawn' where id = p_fee_schedule_id;
  insert into public.payment_event_ledger
    (stripe_event_id, event_type, stripe_object_id, amount_minor, currency,
     outcome, occurred_at)
  values ('withdrawal:'||p_fee_schedule_id, 'member.withdrawn',
          p_fee_schedule_id::text, v_refund, 'USD', 'applied', now());
  return query select v_n, v_refund;
end; $$;
revoke all on function public.withdraw_member(uuid) from public, anon;
grant execute on function public.withdraw_member(uuid) to authenticated;

-- ── The treasurer/AR view: the agent's input ────────────────────────────────
create or replace view public.org_ar as
select
  fs.provider_id,
  sum(i.amount_cents)                                                   as billed_cents,
  sum(i.amount_cents) filter (where i.status = 'paid')                  as collected_cents,
  sum(i.amount_cents) filter (where i.due_date < current_date
                                and i.status <> 'paid'
                                and i.status <> 'waived')               as overdue_cents,
  count(distinct i.member_id) filter (where i.due_date < current_date
                                and i.status <> 'paid'
                                and i.status <> 'waived')               as overdue_members
from public.installments i
join public.fee_schedules fs on fs.id = i.fee_schedule_id
group by fs.provider_id;
comment on view public.org_ar is
  'Outstanding AR per org. Overdue is DERIVED here and only here — the agent and the treasurer read the same condition.';

create or replace view public.org_overdue_list as
select fs.provider_id, i.member_id, i.id as installment_id,
       i.amount_cents, i.due_date,
       (current_date - i.due_date) as days_late,
       i.attempt_count, i.last_attempt_at
from public.installments i
join public.fee_schedules fs on fs.id = i.fee_schedule_id
where i.due_date < current_date and i.status not in ('paid','waived');
comment on view public.org_overdue_list is 'The overdue families list — the agent''s direct input (spec 03/05).';
