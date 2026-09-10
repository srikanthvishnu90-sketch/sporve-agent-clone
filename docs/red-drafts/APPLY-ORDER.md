# Red drafts — the reconciled apply order

**Written 2026-09-09. Every line below was checked against the LIVE database**
(`tseszaprvtvqrkfpditu`), not against filenames and not against
`supabase/migrations/`. Those two disagree with production in three places, which
is the reason this file exists.

A draft in `docs/red-drafts/` is not a queue position. Some are already applied,
one is explicitly superseded, one is evidence rather than a migration, and
several cannot be applied alone because their own headers say so. Applying them
in directory order would fail on the third file.

## What production actually has

Migrations through `20260907163659` (`001036_public_org_read`). Verified live:

| probe | result |
|---|---|
| `org_connectors`, `connector_oauth_state` | absent |
| `plan_entitlements.connectors`, `resolve_provider_entitlements_internal` | absent |
| `platform_billing_checkout_reservations`, `message_send_quota_claims`, `outbound_inbox_send_receipts` | absent |
| `trg_ledger_append_only` | **present** |
| `apply_stripe_booking_event` overloads | **2** |
| `agent_read_on`, `run_agent_drafts`, `org_ar`, import-batch uniqueness index | present |
| tables in `public` without RLS | **0** |
| `anon` grants on `public.programs` | **7 — DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE** |
| `anon` policy on `organization_members` | present |
| treasurer role / `is_org_treasurer` | absent |
| `sporv-rate-limit-gc` cron job | absent |
| RLS policies re-evaluating a bare `auth.uid()` per row | 95 |
| rows in `payment_event_ledger` | 5 |

Three repo migrations have **no counterpart in production**:
`20260905_001026_treasurer_backfill`, `20260905_001027_launch_security`,
`20260906_001029_run_agent_drafts_parity`. `run_agent_drafts` and `org_ar` both
exist, so parity and the finance views arrived some other way; the treasurer role
did not arrive at all. Treat the migrations directory as a record of intent, not
of state.

## Dead files — do not apply, ever

| file | why |
|---|---|
| `2026-09-04-launch-security.sql` | applied (its objects are live) |
| `2026-09-05-ai-quota.sql` | applied as `20260906004404 ai_quota_burst` |
| `2026-09-05-finance-view-isolation.sql` | applied — `org_ar` exists and is caller-scoped |
| `2026-09-05-outbound-status.sql` | applied — the eight-state constraint is live |
| `2026-09-06-agent-cron-hygiene.sql` | applied as `001033` |
| `2026-09-06-import-batch-uniqueness.sql` | applied as `001035` |
| `2026-09-06-ledger-append-only.sql` | applied as `001032` |
| `2026-09-06-trigger-function-grants.sql` | applied as `001034` |
| `2026-09-07-public-org-read.sql` | applied as `001036` |
| `2026-09-08-ledger-promotion-fix.sql` | **superseded** by `2026-09-09-ledger-insert-once.sql`; its own header says do not apply |
| `2026-09-09-agent-read-source.sql` | a read-only capture of production function bodies. Evidence, not a migration. |

Eleven of the twenty-four are already dead. The real queue is thirteen.

## The order

Each wave is independently useful and independently revertible. Stop after any
wave. **Never start a wave before the one above it is verified.**

### Wave 1 — money is broken today (apply alone, verify, stop)

1. **`2026-09-09-ledger-insert-once.sql`**
   Why first: `trg_ledger_append_only` is live and raises on every UPDATE of
   `payment_event_ledger`, but both money RPCs insert a row and then update its
   outcome. Any Stripe payment event today fails and retries for three days. No
   customer has hit it (5 ledger rows, none since 09-01), which is luck, not
   design.
   Also drops the legacy 9-argument `apply_stripe_booking_event`; production
   currently carries **two** overloads, so a caller can reach the old one.
   Verify: `select count(*) from pg_proc where proname='apply_stripe_booking_event'` → 1.
   Then replay one test webhook and confirm exactly one ledger row with the
   final outcome and no UPDATE attempted.

### Wave 2 — the signed-out visitor (apply together)

