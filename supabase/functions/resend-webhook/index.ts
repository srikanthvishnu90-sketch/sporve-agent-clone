// ============================================================================
// resend-webhook  (Supabase Edge Function) — doc 08 bounce/complaint intake
// ============================================================================
// Resend signs webhooks with svix. Verification is mandatory: an unsigned
// bounce claim could otherwise silence a family's dues reminders. On a hard
// bounce or complaint: stamp the message row's delivery_error and set
// guardians.email_bounced_at — the dues generator stops drafting to that
// address on its next run (agent must stop drafting to a bounced address).
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

async function verifySvix(req: Request, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;              // fail closed, never open
  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  const sigHeader = req.headers.get("svix-signature") ?? "";
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;  // 5-min replay window
  const secret = WEBHOOK_SECRET.startsWith("whsec_") ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET;
  const keyBytes = Uint8Array.from(atob(secret), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // header carries space-separated "v1,<sig>" entries
  return sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1] ?? "";
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const body = await req.text();
  if (!(await verifySvix(req, body))) return new Response("bad signature", { status: 401 });
  let evt: { type?: string; data?: { email_id?: string; to?: string[] } };
  try { evt = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
  if (!evt.type || !["email.bounced", "email.complained"].includes(evt.type)) {
    return new Response(JSON.stringify({ ok: true, ignored: evt.type }), { status: 200 });
  }
  const emailId = evt.data?.email_id;
  if (!emailId) return new Response("no email_id", { status: 400 });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: row } = await admin.from("outbound_messages")
    .select("id, content").eq("provider_message_id", emailId).maybeSingle();
  const gid = row ? (row.content as { guardian_id?: string } | null)?.guardian_id : null;
  // audit intake row FIRST — even for unmatched messages we keep the event
  await admin.from("delivery_events").insert([{
    guardian_id: gid ?? null, message_id: row?.id ?? null,
    type: evt.type, raw: evt as unknown as Record<string, unknown>,
  }]);
  if (row) {
    await admin.from("outbound_messages").update({
      delivery_error: evt.type === "email.bounced" ? "hard bounce" : "complaint",
      last_error: evt.type === "email.bounced" ? "hard bounce" : "complaint",
    }).eq("id", row.id);
  }
  if (gid) {
    await admin.from("guardians").update({
      email_status: evt.type === "email.bounced" ? "bounced" : "complained",
      email_bounced_at: new Date().toISOString(),
    }).eq("id", gid);
    // Suppression survives the ROW (red fix 2026-09-04): the per-email
    // suppression list is what the guardians guard consults on re-insert,
    // so deleting + re-adding the guardian cannot resume mail.
    const { data: g } = await admin.from("guardians").select("email").eq("id", gid).maybeSingle();
    const em = (g as { email?: string } | null)?.email?.toLowerCase();
    if (em) {
      await admin.from("email_suppressions").upsert(
        { email: em, reason: evt.type === "email.bounced" ? "bounced" : "complained" },
        { onConflict: "email" });
    }
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
