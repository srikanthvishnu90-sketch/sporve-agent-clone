// ============================================================================
// stripe-connect-onboarding  (Supabase Edge Function)
// ============================================================================
// REVIEW COPY — paste into the Supabase dashboard after review; deploying is
// manual. Fixes the payout write-back bug: previously stripe_account_id was only
// written on first creation (or not at all) and stripe_charges_enabled was never
// refreshed on the return trip, so the providers row stayed NULL/false.
//
// This version, on EVERY invoke:
//   1. Authenticates the caller (JWT) and finds their provider row.
//   2. Creates a Standard account if none exists, and ALWAYS writes
//      stripe_account_id back to the provider row.
//   3. RETRIEVES the account from Stripe and ALWAYS writes
//      stripe_charges_enabled = account.charges_enabled.
//   4. Returns an onboarding URL only while the account still needs onboarding.
//
// All DB writes use the SERVICE-ROLE client so RLS can never block the write.
// ============================================================================

import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpInputError, readBoundedJson } from "../_shared/http.ts";

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
const CONNECT_RETURN_ORIGINS = (Deno.env.get("CONNECT_RETURN_ORIGINS") ?? "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

function allowedReturnUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return CONNECT_RETURN_ORIGINS.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    if (CONNECT_RETURN_ORIGINS.length === 0) {
      console.error("CONNECT_RETURN_ORIGINS is not configured");
      return json({ error: "Payout onboarding is temporarily unavailable." }, 503);
    }
    const body = await readBoundedJson(req, 20_000);
    // ── 1. Authenticate the caller and resolve their provider row ───────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // User-scoped client (validates the JWT and identifies the caller).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated" }, 401);
    }
    const uid = userData.user.id;
    const email = userData.user.email ?? undefined;

    // Service-role client: bypasses RLS for the write-back. NEVER exposed to the
    // client — it lives only in this server-side function.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: withinLimit, error: rateError } = await admin.rpc(
      "consume_edge_rate_limit",
      {
        p_actor_key: `user:${uid}`,
        p_scope: "stripe-connect:minute",
        p_limit: 5,
        p_window_seconds: 60,
      },
    );
    if (rateError) return json({ error: "Payout onboarding is temporarily unavailable." }, 503);
    if (withinLimit !== true) return json({ error: "Too many requests. Try again later." }, 429);

    const { data: provider, error: provErr } = await admin
      .from("providers")
      .select("id, owner_id, stripe_account_id")
      .eq("owner_id", uid)
      .maybeSingle();
    if (provErr) return json({ error: provErr.message }, 400);
    if (!provider) {
      return json({ error: "No provider profile for this user" }, 404);
    }

    // ── 2. Ensure a Stripe account exists; ALWAYS persist its id ────────────
    let accountId: string | null = provider.stripe_account_id ?? null;

    if (!accountId) {
      // STANDARD connected account: the club is merchant of record, owns the
      // customer relationship + dispute liability, and pays Stripe fees.
      const account = await stripe.accounts.create({
        type: "standard",
        email,
        metadata: { provider_id: provider.id, owner_id: uid },
      }, { idempotencyKey: `sporve-connect-account-${uid}` });
      accountId = account.id;
      // Write-back on creation (the bug: this step was missing/conditional).
      const { error: idErr } = await admin
        .from("providers")
        .update({ stripe_account_id: accountId })
        .eq("id", provider.id);
      if (idErr) return json({ error: idErr.message }, 400);
    }

    // ── 3. Retrieve the account and ALWAYS write charges_enabled back ───────
      const account = await stripe.accounts.retrieve(accountId);

      if (!("type" in account) || account.type !== "standard") {
      return json({
        error: "This payout account uses a legacy Stripe configuration. Contact Sporv support to migrate it before accepting bookings.",
        code: "STRIPE_STANDARD_REONBOARD_REQUIRED",
      }, 409);
    }
    const chargesEnabled = account.charges_enabled === true;

    const { error: chErr } = await admin
      .from("providers")
      .update({
        stripe_account_id: accountId, // idempotent; keeps the row authoritative
        stripe_charges_enabled: chargesEnabled,
      })
      .eq("id", provider.id);
    if (chErr) return json({ error: chErr.message }, 400);

    // ── 4. Onboarding URL only while the account still needs onboarding ─────
    const needsOnboarding =
      !chargesEnabled || account.details_submitted !== true;

    let onboardingUrl: string | undefined;
    if (needsOnboarding) {
      const returnUrl = allowedReturnUrl(body.returnUrl);
      if (!returnUrl) return json({ error: "Return URL is not allowed." }, 400);
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: returnUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });
      onboardingUrl = link.url;
    }

    return json({ accountId, chargesEnabled, onboardingUrl });
  } catch (e) {
    if (e instanceof HttpInputError) return json({ error: e.message }, e.status);
    console.error("stripe-connect-onboarding error:", e);
    return json({ error: "Payout onboarding could not be started." }, 500);
  }
});
