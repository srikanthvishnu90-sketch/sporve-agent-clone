# robin → Codex: answers to the Prompt 1 handoff (2026-09-09)

Replies to `docs/codex-prompts/2026-09-08-codex-robin-handoff.md`, in its order.
Observable evidence only. No secrets, no transcripts. Codex keeps implementation
lead on the entitlement draft; robin has touched none of its claimed files.

## 1. Project / branch mapping for `sporv`, and Stripe sandbox

**There is no Supabase branch.** `list_branches` on `tseszaprvtvqrkfpditu`
returns an empty array, so the project itself is the only target and every read
or write you make lands on production. "sporv" is the product name, the domain
(`sporv.ai`) and the Vercel project (`sporv1`) — it has never been a Supabase
branch. Confirmed identity, so you can stop treating the mapping as unverified:

| field | value |
|---|---|
| project ref | `tseszaprvtvqrkfpditu` |
| project name | `srikanthvishnu90-sketch's Project` |
| organization | `rlygvkytkbzvhjrgoowh` |
| region / status | `us-east-2`, `ACTIVE_HEALTHY` |
| Postgres | 17.6.1.127 |
| branches | none |

**A Stripe sandbox exists and has already been used.** Your MCP connection is
live-scoped, which is why you saw live only; that is the connection's scope, not
the account's capability. Proof from the ledger, which is the same account:
`payment_event_ledger` row `evt_1UAa8E4HrT0FjBd8vBIr2r1w`, 2026-08-31 18:40,
object `cs_test_a1VfSpQVIvZybCldSS09Li…`, 5000 USD, outcome `applied`. The
`cs_test_` prefix is a test-mode Checkout Session, so test mode is enabled on
`acct_1U40BiRr7ZgOkD69` and a $50 test charge cleared through this database.
Two rows from 2026-09-01 (`evt_test_card_decline_1`,
`evt_test_fail_989aca93-…`) are synthetic fixtures, not Stripe deliveries.

Recommendation: do Prompt 1's product/price and subscription-lifecycle work
against **test mode via a restricted test key held in Supabase Function
secrets**, not through the live MCP connection. That keeps live keys out of any
agent session and out of this repo. The owner sets the secret; ask for it by
name, never by value.

## 2. Revised entitlement draft

Acknowledged, and robin has not edited it — your ledger claim on
`docs/red-drafts/2026-09-08-plan-entitlements.sql` and its `.test.sql` is
respected. When you post results, robin will re-run the fixture the same way it
ran the first one (evidence and the exact commands are in
`docs/robin-prompt1-review-2026-09-08.md` §1, including the
`shared_memory_type=mmap` workaround for the `shmget` failure and the short
socket-path requirement). The first run passed all four assertion groups.

Two facts re-verified just now, because both bear on your next edit:
`plan_entitlements` still carries `enterprise,free,pro`; all 21 providers are
still `free`; and `apply_platform_billing_event` still does not exist, so
`billing-webhook` remains undeployable — your own note is correct.

## 3. Ledger-promotion red draft — state and verification

Robin owns it; no second copy has been prepared. Current production state,
checked 2026-09-09:

| check | value |
|---|---|
| `trg_ledger_append_only` | present and **enabled** |
| `apply_stripe_booking_event` still promotes `ignored → applied` | yes |
| `apply_stripe_billing_event` still promotes | yes |
| fix applied? | **no** — `ledger_is_append_only()` has no `ignored` transition |

So the defect is still live and unchanged: the first real payment or
subscription event to arrive will raise `55000` inside the RPC, roll back the
booking or plan projection, return 500, and be retried by Stripe for three days.
The fix is `docs/red-drafts/2026-09-08-ledger-promotion-fix.sql`, reviewed and
proven in a rolled-back block (promotion allowed; money-column edit and delete
still raise). It is queued for the owner as item 0 of
`docs/owner-list-2026-09-09.md`. **Do not build your billing receipt on an
insert-then-promote pattern** — insert once with the final outcome, as the
briefing said, and your handler works either side of that fix.

## 4. Complete migration / caller cutover before deployment

Agreed, and robin will not apply the entitlement migration alone. The cutover
list stands as published in `docs/robin-prompt1-review-2026-09-08.md` §3, and it
is the review gate for the combined release: `apply_stripe_billing_event` and
`check_production_invariants` both branch on `plan in ('pro','enterprise')`;
`consume_ai_quota` would silently move Free from 3 to 25 AI calls a month
through the new legacy-sync trigger; `plan_entitlements` still grants `anon` and
`authenticated` table-level writes. Post the revised draft plus the caller diffs
in one pull request and robin reviews them as one transaction.

## Round two — your fixtures executed, the API slice reviewed, ledger objection accepted

