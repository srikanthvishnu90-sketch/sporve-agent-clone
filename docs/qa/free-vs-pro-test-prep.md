# Free vs Pro test preparation — Sporv launch sprint

Prep-only document. No enforcement code was changed. Read this before running the
side-by-side test script `tests/qa/free-vs-pro.side-by-side.sh`.

Branch: `fix/non-stripe-launch-blockers` · Production: https://sporv.ai ·
Supabase project ref: `hzbhjkcqwawgqtspueuw`

## 0. What the repo actually implements (code reality, 2026-09-21)

Plan keys in code: `free | pro | enterprise` (`providers_plan_check`,
`supabase/migrations/00000000000000_baseline.sql:834`). Customer labels in the
billing tab: Free / **Sporv Pro $34.99/mo** / Sporv Enterprise (custom)
(`src/mod-coachaccount.js:110-119`). This **contradicts** CONTEXT.md section 6
(Free/Solo/Organization, $49/$199, keys `free|solo|organization`); billing is
launching on the code, not the stale section. Owner must decide which is truth
before launch.

### 0.1 Enforcement audit — server-side vs UI-only vs missing

**Enforced server-side today:**

1. Connector OAuth gates — 402. `google-oauth-start` (index.ts:273-295),
   `intuit-oauth-start` (index.ts:229-251), `microsoft-oauth-start`
   (index.ts:247-269). Reads `plan_entitlements.connectors`; a kind not in the
   list returns 402 `{reason:'connector_not_in_plan', current_plan, upgrade_to,
   limit, current}`; fails closed 503 when the entitlements row is missing.
   **Stale copy:** `upgrade_to:'solo'` is emitted, but `'solo'` is not a DB plan
   key — that link/deep-path goes nowhere.
2. Checkout sale gate — `billing-create-checkout` (index.ts:131-156). Requires
   the plan row to exist, `plan != 'free'`, `purchasable=true`, and a valid
   `price_usd_month`; 409 when already active on the plan.
3. Command-bar AI gate — `api/ai.js:238-310`. Calls `consume_ai_quota` RPC
   before the model call. Fails closed: 503 on `quota_unavailable`,
   429 `rate_limited`, 429 legacy `quota_exhausted`. A 402 fires only when the
   RPC returns `contract_version===2` — **neither shipped RPC version sends it,
   so the I3-mandated 402 is unreachable today.**
4. `ai-gateway` per-user minute/day rate caps (index.ts:406-423), 503
   fail-closed. Abuse shield, not plan-based.
5. Paid-state derivation — `src/mod-coachaccount.js:638-662`. `entitled` is
   true only when `providers.plan != 'free'` AND `plan_status` in
   `['active','trialing','past_due']`. `canceled` and `incomplete` render as the
   free plan. The UI reads server-owned columns only.

**UI-only (no server enforcement behind it):**

- Seat display from `seat_limit` (`mod-coachaccount.js:141-147`). No cap is
  checked when inviting staff — `coach_invites` exists but no seat-cap query.
- Upgrade prompt copy at `src/sporve-web.host.html:19889`:
  "You've hit this month's free AI limit — upgrade to Pro for unlimited."
  (Only reachable via the legacy 429 path today.)
- Plans-tab fallback copy (`mod-coachaccount.js:110-119`): Free "Three AI
  actions a month, one seat"; Pro "Sporv Pro $34.99/mo — Unlimited AI actions
  and up to three seats". Live values sync from `plan_entitlements` at runtime.
- Quota visibility banners, draft over-limit marking, connector-card lock copy:
  absent.

**Missing entirely (honest gaps — launch risks):**

1. **No quota seeds.** `ai_monthly_quota`, `seat_limit`, `price_usd_month`,
   `purchasable` are never seeded (only `connectors` was, in
   `20260920_001104`). With the row present and `ai_monthly_quota` NULL, the
   production `consume_ai_quota` (baseline.sql:1500-1546) treats NULL as
   **unlimited — including Free**. Today every plan has unlimited AI.
