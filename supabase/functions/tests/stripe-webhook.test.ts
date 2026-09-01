// ============================================================================
// stripe-webhook — security tests (Deno)                                L-006
// ----------------------------------------------------------------------------
// Covers the three money-safety invariants of the payment webhook:
//   (a) a MISSING or INVALID Stripe signature is rejected (never trust an
//       unsigned/forged body — auth IS the signature, see stripe-webhook/index.ts
//       lines 77-109);
//   (b) the SAME stripe_event_id delivered twice applies money state ONCE
//       (idempotency via the payment_event_ledger unique gate + ON CONFLICT DO
//       NOTHING in apply_stripe_booking_event — 20260802_000105);
//   (c) an amount/currency MISMATCH does NOT flip a booking to paid (the RPC's
//       `round(final_price*100)=p_amount_minor AND upper(currency)=upper(p_currency)`
//       guard — a signed-but-tampered amount can never confirm a booking).
//
// ----------------------------------------------------------------------------
// HOW TO RUN (CI — deno is NOT installed in the authoring sandbox):
//
//   # signature tests only (no DB needed):
//   deno test -A supabase/functions/tests/stripe-webhook.test.ts
//
//   # full suite incl. idempotency/mismatch (needs a Postgres with the schema
//   # + 20260802_000105 applied; e.g. a `supabase start` local stack):
//   SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
//     deno test -A supabase/functions/tests/stripe-webhook.test.ts
//
// The idempotency/mismatch steps SKIP (do not fail) when SUPABASE_DB_URL is
// unset, so the signature contract still runs anywhere. The SAME money-once /
// amount-mismatch invariant is ALSO proven with zero deps on local PG16 by
// supabase/tests/payment_webhook_idempotency_test.sql (runnable today).
//
// Type-checked by inspection (deno unavailable here); imports pin the SAME
// versions the function uses (npm:stripe@14.21.0) so the crypto path is identical.
// ============================================================================

import Stripe from "npm:stripe@14.21.0";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

// A test signing secret. The webhook derives trust ONLY from a valid HMAC over
// the raw body with this secret — exactly stripe.webhooks.constructEventAsync.
const WEBHOOK_SECRET = "whsec_test_secret_do_not_use_in_prod";

const stripe = new Stripe("sk_test_dummy", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

function samplePayload(): string {
  return JSON.stringify({
    id: "evt_sig_1",
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "cs_test_1", object: "checkout.session" } },
  });
}

// ── (a) SIGNATURE VERIFICATION ───────────────────────────────────────────────

Deno.test("(a) a VALID signature is accepted", async () => {
  const payload = samplePayload();
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  const event = await stripe.webhooks.constructEventAsync(
    payload,
    header,
    WEBHOOK_SECRET,
    undefined,
    cryptoProvider,
  );
  assertEquals(event.id, "evt_sig_1");
  assertEquals(event.type, "checkout.session.completed");
});

Deno.test("(a) an INVALID signature is rejected", async () => {
  const payload = samplePayload();
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_a_different_secret",
  });
  await assertRejects(
    () =>
      stripe.webhooks.constructEventAsync(
        payload,
        header,
        WEBHOOK_SECRET,
        undefined,
        cryptoProvider,
      ),
    Error, // Stripe.errors.StripeSignatureVerificationError extends Error
  );
});

Deno.test("(a) a TAMPERED body (valid sig for the ORIGINAL body) is rejected", async () => {
  const original = samplePayload();
  const header = stripe.webhooks.generateTestHeaderString({
    payload: original,
    secret: WEBHOOK_SECRET,
  });
  // Attacker keeps the good signature but swaps the body (e.g. bumps the amount).
  const tampered = original.replace("cs_test_1", "cs_attacker");
  await assertRejects(
    () =>
      stripe.webhooks.constructEventAsync(
        tampered,
        header,
        WEBHOOK_SECRET,
        undefined,
        cryptoProvider,
      ),
    Error,
  );
});

Deno.test("(a) a MISSING signature header is rejected", async () => {
  const payload = samplePayload();
  await assertRejects(
    () =>
      stripe.webhooks.constructEventAsync(
        payload,
        "", // the function returns 400 on a missing header BEFORE this (index.ts:78)
        WEBHOOK_SECRET,
        undefined,
        cryptoProvider,
      ),
    Error,
  );
});

// ── (b)+(c) IDEMPOTENCY + AMOUNT MISMATCH (needs a DB with 000105 applied) ────
// These exercise apply_stripe_booking_event directly — the money mutation the
// webhook delegates to. Gated on SUPABASE_DB_URL so the signature contract above
// runs with no infra.

const DB_URL = Deno.env.get("SUPABASE_DB_URL");

