-- ============================================================================
-- 20260915_001063 — spec 18.6 as ruled (owner, 2026-09-16): NO org_subscription
-- table. The agreed price shape (base + per-athlete + payment margin) lives as
-- two nullable columns on the existing plan_entitlements structure, unused at
-- launch. A second billing table duplicating plan_entitlements is how
-- reconciliation drift starts, and there is nothing to bill yet.
-- Single lane. FILE ONLY — never applied (D5).
-- ============================================================================
alter table public.plan_entitlements
  add column if not exists per_athlete_minor integer
    check (per_athlete_minor is null or per_athlete_minor >= 0),
  add column if not exists payment_margin_bps integer
    check (payment_margin_bps is null or (payment_margin_bps >= 0 and payment_margin_bps <= 10000));
comment on column public.plan_entitlements.per_athlete_minor is
  'Spec 18.6: per-athlete component in minor units, billed at registration on a counted date. NULL = not priced (launch state). Not read by billing-create-checkout yet.';
comment on column public.plan_entitlements.payment_margin_bps is
  'Spec 18.6: basis points on processed volume. NULL = none (launch state; subscription-only positioning 2026-09-09). Not read by any function yet.';