2. **CONTEXT 6.2 columns never created:** `member_cap`, `admin_cap`,
   `group_cap`, `jobs`, `modules`, `scan_mode`, `draft_quota_month`,
   `send_quota_month`, `ask_quota_month`, `branding_footer` — zero grep hits
   repo-wide. No member/group/draft/send/module gate exists anywhere.
3. **No 402 on AI quota exhaustion** (contract_version mismatch, item 3 above)
   — this violates invariant I3 directly.
4. **No quota or entitlement checks in** `coach-command`, `connector-read`, or
   `ai-chat` — unlimited AI for all plans on those paths.
5. **Billing webhook pipeline is broken.** `billing-webhook/index.ts:53` calls
   `admin.rpc('apply_platform_billing_event')`; that RPC does not exist in any
   migration (only `apply_stripe_billing_event` with a different signature,
   baseline.sql:1022), and the handler depends on `billing_prices` /
   `billing_customers` tables that do not exist (handler.mjs:113). Even after
   Stripe goes live, no subscription event can flip `providers.plan`. **This
   blocks the paid tier itself.**
6. No trial logic (CONTEXT 6.6, 14-day Organization trial) — no code.
7. No dunning-window delay on `invoice.payment_failed` before downgrade.
8. **Plan self-tamper:** `providers_update_owner` RLS (baseline.sql:4675) lets
   an authenticated owner UPDATE every column, including `plan` and
   `plan_status`. There is no trigger guarding those columns; only the
   client-side EDITABLE list restricts them. A direct REST PATCH could
   self-grant Pro.
9. `upgrade_to:'solo'` in the OAuth 402 payload (item 1) — dead key.

## 1. Test workspace setup (do this first, tomorrow)

No purchase is performed during setup. Create two accounts on sporv.ai:

**Workspace A — FREE (control):**
1. In a clean browser profile, open https://sporv.ai, choose "For coaches"
   signup with **email 1** (magic link OTP or Google OAuth).