2. **`2026-09-08-pentest-hardening.sql`**
   Finding A is worse than the draft's own header says. `anon` does not merely
   hold SELECT on `public.programs`; it holds **DELETE, INSERT, UPDATE and
   TRUNCATE** as well. Row-level security is the only thing standing between a
   signed-out visitor and writing to that table, and `select=*` returns
   six-decimal latitude and longitude, `address_line1` and `zip`. The August
   geo lockdown fuzzed `providers` to two decimals; `programs` hands the precise
   coordinates back for free.
   Finding B: the `anon` policy on `organization_members` is live, so the
   moment one row qualifies it exposes trainer name and email, commission
   value, and the Checkr reference.
   Verify: the `anon` grant list on `programs` reduces to `SELECT` on named
   columns, and an anonymous `select=*` returns no coordinate column.
3. **`2026-09-08-anon-definer-revoke.sql`** — six SECURITY DEFINER functions
   callable by `anon` through `/rest/v1/rpc/`, none of them on an anon path.

### Wave 3 — the agent tells the truth (apply together)

4. **`2026-09-08-generator-targeting.sql`** — verified NOT applied. Idle-capacity
   offers still go to families already enrolled, and waiver nags to lapsed
   members. Verify: `node scripts/agent-golden.mjs` → the two `quality:` checks pass.
5. **`2026-09-08-invite-creates-guardian.sql`** — verified NOT applied
   (`redeem_coach_invite` does not mention `guardians`). Today "Accept this
   invite" attaches nobody to the club.

### Wave 4 — entitlements (Codex's set; strictly ordered, do not split)

Their own headers say they are not standalone. The caller cutover ships in the
same release or the release does not ship.

6. `2026-09-08-plan-entitlements.sql` — the catalog and resolver. Everything
   below depends on it, and so does my connector gate, which fails closed
   without it.
7. `2026-09-08-entitlement-guards.sql` — `PT402` on capacity-increasing writes.
8. `2026-09-08-entitlement-ai-quota.sql` — quota RPC on the new resolver.
9. `2026-09-08-platform-billing.sql`
10. `2026-09-08-platform-billing-checkout.sql`
11. `2026-09-09-agent-entitlements.sql`

**Prices are unconfirmed.** The draft generates constants from
`_shared/billing-pricing.json` and refuses to start Checkout for a price the
owner has not confirmed. Confirm Solo and Organization before this wave, or it
lands inert.

### Wave 5 — connectors (mine; needs wave 4 for the gate)

12. `2026-09-09-org-connectors.sql`
13. `2026-09-09-google-oauth.sql` — depends on 12. Requires
    `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in Supabase
    function secrets, or the three edge functions deploy and honestly refuse.
    Both fixtures pass on a disposable cluster and both were proved capable of
    failing.

### Wave 6 — send quota and delivery (Codex's; blocks the email gate)

14. `2026-09-09-send-quota.sql`
15. `2026-09-09-lifecycle-approval.sql`
16. `2026-09-09-lifecycle-inbox-delivery.sql`
17. `2026-09-09-parent-update-send.sql`

Every sender must reserve from the same pool before delivering, so these four go
together with their worker cutover or not at all.

### Wave 7 — housekeeping (any time after wave 2)

18. `2026-09-08-rate-limit-gc.sql` — `waitlist_rate_limit` has no cleanup at all
    today; every marketing-page submission leaves a row forever.
19. `2026-09-08-treasurer-role.sql` — verified NOT applied despite a repo
    migration named `treasurer_backfill`.
20. `2026-09-08-performance-advisors.sql` — **dry-run part D first.** 95 policies
    still re-evaluate a bare `auth.uid()` per row. The draft's own note says
    plain `CREATE INDEX` is only acceptable while the tables are tiny; that was
    checked on 09-08 and is still true, but it stops being true after the first
    real club.

## The two rules that make this safe

**One wave at a time, verified before the next.** Every wave above has a
verification line. A wave without its check performed is not applied, it is
outstanding.

**The repo is not the state.** Three migrations in `supabase/migrations/` are
not in production, and one applied change (`ai_quota_burst`) has a different
name there. Before applying anything, probe for the object, not the filename.
