-- 20260921_001108_billing_pipeline_repair.sql
-- Billing-database pipeline repair (2026-09-21).
--
-- DIAGNOSIS. apply_stripe_billing_event, billing_subscriptions, and
-- plan_entitlements all existed, so the pipeline looked wired — but
-- plan_entitlements was never really seeded: pro.purchasable was false and
-- pro.price_usd_month was null, so billing-create-checkout could never open a
-- Pro checkout ("That plan can't be purchased") and no subscription event
-- could ever grant Pro. ai_monthly_quota / seat_limit were null on every row,
-- so consume_ai_quota treated every workspace as unlimited and seat caps were
-- UI-only. Separately, providers_update_owner let a workspace owner self-PATCH
-- plan/plan_status with a plain authenticated request.
--
-- THIS MIGRATION
--   1. Adds the CONTEXT.md §6.2 capability-gate columns to plan_entitlements.
--   2. Seeds quotas/prices as data (never code — CONTEXT.md I2):
--      free = limited AI actions (25/mo) + 1 seat, not purchasable;
--      pro  = unlimited AI actions (null quota = unlimited in
--             consume_ai_quota) + 3 seats, purchasable at $34.99/mo
--             (owner-authorized purchase 2026-09-21);
--      enterprise = custom, not self-serve (purchasable=false until the
--             workspace product exists — billing-create-checkout enforces it).
--   3. Server-side seat-cap enforcement: BEFORE INSERT/UPDATE trigger on
--      organization_members raising SQLSTATE PT402 with the JSON details the
--      shared entitlements.mjs contract parses into a 402 paywall.
--   4. RLS review: providers_update_owner lets an owner UPDATE their row, but
--      the pre-existing trg_enforce_provider_trust already rejects any
--      authenticated self-write of plan/plan_status/plan_period_end/
--      stripe_customer_id/founding_coach (verified live 2026-09-21) while
--      service_role (the billing edge functions) passes through. No change
--      needed — plan state is already service-role-only.
--   5. Minimal billing_customers / billing_prices mirrors (service-role only).
--      billing-create-checkout uses inline price_data, so no Stripe Price
--      objects exist yet — billing_prices stays empty until tomorrow's
--      Stripe-dashboard work creates real prices.
--
-- Gate: supports G2 (MONEY). Does not move it — that needs tomorrow's live
-- Stripe purchase receipt.

begin;

-- ── 1. §6.2 capability-gate columns ──────────────────────────────────────────
alter table public.plan_entitlements
  add column if not exists member_cap integer,
  add column if not exists admin_cap integer,
  add column if not exists group_cap integer,
  add column if not exists jobs text[] not null default '{}',
  add column if not exists modules text[] not null default '{}',
  add column if not exists scan_mode text not null default 'nightly',
  add column if not exists draft_quota_month integer,
  add column if not exists send_quota_month integer,
  add column if not exists ask_quota_month integer,
  add column if not exists branding_footer boolean not null default true;

-- ── 2. Quota + price seeds ───────────────────────────────────────────────────
update public.plan_entitlements set
  ai_monthly_quota = 25,
  seat_limit = 1,
  workspace_enabled = false,
  purchasable = false,
  price_usd_month = null,
  member_cap = 15,
  admin_cap = 1,
  group_cap = 1,
  jobs = array['money','documents'],
  modules = array['roster','dues','waivers'],
  scan_mode = 'nightly',
  draft_quota_month = 20,
  send_quota_month = 20,
  ask_quota_month = 25,
  branding_footer = true,
  updated_at = now()
where plan = 'free';

update public.plan_entitlements set
  ai_monthly_quota = null,          -- null = unlimited in consume_ai_quota
  seat_limit = 3,
  workspace_enabled = true,
  purchasable = true,
  price_usd_month = 34.99,
  member_cap = 100,
  admin_cap = 3,
  group_cap = null,                 -- null = unlimited
  jobs = array['money','documents','records','proposals','sourcing'],
  modules = array['roster','dues','waivers','booking','packages','notes',
                  'progress','session_billing'],
  scan_mode = 'triggered',
  draft_quota_month = null,
  send_quota_month = null,
  ask_quota_month = null,
  branding_footer = false,
  updated_at = now()
