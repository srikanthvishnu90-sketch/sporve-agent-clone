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
import {
  HttpInputError,
  readBoundedText,
  withHttpDeadline,
} from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    ? email
    : null;
}

async function verifySvix(req: Request, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false; // fail closed, never open
  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  const sigHeader = req.headers.get("svix-signature") ?? "";
  if (!id || !ts || !sigHeader) return false;
  if (
    !/^\d+$/.test(ts) || !Number.isSafeInteger(Number(ts)) ||
    Math.abs(Date.now() / 1000 - Number(ts)) > 300
  ) return false; // 5-min replay window
  const secret = WEBHOOK_SECRET.startsWith("whsec_")
    ? WEBHOOK_SECRET.slice(6)
    : WEBHOOK_SECRET;
  const keyBytes = Uint8Array.from(atob(secret), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${ts}.${body}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // header carries space-separated "v1,<sig>" entries
  return sigHeader.split(" ").some((part) => {
    const [version, sig = "", extra] = part.split(",");
    if (version !== "v1" || extra !== undefined) return false;
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) {
      diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (
    !req.headers.get("svix-id") || !req.headers.get("svix-timestamp") ||
    !req.headers.get("svix-signature")
  ) return new Response("bad signature", { status: 401 });
  let body: string;
  try {
    body = await withHttpDeadline(
      (signal) => readBoundedText(req, 100_000, signal),
      5000,
    );
  } catch (error) {
    return new Response("invalid request body", {
      status: error instanceof HttpInputError ? error.status : 400,
    });
  }
  try {
    if (!(await verifySvix(req, body))) {
      return new Response("bad signature", { status: 401 });
    }
  } catch {
    return new Response("signature unavailable", { status: 503 });
  }
  let evt: { type?: string; data?: { email_id?: string; to?: string[] } };
  try {
    evt = JSON.parse(body);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!evt || typeof evt !== "object" || Array.isArray(evt)) {
    return new Response("bad event", { status: 400 });
  }
  if (!evt.type || !["email.bounced", "email.complained"].includes(evt.type)) {
    return new Response(JSON.stringify({ ok: true, ignored: evt.type }), {
      status: 200,
    });
  }
  const emailId = evt.data?.email_id;
  if (typeof emailId !== "string" || !emailId.trim() || emailId.length > 200) {
    return new Response("no email_id", { status: 400 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    await withHttpDeadline(async (signal) => {
      const { data: row, error: lookupError } = await admin.from(
        "outbound_messages",
      )
        .select("id, content").eq("provider_message_id", emailId).abortSignal(
          signal,
        ).maybeSingle();
      if (lookupError) throw new Error("Message lookup failed");
      // The sender can replace content.to_email with the guardian's address at
      // send time. Only the signed provider recipient identifies this delivery.
      const recipients = evt.data?.to;
      const sentEmail = Array.isArray(recipients) && recipients.length === 1
        ? normalizedEmail(recipients[0])
        : null;
      // Missing/ambiguous recipients do not erase verified delivery evidence.
      // Persist the event and message failure, but never guess an address to
      // suppress from the mutable draft or current guardian record.
      const gid = row
        ? (row.content as { guardian_id?: string } | null)?.guardian_id
        : null;
      const deliveryError = evt.type === "email.bounced"
        ? "hard bounce"
        : "complaint";
      const emailStatus = evt.type === "email.bounced"
        ? "bounced"
        : "complained";
      // audit intake row FIRST — even for unmatched messages we keep the event
      const { data: receipt, error: receiptError } = await admin.from(
        "delivery_events",
      ).insert([{
        guardian_id: gid ?? null,
        message_id: row?.id ?? null,
        type: evt.type,
        raw: evt as unknown as Record<string, unknown>,
      }]).select("id, message_id, guardian_id, type").abortSignal(signal)
        .single();
      if (
        receiptError || typeof receipt?.id !== "string" || !receipt.id ||
        receipt.message_id !== (row?.id ?? null) ||
        receipt.guardian_id !== (gid ?? null) || receipt.type !== evt.type
      ) {
        throw new Error("Delivery receipt missing");
      }
      if (row) {
        const { data: message, error: messageError } = await admin.from(
          "outbound_messages",
        ).update({
          delivery_error: deliveryError,
          last_error: deliveryError,
        }).eq("id", row.id).select("id, delivery_error, last_error")
          .abortSignal(signal).single();
        if (
          messageError || message?.id !== row.id ||
          message.delivery_error !== deliveryError ||
          message.last_error !== deliveryError
        ) {
          throw new Error("Message update receipt missing");
        }
      }
      if (row && sentEmail) {
        // Suppress the actual recipient even if the guardian changed address
        // or was deleted after sending. Never substitute their current email.
        const { data: suppression, error: suppressionError } = await admin
          .from("email_suppressions").upsert(
            { email: sentEmail, reason: emailStatus },
            { onConflict: "email" },
          ).select("email, reason").abortSignal(signal).single();
        if (
          suppressionError || suppression?.email !== sentEmail ||
          suppression.reason !== emailStatus
        ) {
          throw new Error("Suppression receipt missing");
        }
      }
      if (gid && sentEmail) {
        const { data: current, error: currentError } = await admin.from(
          "guardians",
        )
          .select("id, email").eq("id", gid).abortSignal(signal).maybeSingle();
        if (currentError) throw new Error("Guardian lookup failed");
        if (!current || normalizedEmail(current.email) !== sentEmail) return;
        const bouncedAt = new Date().toISOString();
        const { data: guardian, error: guardianError } = await admin.from(
          "guardians",
        ).update({
          email_status: emailStatus,
          email_bounced_at: bouncedAt,
        }).eq("id", gid).eq("email", current.email).select(
          "id, email, email_status, email_bounced_at",
        )
          .abortSignal(signal).single();
        if (
          guardianError || guardian?.id !== gid ||
          normalizedEmail(guardian.email) !== sentEmail ||
          guardian.email_status !== emailStatus ||
          Date.parse(guardian.email_bounced_at) !== Date.parse(bouncedAt)
        ) {
          throw new Error("Guardian update receipt missing");
        }
      }
    }, 8000);
  } catch {
    // Never acknowledge a rejected or silently suppressed write. A retry may
    // repeat an intake row: transactional event-id dedup is a DB prerequisite,
    // not something these separate REST writes can promise.
    console.error("Delivery event persistence unavailable");
    return new Response("delivery persistence unavailable", { status: 503 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
