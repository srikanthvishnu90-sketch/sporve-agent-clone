// ncsi-webhook — the ONLY path by which a background-check result enters Sporv.
// Spec 16.2, skeleton (owner ruling 2026-09-16 #4): no NCSI account exists yet.
//
// FAILS CLOSED. Unconfigured (no NCSI_WEBHOOK_SECRET) → 503 and nothing is
// written, so "no vendor" means no check, no clearance, no booking — never a
// permissive default. A bad or missing secret → 401, nothing written. A known
// reference is resolved through record_background_check_result(), which
// refuses unknown references (a stray or forged result cannot clear anyone)
// and which never turns 'consider' into clearance: a human adjudicates.
//
// Body shape is a PLACEHOLDER until NCSI's contract is signed and their
// payload is known: { reference, status, completed_at?, expires_at? }.
// Report contents are never accepted, stored, or logged (D3).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("NCSI_WEBHOOK_SECRET") ?? "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const STATUSES = new Set(["pending", "clear", "consider", "suspended", "expired", "cancelled"]);

function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SECRET) return json({ error: "background-check vendor is not configured; no result can be recorded" }, 503);
  if (!sameToken(req.headers.get("x-ncsi-webhook-secret") ?? "", SECRET)) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  if (!reference || !STATUSES.has(status)) return json({ error: "reference and a known status are required" }, 400);
  const completedAt = typeof body.completed_at === "string" && !Number.isNaN(Date.parse(body.completed_at)) ? body.completed_at : null;
  const expiresAt = typeof body.expires_at === "string" && !Number.isNaN(Date.parse(body.expires_at)) ? body.expires_at : null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("record_background_check_result", {
    p_vendor: "ncsi", p_vendor_reference: reference, p_status: status, p_completed_at: completedAt, p_expires_at: expiresAt });
  if (error) {
    // P0002 = no ordered check carries that reference. Nothing was written either way.
    const code = (error as { code?: string }).code;
    return json({ error: code === "P0002" ? "unknown reference" : "not recorded" }, code === "P0002" ? 404 : 503);
  }
  return json({ ok: true, check_id: data, status, adjudication: status === "consider" ? "human review required" : null });
});
