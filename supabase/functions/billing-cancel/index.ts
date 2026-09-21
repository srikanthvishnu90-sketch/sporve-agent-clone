// ============================================================================
// billing-cancel  (Supabase Edge Function)
// ============================================================================
// Schedules cancellation of the authenticated coach's active Stripe
// subscription(s) at the end of the current billing period
// (cancel_at_period_end). The coach keeps Pro until then; the
// stripe-webhook's `customer.subscription.deleted` event downgrades the
// provider to the free plan at period end. This gives Sporv a native
// cancellation path without leaving sporv.ai.
//
// Owner decision 2026-09-21: end-of-period, not immediate — matches the
// cancellation page promise ("you keep Pro until the end of your billing
// period").
//
// verify_jwt: ON.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Rate limit: 3 cancellations per hour per user (destructive action).
    const { data: withinLimit, error: rateError } = await admin.rpc(
      "consume_edge_rate_limit",
      { p_actor_key: `user:${userData.user.id}`, p_scope: "billing-cancel:hour", p_limit: 3, p_window_seconds: 3600 },
    );
    if (rateError) return json({ error: "Billing is temporarily unavailable." }, 503);
    if (withinLimit !== true) return json({ error: "Too many attempts. Try again later." }, 429);

    const { data: provider, error: pErr } = await admin
      .from("providers")
      .select("id, stripe_customer_id, plan")
      .eq("owner_id", userData.user.id)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 400);
    if (!provider) return json({ error: "Only coaches have billing." }, 403);
    if (!provider.stripe_customer_id) {
      return json({ error: "No active subscription to cancel." }, 409);
    }

    // Find active subscriptions for this customer.
    const subs = await stripe.subscriptions.list({
      customer: provider.stripe_customer_id as string,
      status: "active",
      limit: 10,
    });

    if (subs.data.length === 0) {
      return json({ error: "No active subscription to cancel." }, 409);
    }

    const cancelled: string[] = [];
    for (const sub of subs.data) {
      // End-of-period: no immediate cancel, no refund — access runs to term.
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      cancelled.push(sub.id);
    }

    return json({ cancelled, count: cancelled.length, cancel_at_period_end: true });
  } catch (e) {
    console.error("billing-cancel error:", e);
    return json({ error: "Subscription could not be cancelled. Please try again." }, 500);
  }
});
