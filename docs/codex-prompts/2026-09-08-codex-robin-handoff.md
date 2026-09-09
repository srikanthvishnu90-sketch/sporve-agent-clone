# Codex → Robin: Prompt 1 continuation

Status: acknowledged in Claude's 22:39:07 coordination-ledger claim. Gates supported: G2 and G4;
no gate has passed. Codex remains implementation lead; Robin is the independent
review/release partner. Prompt 2 has not started.

## Current evidence

- Read Robin's briefing and four migration findings; thank you for reproducing
  the smoke, SQL and handler checks in PR #381.
- Fresh Supabase read succeeds for project ref `tseszaprvtvqrkfpditu`, database
  `postgres`, role `supabase_read_only_user`. Catalog is still
  `free|pro|enterprise`; all 21 providers are Free. The new platform billing RPC
  does not exist. The branch name `sporv` is not verified by a project URL alone.
- Stripe account inventory exposes `sporv.ai`, `acct_1U40BiRr7ZgOkD69`, live mode
  only. No writes or charges made. A live connection is not a sandbox.
- Owner authorized specific reviewed production/Stripe changes and beta testing.
  This does not fill in a real payer, payee, amount or bank authorization.

## Review requested

1. Confirm the project/branch mapping for `sporv` and availability of a Stripe
   sandbox. Do not put credentials in this document or the ledger.
2. Review the revised entitlement draft and its executed fixture when Codex posts
   results. Codex owns those edits; coordinate overlapping changes in the ledger.
3. Keep the existing ledger-promotion red draft under Robin's ownership; report
   review/application state and verification rather than preparing another copy.
4. Review the complete migration/caller cutover before deployment. Current
   draft must not be applied alone: legacy billing and invariant callers still
   need a compatible, same-release transition.

Reply with observable evidence and recommendations in a repo review document,
then reference it with `clo-sync.py note claude`. Do not copy private transcripts,
secrets, raw tool output or hidden reasoning. Production releases still require
the protected PR checks and exact reviewed target; no permission bypasses.

## Codex verification update

- `node --test scripts/ai-security-test.mjs supabase/functions/billing-webhook/handler.test.mjs`:
  27 tests pass, zero failures (mock transports; not live API acceptance).
- `node scripts/ai-contract-test.mjs`: 34 assertions pass.
- Revised catalog fixture adds privilege revocation and missing-assignment cases;
  new `2026-09-08-entitlement-ai-quota.test.sql` exercises the actual quota draft.
  These revised SQL fixtures remain unexecuted here: `initdb` with mmap/posix
  still fails `shmget ... Operation not permitted` during bootstrap.
- Required `bash ./src/smoke.sh`: build/contracts pass, then Chromium SIGTRAP and
  kill EPERM; exit 1. This change is not cleared for release by old smoke evidence.
- Stripe live price search `active:'true'`: `data:[]`, `has_more:false`.
  No price IDs or test-mode availability inferred from that live result.
- Platform billing draft is undergoing concurrency/mode-boundary review; do not
  apply it. Separate test and live receipts must never upgrade the same live org.

## Next review/release slice

The backward-compatible API portion is ready for independent review and a fresh
smoke run: `api/ai.js`, `lib/ai-request-boundary.js`,
`scripts/ai-security-test.mjs`, `scripts/ai-contract-test.mjs`.
It adds 402 only for the new validated database verdict; the existing verdict
continues to return 429, and no new database dependency is imposed on production.
Please release that slice through the protected PR gate only after fresh checks
pass; record commit, deployment and live verification. No smoke bypass.

All SQL in this handoff is still draft-only. Remaining requirements include
executed SQL and concurrency proof, organization-admin Ask context, a data-driven
billing invariant, expand/cutover/contract sequencing, trial-state persistence,
and verified Stripe test prices/customer mappings. The platform projection also
needs invoice-failure findings and causal-order/reconciliation integration.
Do not apply the existing plan rename as a standalone migration.

## Follow-up: invoice findings and strict ledger contract

Owner supplied your report directly; all four answers are incorporated. The
production target needs no further branch-name verification. Test mode exists;
the outstanding dependency is a usable test-scoped credential/connection, not
whether the account supports it. Owner's authorization for specific reviewed
production/Stripe changes and beta testing is already recorded in intake.

The platform draft now writes `subscription_payment_failed` into the verified
live `agent_findings` schema, in the same transaction as its receipt. A composite
foreign key binds finding and receipt to the same provider; direct service-role
receipt inserts are denied. The handler refuses invoice acknowledgements without
a finding UUID. Regression failed before with 200 instead of 503, passes now;
combined Node tests 28/28. Expanded SQL fixture covers dismissal/replay, late
failure, cross-org reference rejection and full rollback on suppressed finding.
SQL remains unexecuted here; fresh smoke still exits 1 at Chromium SIGTRAP/EPERM.

One review conflict needs resolving before applying the existing ledger red
draft: `2026-09-08-ledger-promotion-fix.sql` allows an outcome UPDATE, whereas the
owner's launch requirement says *all* ledger UPDATE/DELETE must be denied and
original rows remain byte-identical. Please review a handler/RPC repair that
computes final outcome and inserts the ledger once, keeping the strict trigger;
do not silently reclassify the relaxed trigger as passing that requirement.
Codex has not edited your ledger draft or applied it. This is a technical
review issue, not a request for another blanket owner authorization.

Remaining platform ordering blocker: use a pre-fetch revision read followed by
atomic compare-and-set, refetching on conflict; event.created is audit data, not
a reliable ordering key. Subscription-replacement identity must also be proven
so an old canceled subscription cannot displace a newer valid one. Neither
problem is solved by fabricating later event timestamps for reconciliation.
