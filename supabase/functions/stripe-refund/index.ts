// ============================================================================
// stripe-refund  (Supabase Edge Function)
// ============================================================================
// Issues a REAL refund. Before this, `stripe.refunds.create` appeared nowhere in
// the codebase while the UI quoted exact dollar figures to parents — the refund
// button was decoration on a promise nothing could keep.
//
// THE AMOUNT IS NEVER SUPPLIED BY THE CALLER.
// The request body carries a booking id and nothing else. public.booking_refund_quote()
// computes the figure server-side from the cancellation policy SNAPSHOTTED at
// booking time (not the program's policy today, which a coach could edit after
// the fact), the session start, what was paid, and what was already refunded.
// A caller cannot inflate a refund because a caller cannot express one.
//
// AUTHORISATION is checked against the JWT, not against anything in the body:
// only the booking's own searcher may request its refund. verify_jwt=true is set
// on the function AND the user is re-resolved here — the gateway proves the token
// is valid, this proves it belongs to the person whose money is moving.
//
// The DATABASE IS NOT WRITTEN HERE. Stripe emits charge.refunded, and the
// existing stripe-webhook applies it through apply_stripe_booking_event, which is
// idempotent via the payment_event_ledger. One writer for money, one source of
// truth, and a refund cannot be double-recorded by a retry of this endpoint.
// ============================================================================

import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ---- who is asking -------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in to request a refund." }, 401);

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const uid = userData?.user?.id ?? null;
  if (userErr || !uid) return json({ error: "Sign in to request a refund." }, 401);

  // ---- what they are asking about ------------------------------------------
  let bookingId: string | null = null;
  try {
    const body = await req.json();
    bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
    // Deliberately ignoring any amount in the body. Logged, not honoured — a
    // client sending one is either a stale caller or someone probing.
    if (body && ("amount" in body || "refundAmount" in body)) {
      console.warn("refund request carried a client-supplied amount; ignored");
    }
  } catch {
    return json({ error: "Malformed request." }, 400);
  }
  if (!bookingId) return json({ error: "Which booking?" }, 400);

  // Service role reads the row; ownership is asserted explicitly below rather
  // than relying on RLS, so the check is visible at the point of decision.
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .select("id, searcher_id, payment_status, stripe_payment_intent_id, final_price, refund_amount")
    .eq("id", bookingId)
    .maybeSingle();

  if (bErr) return json({ error: "Could not read that booking." }, 500);
  if (!booking) return json({ error: "Booking not found." }, 404);
  if (booking.searcher_id !== uid) {
    // Same message and status as "not found": whether a booking exists is not a
    // fact a stranger should be able to probe by id.
    return json({ error: "Booking not found." }, 404);
  }
  if (booking.payment_status !== "paid") {
    return json({ error: "That booking has not been paid, so there is nothing to refund." }, 409);
  }
  if (!booking.stripe_payment_intent_id) {
    return json({ error: "That booking has no payment on file. Contact support@sporve.com." }, 409);
  }

  // ---- how much, decided by the server -------------------------------------
  const { data: quoteRows, error: qErr } = await admin
    .rpc("booking_refund_quote", { p_booking_id: bookingId });
  if (qErr) return json({ error: "Could not price that refund." }, 500);

  const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
  const minor = Number(quote?.refundable_minor ?? 0);
  if (!Number.isFinite(minor) || minor <= 0) {
    return json({
      refunded: false,
      amount: 0,
      policy: quote?.policy ?? null,
      reason: quote?.reason ?? "No refund is due under the policy on this booking.",
    }, 200);
  }

  // ---- issue it ------------------------------------------------------------
  try {
  const accountLookupClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: accountBooking, error: accountLookupError } = await accountLookupClient
    .from("bookings")
    .select("programs!inner(providers!inner(stripe_account_id))")
    .eq("id", bookingId)
    .maybeSingle();
  const accountProgram = (accountBooking as Record<string, unknown> | null)?.programs as
    | { providers?: { stripe_account_id?: string | null } | null }
    | null
    | undefined;
  const connectedAccountId = accountProgram?.providers?.stripe_account_id ?? null;
  if (accountLookupError || !connectedAccountId) {
    return json({ error: "This booking's club payout account is unavailable." }, 409);
  }

  // DIRECT charge on the club's connected account: the charge (and its refund)
  // live entirely on that account, so the refund runs in connected scope and
  // needs NO reverse_transfer / refund_application_fee (there is no transfer
  // and no application fee under the 0% model).
  const createConnectedRefund = (
    params: Stripe.RefundCreateParams,
    opts: Stripe.RequestOptions = {},
  ) => stripe.refunds.create(params, { ...opts, stripeAccount: connectedAccountId });
  const refund = await createConnectedRefund(
      {
        payment_intent: booking.stripe_payment_intent_id,
        amount: minor,
        reason: "requested_by_customer",
        metadata: { booking_id: booking.id, requested_by: uid },
      },
      {
        // A double-clicked button or a network retry must not refund twice.
        // Keyed to the booking AND the amount, so a legitimate later top-up
        // refund is still possible while an immediate repeat is collapsed.
        idempotencyKey: `refund:${booking.id}:${minor}`,
      },
    );

    // Not written to the database here on purpose — charge.refunded arrives at
    // stripe-webhook and applies through the idempotent ledger.
    return json({
      refunded: true,
      amount: minor / 100,
      currency: refund.currency,
      status: refund.status,
      policy: quote?.policy ?? null,
      reason: quote?.reason ?? null,
      note: "Your refund is with Stripe. It will show on your booking once confirmed.",
    });
  } catch (e) {
    console.error("refund failed:", (e as Error).message);
    return json({ error: "Stripe could not process that refund. Nothing was charged or changed." }, 502);
  }
});
