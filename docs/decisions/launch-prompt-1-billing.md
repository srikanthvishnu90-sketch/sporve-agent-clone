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

## Executed evidence

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
