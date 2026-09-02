# First real payment — the launch gate (doc 03)

**Status: OPEN — blocked on four acts only a human can perform.** Everything
code-side is live-ready and pre-verified below. This file closes when the
$10 ACH lands.

## What is already proven (2026-09-02, test mode + prod DB)
- The full path ran end-to-end in test mode on 08-31 (G2): booking 9afca6d5,
  checkout → webhook → paid in 2s, direct charge on the connected account,
  application fee $0; and the $300 installment E2E (ACH offered first,
  schedule auto-complete, ledger row, AR view).
- **No hardcoded keys**: `grep sk_test|pk_test|sk_live src/ api/ supabase/` →
  only `.env.example` placeholder, the livemode guard string in
  stripe-webhook, and a dummy in a test file. Keys live in Supabase secrets.
- **Ledger immutable to clients**: `UPDATE payment_event_ledger` as a
  signed-in org owner → `permission denied` (probed live 2026-09-02).
- Failed-payment path proven (test): payment_intent.payment_failed →
  instant draft, 1/3/7 ladder via installments.attempt_count, single-owner
  counter. Withdrawal path proven: waives future installments, computes per
  snapshotted policy, writes the decision ledger row.
- Spec-name mismatches (rule 9, noted not built): the ledger table is
  `payment_event_ledger` (not `ledger_entry`); the retry schedule lives in
  `installments.attempt_count` + drafted obligations (there is no
  `installment_events` table). Balance = derived from installments+ledger.

## The four human acts (in order, click-level)
1. **Activate live mode** — dashboard.stripe.com → complete the platform
   account's business profile (legal name, EIN/SSN, bank for platform — even
   at $0 platform fee Stripe requires it). Until "Activate payments" is
   green, live keys don't exist.
2. **Set live secrets** — Developers → API keys → copy `sk_live_...`, then:
   `supabase secrets set STRIPE_SECRET_KEY=sk_live_... --project-ref tseszaprvtvqrkfpditu`
   ⚠️ Webhook endpoints are PER-MODE: after switching, tell Claude — the
   one-shot admin fn recreates both endpoints in live mode and rotates
   STRIPE_WEBHOOK_SECRET / STRIPE_CONNECT_WEBHOOK_SECRET (5 minutes, staged).
3. **KYC for "Sporv Test Club"** — sign up a fresh director account on
   sporv.vercel.app, Settings → Money → Connect with Stripe, and complete
   Stripe's hosted KYC with your real identity + your real bank. Wait for
   charges_enabled AND payouts_enabled (the Money pane shows Connected).
4. **Pay $10 by ACH** — Claude stages the $30/3-installment schedule to your
   guardian email the moment step 3 completes; you open the checkout link,
   pick the bank option (listed first), and authenticate via Financial
   Connections with your real bank.

After your charge: Claude verifies webhook→ledger→balance→Money screen→
overdue-absence, drives the failed-payment and refund legs with you
confirming the refund click, runs reconciliation, pastes the SQL + charge id
here, and flips this file to CLOSED.

## Record (fill on close)
- Date: · Org: Sporv Test Club · Amount: $10.00 ACH
- Stripe charge id: · Connected acct: · App fee: $0.00
- Payout expected: · What broke / what we fixed:
