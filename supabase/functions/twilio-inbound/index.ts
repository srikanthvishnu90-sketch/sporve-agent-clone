// ============================================================================
// twilio-inbound  (Supabase Edge Function) — Twilio SMS webhook -> findings
// ============================================================================
// The INBOUND half of the SMS connector, mirroring gmail-scan's pattern:
//
//   * Twilio POSTs application/x-www-form-urlencoded {From, To, Body, MessageSid}.
//   * X-Twilio-Signature is validated (HMAC-SHA1 over the full request URL +
//     sorted params, TWILIO_AUTH_TOKEN). Mismatch -> 403. This is the auth;
//     the function deploys with --no-verify-jwt because Twilio cannot present
//     a JWT. Nothing sensitive is ever logged.
//   * To (our Twilio number) -> org via org_connectors kind='sms',
//     status='connected', external_account = the number. Fallback: if no row
//     matches and the deployment has exactly one connected sms connector whose
//     number equals TWILIO_PHONE_NUMBER, that org is used (documented
//     limitation — see below).
//   * A finding is filed ONLY when From matches a guardian phone of that org.
//     A stranger cannot manufacture work. The body is fenced as UNTRUSTED
//     before storage and is never acted on, never obeyed, never replied to.
//   * No match -> 200 {ignored:true} (Twilio retries non-2xx; an unknown
//     sender/number would retry forever, so it is acknowledged, not retried).
//   * Rate-limited per From via consume_edge_rate_limit.
//   * This function NEVER sends a reply. Ever.
//
// ORG <-> NUMBER MAPPING (limitation): the schema has no per-org SMS number
// table. The mapping lives in org_connectors: one row per org with
// kind='sms', status='connected', external_account = the Twilio number that
// org connected. The TWILIO_PHONE_NUMBER env is the deployment's number; if
// several orgs each connect their own Twilio number, each gets its own row and
// inbound To routing stays exact. If no row matches To, the single-connector
// fallback above applies; with zero or several connectors and no row match,
// the message is ignored.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { validTwilioSignature } from "./signature.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") ?? "";
const BODY_MAX_BYTES = 32_768;
const DETAIL_MAX_CHARS = 2_000;
const RATE_LIMIT_PER_HOUR = 30;

