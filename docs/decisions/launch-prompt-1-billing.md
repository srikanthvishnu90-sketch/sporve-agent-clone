# Prompt 1 — billing implementation evidence

Session: 2026-09-08, starting commit `72ecea7`.
Scope: Prompt 1 only. **0/10 acceptance checks complete.** G1 and G4 are the gates this work supports; neither passes from these changes.

## Current execution path and corrections

- `supabase/migrations/00000000000000_baseline.sql:809` and `:834` constrain the catalog/providers to `free|pro|enterprise`. The supplied live state is `free|solo|organization`; live verification must resolve this discrepancy before migration.
- The baseline catalog lacks the requested caps, connector/job/module arrays, scan mode, draft/send quotas and branding/camp fields; it contains no data seed.
- `stripe-webhook/index.ts` handles subscription and connected dues events; `apply_stripe_billing_event` records subscription receipts in `payment_event_ledger`.
- `billing-create-checkout/index.ts` creates inline monthly Product/Price data and reads legacy plan-name comparisons. `billing-portal` exists but its live behavior has not been proved.
- Roster and group writes are direct PostgREST calls, so an Edge-only check would leave a bypass. Cap enforcement needs a transaction-safe database guard plus a canonical API response adapter.
- Price mapping must choose a catalog row by verified Stripe price ID; subscription metadata must never pick an organization or entitlement tier.
- `past_due` is not a completed dunning window: Stripe can end retry attempts by moving a subscription to `unpaid`, `canceled`, or retaining `past_due`, depending on account settings. Those settings must be verified and the terminal behavior tested. [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks?locale=en-GB)
- PostgreSQL can raise HTTP 402 through PostgREST using `PT402`; its standard error envelope still needs normalization to the owner's five-field API body. [PostgREST errors](https://docs.postgrest.org/en/latest/references/errors.html)

## Work prepared

`docs/red-drafts/2026-09-08-plan-entitlements.sql` is a reviewable foundation migration. It refuses unexpected or ambiguous legacy keys, renames only the known legacy aliases, seeds three rows, keeps every requested limit in data, and adds a separate per-provider assignment. Integer `-1` explicitly denotes unlimited, keeping every requested field non-null. A trigger synchronizes the old AI/seat/workspace columns during rollout. This migration has not been executed or promoted into the canonical applied-migration directory.

New providers receive an assignment for a 14-day no-card trial. Existing providers retain their present access instead of receiving an unrequested trial restart. `get_provider_entitlements` resolves expiry against the server clock and falls back even if a cron is late; existing callers still need migration to this resolver. The companion `.test.sql` executes the actual draft in a disposable fixture and asserts catalog values, key preservation, data-only limit changes, trial/expiry boundaries and tenant/self-upgrade denial; those SQL assertions are **not yet executed**.

`supabase/functions/billing-webhook/{handler.mjs,index.ts}` provides a separate platform intake. It requires its own Stripe Billing key/mode/signing secret, rejects Connect events and wrong modes, retrieves the current subscription, discards plan/org metadata, and requires an exact database receipt before acknowledging a projection. It currently depends on **not-yet-implemented** `apply_platform_billing_event` and verified customer/price mappings. It must not be deployed until those exist; the old mixed webhook also still requires coordinated subscription-path removal.

The Node tests inject signature verification, Stripe retrieval and database projection. They prove handler control flow, not the actual Stripe signature implementation, database replay atomicity or end-to-end entitlement updates.

Read-only council review found and corrected three draft defects: provider deletion now cascades only the non-financial assignment; cron has an ungranted internal resolver behind the authenticated wrapper; applied webhook receipts must echo the exact subscription snapshot, payload hash, effective plan and positive assignment revision. Duplicate receipts must match the stored payload hash. The resolver explicitly distinguishes assigned/effective plan and expiry. SQL fixtures additionally check RLS, internal RPC grants, missing assignments, active/inactive staff and JWT-free cron resolution. A worker that persists trial expiry/revision and reconciliation of all existing Stripe subscriptions remain open before caller cutover.

## Continuation — fresh evidence and staged changes

Owner authorization for specific reviewed production/Stripe changes and beta
testing is recorded in the internal intake. Authorization does not establish the
target branch, test mode, or successful deployment. Robin acknowledged the
shared review handoff at 22:39:07; no manual owner relay was needed.

Fresh Supabase query result on `tseszaprvtvqrkfpditu`:

```json
{"role":"supabase_read_only_user","database":"postgres","plans":[{"plan":"free","count":21}],"catalog":[{"plan":"enterprise","seat_limit":null,"ai_monthly_quota":null},{"plan":"free","seat_limit":1,"ai_monthly_quota":3},{"plan":"pro","seat_limit":3,"ai_monthly_quota":null}]}
```

