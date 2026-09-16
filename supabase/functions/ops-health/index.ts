// ops-health — the alert feed for a solo founder (spec 18.3, checklist item 7).
//
// GET with `Authorization: Bearer <OPS_HEALTH_TOKEN>` → { ok, critical, high,
// ... }; GET ?view=functions → { ok, functions:[{name,args}] } (drift guard).
// checks:[{severity, check_name, failing_count, detail}] }. Counts and static
// strings only; nothing in the response identifies a person, a booking or a
// message. The database work is public.ops_alerts() (migration 001061),
// which is service_role-only — this function holds that key INSIDE Supabase
// so the caller (a GitHub Actions cron) needs nothing but its own token.
// Rejecting a caller costs one constant-time compare and no database round
// trip; there is no body to parse and no state to change.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPS_HEALTH_TOKEN = Deno.env.get("OPS_HEALTH_TOKEN") ?? "";
const HDR = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HDR });

function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Alert = { severity: string; check_name: string; failing_count: number; detail: string };

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  if (!OPS_HEALTH_TOKEN) return json({ error: "ops-health is not configured" }, 503);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!sameToken(bearer, OPS_HEALTH_TOKEN)) return json({ error: "Forbidden" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // ?view=functions — the live function inventory for tools/check-migration-drift.mjs
  if (new URL(req.url).searchParams.get("view") === "functions") {
    const inv = await admin.rpc("ops_function_inventory");
    if (inv.error) return json({ ok: false, error: "inventory unavailable" }, 503);
    return json({ ok: true, functions: (inv.data ?? []).map((r: { name: string; args: string }) => ({ name: String(r.name), args: String(r.args ?? "") })) });
  }
  const { data, error } = await admin.rpc("ops_alerts");
  if (error) return json({ ok: false, error: "ops_alerts unavailable", critical: 1, high: 0, checks: [
    { severity: "critical", check_name: "ops_alerts_unavailable", failing_count: 1, detail: "The alert query itself failed. Treat as an outage of the monitor." }] }, 503);

  const checks: Alert[] = (data ?? []).map((r: Alert) => ({
    severity: String(r.severity), check_name: String(r.check_name), failing_count: Number(r.failing_count), detail: String(r.detail) }));
  const critical = checks.filter((c) => c.severity === "critical").length;
  const high = checks.filter((c) => c.severity === "high").length;
  return json({ ok: critical === 0, critical, high, checks, checked_at: new Date().toISOString() });
});