/** Normalize to E.164-ish for comparison; null when not a real number. */
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("+")) return null;
  const e164 = "+" + trimmed.slice(1).replace(/[^\d]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/**
 * Fence untrusted text before it reaches anything that interprets language.
 * Same delimiter contract as _shared/gmail-read.mjs wrapUntrusted (both
 * brackets neutralised so content cannot close the fence early); inlined here
 * because this function must stay self-contained for deployment.
 */
function wrapUntrusted(label: string, text: string): string {
  const body = String(text ?? "").replace(/</g, "‹").replace(/>/g, "›");
  return `<<<UNTRUSTED_${label}\n${body}\nUNTRUSTED_${label}>>>`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!TWILIO_AUTH_TOKEN) return json({ error: "SMS is not configured." }, 503);

  try {
    const raw = await req.text();
    if (raw.length > BODY_MAX_BYTES) return json({ error: "Body too large." }, 413);
    const params = new URLSearchParams(raw);
    const p: Record<string, string> = {};
    params.forEach((v, k) => { p[k] = v; });

    // Auth FIRST: the signature is the only credential Twilio presents.
    // The signed URL must be exactly what Twilio called (scheme + host +
    // path + query). Configure the Twilio webhook URL to the function's
    // public URL verbatim; a proxy that rewrites the host breaks validation.
    const signature = req.headers.get("X-Twilio-Signature") ?? "";
    const ok = await validTwilioSignature(TWILIO_AUTH_TOKEN, req.url, p, signature);
    if (!ok) {
      // Log nothing sensitive: no From, no Body, no params.
      console.error("twilio-inbound: signature mismatch");
      return json({ error: "Invalid signature." }, 403);
    }

    const from = normalizePhone(p.From);
    const to = normalizePhone(p.To);
    const body = typeof p.Body === "string" ? p.Body : "";
    const messageSid = typeof p.MessageSid === "string" ? p.MessageSid : "";
    // A well-formed Twilio request always carries these; a retry cannot fix a
    // malformed one, so acknowledge-and-ignore instead of 4xx.
    if (!from || !to || !messageSid || !body.trim()) {
      return json({ ignored: true, reason: "malformed" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Rate-limit per sender. The actor key is a hash, not the raw number.
    const actorKey = `twilio-inbound:${await sha256Hex(from)}`;
    const { data: withinLimit, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
      p_actor_key: actorKey, p_scope: "twilio-inbound:from", p_limit: RATE_LIMIT_PER_HOUR, p_window_seconds: 3600,
    });
    if (rateError) return json({ error: "Rate limiter unavailable." }, 503);
    if (withinLimit !== true) return json({ error: "Too many messages. Try again later." }, 429);

    // To -> org. Primary: the org_connectors row for this number.
    const { data: connectors, error: cErr } = await admin.from("org_connectors")
      .select("id, provider_id, external_account").eq("kind", "sms").eq("status", "connected");
    if (cErr) return json({ error: "Connector lookup unavailable." }, 503);
    const normTo = to;
    let providerId: string | null = null;
    let connectorId: string | null = null;
    for (const c of connectors ?? []) {
      if (normalizePhone((c as { external_account?: string }).external_account) === normTo) {
        providerId = (c as { provider_id: string }).provider_id;
        connectorId = (c as { id: string }).id;
        break;
      }
    }
    if (!providerId) {
      // Fallback (documented limitation): the deployment's single sms
      // connector answers for the env-configured number.
      const only = (connectors ?? []) as { id: string; provider_id: string; external_account?: string }[];
      const envNumber = normalizePhone(TWILIO_PHONE_NUMBER);
      if (only.length === 1 && envNumber && normTo === envNumber) {
        providerId = only[0].provider_id;
        connectorId = only[0].id;
      } else {
        return json({ ignored: true, reason: "unknown_number" });
      }
    }

    // From -> guardian of THAT org. Service-role read, tenant-scoped.
    const { data: guardians, error: gErr } = await admin.from("guardians")
      .select("id, first_name, phone").eq("provider_id", providerId);
    if (gErr) return json({ error: "Guardian lookup unavailable." }, 503);
    let guardian: { id: string; first_name?: string } | null = null;
    for (const g of guardians ?? []) {
      if (normalizePhone((g as { phone?: string }).phone) === from) {
        guardian = g as { id: string; first_name?: string };
        break;
      }
    }
    // Unknown sender: acknowledge so Twilio does not retry; file nothing.
    if (!guardian) return json({ ignored: true, reason: "unknown_sender" });

    // Idempotence on MessageSid: a Twilio retry must not double-file.
    const sourceRef = `twilio:${messageSid}`;
    const { data: seen, error: seenErr } = await admin.from("agent_findings")
      .select("id").eq("provider_id", providerId).eq("source_ref", sourceRef).maybeSingle();
    if (seenErr) return json({ error: "Finding lookup unavailable." }, 503);
    if (seen) return json({ ok: true, duplicate: true });

    const who = (guardian.first_name || "A guardian").slice(0, 60);
    const { data: inserted, error: fErr } = await admin.from("agent_findings").insert([{
      provider_id: providerId,
      kind: "people",
      code: "inbound_sms",
      severity: "attention",
      title: `${who} texted the club`,
      // The body is UNTRUSTED: fenced before storage, never acted on.
      detail: wrapUntrusted("SMS", body.slice(0, DETAIL_MAX_CHARS)),
      source_ref: sourceRef,
      status: "open",
    }]).select("id").maybeSingle();
    if (fErr || !inserted) return json({ error: "Finding write failed." }, 503);

    return json({ ok: true, finding: (inserted as { id: string }).id, connector: connectorId });
  } catch (e) {
    // Never echo the request body or sender into logs.
    console.error("twilio-inbound: unavailable");
    return json({ error: "Inbound SMS is temporarily unavailable." }, 503);
  }
});
