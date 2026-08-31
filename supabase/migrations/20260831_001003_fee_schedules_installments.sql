-- ============================================================================
-- Spec 02 · migration 3 — FEE SCHEDULES + INSTALLMENTS (2026-08-31)
-- The team billing shape: a season total split into N installments per MEMBER
-- (team_id nullable by construction — the schedule hangs off the member via
-- fee_schedules.member_id; a solo trainer uses count=1 or per-session
-- bookings). Integer cents everywhere. Overdue is DERIVED
-- (due_date < current_date AND status <> 'paid') — deliberately NO is_overdue
-- column, so the agent can never chase a stale flag.
-- ============================================================================
create table if not exists public.fee_schedules (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.providers(id) on delete cascade,
  program_id        uuid references public.programs(id) on delete set null,   -- the offering
  member_id         uuid not null references public.team_athletes(id) on delete cascade,
  season_id         uuid references public.seasons(id) on delete set null,
  total_cents       integer not null check (total_cents >= 0),
  installment_count integer not null default 1 check (installment_count between 1 and 24),
  created_at        timestamptz not null default now()
);
comment on table public.fee_schedules is
  'One member''s plan for one offering/season: the total and how many pieces it splits into. The pieces live in installments.';

create table if not exists public.installments (
  id                        uuid primary key default gen_random_uuid(),
  fee_schedule_id           uuid not null references public.fee_schedules(id) on delete cascade,
  member_id                 uuid not null references public.team_athletes(id) on delete cascade,
  due_date                  date not null,
  amount_cents              integer not null check (amount_cents >= 0),
  status                    text not null default 'due'
                            check (status in ('due','processing','paid','failed','waived')),
  stripe_payment_intent_id  text,
  attempt_count             integer not null default 0 check (attempt_count >= 0),
  last_attempt_at           timestamptz,
  created_at                timestamptz not null default now()
);
comment on table public.installments is
  'One dated piece of a fee schedule. Overdue is DERIVED: due_date < current_date AND status <> ''paid''. No is_overdue column may ever be added.';

create index if not exists idx_fee_schedules_provider on public.fee_schedules(provider_id);
create index if not exists idx_fee_schedules_member on public.fee_schedules(member_id);
create index if not exists idx_installments_schedule on public.installments(fee_schedule_id);
create index if not exists idx_installments_due
  on public.installments(due_date) where status <> 'paid';

alter table public.fee_schedules enable row level security;
alter table public.installments enable row level security;

create policy fee_schedules_all_owner on public.fee_schedules
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = fee_schedules.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = fee_schedules.provider_id and pv.owner_id = auth.uid()));
-- claimed guardian: read schedules for members they are linked to — never other families'
create policy fee_schedules_select_guardian on public.fee_schedules
  for select to authenticated
  using (exists (select 1 from public.guardian_links gl
                 join public.guardians g on g.id = gl.guardian_id
                 where gl.member_id = fee_schedules.member_id and g.user_id = auth.uid()));

create policy installments_all_owner on public.installments
  for all to authenticated
  using (exists (select 1 from public.fee_schedules fs
                 join public.providers pv on pv.id = fs.provider_id
                 where fs.id = installments.fee_schedule_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.fee_schedules fs
                 join public.providers pv on pv.id = fs.provider_id
                 where fs.id = installments.fee_schedule_id and pv.owner_id = auth.uid()));
create policy installments_select_guardian on public.installments
  for select to authenticated
  using (exists (select 1 from public.guardian_links gl
                 join public.guardians g on g.id = gl.guardian_id
                 where gl.member_id = installments.member_id and g.user_id = auth.uid()));

grant select, insert, update, delete on public.fee_schedules, public.installments to authenticated;

-- Money-state columns are server-owned: a client (owner included) may not flip
-- an installment to paid or touch the payment intent — Stripe's webhook path
-- (service role) does that. Mirrors the bookings financial-fields trigger.
create or replace function public.enforce_installment_money()
 returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;  -- service role trusted
  if tg_op = 'UPDATE' then
    if new.status in ('paid','processing') and new.status is distinct from old.status then
      raise exception 'installment payment states are set by the payment path, not a client';
    end if;
    if new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
     or new.attempt_count is distinct from old.attempt_count
     or new.last_attempt_at is distinct from old.last_attempt_at then
      raise exception 'installment payment fields are server-owned';
    end if;
    if new.amount_cents is distinct from old.amount_cents and old.status = 'paid' then
      raise exception 'a paid installment''s amount is immutable';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.enforce_installment_money() from public, anon, authenticated;
create trigger trg_enforce_installment_money
  before update on public.installments
  for each row execute function public.enforce_installment_money();
