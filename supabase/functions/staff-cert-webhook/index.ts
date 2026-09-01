// ============================================================================
// staff-cert-webhook  (Supabase Edge Function) — enterprise compliance slice 7
// ============================================================================
// The ONLY path that can move a staff_certifications row to status='verified'.
//
// WHY THIS EXISTS: slice 6 tightened the table's RLS so a client (an org admin)
// can only ever write status 'none'/'pending' — a director records a cert but can
// never self-clear. Verification therefore has to come from OUTSIDE the client:
// a cert vendor / attestation service POSTs its result here, and this function —
// running as service_role, which bypasses RLS — writes the 'verified' state.
// Mirrors the background-check posture: the trust signal is never self-set.
//
// AUTH: verify_jwt = false (a vendor cannot send a Supabase JWT). Auth IS a shared
// secret in the `x-cert-webhook-secret` header, compared in constant time against
// CERT_WEBHOOK_SECRET. Empty/mismatched secret => 401, nothing written.
//
// BODY: { cert_id: uuid, decision: "verified" | "revoked",
//         expires_at?: "YYYY-MM-DD", reference?: string }
//   verified -> status='verified' (+ expires_at, reference); the board's
//               fail-closed rule still hides it once expires_at passes.
//   revoked  -> status='none' (the cert no longer counts; fail-closed).
//
// NOT DEPLOYED — RED. The owner deploys and sets CERT_WEBHOOK_SECRET; no cert
// vendor is wired yet, so this completes the trust LOOP architecturally and waits.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cert-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CERT_WEBHOOK_SECRET = Deno.env.get("CERT_WEBHOOK_SECRET") ?? "";

// Constant-time string compare — never leak the secret through timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    // ── Auth: shared secret, constant-time ──────────────────────────────────
    const provided = req.headers.get("x-cert-webhook-secret") ?? "";
    if (!CERT_WEBHOOK_SECRET || !safeEqual(provided, CERT_WEBHOOK_SECRET)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const certId = typeof body?.cert_id === "string" ? body.cert_id : "";
    const decision = body?.decision;
    if (!UUID_RE.test(certId)) return json({ error: "cert_id must be a uuid" }, 400);
    if (decision !== "verified" && decision !== "revoked") {
      return json({ error: "decision must be 'verified' or 'revoked'" }, 400);
    }

    // ── Build the update. 'verified' is the whole point; 'revoked' → 'none'. ──
    const patch: Record<string, unknown> = {
      status: decision === "verified" ? "verified" : "none",
      updated_at: new Date().toISOString(),
    };
    if (decision === "verified") {
      const exp = typeof body?.expires_at === "string" ? body.expires_at : null;
      if (exp !== null && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
        return json({ error: "expires_at must be YYYY-MM-DD" }, 400);
      }
      patch.expires_at = exp;
      if (typeof body?.reference === "string") patch.reference = body.reference.slice(0, 200);
    }

    const { data, error } = await admin
      .from("staff_certifications")
      .update(patch)
      .eq("id", certId)
      .select("id")
      .maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!data) return json({ error: "Cert not found" }, 404);

    return json({ ok: true, cert_id: certId, status: patch.status });
  } catch (e) {
    console.error("staff-cert-webhook error:", e);
    return json({ error: "Could not process the verification." }, 500);
  }
});
