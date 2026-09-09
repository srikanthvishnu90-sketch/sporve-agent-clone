// ============================================================================
// installment-checkout  (Supabase Edge Function) — Spec 03 (2026-08-31)
// ============================================================================
// Creates a Stripe Checkout Session for ONE installment, as a DIRECT charge on
// the club's Standard connected account with application fee 0 (subscription
// model). ACH (us_bank_account) is listed FIRST — ~0.8% capped vs card 2.9% —
// so the rail mix is right before any take rate exists.
//
// AUTH: the org owner, or a claimed guardian linked as payer to the member.
// The AMOUNT comes only from the installments row — never from the client.
// The webhook (metadata.installment_id) is the sole writer of 'paid'.
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
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CHECKOUT_ORIGINS = (Deno.env.get("CHECKOUT_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Not authenticated" }, 401);
    const uid = u.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: withinLimit, error: rateError } = await admin.rpc(
      "consume_edge_rate_limit",
      { p_actor_key: `user:${uid}`, p_scope: "installment-checkout:minute", p_limit: 10, p_window_seconds: 60 },
    );
    if (rateError) return json({ error: "Checkout is temporarily unavailable." }, 503);
    if (withinLimit !== true) return json({ error: "Too many checkout attempts. Try again later." }, 429);

    const body = await req.json().catch(() => ({}));
    const installmentId = typeof body?.installmentId === "string" ? body.installmentId : null;
    if (!installmentId) return json({ error: "installmentId is required" }, 400);
    const origin = CHECKOUT_ORIGINS.includes(String(body?.origin)) ? String(body.origin) : CHECKOUT_ORIGINS[0];
    if (!origin) return json({ error: "Checkout is not configured." }, 503);

    const { data: inst, error: iErr } = await admin
      .from("installments")
      .select("id, amount_cents, status, member_id, fee_schedules!inner(id, provider_id, status, providers!inner(owner_id, business_name, stripe_account_id, stripe_charges_enabled))")
      .eq("id", installmentId)
      .maybeSingle();
    if (iErr) return json({ error: iErr.message }, 400);
    if (!inst) return json({ error: "Installment not found" }, 404);
    const fs = (inst as Record<string, unknown>).fee_schedules as {
      id: string; provider_id: string; status: string;
      providers: { owner_id: string; business_name: string | null;
        stripe_account_id: string | null; stripe_charges_enabled: boolean };
    };
    if (fs.status !== "active") return json({ error: "This plan is no longer active." }, 409);
    if (inst.status === "paid") return json({ error: "Already paid." }, 409);

    // AUTH: owner, or a claimed payer-guardian of this member
    const isOwner = fs.providers.owner_id === uid;
    if (!isOwner) {
      // robin 2026-09-08: filter by the CALLER's guardian row rather than
      // fetching "the" payer link. guardian_links is unique on
      // (guardian_id, member_id), so a member with two payer-flagged guardians
      // made maybeSingle() error and locked out a legitimate payer with a 403.
      const { data: link, error: linkErr } = await admin
        .from("guardian_links")
        .select("id, guardians!inner(user_id)")
        .eq("member_id", inst.member_id)
        .eq("is_payer", true)
        .eq("guardians.user_id", uid)
        .limit(1)
        .maybeSingle();
      if (linkErr) {
        console.error("installment-checkout payer lookup failed", linkErr.code ?? "unknown");
        return json({ error: "Could not verify who pays this plan. Try again." }, 503);
      }
      if (!link) {
        return json({ error: "Not authorized for this installment." }, 403);
      }
    }

    const acct = fs.providers.stripe_account_id;
    if (!acct || fs.providers.stripe_charges_enabled !== true) {
      return json({ error: "This club can't accept payments yet." }, 409);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // ACH FIRST — the visually primary rail (spec 03).
      payment_method_types: ["us_bank_account", "card"],
      success_url: origin + "/?installment=" + encodeURIComponent(installmentId) + "&paid=1",
      cancel_url: origin + "/?installment=" + encodeURIComponent(installmentId) + "&paid=0",
      client_reference_id: installmentId,
      metadata: { installment_id: installmentId },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: inst.amount_cents,
          product_data: { name: (fs.providers.business_name || "Club") + " — installment" },
        },
      }],
      payment_intent_data: {
        // DIRECT charge, 0% application fee — the one function a take rate
        // would later edit (spec 03 acceptance).
        metadata: { installment_id: installmentId },
      },
    }, {
      stripeAccount: acct,
      idempotencyKey: "sporv-installment-" + installmentId,
    });

    return json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (e) {
    console.error("installment-checkout error:", e);
    return json({ error: "Checkout could not be started." }, 500);
  }
});