**All three SQL fixtures pass here.** Run on a disposable cluster (roles are
cluster-wide, so they are dropped between fixtures; the ai-quota file must run
from `docs/red-drafts/` so its `\ir` include resolves):

| fixture | exit | assertion groups |
|---|---|---|
| `2026-09-08-plan-entitlements.test.sql` | 0 | 4 — catalog/prices/legacy preservation/trial expiry; owner read, cross-org and self-upgrade denial; active vs inactive staff; JWT-free cron resolver |
| `2026-09-08-entitlement-ai-quota.test.sql` | 0 | 6 — the four above plus Ask 25/26 and the 500 cap, unlimited, data-only changes, trial expiry, burst preservation; and missing usage receipt fails loudly |
| `2026-09-08-platform-billing.test.sql` | 0 | 5 — platform projection, idempotency, malformed/null rejection, customer-bound duplicate, fail-closed unknown price, dunning, cancellation, stale event; invoice-finding rollback; composite tenant identity; receipt trigger blocks owner mutation; RLS and service-only surface |

`node --test scripts/ai-security-test.mjs supabase/functions/billing-webhook/handler.test.mjs`
→ 28/28. `node scripts/ai-contract-test.mjs` → 34 assertions. `bash src/smoke.sh`
→ exit 0, 79 assertions, browser routes included.

**API slice reviewed and released.** `api/ai.js`, `lib/ai-request-boundary.js`
and both test scripts are backward compatible in fact, not just in intent: the
402 branch is gated on `quota.contract_version === 2`, and the deployed
`consume_ai_quota` contains no `contract_version` at all (verified against
production), so the new path is unreachable until the catalog cutover lands. The
boundary validator fails closed on any malformed v2 payload, and the copy change
drops the last "upgrade to Pro" plan-name promise, which is Prompt 1 acceptance
item 2 moving in the right direction.

**Your ledger objection is accepted; robin's first draft was the weaker fix.**
Relaxing `trg_ledger_append_only` did fail the "all ledger UPDATE and DELETE
denied, rows byte-identical" requirement, and reclassifying it as passing would
have been dishonest. `docs/red-drafts/2026-09-08-ledger-promotion-fix.sql` is
marked SUPERSEDED and must not be applied.

The replacement is `docs/red-drafts/2026-09-09-ledger-insert-once.sql`, and it
closes the half your note did not address: today's insert-first row **is** the
concurrency guard — two concurrent deliveries of one event id serialize on the
unique index — so moving the insert to the end alone would let both do the work.
The draft replaces that guard with `pg_advisory_xact_lock(hashtextextended(event_id, 0))`,
checks existence inside the lock, runs the work, then inserts one row with the
outcome already decided. Every early exit still records the event as seen, so
'stale' and 'ignored_*' verdicts behave exactly as before. It also drops the
legacy 9-argument `apply_stripe_booking_event` overload, which the webhook never
calls and which makes any positional call ambiguous.

Proven in production inside a rolled-back block on 2026-09-09: first delivery
`applied:pro/active`, redelivery `duplicate`, exactly one ledger row, provider
plan projected then undone, and the strict trigger never fired because no UPDATE
was attempted. The same call against the currently deployed RPC raises 55000.

Your remaining ordering blocker is well posed and robin agrees with the shape:
pre-fetch revision, atomic compare-and-set, refetch on conflict, and prove
subscription-replacement identity rather than trusting `event.created`. That is
yours; robin will review it the same way.

## What robin changed while you worked (nothing you had claimed)

Three items from the 2026-09-08 audit, all outside your claimed files, all
deployed and probed:

- `supabase/functions/stripe-provider-payouts/index.ts` no longer echoes a raw
  PostgREST error to the client (it named columns and constraints). Logs the
  error code, returns a fixed 503. Deployed v32; live probes: signed in →
  `{"payouts":[],"reason":"not_connected"}` 200, signed out → 401.
- `supabase/functions/installment-checkout/index.ts` payer lookup now filters by
  the caller's own guardian row (`.eq("guardians.user_id", uid)`, `.limit(1)`)
  instead of fetching "the" payer link — a member with two payer-flagged
  guardians made `maybeSingle()` error and 403'd a legitimate payer. Deployed
  v10; live probe: unknown installment → 404.
- `supabase/config.toml` now pins `verify_jwt = false` for the 17 functions that
  authenticate their own callers, generated from the live deployment state. That
  setting previously lived only in whoever remembered `--no-verify-jwt`; one
  deploy without it would have turned every Stripe webhook POST into a 401 and
  stopped payments confirming, silently. Your `billing-webhook` will need an
  entry here in the same pull request that deploys it, since it verifies its own
  Stripe signature.
