// ============================================================================
// unsubscribe — the one-click opt-out the privacy policy promises.
// ============================================================================
// GET  /functions/v1/unsubscribe?g=<guardian_id>&t=<hmac>   (human click)
// POST same URL                                             (RFC 8058 one-click)
// Fallback: ?email=<addr> (legacy Join-Waitlist links carry no token; a bare
// email can only STOP mail to that address, never start it, so a working
// opt-out outweighs forgeability here.)
//
// Token = first 32 hex chars of HMAC-SHA256(guardian_id, service-role key):
// derived server-side in lifecycle-process, verified here, no new secret and
// nothing stored. Deploy with --no-verify-jwt: an unsubscribe link must work
// from a mail client with no session.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function hmac(id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SERVICE_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="margin:0;background:#F7F8FA;color:#16181D;font:15px/1.6 -apple-system,system-ui,sans-serif">
<div style="max-width:420px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #E3E7ED;border-radius:12px">
<h1 style="font-size:20px;margin:0 0 10px">${title}</h1><p style="margin:0;color:#475569">${body}</p>
<p style="margin-top:18px;color:#94A3B8;font-size:13px">Sporv · questions? support@sporv.ai</p></div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  if (!["GET", "POST"].includes(req.method)) return page("Not allowed", "", 405);
  const u = new URL(req.url);
  const g = (u.searchParams.get("g") || "").trim();
  const t = (u.searchParams.get("t") || "").trim();
  const email = (u.searchParams.get("email") || "").trim().toLowerCase();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    if (g && t) {
      if (!/^[0-9a-f-]{36}$/.test(g) || t !== await hmac(g)) {
        return page("Link not recognized", "This unsubscribe link is invalid or expired. Email support@sporv.ai and we'll take care of it.", 400);
      }
      await admin.from("guardians").update({ email_status: "unsubscribed" }).eq("id", g);
      // Per-email suppression too, so a re-added row stays unsubscribed.
      const { data: gu } = await admin.from("guardians").select("email").eq("id", g).maybeSingle();
      const em = (gu as { email?: string } | null)?.email?.toLowerCase();
      if (em) await admin.from("email_suppressions").upsert({ email: em, reason: "unsubscribed" }, { onConflict: "email" });
      return page("You're unsubscribed", "You won't receive further messages from your club through Sporv. Account and safety notices may still be sent when required.");
    }
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await admin.from("guardians").update({ email_status: "unsubscribed" }).eq("email", email);
      await admin.from("email_suppressions").upsert({ email, reason: "unsubscribed" }, { onConflict: "email" });
      return page("You're unsubscribed", "You won't receive further messages through Sporv at this address. Account and safety notices may still be sent when required.");
    }
    return page("Unsubscribe", "Open the unsubscribe link from one of our emails, or write to support@sporv.ai and we'll remove you.", 400);
  } catch (_e) {
    return page("Something went wrong", "Please email support@sporv.ai and we'll remove you by hand.", 500);
  }
});
