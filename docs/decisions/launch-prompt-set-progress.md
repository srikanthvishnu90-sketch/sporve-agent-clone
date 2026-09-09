# Launch prompt set — progress

Updated 2026-09-08. **Prompt 1 active; 0 of 6 prompts complete.** One prompt per session, in order. A checked and struck-through item requires evidence; source written, tests passing, deployed, and live-verified are distinct states. The business gates in GATES.md remain authoritative; no gate is marked passed by this tracker.

## Prompt 1 — Payments and entitlement enforcement

- [ ] Reconcile schema; preserve `free`, `solo`, `organization` keys and label them Free, Individual, Enterprise.
- [ ] Exactly three populated entitlement rows, all limits and allowed capabilities held in data.
- [ ] Four recurring Stripe prices plus $49 camp price; platform billing separated from connected dues.
- [ ] Dedicated signed/replay-safe billing webhook; trial, cancellation, dunning and <60-second projection verified.
- [ ] Working Customer Portal and card-change proof.
- [ ] Atomic server 402 enforcement: member, admin, group, connector, draft, send, Ask, module.
- [ ] Jobs/scan modes filtered before generation; quota findings contain real counts.
- [ ] Downgrade preserves records, reads, exports and dues; 200-member fixture proves behavior.
- [ ] 14-day no-card trial; Free branding; camp-session purchases.
- [ ] Pricing exactly Free / Individual / Enterprise, correct prices, no retired tier comparisons.
- [ ] All ten acceptance checks recorded in the requested commit; reviewed release and live verification.

Current findings: fresh Supabase reads confirm live keys `free|pro|enterprise`, contradicting the prompt's starting premise; all 21 providers are Free. Access works as `supabase_read_only_user` on ref `tseszaprvtvqrkfpditu`; named branch mapping still needs confirmation. Stripe exposes only the live `sporv.ai` account and its active-price search returned zero rows. Subscription events still share `stripe-webhook` and dues-ledger receipts; source pricing still includes Club. Robin recommends a generation hard stop with an honest overflow finding, and period-end cancellation; the original Prompt 5 demand for five actual overflow drafts remains a specification discrepancy, not a passed check.

Supporting work (does not complete a launch acceptance check):

- [x] ~~Record the full prompt and its per-prompt breakdown.~~ Internal intake has all six prompts and 61 individually tracked asks.
- [x] ~~Review the current billing execution path.~~ Repository review found plan-key drift, mixed subscription/dues receipt handling and absent enforcement.
- [x] ~~Test the independent billing webhook handler's failure boundaries.~~ Eleven mocked-handler tests pass, including exact applied-receipt matching; actual Stripe verification and database projection remain unverified.
- [x] ~~Obtain independent execution of the original catalog fixture.~~ Robin reports exit 0 in PR #381; this does not verify subsequent SQL edits.
- [x] ~~Add staged Ask 402 API handling and regression coverage.~~ Version-2 catalog denial returns all five required fields; malformed verdicts fail closed; legacy DB keeps its existing 429 during rollout. 27 Node tests and 34 contract assertions pass.
- [ ] Execute revised catalog, entitlement-aware Ask and platform billing SQL fixtures; PostgreSQL startup remains denied in this session.
- [ ] Complete platform projection review, remaining legacy caller corrections and actual API acceptance; drafts are not deployed.
- [x] ~~Add invoice-finding receipt validation to the billing handler.~~ New regression failed before (200 instead of 503), now combined Node suite passes 28/28; this is mocked-handler evidence, not live billing acceptance.
- [ ] Execute the expanded SQL fixture proving transactional failure finding, tenant-bound receipt, dismissed replay and complete rollback; implement revision-based snapshot ordering and safe subscription replacement before deployment.

Detailed evidence and remaining integration work: [Prompt 1 billing record](launch-prompt-1-billing.md). Required fresh smoke exits 1 at Chromium startup. Supabase/Stripe reads now work, but deployment/testing capabilities remain limited. Robin confirmed there is no separate `sporv` branch: the connected project is production. He acknowledged the handoff and reports PR #383 deployed the separately owned payer-lookup/error-response fixes; Codex's entitlement/API slice has not been released or applied.

## Prompt 2 — Grand feature review (queued)

- [ ] Evidence-scored trainer inventory, including fresh-org and test coverage.
- [ ] Evidence-scored team-organization inventory.
- [ ] Evidence-scored gym/studio/academy inventory.
- [ ] Agent jobs, Ask features and all cross-cutting surfaces inventoried.
- [ ] Five daily workflows for each of nine competitors compared with current evidence.
- [ ] Sellable / segment blockers / claimed-but-not-real sections and three segment verdicts.
- [ ] `docs/review/feature-inventory.md` verified and committed; audit session makes no feature fixes.

## Prompt 3 — Feature completeness and scale (queued)

- [ ] Every in-scope feature reaches evidence-backed maturity 4+ in ranked order.
- [ ] All seven named segment blockers built, tested with two orgs and honest empty/error states.
- [ ] Five indexed hot paths proven with EXPLAIN ANALYZE; ledger target verified.
- [ ] Chunked/resumable crons, per-org failure isolation and fresh entitlement checks.
- [ ] External rate limiting/retries and paginated queue.
- [ ] 5,000-org load test with time, connections and cost in `docs/review/scale-test.md`.
- [ ] Four concurrency cases pass; exclusions disclosed; requested release complete.

## Prompt 4 — Security (queued)

- [ ] Exhaustive table, org, family, staff and agent isolation.
- [ ] Minor-data access, retention/deletion and schema-complete export.
- [ ] Secrets/rotation/browser exclusion; agent approval and money boundaries.
- [ ] Three-channel hostile-input tests and complete SSRF cases.
- [ ] Signed/replay-safe webhooks and complete endpoint rate-limit proof.
- [ ] All auth cases, live headers, clean dependency audit, version pins and PITR restore.
- [ ] Every entitlement denial retested through authenticated APIs.
- [ ] `docs/security/pre-launch-audit.md` contains pasted evidence and all open findings; release complete.

## Prompt 5 — Free tier and paywall experience (queued)

- [ ] Four contextual walls with correct plan, value and CTA.
- [ ] Visible 50%/80%/100% quota states and agreed overflow behavior.
- [ ] Locked surfaces and connector descriptions show real structure and value.
- [ ] Upgrade sheet, correct return location and safe automatic retry after entitlement refresh.
- [ ] Day 11/13/14 trial findings and honest downgrade banner.
- [ ] SQL-matched Billing settings, Portal lifecycle, cancellation reason and period-end behavior.
- [ ] All six acceptance cases proven and requested release complete.

## Prompt 6 — Final launch readiness (queued)

- [ ] Real delivery gate closed with inbox, provider id, mail-tester and bounce evidence.
- [ ] Real payment/decline/refund gate closed with ledger reconciliation.
- [ ] Trainer and club production journeys recorded end to end, including overnight agent and upgrade.
- [ ] Error tracking, phone alerts, 72-hour health, seven-day cron logs.
- [ ] Rehearsed deployment/database rollback and incident runbook.
- [ ] Accurate legal policies, submitted Google verification, booking/support/status paths.
- [ ] Three novice onboarding runs, median below 20 minutes.
- [ ] Marketing claims match inventory, exclusions clear, copy scan clean, real hero screenshot.
- [ ] Five prospects, exports requested/obtained and two booked calls.
- [ ] `docs/decisions/launch-readiness-FINAL.md` records every result and blocker; both live gates closed before final commit claims.