Stripe account inventory: `sporv.ai`, `acct_1U40BiRr7ZgOkD69`, `livemode:true`;
no test account exposed. Active-price search: `data:[]`, `has_more:false`.
Named Supabase branch mapping is still unverified; no production writes attempted.

Subsequent Robin evidence in `docs/robin-review-2026-09-09-codex-handoff.md`
reports `list_branches=[]` for this project: there is no separate `sporv` branch,
so this target is production. Robin also cites a historical genuine test-mode
Checkout event; that proves past test-mode use, not current test credentials or
a separate sandbox connection in this session. No writes were attempted by Codex.
Robin's 22:43:48 ledger entry records PR #383 and independent deployments:
`stripe-provider-payouts` v32 (fixed error response), `installment-checkout` v10
(caller-specific guardian payer lookup), plus 17 self-authenticating functions'
JWT settings pinned in `supabase/config.toml`; his report records 200/401/404
probes. Those are Robin's distinct changes, not evidence that this new billing
projection or its SQL tests passed.

Revised entitlement draft revokes catalog mutation privileges while preserving
pricing reads, and resolves a missing assignment on a real provider to explicit
Free access with no fabricated assignment revision. A nonexistent provider still
fails. Regression assertions were added to the actual-migration fixture.

New entitlement-aware Ask RPC draft reads `ask_quota_month` from the effective
assignment/catalog, keeps the 12/minute burst guard and atomic usage receipt,
and emits catalog-derived upgrade metadata. API supports this versioned verdict
with 402; legacy verdicts remain 429 until the coordinated DB cutover. This is
staged compatibility, **not** completion of the all-endpoints 402 acceptance.

Independent platform projection and fixture are being reviewed in
`docs/red-drafts/2026-09-08-platform-billing.sql` and its `.test.sql`; they are
not applied and not yet deployment-ready. Ordering/reconciliation, modes, receipt
integrity, trial status persistence and legacy caller cutover remain release gates.
Read-only review also found the Ask RPC remains owner-only, as its existing
caller contract was; multi-admin org Ask requires explicit authorized org context
before claiming the full Enterprise surface. The upgrade query now requires a
higher catalog sort order, so a data-only quota edit cannot suggest a downgrade.

```text
node --test scripts/ai-security-test.mjs supabase/functions/billing-webhook/handler.test.mjs
tests 27; pass 27; fail 0; skipped 0; exit 0
node scripts/ai-contract-test.mjs
AI contract: 34 assertions passed; exit 0
git diff --check
exit 0
initdb -D /private/tmp/sporv-p1.3xs5BD/data -U postgres --auth=trust
  -c shared_memory_type=mmap -c dynamic_shared_memory_type=posix
FATAL: could not create shared memory segment: Operation not permitted
DETAIL: Failed system call was shmget(...); exit 1
bash ./src/smoke.sh
build and AI/repository/data/getting-started contracts PASS
Chromium startup SIGTRAP, process kill EPERM; exit 1
```

Robin's original SQL fixture and smoke results in PR #381 are supporting
historical evidence; they do not validate the new edits. Revised SQL assertions
remain unexecuted. No commit/release may claim this continuation passed smoke.

## Continuation: invoice-failure finding receipt

Fresh read-only Supabase inspection confirmed the live `agent_findings` columns,
severity/status constraints and partial unique `(provider_id,source_ref)` index.
The queue reads open findings by provider in `src/sporve-web.host.html:11961`
and renders their title/detail without a code allowlist. Actual live visibility
and its cached refresh behavior are not tested by this source inspection.

The platform draft now inserts a `money/subscription_payment_failed` finding
with event/subscription identity and observed status, before inserting its final
billing receipt in the same transaction. It names no invented amount or recipient
and cannot send mail or create a charge. Receipt/finding provider identity is
enforced with a composite foreign key; direct service-role receipt INSERT is
revoked. Replays return the stored finding ID, including after dismissal.

The SQL fixture now covers the failure finding, dismissal/replay, stale invoice,
cross-org foreign-key rejection, direct service insert denial and a suppressed
finding INSERT. That suppression case compares all provider, assignment,
subscription, cursor, finding and receipt rows before/after the exception.
These SQL assertions remain **unexecuted**, not a claimed pass.

```text
Before handler fix:
node --test supabase/functions/billing-webhook/handler.test.mjs
tests 12; pass 11; fail 1; exit 1
invoice finding regression: actual HTTP 200, expected 503

After handler fix:
node --test supabase/functions/billing-webhook/handler.test.mjs scripts/ai-security-test.mjs
tests 28; pass 28; fail 0; skipped 0; exit 0
git diff --check: exit 0
bash ./src/smoke.sh: build and four contracts PASS; Chromium SIGTRAP/kill EPERM; exit 1
```