2. Complete onboarding to a populated workspace (import the sample CSV or
   connect the website extractor only — both in Free's `connectors` list).
3. Confirm billing tab shows "Free plan". Record provider id (Account sheet).

**Workspace B — PRO-TO-BE (experimental):**
1. In a second browser profile, sign up with **email 2** the same way.
2. Complete onboarding identically (same CSV rows, same connector).
3. At launch time, buy **Sporv Pro** via Account → Billing → "Get Pro"
   (Stripe Checkout, real card). This is the ONLY step that moves money, and it
   happens at launch, not during prep.

Do not reuse emails; do not share profiles; do not touch Workspace B's billing
until launch. Record both provider ids.

## 2. Side-by-side test script

Run `tests/qa/free-vs-pro.side-by-side.sh` — it prints each step, the command
or click path, and the expected result per workspace. Summary of assertions:

| # | Identical task, both workspaces | FREE expected | PRO expected |
|---|---|---|---|
| T1 | Command-bar Ask: 5 prompts | Allowed while under quota (today: always, gap 1) | Allowed, metered in `ai_usage` |
| T2 | Ask until monthly quota exhausted | **402** `{reason:'quota_exhausted', current_plan:'free', upgrade_to:'pro', limit, current}` + "upgrade to Pro for unlimited" copy (gaps 1+3 mean this currently fails) | Never 402s |
| T3 | Connect Google OAuth start (Gmail) | **402** `connector_not_in_plan` (upgrade_to currently stale 'solo', gap 9) | Redirects to Google consent |
| T4 | Connect website extractor / CSV import | Allowed | Allowed |
| T5 | coach-command draft generation ×10 | Allowed (gap 4: no quota check) | Allowed |
| T6 | Invite staff seat 2, seat 3 | 2nd allowed; 3rd allowed today (gap: no cap check) | Allowed |
| T7 | Invite staff seat 4 | Must fail 402 | Allowed (Pro = 3 seats) |
| T8 | Cancelled/incomplete checkout returns | Plan stays free, `plan_status='incomplete'`, billing tab shows "Free plan — Sporv Pro checkout not finished" | n/a |
| T9 | After purchase: refresh, log out, log in | n/a | `plan='pro'`, `plan_status='active'`, `entitled=true`, "Sporv Pro — renews <date>"; AI and Gmail still work |
| T10 | Cancel in Stripe portal, period ends | n/a | Drops to free: `plan='free'`, `plan_status='canceled'`; roster/reads/exports/dues still work; new AI writes 402 |
| T11 | Failed renewal (`invoice.payment_failed`) | n/a | Access continues through Stripe's dunning window (gap 7: not implemented); after close, free entitlements + a finding |
| T12 | REST PATCH `providers` set `plan='pro'` as the owner | Must be rejected (gap 8: likely succeeds — verify) | n/a |
| T13 | Export roster as free, over-cap | Always allowed (I4) | Always allowed |

Pass criteria: every row behaves as the "expected" column says. Gaps 1, 3, 5,
8, 9 make T2/T5/T7/T12 fail today — the script marks those as EXPECTED-FAIL
until the gaps are closed.

## 3. Read-only database verification queries

Run against the canonical project (`hzbhjkcqwawgqtspueuw`) with a read-only
role. SELECTs only.

```sql
-- Q1. Entitlement rows actually in production (proves quotas exist)
select plan, ai_monthly_quota, seat_limit, purchasable, price_usd_month,
       connectors, updated_at
from public.plan_entitlements;

-- Q2. Paid state for the test workspaces (proves purchase projected)
select id, business_name, plan, plan_status, plan_period_end,
       stripe_customer_id
from public.providers
where owner_id in ('<AUTH_UID_EMAIL1>', '<AUTH_UID_EMAIL2>');

-- Q3. Subscription ledger rows written by the webhook (proves events applied)
select provider_id, stripe_subscription_id, stripe_price_id, status,
       current_period_start, current_period_end, cancel_at_period_end, updated_at
from public.billing_subscriptions
where provider_id in ('<PROVIDER_UUID_A>', '<PROVIDER_UUID_B>')
order by updated_at desc;

-- Q4. AI usage metering for both workspaces this month (proves quota counts)
select provider_id, kind, count(*) as calls
from public.ai_usage
where used_at >= date_trunc('month', now())
  and provider_id in ('<PROVIDER_UUID_A>', '<PROVIDER_UUID_B>')
group by provider_id, kind;

-- Q5. Quota verdict the server computes (same function api/ai.js calls)
select public.consume_ai_quota('command_bar');
-- NOTE: this function INSERTS an ai_usage row on the allowed path; run it
-- from the test account's own session so the receipt belongs to that account.
```

Q2 is the single source the billing tab renders (`mod-coachaccount.js:638`).
`plan='pro'` + `plan_status='active'` is the paid state; anything else on
Workspace B after checkout means the webhook pipeline (gap 5) failed.

## 4. What must wait for billing to go live

- Real Stripe Checkout on Workspace B (money moves once).
- `STRIPE_BILLING_*` env + webhook endpoint wiring in production.
- Gap 5 fix: deploy `apply_platform_billing_event` (or rewire the webhook to
  the existing `apply_stripe_billing_event`) plus `billing_prices` /
  `billing_customers` before any paid test is meaningful.
- Gap 1 fix: seed `ai_monthly_quota`, `seat_limit`, `price_usd_month`,
  `purchasable` (founder-confirmed prices) or Free stays unlimited.
- Owner decision: CONTEXT section 6 pricing vs shipped code pricing.

## 5. Benchmark scoring note (owner standing instruction)

Each test task scores 5: 4 function + 1 design quality of the user-visible
output. Apply to T2's 402 payload rendering, T3's connector lock card, and
the billing tab's paid-state label.
