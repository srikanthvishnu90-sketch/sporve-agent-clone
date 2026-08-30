# RED — Standard Connect direct charges, 0% fee (apply in ~/SportsMan-main)

Owner decisions (2026-08-30, from the Codex session): **Standard** connected
accounts, **direct charges**, **0% Sporv fee** (subscription-funded). No Stripe
credentials needed to write this code; deploy + test-mode proof are the human
remainder. Apply in a session rooted at `~/SportsMan-main` (both Claude-in-web
and Codex-in-web are sandboxed to their own repo and cannot write here).

Exact, apply-ready edits below — traced against the current source 2026-08-30.

---

## 1. `supabase/functions/stripe-connect-onboarding/index.ts` (~line 114)

Express → Standard. Standard accounts manage capabilities via Stripe's hosted
dashboard, so drop the `capabilities` block. Account Links onboarding (already
below at ~:157) works for Standard.

REPLACE:
```ts
      const account = await stripe.accounts.create({
        type: "express",
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { provider_id: provider.id, owner_id: uid },
      }, { idempotencyKey: `sporve-connect-account-${uid}` });
```
WITH:
```ts
      // STANDARD connected account: the club is merchant of record, owns the
      // customer relationship + dispute liability, pays Stripe fees.
      const account = await stripe.accounts.create({
        type: "standard",
        email,
        metadata: { provider_id: provider.id, owner_id: uid },
      }, { idempotencyKey: `sporve-connect-account-${uid}` });
```

---

## 2. `supabase/functions/stripe-create-checkout/index.ts`

Destination charge → **direct charge on the connected account**, no application
fee. Two edits.

### 2a. Resolve `destination` BEFORE the existing-session retrieve, and pass the
connected-account context to that retrieve (a direct-charge session lives on the
connected account). Today the retrieve at ~:139 runs before `destination` is
computed at ~:151 — move the provider/destination block up.

CURRENT ORDER (~:136–157):
```ts
    const existingSessionId = booking.stripe_checkout_session_id as string | null;
    if (existingSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(existingSessionId);
      if (existing.status === "open" && existing.url) {
        return json({ checkoutUrl: existing.url, sessionId: existing.id });
      }
    }
    const program = (booking as Record<string, unknown>).programs as ... ;
    const provider = (program?.providers ?? null) as ... ;
    const destination = provider?.stripe_account_id ?? null;
    if (!destination || provider?.stripe_charges_enabled !== true) {
      return json({ error: "This coach can't accept payments yet. Please try later." }, 409);
    }
```
CHANGE TO: move the `program`/`provider`/`destination` lines (and the 409 guard)
ABOVE the `existingSessionId` block, then make the retrieve connected-scoped:
```ts
      const existing = await stripe.checkout.sessions.retrieve(
        existingSessionId, { stripeAccount: destination });
```

### 2b. The session create (~:184–216): remove `application_fee_amount` and
`transfer_data`; create the session ON the connected account via `stripeAccount`.

REPLACE the `payment_intent_data` block:
```ts
      payment_intent_data: {
        ...(feeAmount > 0 ? { application_fee_amount: feeAmount } : {}),
        transfer_data: { destination },
        metadata: { booking_id: bookingId },
      },
```
WITH:
```ts
      payment_intent_data: {
        // DIRECT charge on the connected (club) account: no application fee
        // (0% subscription model) and no transfer_data — funds start on the
        // club account, which is the merchant of record.
        metadata: { booking_id: bookingId },
      },
```
And add `stripeAccount: destination` to the request-options object (alongside the
existing `idempotencyKey`):
```ts
    }, {
      stripeAccount: destination,
      idempotencyKey:
        `sporve-booking-${bookingId}-${existingSessionId ?? "initial"}`,
    });
```
(`PLATFORM_FEE_BPS`/`feeAmount` become unused for bookings — leave the validation
or delete it; with a direct charge a future platform cut would use
`application_fee_amount` on the connected charge, which is why the field is worth
keeping wired even at 0.)

---

## 3. `supabase/functions/stripe-webhook/index.ts` — REQUIRED before deploy (Codex + test mode)

Direct-charge events fire on the CONNECTED account, so the current platform-scoped
webhook will NOT see them and a paid booking would never confirm. This part MUST
be done and verified against live test-mode events (do not ship checkout §2 without it):
1. Configure a **Connect webhook endpoint** in Stripe (Events from → Connected
   accounts) with its own signing secret; keep the existing platform endpoint for
   subscription/billing events (they stay platform-scoped).
2. In the handler, read `event.account` and pass `{ stripeAccount: event.account }`
   to the two `stripe.paymentIntents.retrieve(...)` calls (~:65 and ~:259) for
   booking events only. Subscription (`apply_stripe_billing_event`) events keep
   platform scope.
3. Verify `event.livemode` matches the expected environment; keep event-id
   idempotency; fail loudly on an unknown account or a booking whose
   `provider.stripe_account_id !== event.account`.
4. Update `stripe-refund` to refund in connected-account scope.

## 4. Verify (test mode, human/Codex — needs Stripe creds)
- Rotate to a KNOWN test key. One provider completes Standard onboarding →
  `stripe_charges_enabled=true`. One test-mode booking: checkout → connected
  webhook → booking `payment_status='paid'`. Confirm the charge sits on the
  connected account and Sporv took $0. Then a real club + real card (owner only).

## Notes
- The web-side `fee_schedule` + `fee_bps_for()` (the-sporve-web PR #285) stay
  EMPTY under the 0% decision, so there is no application fee to compute — they
  are the mechanism if a take rate is ever turned on.
- Preserve the app repo's uncommitted WIP (`.claude/ENGINEERING-LEDGER.md`,
  `docs/security/`) — do not stage or revert it.
</content>