Independent review found the timestamp cursor can acknowledge an unprojected
fresher snapshot when Stripe event timestamps tie. Deployment remains held for
a pre-fetch revision/CAS/refetch protocol plus safe subscription-replacement
identity. Duplicate receipts must ultimately return their immutable original
revision/projection, not today's assignment. A periodic job with invented later
event timestamps is not an acceptable fix.

Robin's ledger-promotion draft also conflicts with the explicit no-UPDATE launch
check: it permits `ignored → applied`. The shared handoff requests an insert-once
payment-RPC repair while retaining the strict append-only trigger; his file is
untouched. Owner production/test authorization is recorded, so this is a
technical review issue rather than a missing blanket approval. No new SQL,
Stripe mutation, commit or deployment was performed by Codex in this slice.

## Earlier executed evidence (superseded access errors retained as history)

```text
node --test supabase/functions/billing-webhook/handler.test.mjs
tests 11; pass 11; fail 0; skipped 0; exit 0

Cases: unsigned/invalid signature stops reads; account/mode mismatch stops reads;
dues events ignored; metadata cannot choose plan/org; checkout+invoice lookup;
past_due preserved for dunning; malformed identity/price/period blocked;
missing/wrong/failed receipt returns 503; duplicate receipt accepted;
applied receipt must match projected fields, payload hash and revision;
UTF-8 byte cap and late retrieval cannot start a database write.

Billing adapter TypeScript syntax parsed using stripTypeScriptTypes.
This does not type-check or resolve the remote Stripe/Supabase SDK imports.

git diff --check
exit 0

bash ./src/smoke.sh
build: PASS; 2,226,792 bytes
AI, repository, data and getting-started contracts: PASS
browser startup: FAIL, Chromium SIGTRAP / kill EPERM
exit 1; browser assertions did not run
git status: no index.html or vercel.json change after the build
```

## Access and test infrastructure evidence

```text
Supabase execute_sql (read-only schema inventory):
failed to refresh OAuth tokens; Failed to parse server response

Stripe list_available_accounts_or_orgs:
invalid_grant: Invalid refresh token; OAuth authorization required

PostgreSQL 17 initdb in a fresh /private/tmp/sporv-billing-pg-* directory:
FATAL: could not create shared memory segment: Operation not permitted
DETAIL: Failed system call was shmget(...)
exit 1; no database started
```

The plugin-management instructions were inspected for a reconnection route. This session exposes the existing Supabase/Stripe tools but no plugin search/suggestion/reconnect operation; a connection is not proven healthy merely because its tools are listed. No tool for approving an escalated local command is exposed, so the PostgreSQL/browser sandbox failures remain unresolved here.

## Acceptance checklist

- [ ] 1. Three live seeded rows, all fields verified — foundation draft only.
- [ ] 2. Plan-name comparison grep zero — existing comparisons remain.
- [ ] 3. Free member/Gmail/draft/Ask boundaries with exact 402 and finding evidence — pending enforcement.
- [ ] 4. Individual Outlook denied, Gmail succeeds — connector implementation remains a dependency.
- [ ] 5. Enterprise permitted actions — pending enforcement and authenticated fixtures.
- [ ] 6. Stripe lifecycle <60 seconds and completed dunning — connection, price mapping and DB projection pending.
- [ ] 7. Portal opens and actual card change succeeds — live test pending.
- [ ] 8. 200-member downgrade preserves reads/export/dues; new member 402 — pending fixture.
- [ ] 9. Complete separation of Billing and dues — new handler exists, old shared branches and SQL migration pending.
- [ ] 10. Exactly Free/Individual/Enterprise on pricing — pending UI changes after catalog contract stabilizes.

## Unresolved decisions and release prerequisites

Two owner questions are pending: the Prompt 1 hard stop at draft 20 versus Prompt 5 visible drafts beyond 20; and immediate cancellation versus paid-period-end access. Module enforcement must preserve all downgraded reads/export/dues as explicitly required. A no-card trial must end unless a paid subscription is established; storing a card alone does not identify which paid plan the owner intends to purchase.

Release order still to implement and prove: verify live branch/schema and Stripe mode; review and execute the database foundation/projection/guards; configure verified prices and billing endpoint; migrate checkout/portal/callers and remove subscription handling from dues; run all ten acceptance cases and full smoke; commit the intended files; release and verify the production deployment. No new commit, push, production configuration or payment occurred in this session.
