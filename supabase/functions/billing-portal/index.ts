// ============================================================================
// billing-portal  (Supabase Edge Function) — subscription pivot #2
// ============================================================================
// Returns a Stripe Billing Portal session URL for the authenticated coach.
// Card changes, plan cancellation and invoices all live in the portal —
// Sporve builds no custom UI for any of them, so there is no custom UI to get
// subtly wrong about money.
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
const CHECKOUT_ORIGINS = (Deno.env.get("CHECKOUT_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    if (CHECKOUT_ORIGINS.length === 0) {
      console.error("CHECKOUT_ORIGINS is not configured");
      return json({ error: "Billing is temporarily unavailable." }, 503);
    }
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
    const { data: provider, error: pErr } = await admin
      .from("providers")
      .select("id, stripe_customer_id")
      .eq("owner_id", userData.user.id)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 400);
    if (!provider) return json({ error: "Only coaches have billing." }, 403);
    if (!provider.stripe_customer_id) {
      return json({ error: "No billing history yet — subscribe first." }, 409);
    }

    const body = await req.json().catch(() => ({}));
    const fallbackUrl = CHECKOUT_ORIGINS[0];
    let returnUrl = fallbackUrl;
    if (typeof body?.returnUrl === "string" && body.returnUrl.trim()) {
      try {
        const url = new URL(body.returnUrl);
        if (CHECKOUT_ORIGINS.includes(url.origin)) returnUrl = url.toString();
      } catch { /* keep fallback */ }
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: provider.stripe_customer_id as string,
      return_url: returnUrl,
    });
    return json({ portalUrl: session.url });
  } catch (e) {
    console.error("billing-portal error:", e);
    return json({ error: "Billing portal could not be opened." }, 500);
  }
});