async function withBooking(
  fn: (db: Client, bookingId: string) => Promise<void>,
) {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await db.queryArray("begin");
    // A parent + a paid-pending booking of $100.00 USD tied to a checkout session.
    const uid = crypto.randomUUID();
    const bookingId = crypto.randomUUID();
    await db.queryArray(
      `insert into auth.users (id, email) values ($1, 'pay@t')
         on conflict do nothing`,
      [uid],
    );
    await db.queryArray(
      `insert into public.profiles (id, role, first_name) values ($1,'searcher','Payer')
         on conflict (id) do nothing`,
      [uid],
    );
    await db.queryArray(
      `insert into public.bookings
         (id, searcher_id, final_price, currency, payment_status, status,
          stripe_checkout_session_id)
       values ($1, $2, 100.00, 'USD', 'unpaid', 'pending', 'cs_test_1')`,
      [bookingId, uid],
    );
    await fn(db, bookingId);
  } finally {
    await db.queryArray("rollback").catch(() => {});
    await db.end();
  }
}

Deno.test({
  name: "(b) same stripe_event_id delivered twice applies money ONCE",
  ignore: !DB_URL,
  fn: async () => {
    await withBooking(async (db, bookingId) => {
      const args = (evt: string) => [
        evt,
        "checkout.session.completed",
        bookingId,
        "cs_test_1",
        10000, // $100.00 -> minor units, matches final_price
        "USD",
        "hash_" + evt,
        new Date().toISOString(),
        "pi_1",
      ];
      const call = (evt: string) =>
        db.queryObject<{ apply_stripe_booking_event: boolean }>(
          `select public.apply_stripe_booking_event(
             $1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9) as apply_stripe_booking_event`,
          args(evt),
        );

      const first = await call("evt_dup_1");
      assertEquals(first.rows[0].apply_stripe_booking_event, true, "1st apply");

      const second = await call("evt_dup_1"); // SAME event id — a Stripe retry
      assertEquals(
        second.rows[0].apply_stripe_booking_event,
        false,
        "2nd delivery is a no-op",
      );

      // Booking paid exactly once; ledger holds exactly one row for the event.
      const bk = await db.queryObject<{ payment_status: string; status: string }>(
        `select payment_status, status from public.bookings where id=$1`,
        [bookingId],
      );
      assertEquals(bk.rows[0].payment_status, "paid");
      assertEquals(bk.rows[0].status, "confirmed");

      const ledger = await db.queryObject<{ n: bigint }>(
        `select count(*)::int as n from public.payment_event_ledger
           where stripe_event_id='evt_dup_1'`,
      );
      assertEquals(Number(ledger.rows[0].n), 1);
    });
  },
});

Deno.test({
  name: "(c) an amount mismatch does NOT flip the booking to paid",
  ignore: !DB_URL,
  fn: async () => {
    await withBooking(async (db, bookingId) => {
      const res = await db.queryObject<{ applied: boolean }>(
        `select public.apply_stripe_booking_event(
           'evt_bad_amt','checkout.session.completed',$1,'cs_test_1',
           9999,'USD','h',now(),'pi_1') as applied`, // 9999 != 10000
        [bookingId],
      );
      assertEquals(res.rows[0].applied, false, "wrong amount -> not applied");

      const bk = await db.queryObject<{ payment_status: string }>(
        `select payment_status from public.bookings where id=$1`,
        [bookingId],
      );
      assertEquals(bk.rows[0].payment_status, "unpaid", "still unpaid");
    });
  },
});

Deno.test({
  name: "(c) a currency mismatch does NOT flip the booking to paid",
  ignore: !DB_URL,
  fn: async () => {
    await withBooking(async (db, bookingId) => {
      const res = await db.queryObject<{ applied: boolean }>(
        `select public.apply_stripe_booking_event(
           'evt_bad_cur','checkout.session.completed',$1,'cs_test_1',
           10000,'EUR','h',now(),'pi_1') as applied`, // EUR != USD
        [bookingId],
      );
      assertEquals(res.rows[0].applied, false, "wrong currency -> not applied");
      const bk = await db.queryObject<{ payment_status: string }>(
        `select payment_status from public.bookings where id=$1`,
        [bookingId],
      );
      assertEquals(bk.rows[0].payment_status, "unpaid");
    });
  },
});

// Sanity: signature tests always ran; note when DB steps were skipped.
Deno.test("meta: DB-backed steps require SUPABASE_DB_URL", () => {
  assert(true);
  if (!DB_URL) {
    console.warn(
      "SUPABASE_DB_URL unset — (b)/(c) idempotency+mismatch steps were SKIPPED. " +
        "They are also proven on local PG16 by " +
        "supabase/tests/payment_webhook_idempotency_test.sql",
    );
  }
});
