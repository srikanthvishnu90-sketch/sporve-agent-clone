# Sidekick audit — Codex's Standard direct-charge work (~/SportsMan-main)

Claude audits Codex's live edits to the Stripe functions (I can read the app repo,
not write it). Baseline + running findings so the next steps are frictionless.

## Decisions (final): Standard accounts, direct charges, 0% Sporv fee.

## Status as of 2026-08-30 ~16:50
- **onboarding** (#1): DONE — `type:"express"` → `"standard"`, capabilities block
  removed. Correct.
- **checkout** (#2): DONE (core correct) — destination resolved before the reuse
  retrieve; reuse retrieve + create both `{stripeAccount: destination}`;
  `application_fee_amount` and `transfer_data` removed. Clean direct charge, 0% fee.
  CLEANUPS before PR:
    1. Duplicate `if(!destination…)` 409 guard — Codex added a new one, left the
       old one right after (dead code). Remove the old one.
    2. Stale comment (~line 212) still describes destination-charge/appfee:0 —
       rewrite for direct charge.
    3. `feeAmount`/`PLATFORM_FEE_BPS` now unused in the booking path — dead code.
- **webhook** (#3): NOT STARTED — the make-or-break piece. Direct-charge events
  fire on the CONNECTED account; without a Connect endpoint + `event.account` +
  `{stripeAccount: event.account}` on the two paymentIntent retrieves (booking
  events only; billing stays platform-scoped), a paid booking NEVER confirms.
- **stripe-refund**: needs connected-account refund scope too.
- **branch**: Codex is editing on `test/notes-attendance-demo` (a "not for merge"
  demo branch) with uncommitted ENGINEERING-LEDGER/docs-security WIP — the PR must
  be off `main` so it doesn't drag demo commits. Preserve that WIP; don't stage it.

## When Codex says done, verify (Claude, from here):
- `git -C ~/SportsMan-main diff main -- supabase/functions/stripe-*` matches spec + cleanups applied.
- edge fn versions bumped (Supabase list_edge_functions).
- test-mode: providers row shows stripe_charges_enabled=true after onboarding;
  a test booking → payment_status='paid'; charge on the connected account; Sporv $0.

## ROBIN RUN #1 — 2026-08-30 ~18:10 (4/5 auditors reported; hygiene pending)

**onboarding: WRONG (blocker).** type:"standard" + capabilities-removal correct, BUT
Codex's edit deleted `const account = await stripe.accounts.retrieve(accountId)` —
`account` is now block-scoped inside `if(!accountId)`, so :131 account.type,
:137 charges_enabled, :150 details_submitted are out of scope. Won't type-check;
every invoke 500s. FIX: restore the retrieve immediately before the guard at :131.

**checkout: INCOMPLETE.** Fee+transfer_data removed, stripeAccount on both calls,
dup guard cleaned (all ✅). REMAINING: (a) the 409 guard is still BELOW the reuse
retrieve — stale session + null stripe_account_id → retrieve({stripeAccount:null})
→ resource_missing → generic 500 instead of friendly 409; move guard above.
(b) stale destination-charge comments (:7-10, :188, :206-211). (c) PLATFORM_FEE_BPS
validator (:173-183) still FAILS CLOSED WITH 503 when unset — a dead fee that can
block all checkout; remove it with the dead fee code.

**webhook: WRONG (make-or-break, effectively untouched).** One broken 8-line edit:
`event.account` referenced inside feeFromPaymentIntent (:68) where `event` is not
in scope — and it's inside the fn's own try, so it FAILS SILENT (returns null).
Second paymentIntents.retrieve (:266, charge.refunded) still platform-scoped.
No event.livemode check. No account-match guard (any connected account could drive
apply_stripe_booking_event for any booking_id in metadata — security hole once
Connect endpoint exists). Billing correctly left platform-scoped (the one pass).

**refund: INCOMPLETE (hard-fails every refund under direct charges).** No
stripeAccount option on refunds.create (:121-147); no provider join to even get the
account id (:83-87 selects none); reverse_transfer/refund_application_fee flags
(:136-137) are destination-charge params, invalid on a direct charge. Auth +
server-derived amount are solid — keep.

NET: do NOT deploy. Onboarding 500s, bookings would never confirm, refunds all fail.

**hygiene: RISK.** All Stripe work is UNCOMMITTED working-tree edits on the
forbidden demo branch (`test/notes-attendance-demo` @ 780c3c1); no branch, no PR.
Both compile-breaking scope errors confirmed independently (onboarding `account`,
webhook `event`). Preserved WIP intact (ledger + docs/security untouched) ✅. No
scope creep ✅. No deploy evidence (and with two compile errors, deploy would fail).

## ROBIN RUN #1 CONSOLIDATED: DO NOT DEPLOY.
Fix list for Codex, in order:
1. onboarding: restore `const account = await stripe.accounts.retrieve(accountId);`
   before the guard at :131.
2. webhook: pass the connected account INTO feeFromPaymentIntent as a parameter
   (or scope retrieves inside applyEvent); scope the second retrieve (:266);
   add event.livemode check; add booking-provider↔event.account match guard.
3. refund: join provider stripe_account_id; pass {stripeAccount}; drop
   reverse_transfer/refund_application_fee.
4. checkout: move the 409 guard above the reuse retrieve; delete the
   PLATFORM_FEE_BPS 503 validator + stale destination-charge comments.
5. Cut a clean branch off main, commit ONLY supabase/functions/stripe-*, PR.
   (0% fee posture is intended — confirmed owner decision, not a revenue hole.)

## ROBIN RUN #2 — 2026-08-30 ~18:20 (Codex editing live during audit)

- **onboarding: CORRECT** ✅ — `accounts.retrieve(accountId)` restored at :131 (top-level
  scope); `type:"standard"`, no capabilities. Compile blocker cleared. (minor: odd indent :131-133)
- **checkout: INCOMPLETE** — 409 guard moved above the retrieve ✅, BUT (a) PLATFORM_FEE_BPS
  503 validator still at :177-186 (blocks checkout if env unset — dead fee), (b) stale
  destination-charge comments remain (:9,:49,:192,:210-215), (c) a DUPLICATE destination
  guard was reintroduced at :162-166 (dead code — :148 already returns).
- **webhook: INCOMPLETE (make-or-break still broken)** — scope crash "fixed" by amputation:
  `feeFromPaymentIntent` now hardcodes `return 0` with dead code below referencing undefined
  `pi` (fresh type-check failure). Still MISSING: `{stripeAccount: event.account}` on the
  `charge.refunded` retrieve (:262-266); `event.livemode` check; account-match guard
  (`event.account` never read). Billing stays platform-scoped ✅; idempotency intact ✅.
- **refund: WRONG (byte-identical to HEAD — untouched)** — no `{stripeAccount}`, no provider
  join, `reverse_transfer`/`refund_application_fee` destination-charge flags still present.
  Every direct-charge refund would 404. Auth + server-derived amount fine.
- **hygiene: NEEDS-FIX** — still uncommitted on `test/notes-attendance-demo`, no branch/PR.
  Pre-existing WIP preserved ✅. No scope creep ✅.

### ROBIN RUN #2 CONSOLIDATED: STILL DO NOT DEPLOY. Delta: onboarding fixed; everything else open.
Tightened fix list for Codex:
1. webhook (CRITICAL): don't stub fee to 0 with dead code — delete the dead `pi` lines;
   read `event.account`, scope BOTH paymentIntent retrieves for booking events, add
   `event.livemode` check + reject when `event.account != booking provider stripe_account_id`.
2. refund: STILL UNTOUCHED — join provider `stripe_account_id`, pass `{stripeAccount}`,
   remove `reverse_transfer`/`refund_application_fee`.
3. checkout: remove the PLATFORM_FEE_BPS 503 validator + stale destination-charge comments +
   the reintroduced duplicate 409 guard (:162-166).
4. Cut a clean branch off main; commit ONLY supabase/functions/stripe-*; PR. Re-run robin.
