// ============================================================================
// stripe-webhook  (Supabase Edge Function) — Phase B #1b
// ============================================================================
// The server-side confirmation that closes the payment loop. Stripe POSTs events
// here; we verify the signature, then update the booking:
//   • checkout.session.completed (paid)  -> payment_status='paid', status='confirmed'
//   • charge.refunded                    -> payment_status='refunded'
//   • checkout.session.expired           -> payment_status='failed', status='expired'
// Subscription (billing) events route to apply_stripe_billing_event instead:
//   • checkout.session.completed (mode=subscription), customer.subscription.
//     created/updated/deleted, invoice.payment_failed -> billing_subscriptions
//     mirror + providers.plan/plan_status/plan_period_end projection.
//
// The booking is matched by booking_id carried in metadata / client_reference_id
// (set by stripe-create-checkout, #1a). Writes use the service-role client and
// are idempotent (the WHERE clause guards re-delivery).
//
// CRITICAL deploy settings:
//   • verify_jwt = false  — Stripe cannot send a Supabase JWT; auth IS the
//     signature check below. Deploy with `--no-verify-jwt`.
//   • STRIPE_WEBHOOK_SECRET must be the signing secret of THIS endpoint
//     (Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret).
// ============================================================================

import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
// Direct-charge booking events arrive from a SECOND Stripe endpoint ("Events on
// connected accounts"), which carries its OWN signing secret. Optional until
// that endpoint is configured; verification tries the platform secret first.
const CONNECT_WEBHOOK_SECRET = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? null;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Resolve the booking id from a Checkout Session (metadata first, then the
// client_reference_id fallback set at creation).
function bookingIdFromSession(s: Stripe.Checkout.Session): string | null {
  return (s.metadata?.booking_id as string | undefined) ??
    (s.client_reference_id ?? null);
}

/* The application fee lives on the PAYMENT INTENT, not the checkout session:
   stripe-create-checkout sets it via payment_intent_data.application_fee_amount
   alongside a destination transfer. So the session object a webhook receives
   does not carry it and it has to be retrieved.

   Returns null on any failure rather than throwing. A booking must still be
   marked paid if this lookup fails — the RPC treats a null fee as "not recorded
   yet", which is recoverable, whereas losing the payment confirmation is not.
   Missing economics is a reconciliation job; a missed payment is a support
   ticket from a parent who was charged. */
async function feeFromPaymentIntent(
  connectedAccountId: string | null | undefined,
  stripe: Stripe,
  paymentIntentId: string | null,
): Promise<number | null> {
  if (!paymentIntentId) return null;
  try {
    // Direct-charge PIs live on the CONNECTED account — retrieve in that scope
    // (event.account). Platform-scoped events pass no account and stay as-is.
    const pi = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
    );
    const fee = (pi as { application_fee_amount?: number | null }).application_fee_amount;
    return typeof fee === "number" ? fee : null;
  } catch (e) {
    console.error("fee lookup failed (payment still applied):", (e as Error).message);
    return null;
  }
}

async function applyEvent(
  event: Stripe.Event,
  bookingId: string,
  objectId: string | null,
  payloadHash: string,
  amountMinor: number | null = null,
  currency: string | null = null,
  paymentIntentId: string | null = null,
  applicationFeeMinor: number | null = null,
) {
  // [CRITICAL-PATH: money] Ownership guard AT THE APPLY POINT (robin final
  // audit, 2026-08-31): the top-of-handler guard only sees metadata.booking_id,
  // but this function receives ids resolved from client_reference_id and PI
  // metadata too. Checking HERE — on the exact id being applied — means a
  // connected account can never write a booking that is not its own, whatever
  // field the id arrived in. Platform-scoped events (no event.account) skip it.
  if (event.account) {
    const { data: owned, error: ownErr } = await admin
      .from("bookings")
      .select("id, programs!inner(providers!inner(stripe_account_id))")
      .eq("id", bookingId)
      .maybeSingle();
    const prog = (owned as Record<string, unknown> | null)?.programs as
      | { providers?: { stripe_account_id?: string | null } | null }
      | null | undefined;
    const acct = prog?.providers?.stripe_account_id ?? null;
    if (ownErr || !owned || acct !== event.account) {
      throw new Error(
        `Booking ${bookingId} does not belong to connected account ${event.account}`,
      );
    }
  }
  // The RPC claims event.id and applies the transition in one DB transaction.
  // A Stripe retry cannot apply a payment/refund twice.
  const { error } = await admin.rpc("apply_stripe_booking_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_booking_id: bookingId,
    p_stripe_object_id: objectId,
    p_amount_minor: amountMinor,
    p_currency: currency,
    p_payload_sha256: payloadHash,
    p_occurred_at: new Date(event.created * 1000).toISOString(),
    p_payment_intent_id: paymentIntentId,
    // [CRITICAL-PATH: money] What Stripe ACTUALLY took, recorded — never
    // recomputed from a PLATFORM_FEE_BPS constant. The constant has already
    // changed once (18%+4% -> flat 12%); recomputing would silently re-price
    // every historical booking every time it changes again.
    p_application_fee_minor: applicationFeeMinor,
  });
  if (error) throw new Error(`payment ledger failed: ${error.message}`);
}

