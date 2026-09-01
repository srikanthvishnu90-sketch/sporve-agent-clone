// ============================================================================
// billing-create-checkout  (Supabase Edge Function) — subscription pivot #1
// ============================================================================
// Opens a Stripe Billing Checkout Session (mode: subscription) for the
// authenticated COACH. This is the provider-side twin of stripe-create-checkout
// (which stays the family-booking rail).
//
// House rules carried over:
//   * The client sends identifiers only ({ plan }); price and entitlements are
//     read from public.plan_entitlements — the single source of truth the web
//     page and the AI endpoint also read. No client-sent amounts, ever.
//   * Redirect URLs are validated against the same CHECKOUT_ORIGINS allowlist.
//   * plan_entitlements.purchasable gates what can be SOLD: enterprise is
//     seeded false until its workspace feature is real, so no checkout path
//     can sell a claim the product cannot keep.
//   * founding_coach providers get the 'founding-coach' 100% coupon attached —
//     they exercise the REAL billing pipeline and produce a $0 invoice; there
//     is no DB-only plan bypass.
//
// verify_jwt: ON (the coach's session authorizes the subscription).
// ============================================================================

import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CHECKOUT_ORIGINS = (Deno.env.get("CHECKOUT_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function checkoutRedirect(value: unknown, fallback: string): string | null {
  const candidate = typeof value === "string" && value.trim() ? value : fallback;
  try {
    const url = new URL(candidate);
    const allowed = CHECKOUT_ORIGINS.length
      ? CHECKOUT_ORIGINS
      : [new URL(fallback).origin];
    return allowed.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

// The 100%-off forever coupon founding coaches ride on. Created lazily and
// idempotently by id, so no dashboard step can be forgotten.
async function ensureFoundingCoupon(): Promise<string> {
  const id = "founding-coach";
  try {
    await stripe.coupons.retrieve(id);
  } catch {
    await stripe.coupons.create({
      id,
      percent_off: 100,
      duration: "forever",
      name: "Founding coach",
    });
  }
  return id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    if (CHECKOUT_ORIGINS.length === 0) {
      console.error("CHECKOUT_ORIGINS is not configured");
      return json({ error: "Billing is temporarily unavailable." }, 503);
    }

    // ── 1. Authenticate the caller ─────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
    const uid = userData.user.id;
    const email = userData.user.email ?? undefined;

    const body = await req.json().catch(() => ({}));
    const plan: string = typeof body?.plan === "string" ? body.plan : "";
    const fallbackUrl = CHECKOUT_ORIGINS[0];
    const successUrl = checkoutRedirect(body?.successUrl, fallbackUrl);
    const cancelUrl = checkoutRedirect(body?.cancelUrl, fallbackUrl);
    if (!successUrl || !cancelUrl) {
      return json({ error: "Billing redirect URL is not allowed." }, 400);
    }

    // ── 2. The caller must BE a coach; entitlements decide what is sellable ─
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: provider, error: pErr } = await admin
      .from("providers")
      .select("id, business_name, stripe_customer_id, founding_coach, plan, plan_status")
      .eq("owner_id", uid)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 400);
    if (!provider) return json({ error: "Only coaches can subscribe." }, 403);

    const { data: ent, error: eErr } = await admin
      .from("plan_entitlements")
      .select("plan, purchasable, price_usd_month")
      .eq("plan", plan)
      .maybeSingle();
    if (eErr) return json({ error: eErr.message }, 400);
    if (!ent || plan === "free") {
      return json({ error: "That plan can't be purchased." }, 400);
    }
    if (!ent.purchasable) {
      // Honest by design: enterprise stays unsellable until the multi-player
      // workspace exists. The page may collect interest; money may not move.
      return json(
        { error: "Enterprise isn't open for self-serve checkout yet. Contact Sporve to join the early-access list." },
        409,
      );
    }
    const unitAmount = Math.round(Number(ent.price_usd_month) * 100);
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      console.error("plan_entitlements has no valid price for", plan);
      return json({ error: "Billing is temporarily unavailable." }, 503);
    }
    if (provider.plan === plan && provider.plan_status === "active") {
      return json({ error: "You're already on this plan." }, 409);
    }

    // ── 3. Create or reuse the Stripe Customer; persist with service role ──
    let customerId = provider.stripe_customer_id as string | null;
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if ((existing as { deleted?: boolean }).deleted) customerId = null;
      } catch {
        customerId = null;
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: (provider.business_name as string) || undefined,
        metadata: { provider_id: provider.id },
      });
      customerId = customer.id;
      const { error: cErr } = await admin
        .from("providers")
        .update({ stripe_customer_id: customerId })
        .eq("id", provider.id);
      if (cErr) return json({ error: cErr.message }, 400);
    }

    // ── 4. Open the subscription Checkout Session ──────────────────────────
    const discounts = provider.founding_coach
      ? [{ coupon: await ensureFoundingCoupon() }]
      : undefined;
    const planName = plan === "pro" ? "Sporve Pro" : "Sporve Enterprise";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { provider_id: provider.id, plan },
      subscription_data: {
        metadata: { provider_id: provider.id, plan },
      },
      discounts,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            recurring: { interval: "month" },
            product_data: { name: planName },
          },
        },
      ],
    });

    return json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (e) {
    console.error("billing-create-checkout error:", e);
    return json({ error: "Billing could not be started. Please try again." }, 500);
  }
});
