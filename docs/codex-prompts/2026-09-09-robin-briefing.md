# Robin briefing for Codex — 2026-09-09 (paste everything under the line)

Written after the robin audit of 2026-09-08 (`docs/robin-2026-09-08.md`), while
Codex was mid-flight on Prompt 1. Corrects two false premises in PROMPT.md,
answers P1.17, and names the one live defect that would silently fail Codex's
billing webhook.

---

MODE: continue Prompt 1. This is a robin audit briefing — read it before writing
more code, then keep going on the same task. Do not start Prompt 2.

**1. BLOCKER you cannot see, and must design around (do not fix it yourself).**
`trg_ledger_append_only` is LIVE in prod (migration 20260907_001032) and its
function raises on EVERY update of `payment_event_ledger`. Both money RPCs —
`apply_stripe_booking_event` (both overloads) and `apply_stripe_billing_event` —
insert the ledger row as `outcome='ignored'` and then promote it to `'applied'`.
That promotion raises 55000 today, so the whole RPC transaction rolls back, the
webhook returns 500, and Stripe retries for three days. Proven in a rolled-back
DO block against production on 2026-09-08. Nothing has hit it because there have
been no payment events since 09-01 and `webhook_dead_letter` is empty.

Consequences for your work, in order:
- The fix is `docs/red-drafts/2026-09-08-ledger-promotion-fix.sql`. It is RED and
  the owner applies it. Do not apply it, do not edit it, do not write a second
  version of it.
- Your new `supabase/functions/billing-webhook` must NOT depend on an
  insert-then-promote pattern. Compute the outcome first, then insert the ledger
  row ONCE with its final `outcome`. That needs no UPDATE at all, so it works
  both before and after the owner applies the fix. If you instead call
  `apply_stripe_billing_event`, your end-to-end test will fail until the fix
  lands — and the failure will look like a signature or projection bug, not a
  trigger.
- Any P1.05 acceptance evidence that requires a real event to project within 60
  seconds is blocked until the owner applies the fix. Do the implementation and
  the unit/handler tests now; mark that one acceptance row `blocked: ledger
  promotion fix pending` in STATUS.md rather than claiming it passed.

**2. P1.17 — both contradictions are resolved. Use these answers.**
- Draft overflow at the Free cap: **hard stop at generation, visible overflow in
  the UI.** The generator never creates draft 21. The paywall surface shows the
  real count of families that would have been drafted (an honest finding derived
  from the same query, not a fabricated number) plus the upgrade CTA. Prompt 1's
  "hard stop" governs the writer; Prompt 5's "visible overflow" governs the
  reader. There is no conflict once the count is a finding rather than a draft.
- Cancellation: **at period end.** `cancel_at_period_end = true`, entitlements
  stay at the paid tier until `current_period_end`, then fall to Free. This
  matches P5.07 and Stripe's default; immediate cancellation is not built.

**3. Two premises in PROMPT.md are false. Verified live on 2026-09-08 against
project `tseszaprvtvqrkfpditu` (your Supabase MCP login is failing with an OAuth
refresh error — re-authenticate it before you touch schema again; until you do,
treat the four facts below as the only trustworthy schema truth).**
- PROMPT.md says "plan enum is `free|solo|organization` (no `club`)". It is not.
  The live CHECK on `providers.plan` is `('free','pro','enterprise')`, and
  `plan_entitlements.plan` carries the same three keys. Your draft
  `docs/red-drafts/2026-09-08-plan-entitlements.sql` already handles this
  correctly (pro→solo, enterprise→organization, with a preflight) — that
  approach is right; the prompt's stated starting state was wrong, not your
  reading of the database.
- PROMPT.md says `ai_quota` exists. There is **no** `ai_quota` table. What exists
  is the function `consume_ai_quota(p_kind text)` and the table `ai_usage`. Build
  P1.10 on those, or add the table in a red draft and say so.
- Real current state, for your fixtures: all 21 providers are `plan='free'`, so
  the key rename touches no paying customer. `plan_entitlements` today has three
  rows and only these columns: `plan, ai_monthly_quota, seat_limit,
  workspace_enabled, purchasable, price_usd_month, updated_at`.
  `billing_subscriptions` has `provider_id, stripe_subscription_id,
  stripe_price_id, status, current_period_start, current_period_end,
  cancel_at_period_end, coupon, created_at, updated_at`.
- `providers.plan_status` CHECK is `('none','trialing','active','past_due','canceled','incomplete')`.
  Your no-card 14-day Enterprise trial (P1.13) must use `trialing` and expire to
  `free` / `canceled`; do not invent a new status value without a red draft that
  widens the CHECK.

**4. Process changed under you on 2026-09-08. Read this or your push will bounce.**
- `main` is now protected: pull request required, and `smoke` +
  `security-regressions` must be green. A direct push to `main` is rejected.
  Branch → PR → checks → merge, always.
- A `gitleaks` check now runs on every PR and every push, and GitHub push
  protection is on. No real keys in fixtures or test files, not even expired
  ones; use obvious fakes.
- `security-regressions` runs `node --test` over the edge-function test files. If
  you add `supabase/functions/billing-webhook/handler.test.mjs`, add it to
  `.github/workflows/pr-checks.yml` in the same PR so it actually runs.
- Every PR body carries its own evidence: the commands you ran and their output.
  "Verified" without a pasted result is not evidence.
- Keep claiming files with `python3 .claude/hooks/clo-sync.py begin codex "..."`
  and close with `end` plus the check performed. Your 22:06 claim sat with no
  files behind it for eight minutes; close claims you are not working.
- RED stays RED: RLS, Stripe, auth, migrations, capacity, consent. Draft into
  `docs/red-drafts/` with a stated inverse and verification; the owner applies.
  You have been doing exactly this — keep doing it.

**5. Robin's findings on your delivered work, so you know where you stand.**
Onboarding, checkout, refund and payouts are CORRECT on every money invariant
(direct charges, connected-account scoping, no application fee, server-derived
amounts, post-auth rate limits on all eleven money/send endpoints). `#358` was
in scope; you applied nothing RED yourself. Two low-severity latents worth a
line each if you are already in those files, and not worth a separate PR:
- `installment-checkout` resolves the payer with `.maybeSingle()` on
  `guardian_links`; a member with two payer-flagged guardians makes it error and
  a legitimate payer gets 403. Filter by `guardians.user_id` instead.
- `stripe-provider-payouts` returns a raw PostgREST error message to the client
  on the provider lookup. Replace it with a fixed string.
Also, for the later Stripe fifth-state prompt: the webhook's pre-guard rejects an
unknown `event.account` with a 500, so an `account.updated` handler must run
before that guard, or the account write-back must be guaranteed first.

**6. What the owner is providing separately** (do not block on these; note them
in STATUS.md as external dependencies): Stripe test secret and Connect webhook
signing secret confirmed valid; `account.updated` and
`account.application.deauthorized` enabled on the Connect endpoint plus its
endpoint id; a connected test account id for the deauthorization trigger;
`stripe login` on this machine; and a working local Chromium so `bash
src/smoke.sh` can run (a broken Chromium is what blocked your last release).

Keep going on Prompt 1 in the order you have it. Do not expand scope.