// ── Subscription (billing) events — the pivot off the 12% fee ───────────────
// Subscription events have NO booking, so they go through a SEPARATE
// service-role RPC (apply_stripe_billing_event) with its own event-id
// idempotency, out-of-order guard, and a status map that never defaults an
// unknown status to 'free'. Reusing the booking RPC here was the
// misprojection risk the design review flagged.

// provider_id rides on subscription metadata (set by billing-create-checkout's
// subscription_data.metadata). For subscriptions that predate that, fall back
// to the billing_subscriptions mirror.
async function billingProviderId(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const fromMeta = (sub.metadata?.provider_id as string | undefined) ?? null;
  if (fromMeta) return fromMeta;
  const { data } = await admin
    .from("billing_subscriptions")
    .select("provider_id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  return (data?.provider_id as string | undefined) ?? null;
}

async function applyBillingEvent(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  payloadHash: string,
  statusOverride: string | null = null,
) {
  const providerId = await billingProviderId(sub);
  if (!providerId) {
    // Not ours (or pre-metadata): acknowledge so Stripe stops retrying, but
    // leave a trace for reconciliation.
    console.error("billing event with unresolvable provider:", event.id, sub.id);
    return;
  }
  const price = sub.items?.data?.[0]?.price ?? null;
  const { error } = await admin.rpc("apply_stripe_billing_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_provider_id: providerId,
    p_subscription_id: sub.id,
    p_price_id: price?.id ?? null,
    p_status: statusOverride ?? sub.status,
    p_plan: (sub.metadata?.plan as string | undefined) ?? null,
    p_period_start: sub.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString()
      : null,
    p_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    p_cancel_at_period_end: sub.cancel_at_period_end ?? false,
    p_coupon: sub.discount?.coupon?.id ?? null,
    p_amount_minor: price?.unit_amount ?? null,
    p_currency: price?.currency ?? null,
    p_payload_sha256: payloadHash,
    p_occurred_at: new Date(event.created * 1000).toISOString(),
  });
  if (error) throw new Error(`billing ledger failed: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing stripe-signature", { status: 400 });

  const declaredBytes = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > 1_000_000) {
    return new Response("Payload too large", { status: 413 });
  }

  // Raw body is REQUIRED for signature verification — never parse before this.
  const payload = await req.text();
  if (new TextEncoder().encode(payload).byteLength > 1_000_000) {
    return new Response("Payload too large", { status: 413 });
  }
  const hashBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  const payloadHash = Array.from(new Uint8Array(hashBytes))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  // Two legitimate signers: the platform endpoint (billing/subscriptions) and
  // the Connect endpoint (direct-charge booking events from connected accounts),
  // each with its own signing secret. Verify against both; both failing = 400.
  const secrets = [WEBHOOK_SECRET, CONNECT_WEBHOOK_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  let event: Stripe.Event | null = null;
  let lastErr: Error | null = null;
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(
        payload,
        sig,
        secret,
        undefined,
        cryptoProvider,
      );
      break;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  if (!event) {
    console.error("Signature verification failed:", lastErr?.message);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const expectedLivemode = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").startsWith("sk_live_");
    if (event.livemode !== expectedLivemode) {
      throw new Error(
        `Stripe event mode mismatch: expected ${expectedLivemode ? "live" : "test"} mode`,
      );
    }

    if (event.account) {
      const ownershipClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      const { data: connectedProvider, error: providerError } = await ownershipClient
        .from("providers")
        .select("id")
        .eq("stripe_account_id", event.account)
        .maybeSingle();
      if (providerError || !connectedProvider) {
        throw new Error(`Unknown Stripe connected account: ${event.account}`);
      }

      const eventObj = event.data.object as {
        metadata?: Record<string, string>; client_reference_id?: string | null;
      };
      // INSTALLMENT sessions (spec 03) carry metadata.installment_id and use
      // client_reference_id for the installment — they must NOT fall into the
      // booking guard. Their ownership check: the installment's provider must
      // be the connected account that sent the event.
      const installmentId = eventObj.metadata?.installment_id;
      if (installmentId) {
        const { data: owned, error: instErr } = await ownershipClient
          .from("installments")
          .select("id, fee_schedules!inner(providers!inner(stripe_account_id))")
          .eq("id", installmentId)
          .maybeSingle();
        const acct = ((owned as Record<string, unknown> | null)?.fee_schedules as
          { providers?: { stripe_account_id?: string | null } } | undefined)
          ?.providers?.stripe_account_id ?? null;
        if (instErr || !owned || acct !== event.account) {
          throw new Error(
            `Installment ${installmentId} does not belong to connected account ${event.account}`,
          );
        }
      }
      // Same resolution the handlers use (metadata ?? client_reference_id), so
      // an id riding only in client_reference_id cannot slip past this fast
      // check. The authoritative guard runs again inside applyEvent on the
      // exact id being applied.
      const bookingId = installmentId ? undefined
        : (eventObj.metadata?.booking_id ?? eventObj.client_reference_id ?? undefined);
      if (bookingId) {
        const { data: ownedBooking, error: bookingError } = await ownershipClient
          .from("bookings")
          .select("id, programs!inner(provider_id)")
          .eq("id", bookingId)
          .eq("programs.provider_id", connectedProvider.id)
          .maybeSingle();
        if (bookingError || !ownedBooking) {
          throw new Error(
            `Booking ${bookingId} does not belong to connected account ${event.account}`,
          );
        }
      }
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        // Subscription checkouts carry no booking — route to the billing RPC
        // via the live subscription object (its status decides the plan).
        if (s.mode === "subscription") {
          const subId = typeof s.subscription === "string"
            ? s.subscription
            : s.subscription?.id ?? null;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await applyBillingEvent(event, sub, payloadHash);
          }
          break;
        }
        // INSTALLMENT session (spec 03): route to the installment RPC and stop.
        if (s.metadata?.installment_id) {
          if (s.payment_status === "paid") {
            const { error } = await admin.rpc("apply_installment_event", {
              p_event_id: event.id, p_event_type: event.type,
              p_installment_id: s.metadata.installment_id,
              p_stripe_object_id: typeof s.payment_intent === "string"
                ? s.payment_intent : s.payment_intent?.id ?? s.id,
              p_amount_minor: s.amount_total, p_currency: s.currency,
              p_payload_sha256: payloadHash,
              p_occurred_at: new Date(event.created * 1000).toISOString(),
            });
            if (error) throw new Error(`installment ledger failed: ${error.message}`);
          }
          break;
        }
        // Only confirm a genuinely-paid session.
        if (s.payment_status === "paid") {
          const id = bookingIdFromSession(s);
          if (id) {
            const pi = typeof s.payment_intent === "string"
              ? s.payment_intent
              : s.payment_intent?.id ?? null;
            // Direct-charge PI lives on the connected account: retrieve in that scope.
            const fee = await feeFromPaymentIntent(event.account, stripe, pi);
            await applyEvent(event, id, s.id, payloadHash, s.amount_total, s.currency, pi, fee);
          }
        }
        break;
      }
      case "checkout.session.async_payment_failed": {
        // ACH debit failed after the session completed (spec 03 retry ladder).
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.metadata?.installment_id) {
          const { error } = await admin.rpc("apply_installment_event", {
            p_event_id: event.id, p_event_type: event.type,
            p_installment_id: s.metadata.installment_id,
            p_stripe_object_id: typeof s.payment_intent === "string"
              ? s.payment_intent : s.payment_intent?.id ?? s.id,
            p_amount_minor: s.amount_total, p_currency: s.currency,
            p_payload_sha256: payloadHash,
            p_occurred_at: new Date(event.created * 1000).toISOString(),
          });
          if (error) throw new Error(`installment ledger failed: ${error.message}`);
        }
        break;
      }
      case "payment_intent.payment_failed": {
        // A2 (doc 06): a CARD decline on an installment PI. installment-checkout
        // stamps payment_intent_data.metadata.installment_id, so the id rides
        // the PI. Drafts the fix-your-card follow-up within seconds; the
        // ledger + dedupe key make retries and the nightly cron collide safely.
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.installment_id) {
          const { error } = await admin.rpc("apply_installment_event", {
            p_event_id: event.id, p_event_type: event.type,
            p_installment_id: pi.metadata.installment_id,
            p_stripe_object_id: pi.id,
            p_amount_minor: pi.amount ?? 0, p_currency: pi.currency ?? "usd",
            p_payload_sha256: payloadHash,
            p_occurred_at: new Date(event.created * 1000).toISOString(),
          });
          if (error) throw new Error(`installment ledger failed: ${error.message}`);
        }
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.metadata?.installment_id) {
          const { error } = await admin.rpc("apply_installment_event", {
            p_event_id: event.id, p_event_type: event.type,
            p_installment_id: s.metadata.installment_id,
            p_stripe_object_id: typeof s.payment_intent === "string"
              ? s.payment_intent : s.payment_intent?.id ?? s.id,
            p_amount_minor: s.amount_total, p_currency: s.currency,
            p_payload_sha256: payloadHash,
            p_occurred_at: new Date(event.created * 1000).toISOString(),
          });
          if (error) throw new Error(`installment ledger failed: ${error.message}`);
          break;
        }
        const id = bookingIdFromSession(s);
        if (id) {
          const pi = typeof s.payment_intent === "string"
            ? s.payment_intent
            : s.payment_intent?.id ?? null;
          // Direct-charge PI lives on the connected account: retrieve in that scope.
          const fee = await feeFromPaymentIntent(event.account, stripe, pi);
          await applyEvent(event, id, s.id, payloadHash, s.amount_total, s.currency, pi, fee);
        }
        break;
      }
      case "checkout.session.expired": {
        const s = event.data.object as Stripe.Checkout.Session;
        const id = bookingIdFromSession(s);
        if (id) await applyEvent(event, id, s.id, payloadHash);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        // Booking id rides on the PaymentIntent metadata set at checkout.
        let id = (charge.metadata?.booking_id as string | undefined) ?? null;
        if (!id && charge.payment_intent) {
  const pi = await ((paymentIntentId: string) => {
    if (!event.account) {
      throw new Error("Connected-account refund event is missing event.account");
    }
    return stripe.paymentIntents.retrieve(
      paymentIntentId,
      { stripeAccount: event.account },
    );
  })(
            typeof charge.payment_intent === "string"
              ? charge.payment_intent
              : charge.payment_intent.id,
          );
          id = (pi.metadata?.booking_id as string | undefined) ?? null;
        }
        if (id) {
          await applyEvent(
            event,
            id,
            charge.id,
            payloadHash,
            charge.amount_refunded,
            charge.currency,
            typeof charge.payment_intent === "string"
              ? charge.payment_intent
              : charge.payment_intent?.id ?? null,
          );
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await applyBillingEvent(event, sub, payloadHash);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        // Deleted = definitively over; project 'canceled' regardless of the
        // snapshot's status field.
        await applyBillingEvent(event, sub, payloadHash, "canceled");
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = typeof inv.subscription === "string"
          ? inv.subscription
          : inv.subscription?.id ?? null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          // Stripe may not have flipped the subscription yet when the invoice
          // fails; grace policy is 'past_due keeps the plan until period end',
          // so record past_due explicitly rather than a racy 'active'.
          await applyBillingEvent(
            event,
            sub,
            payloadHash,
            sub.status === "active" ? "past_due" : sub.status,
          );
        }
        break;
      }
      default:
        // Unhandled events are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (e) {
    console.error("webhook handler error:", (e as Error).message);
    // B6 dead-letter: a hard failure used to only console.log, so a
    // permanently-failing event was invisible. Record it durably (an invariant
    // alarms when an unresolved row lingers). Wrapped in its own try so the
    // recorder can NEVER make the webhook worse — a failed record still returns
    // 500 and lets Stripe retry.
    try {
      await admin.rpc("record_webhook_dead_letter", {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payload_sha256: payloadHash,
        p_error: (e as Error).message,
        p_occurred_at: new Date(event.created * 1000).toISOString(),
      });
    } catch (le) {
      console.error("dead-letter record failed (non-fatal):", (le as Error).message);
    }
    // 500 lets Stripe retry a transient DB failure.
    return new Response("handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
