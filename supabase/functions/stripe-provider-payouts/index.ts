// ============================================================================
// stripe-provider-payouts  (Supabase Edge Function) — Coach OS money page #1
// ============================================================================
// REVIEW COPY — AUTHORED, NOT DEPLOYED. Read-only. Moves NO money (L-003).
//
// Returns the signed-in coach's REAL Stripe Connect PAYOUT history (bank
// transfers Stripe has made to their connected account) so the money page can
// show honest "Paid out" rows instead of a stub. This is read-only: it calls
// `stripe.payouts.list` on the coach's connected account and maps the result —
// it never creates a charge, transfer, or payout.
//
// Ownership: the caller's JWT identifies them; we resolve THEIR provider row
// (owner_id = auth.uid()) with the service role and only ever list payouts for
// that provider's own `stripe_account_id`. A coach can never read another
// coach's payouts. If the coach has no connected account yet (or charges are not
// enabled), we return an empty list + a reason — the client shows the honest
// empty state, never fabricates a payout.
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
    // ── 1. Authenticate the caller ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated" }, 401);
    }
    const uid = userData.user.id;

    // ── 2. Resolve THEIR provider row + connected account (service role) ─────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: provider, error: provErr } = await admin
      .from("providers")
      .select("id, owner_id, stripe_account_id, stripe_charges_enabled")
      .eq("owner_id", uid)
      .maybeSingle();
    if (provErr) return json({ error: provErr.message }, 400);
    if (!provider) return json({ error: "No provider profile for this user" }, 404);

    const accountId = provider.stripe_account_id as string | null;
    if (!accountId || provider.stripe_charges_enabled !== true) {
      // Honest empty state: no connected account = no payouts to show.
      return json({ payouts: [], reason: "not_connected" });
    }

    // ── 3. List the coach's payouts (read-only) on THEIR connected account ───
    const list = await stripe.payouts.list(
      { limit: 24 },
      { stripeAccount: accountId },
    );
    const payouts = list.data.map((p) => ({
      id: p.id,
      amount_cents: p.amount, // minor units, already net of Stripe fees
      currency: (p.currency ?? "usd").toUpperCase(),
      status: p.status, // paid | pending | in_transit | canceled | failed
      arrival_date: p.arrival_date, // unix seconds
      created: p.created,
      bank_last4:
        typeof p.destination === "object" && p.destination
          ? // deno-lint-ignore no-explicit-any
            (p.destination as any).last4 ?? null
          : null,
    }));
    return json({ payouts });
  } catch (e) {
    console.error("stripe-provider-payouts error:", e);
    return json({ error: "Could not load payouts. Please try again." }, 500);
  }
});
