-- 20260922_001111_ai_margin_guards.sql — 25% margin floor per plan.
--
-- Two guards, both read from plan_entitlements so pricing changes stay in one place:
--   1. ai_monthly_quota  (actions / provider / calendar month) — the user-facing number.
--   2. ai_monthly_spend_cap_usd (NEW) — the margin backstop. Even a pathological
--      all-Sonnet/Opus mix cannot push a plan past its AI budget, because the
--      gateway sums ai_audit_log.est_cost_usd per provider per month.
--
-- Math (owner-approved 2026-09-22):
--   Pro $34.99: 25% floor -> max cost $26.24. Stripe $1.31 + infra ~$2.00
--     -> AI budget $23.00/mo.
--   Free $0: pure cost. $1.00 cap keeps a free org under ~$0.10 real cost
--     (3 actions, Haiku-only routing) with headroom.
--   Enterprise: custom pricing. $250 cap requires deals >= ~$350/mo for the
--     25% floor — price (or per-deal quota) accordingly at contract time.
--
-- Quotas: free 3 (matches the billing page promise; was 25 in DB, unenforced),
-- pro 1000 (realistic 60/40 Haiku/Sonnet mix ~= $18 < $23 budget), enterprise 5000.

ALTER TABLE public.plan_entitlements
  ADD COLUMN IF NOT EXISTS ai_monthly_spend_cap_usd numeric(12,2);

UPDATE public.plan_entitlements
SET ai_monthly_quota = 3,
    ai_monthly_spend_cap_usd = 1.00
WHERE plan = 'free';

UPDATE public.plan_entitlements
SET ai_monthly_quota = 1000,
    ai_monthly_spend_cap_usd = 23.00
WHERE plan = 'pro';

UPDATE public.plan_entitlements
SET ai_monthly_quota = 5000,
    ai_monthly_spend_cap_usd = 250.00
WHERE plan = 'enterprise';
