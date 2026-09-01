// ============================================================================
// coach-invoice-create  (Supabase Edge Function) — Coach OS money page #4
// ============================================================================
// REVIEW COPY — AUTHORED, NOT DEPLOYED, AND FLAGGED OFF.
//
// Off-platform invoicing: bill a family Sporve did NOT source, through the coach
// OS. This TOUCHES money movement, so it is gated three ways (L-003):
//   1. FLAG: unless OFFPLATFORM_INVOICING_ENABLED === "true" it returns 503 and
//      creates nothing. The flag is FALSE in every environment until the
//      test-mode proof in docs/COACH-OS-INVOICING-DESIGN.md §6 passes.
//   2. TEST MODE FIRST: enable the flag only with Stripe TEST keys; verify a real
//      test-mode invoice is created + paid end-to-end before any live key.
//   3. SERVER-DERIVED MONEY: the amount is summed from the coach's line items and
//      the application fee is derived from platform_fees.offplatform on the
//      server — the client never sets a total or a fee.
//
// Money model: DIRECT charge on the coach's connected account (the coach is the
// merchant of record for their own family), with a near-zero SaaS application
// fee routed to Sporve. Requires the coach's Connect account to have charges
// enabled (reuses the existing onboarding gate). See open decisions in the design
// doc (direct vs destination charge) — this is the direct-charge draft.
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

// FLAG — off everywhere until the test-mode proof passes (L-003).
const INVOICING_ENABLED =
  (Deno.env.get("OFFPLATFORM_INVOICING_ENABLED") ?? "false") === "true";

type LineItem = { label?: string; qty?: number; unit_amount_cents?: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    // ── 0. FLAG GATE ────────────────────────────────────────────────────────
    if (!INVOICING_ENABLED) {
      return json(
        { error: "Off-platform invoicing is not enabled yet.", flagged: true },
        503,
      );
    }

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

    const body = await req.json().catch(() => ({}));
    const invoiceId: string | null =
      typeof body?.invoiceId === "string" ? body.invoiceId : null;
    if (!invoiceId) return json({ error: "invoiceId is required" }, 400);

    // ── 2. Load the DRAFT invoice + contact + provider (service role) ────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: invoice, error: invErr } = await admin
      .from("coach_invoices")
      .select(
        "id, provider_id, contact_id, description, line_items, amount_cents, " +
          "application_fee_cents, currency, status, " +
          "providers(owner_id, stripe_account_id, stripe_charges_enabled), " +
          "coach_contacts(display_name, email)",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr) return json({ error: invErr.message }, 400);
    if (!invoice) return json({ error: "Invoice not found" }, 404);

    const provider = (invoice as Record<string, unknown>).providers as
      | { owner_id?: string; stripe_account_id?: string | null; stripe_charges_enabled?: boolean }
      | null;
    const contact = (invoice as Record<string, unknown>).coach_contacts as
      | { display_name?: string; email?: string | null }
      | null;

    // Ownership: only the provider-owner may send their own invoice.
    if (!provider || provider.owner_id !== uid) {
      return json({ error: "Not your invoice" }, 403);
    }
    if (invoice.status !== "draft") {
      return json({ error: "This invoice is not a draft." }, 409);
    }
    const account = provider.stripe_account_id ?? null;
    if (!account || provider.stripe_charges_enabled !== true) {
      return json(
        { error: "Connect payouts must be enabled before invoicing." },
        409,
      );
    }
    const email = contact?.email?.trim();
    if (!email) return json({ error: "This contact has no email." }, 400);

    // ── 3. Re-derive money on the SERVER (never trust the row's stored total) ─
    const items = (invoice.line_items as LineItem[] | null) ?? [];
    let amount = 0;
    for (const it of items) {
      const qty = Number(it.qty ?? 0);
      const unit = Number(it.unit_amount_cents ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(unit) || qty < 0 || unit < 0) {
        return json({ error: "Invalid line item." }, 400);
      }
      amount += Math.round(qty * unit);
    }
    if (amount <= 0) return json({ error: "Invoice has no payable amount." }, 400);
    const currency = String(invoice.currency ?? "USD").toLowerCase();

    const { data: feeRow } = await admin
      .from("platform_fees")
      .select("rate_bps")
      .eq("fee_kind", "offplatform")
      .maybeSingle();
    // Fail CLOSED: if the off-platform fee row is missing or its rate is null,
    // do NOT silently substitute a hardcoded 2.5% — a deleted/misconfigured
    // config row must surface as an error, not charge a coach a stale rate.
    const bps = Number(feeRow?.rate_bps);
    if (!Number.isFinite(bps) || bps < 0) {
      return json({ error: "Off-platform fee is not configured." }, 500);
    }
    const applicationFee = Math.round((amount * bps) / 10000);

    // ── 4. Create a Stripe invoice on the coach's connected account ──────────
    // Direct charge (coach = merchant), thin SaaS application fee to Sporve.
    const opts = { stripeAccount: account };
    const customer = await stripe.customers.create(
      { email, name: contact?.display_name ?? undefined },
      opts,
    );
    const stripeInvoice = await stripe.invoices.create(
      {
        customer: customer.id,
        collection_method: "send_invoice",
        days_until_due: 7,
        currency,
        application_fee_amount: applicationFee,
        description: invoice.description ?? undefined,
        metadata: { coach_invoice_id: invoiceId },
      },
      { ...opts, idempotencyKey: `sporve-invoice-${invoiceId}` },
    );
    for (const it of items) {
      await stripe.invoiceItems.create(
        {
          customer: customer.id,
          invoice: stripeInvoice.id,
          quantity: Number(it.qty ?? 1),
          unit_amount: Math.round(Number(it.unit_amount_cents ?? 0)),
          currency,
          description: it.label ?? "Session",
        },
        opts,
      );
    }
    const finalized = await stripe.invoices.finalizeInvoice(stripeInvoice.id, opts);

    // ── 5. Persist the Stripe ids + move the row to 'open' (service role) ────
    const { error: upErr } = await admin
      .from("coach_invoices")
      .update({
        status: "open",
        stripe_invoice_id: finalized.id,
        hosted_invoice_url: finalized.hosted_invoice_url,
      })
      .eq("id", invoiceId);
    if (upErr) return json({ error: upErr.message }, 400);

    return json({
      invoiceId,
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url,
      amountCents: amount,
      applicationFeeCents: applicationFee,
    });
  } catch (e) {
    console.error("coach-invoice-create error:", e);
    return json({ error: "Could not send the invoice. Please try again." }, 500);
  }
});