where plan = 'pro';

update public.plan_entitlements set
  ai_monthly_quota = null,
  seat_limit = null,                -- custom
  workspace_enabled = true,
  purchasable = false,              -- not self-serve until workspace exists
  price_usd_month = null,           -- custom pricing
  member_cap = null,
  admin_cap = null,
  group_cap = null,
  jobs = array['money','documents','records','proposals','sourcing',
               'treasury','multi_program'],
  modules = array['roster','dues','waivers','booking','packages','notes',
                  'progress','session_billing','installments','rsvp',
                  'invite_link','team_chat','eligibility','memberships',
                  'capacity','multi_program','league_view'],
  scan_mode = 'ondemand',
  draft_quota_month = null,
  send_quota_month = null,
  ask_quota_month = null,
  branding_footer = false,
  updated_at = now()
where plan = 'enterprise';

-- ── 3. Server-side seat-cap enforcement ──────────────────────────────────────
create or replace function public.enforce_seat_cap()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_plan    text;
  v_owner   uuid;
  v_limit   int;
  v_used    int;
  v_upgrade text;
begin
  -- Only active seats count; deactivating never trips the cap.
  if tg_op = 'UPDATE' and not new.is_active then
    return new;
  end if;
  select p.plan, p.owner_id into v_plan, v_owner
    from public.providers p where p.id = new.organization_id;
  select e.seat_limit into v_limit
    from public.plan_entitlements e where e.plan = coalesce(v_plan, 'free');
  -- null seat_limit = unlimited (enterprise/custom).
  if v_limit is null then
    return new;
  end if;
  -- The owner always holds one seat. An explicit owner row
  -- (member_user_id = provider owner) must not count twice.
  select count(*) into v_used
    from public.organization_members m
   where m.organization_id = new.organization_id
     and m.is_active
     and (tg_op = 'INSERT' or m.id <> new.id)
     and m.member_user_id is distinct from v_owner;
  if v_owner is not null then
    v_used := v_used + 1;
  end if;
  -- The row being written consumes a seat when it is active and not the owner.
  if new.is_active and new.member_user_id is distinct from v_owner then
    v_used := v_used + 1;
  end if;
  if v_used > v_limit then
    v_upgrade := case when coalesce(v_plan, 'free') = 'free' then 'pro' else null end;
    raise exception using
      errcode = 'PT402',
      message = 'Entitlement limit reached',
      detail = jsonb_build_object(
                 'reason', 'seat_cap',
                 'current_plan', coalesce(v_plan, 'free'),
                 'upgrade_to', v_upgrade,
                 'limit', v_limit,
                 'current', v_used - 1)::text;
  end if;
  return new;
end
$function$;

revoke all on function public.enforce_seat_cap() from public, anon, authenticated;

drop trigger if exists organization_members_seat_cap on public.organization_members;
create trigger organization_members_seat_cap
  before insert or update of is_active on public.organization_members
  for each row execute function public.enforce_seat_cap();

-- ── 4. Plan state is service-role-only ───────────────────────────────────────
-- NOTE (verified 2026-09-21): no new trigger needed. The pre-existing
-- trg_enforce_provider_trust (baseline) already rejects any authenticated
-- user's self-write of plan, plan_status, plan_period_end, stripe_customer_id
-- and founding_coach, while letting service_role (auth.uid() null) through —
-- which is exactly the billing edge-function path. Proven live: an
-- authenticated owner PATCH of plan raised
-- "verification / background-check / account / stripe / plan fields are
-- server-controlled and cannot be self-set". providers_update_owner still
-- permits owners to edit their non-billing profile columns.

-- ── 5. Billing mirrors (service-role only; no authenticated policies) ────────
create table if not exists public.billing_customers (
  provider_id        uuid        primary key references public.providers(id) on delete cascade,
  stripe_customer_id text        not null unique,
  email              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.billing_prices (
  stripe_price_id text        primary key,
  plan            text        not null,
  amount_minor    bigint      not null,
  currency        text        not null default 'usd',
  interval        text        not null default 'month',
  active          boolean     not null default true,
  created_at      timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
alter table public.billing_prices   enable row level security;
-- No policies: authenticated/anon get nothing; service_role bypasses RLS.

commit;
