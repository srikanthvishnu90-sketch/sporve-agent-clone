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
