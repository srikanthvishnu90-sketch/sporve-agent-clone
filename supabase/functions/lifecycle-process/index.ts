// ============================================================================
// lifecycle-process  (Supabase Edge Function) — the CONTENT + CONTROL worker
// ============================================================================
// Invoked by pg_cron (service role) on a short interval. Picks up DUE 'pending'
// outbound_messages and acts per the coach's lifecycle_message_prefs.mode for
// that event_type:
//   • off   -> status='skipped' (no content).
//   • draft -> generate personalized content via ai-gateway (haiku for short
//              logistics reminders, sonnet for richer follow-ups), strip claims,
//              store content, status='drafted'. NOTHING sends — the coach
//              approves later (lifecycle-approve / approval queue).
//   • auto  -> legacy preference: prepare a FIXED logistics template with thin
//              personalization, then store 'drafted' for human approval. It
//              never sends or approves. If a clean template cannot be built,
//              fall back to model-assisted drafting (still human-approved).
//
// Tone via buildCoachVoiceProfile; guardrails identical to P3 (no credential /
// medical / safety claims). Every model call is logged to ai_audit_log
// (feature="lifecycle") inside ai-gateway. This worker authenticates to the
// gateway with the service role and attributes the call to the coach.
//
// post_session here is a logistics/feedback nudge to the parent, DISTINCT from
// the P2 progress update; a coach who uses P2 can set post_session='off'.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverPush } from "../_shared/push.ts";
import { buildCoachVoiceProfile } from "../_shared/coach_voice.ts";
import { withHttpDeadline, readBoundedJson } from "../_shared/http.ts";
import {
  resolveAction,
  modelForEvent,
  autoOrFallback,
  enforceLifecycleDraft,
} from "./policy.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN") ?? "mail.sporv.ai";
const BATCH = Number(Deno.env.get("LIFECYCLE_BATCH") ?? 25);
const GENERATION_DB_MS = 8_000;
const GENERATION_MODEL_MS = 20_000;
const GENERATION_RESPONSE_BYTES = 64_000;

const generationDb = <T>(work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> =>
  withHttpDeadline(async signal => await work(signal), GENERATION_DB_MS);

const EVENT_GUIDANCE: Record<string, string> = {
  booking_confirmed: "a brief, warm confirmation that the session is booked.",
  reminder_24h: "a short, friendly reminder that a session is coming up.",
  post_session: "a brief, warm check-in after a session — a logistics/feedback nudge (e.g. how did it go, anything to flag for next time). This is NOT a progress report; do not summarize skills or progress.",
  no_show_followup: "a gentle, non-judgmental check-in after a missed session, offering to reschedule.",
  rebook_nudge: "a warm, low-pressure invitation to book another session, since it's been a while.",
};

const SYSTEM = [
  "You write a SHORT message a youth-sports coach could send to a parent. Output ONLY the message body — no preamble, no signature, plain language.",
  "HARD RULES (non-negotiable):",
  "- NO certifications, credentials, licenses, accreditations, or degrees.",
  "- NO medical or safety claims (injuries, diagnoses, 'cleared to play', recovery, etc.).",
  "- Truthful over flattering. Never invent facts about the child, sessions, schedules, prices, or availability beyond what is given.",
  "- This is a DRAFT the coach will review and edit; do not claim anything is already done.",
  "- Tone anchors are the coach's OWN past writing — match warmth/voice ONLY, never copy their facts.",
].join("\n");

type Admin = ReturnType<typeof createClient>;

// A failed delivery precondition is not permission to use cached recipient
// data. Keep the approved draft visible for human review, with a checked receipt.
class DeliveryPreconditionError extends Error {}
async function deliveryRead<T>(query: PromiseLike<T>, reason: string): Promise<T> {
  try { return await query; } catch { throw new DeliveryPreconditionError(reason); }
}
async function holdForReview(admin: Admin, row: { id: string; provider_id: string; approved_by: string }, reason: string) {
  const { data, error } = await admin.from("outbound_messages")
    .update({ status: "needs_review", last_error: reason })
    .eq("id", row.id).eq("provider_id", row.provider_id)
    .eq("status", "approved").eq("approved_by", row.approved_by).not("approved_by", "is", null).is("sent_at", null)
    .select("id, provider_id, approved_by, sent_at, status, last_error").maybeSingle();
  if (error || data?.id !== row.id || data?.provider_id !== row.provider_id ||
    !data?.approved_by || data.approved_by !== row.approved_by || data?.sent_at !== null ||
    data?.status !== "needs_review" || data?.last_error !== reason) {
    throw new Error("Delivery review receipt unavailable.");
  }
}

/** Resolve the coach's profile id (notification recipient author) + display name. */
async function resolveProvider(admin: Admin, providerId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { data, error } = await admin.from("providers")
    .select("id, owner_id, business_name").eq("id", providerId).abortSignal(signal).maybeSingle();
  signal.throwIfAborted();
  if (error || data?.id !== providerId || typeof data.owner_id !== "string" || !data.owner_id) {
    throw new Error("Generation provider unavailable.");
  }
  return {
    ownerId: (data as { owner_id?: string } | null)?.owner_id ?? null,
    businessName: (data as { business_name?: string } | null)?.business_name ?? null,
  };
}

/** Service-role reads need their own tenant proof; a foreign key alone is not it. */
async function resolveContext(admin: Admin, row: Record<string, unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  let childFirstName = "", guardianId: string | null = null;
  let dateText = "", timeText = "", place = "";
  let bookingParent: string | null = null;
  if (row.booking_id) {
    const { data: b, error: bookingError } = await admin.from("bookings")
      .select("id, session_id, program_id, athlete_id, searcher_id, athlete_first_name, sessions!inner(id, program_id, programs!inner(id, provider_id))")
      .eq("id", row.booking_id as string).eq("sessions.programs.provider_id", row.provider_id).abortSignal(signal).maybeSingle();
    signal.throwIfAborted();
    const session = b?.sessions as { id?: string; program_id?: string; programs?: { id?: string; provider_id?: string } } | null;
    if (bookingError || b?.id !== row.booking_id || !session || !session.id ||
      b.session_id !== session.id || !session.program_id || session.programs?.id !== session.program_id ||
      session.programs?.provider_id !== row.provider_id ||
      (b.program_id !== null && b.program_id !== session.program_id) ||
      b.athlete_id !== (row.child_id ?? null) || typeof b.searcher_id !== "string" || !b.searcher_id) {
      throw new Error("Generation booking unavailable.");
    }
    bookingParent = b.searcher_id;
    childFirstName = b.athlete_first_name ?? "";
    const { data: s, error: sessionError } = await admin.from("sessions")
      .select("id, program_id, start_date, start_time, address, programs!inner(id, provider_id)")
      .eq("id", session.id).eq("program_id", session.program_id).eq("programs.provider_id", row.provider_id).abortSignal(signal).maybeSingle();
    signal.throwIfAborted();
    const program = s?.programs as { id?: string; provider_id?: string } | null;
    if (sessionError || s?.id !== session.id || s.program_id !== session.program_id ||
      program?.id !== session.program_id || program?.provider_id !== row.provider_id) {
      throw new Error("Generation session unavailable.");
    }
    dateText = s.start_date ?? "";
    timeText = s.start_time ?? "";
    place = s.address ?? "";
  } else if (row.child_id) {
    // Canonical rebook nudges intentionally have no booking_id. Their authority
    // comes from a completed booking for this child with this provider, not from
    // the arbitrary child_id carried by an outbound row.
    if (row.event_type !== "rebook_nudge") throw new Error("Generation booking required for this event.");
    const { data: prior, error } = await admin.from("bookings")
      .select("id, athlete_id, searcher_id, status, program_id, programs!inner(id, provider_id)")
      .eq("athlete_id", row.child_id).eq("status", "completed").eq("programs.provider_id", row.provider_id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
    signal.throwIfAborted();
    const program = prior?.programs as { id?: string; provider_id?: string } | null;
    if (error || !prior?.id || prior.athlete_id !== row.child_id || prior.status !== "completed" ||
      !prior.program_id || program?.id !== prior.program_id || program?.provider_id !== row.provider_id ||
      typeof prior.searcher_id !== "string" || !prior.searcher_id) {
      throw new Error("Generation child relationship unavailable.");
    }
    bookingParent = prior.searcher_id;
  }
  if (row.child_id) {
    const { data: child, error: childError } = await admin.from("athletes")
      .select("id, first_name, parent_id").eq("id", row.child_id as string).eq("parent_id", bookingParent).abortSignal(signal).maybeSingle();
    signal.throwIfAborted();
    if (childError || child?.id !== row.child_id || !bookingParent || child.parent_id !== bookingParent) {
      throw new Error("Generation child unavailable.");
    }
    childFirstName = child.first_name ?? childFirstName;
    guardianId = child.parent_id;
  }
  return { childFirstName, guardianId, dateText, timeText, place };
}

/** Generation only stages a draft; approval/delivery belongs to the human path. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length &&
    Object.keys(aa).every(k => Object.prototype.hasOwnProperty.call(bb, k) && sameJson(aa[k], bb[k]));
}
async function storeDraft(admin: Admin, row: Record<string, unknown>, content: Record<string, unknown>) {
  const { data, error } = await generationDb(signal => admin.from("outbound_messages")
    .update({ content, status: "drafted", last_error: null })
    .eq("id", row.id).eq("provider_id", row.provider_id).eq("status", "processing")
    .is("approved_by", null).is("approved_at", null).is("sent_at", null)
    .select("id, provider_id, status, approved_by, approved_at, sent_at, content, last_error").abortSignal(signal).maybeSingle());
  if (error || data?.id !== row.id || data?.provider_id !== row.provider_id ||
    data?.status !== "drafted" || data?.approved_by !== null || data?.approved_at !== null || data?.sent_at !== null ||
    data?.last_error !== null || !sameJson(data?.content, content)) {
    throw new Error("Draft receipt unavailable.");
  }
}

// A skip or retry is also a write, not an assumed outcome. Release only this
// unapproved processing claim; a no-op/error leaves the tick visibly failed.
// Recovery: pending is the inverse of a generation claim; skipped rows may be
// explicitly requeued only after confirming the intended mode and null approvals.
async function finishGeneration(
  admin: Admin, row: Record<string, unknown>, status: "pending" | "skipped", reason: string,
) {
  const { data, error } = await generationDb(signal => admin.from("outbound_messages")
    .update({ status, last_error: reason })
    .eq("id", row.id).eq("provider_id", row.provider_id).eq("status", "processing")
    .is("approved_by", null).is("approved_at", null).is("sent_at", null)
    .select("id, provider_id, status, approved_by, approved_at, sent_at, last_error").abortSignal(signal).maybeSingle());
  if (error || data?.id !== row.id || data?.provider_id !== row.provider_id || data?.status !== status ||
    data?.approved_by !== null || data?.approved_at !== null || data?.sent_at !== null || data?.last_error !== reason) {
    throw new Error("Generation transition receipt unavailable.");
  }
}

/** Generate a drafted body via the gateway (service role, attributed to coach). */
async function generateDraft(
  admin: Admin, row: Record<string, unknown>, ownerId: string | null, childFirstName: string, guardianUserId: string | null,
): Promise<{ body: string; removed: string[]; model: string | null; audit_id: string | null } | { error: string }> {
  return withHttpDeadline(async signal => {
  const eventType = row.event_type as string;
  const samples = await buildCoachVoiceProfile(admin, row.provider_id as string, signal,
    typeof row.child_id === "string" && guardianUserId ? { childId: row.child_id, guardianUserId } : undefined);
  signal.throwIfAborted();
  const parts: string[] = [
    `Write ${EVENT_GUIDANCE[eventType] ?? "a short, warm message."}`,
    `Child's first name: ${childFirstName || "(not given)"}`,
  ];
  if (samples.length) {
    parts.push("", "Tone anchors — match the coach's voice ONLY, never copy their facts:",
      ...samples.map((s) => `- ${s}`));
  }
  const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
    method: "POST",
    signal, redirect: "error",
    headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "draft",
      feature: "lifecycle",
      system: SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: parts.join("\n") }] }],
      modelOverride: modelForEvent(eventType), // service role may pin the model
      actorId: ownerId,
      actorRole: "provider",
      maxTokens: 500,
    }),
  });
  const g = await readBoundedJson(gResp, GENERATION_RESPONSE_BYTES, signal);
  signal.throwIfAborted();
  if (!gResp.ok || typeof g?.text !== "string") return { error: "draft_generation_unavailable" };
  const { body, removed } = enforceLifecycleDraft(g.text);
  if (!body.trim()) return { error: "draft_generation_empty" };
  const audit = g.audit as { id?: unknown } | null;
  return { body, removed, model: typeof g.model === "string" ? g.model : null,
    audit_id: typeof audit?.id === "string" ? audit.id : null };
  }, GENERATION_MODEL_MS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    // Server-only. Never authorize by merely decoding a JWT claim here: an
    // unsigned/forged payload can claim any role.
    //
    // Accepts EITHER the injected service-role key (manual/admin invocation) or
    // the database-held cron_secret, verified by asking Postgres rather than by
    // comparing against a local copy.
    //
    // WHY THE SECOND PATH EXISTS. This previously accepted only
    // SERVICE_ROLE_KEY, and pg_cron sent a COPY of that key stored in Vault.
    // When the key rotated, the copy did not, and every one-minute tick 403'd
    // for ~6 weeks while pg_cron reported "succeeded" 63,321 times. Two copies
    // of one secret is the bug; cron_secret lives in exactly one place and is
    // never duplicated into an env var, so it cannot drift.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let authorized = bearer.length > 0 && bearer === SERVICE_ROLE_KEY;
    if (!authorized && bearer.length > 0) {
      const { data: ok, error: vErr } = await admin.rpc("verify_cron_secret", {
        p_token: bearer,
      });
      // Fail CLOSED: a verifier error is a rejection, never a pass.
      authorized = !vErr && ok === true;
    }
    if (!authorized) {
      return json({ error: "Forbidden (service role or cron secret only)." }, 403);
    }

    // ── EMAIL DELIVERY PASS (doc 08, spec rev 2026-09-02) ───────────────
    // Sends ONLY rows a human approved (approved_by NOT NULL — the Send click).
    // Window -> send_after; bad address -> needs_review; 3 failures -> failed.
    // The processing claim limits overlapping ticks; it does NOT make provider
    // delivery and the database receipt atomic. Reconciliation remains required.
    const emailSummary = { emailed: 0, emailSkipped: 0, emailFailed: 0, inApp: 0, windowDeferred: 0, needsReview: 0 };
    {
      const nowIso = new Date().toISOString();
      const { data: eRows, error: approvedReadError } = await admin.from("outbound_messages")
        .select("id, provider_id, content, approved_by, attempt_count, send_after")
        .not("approved_by", "is", null)
        .is("sent_at", null)
        .in("status", ["approved"])
        .or(`send_after.is.null,send_after.lte.${nowIso}`)
        .order("created_at", { ascending: true })
        .limit(50);
      if (approvedReadError || !Array.isArray(eRows)) {
        return json({ error: "Approved delivery queue unavailable." }, 503);
      }
      for (const er of eRows ?? []) {
       // Per-row guard: one org's bad settings (or any single-row surprise)
       // must never abort the tick for every other org. A row that keeps
       // throwing is retried at most 3 times, like the email-failure path.
       try {
        const c = er.content as { body?: string; subject?: string; to_email?: string; guardian_id?: string } | null;
        if (typeof c?.body !== "string" || !c.body.trim() || (!c.to_email && !c.guardian_id)) {
          throw new DeliveryPreconditionError("delivery_content_invalid");
        }

        // send window from settings (default 8am-8pm org tz, blocked days)
        const { data: winRow, error: windowError } = await deliveryRead(admin.from("provider_settings")
          .select("value").eq("provider_id", er.provider_id).eq("key", "send_window").maybeSingle(), "delivery_settings_unavailable");
        const { data: tzRow, error: timezoneError } = await deliveryRead(admin.from("provider_settings")
          .select("value").eq("provider_id", er.provider_id).eq("key", "org_tz").maybeSingle(), "delivery_settings_unavailable");
        if (windowError || timezoneError) throw new DeliveryPreconditionError("delivery_settings_unavailable");
        const win = (winRow?.value ?? {}) as { start?: string; end?: string; blocked_days?: (string|number)[]; pause_until?: string };
        // tz + window are tenant input (validated on write since 001022, but
        // rows written before that may hold garbage): a bad tz falls back to
        // the default instead of throwing, and a non-numeric window falls back
        // to 8:00/20:00 instead of silently disabling the window (NaN
        // comparisons are always false).
        let tz = ((tzRow?.value ?? {}) as { tz?: string }).tz ?? "America/Chicago";
        try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "America/Chicago"; }
        const orgNow = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
        const hm = orgNow.getHours() * 60 + orgNow.getMinutes();
        let [ws, we] = [win.start ?? "08:00", win.end ?? "20:00"].map(t => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); });
        if (!Number.isFinite(ws)) ws = 8 * 60;
        if (!Number.isFinite(we)) we = 20 * 60;
        const blocked = (win.blocked_days ?? []).map(String).includes(String(orgNow.getDay()));
        const paused = win.pause_until && new Date(win.pause_until) >= new Date(new Date().toDateString());
        if (hm < ws || hm > we || blocked || paused) {
          // outside the window: park it until the next opening, skip.
          const next = new Date(orgNow);
          if (hm > we || blocked || paused) next.setDate(next.getDate() + 1);
          next.setHours(Math.floor(ws / 60), ws % 60, 0, 0);
          await admin.from("outbound_messages").update({ send_after: next.toISOString() }).eq("id", er.id);
          emailSummary.windowDeferred++; continue;
        }

        // resolve the guardian: claimed -> in-app now; else email path.
        let claimedUser: string | null = null; let gEmail: string | null = c.to_email ?? null; let gStatus = "ok";
        if (c.guardian_id) {
          const { data: gg, error: guardianError } = await deliveryRead(admin.from("guardians")
            .select("id, provider_id, user_id, email, email_status")
            .eq("id", c.guardian_id).eq("provider_id", er.provider_id).maybeSingle(), "guardian_recipient_unavailable");
          const gr = gg as { id?: string; provider_id?: string; user_id?: string; email?: string; email_status?: string } | null;
          if (guardianError || !gr || gr.id !== c.guardian_id || gr.provider_id !== er.provider_id) {
            throw new DeliveryPreconditionError("guardian_recipient_unavailable");
          }
          claimedUser = gr?.user_id ?? null;
          // Never fall back to a stale draft address or assume an unknown status
          // means consent. Claimed guardians still receive the in-app channel.
          gEmail = gr.email ?? null;
          gStatus = gr.email_status ?? "unknown";
        }

        if (claimedUser) {
          const { data: iClaim } = await admin.from("outbound_messages")
            .update({ status: "processing" }).eq("id", er.id).eq("status", "approved").select("id").maybeSingle();
          if (!iClaim) continue;
          const { error: nErr } = await admin.from("notifications")
            .insert([{ user_id: claimedUser, title: c.subject || "Message from your club", message: c.body.slice(0, 280) }]);
          if (nErr) {
            // bounded like the email path — a permanently failing insert
            // (deleted user, constraint) must not retry every tick forever.
            const nAttempts = (er.attempt_count ?? 0) + 1;
            await admin.from("outbound_messages").update({
              status: nAttempts >= 3 ? "failed" : "approved",
              attempt_count: nAttempts, last_error: nErr.message.slice(0, 300),
            }).eq("id", er.id);
            emailSummary.emailFailed++;
          } else {
            await deliverPush(admin, claimedUser, c.subject || "Message from your club", c.body.slice(0, 280));
            await admin.from("outbound_messages").update({
              status: "sent", sent_at: new Date().toISOString(), provider: "in-app", last_error: null,
            }).eq("id", er.id).is("sent_at", null);
            emailSummary.inApp++;
          }
          continue;
        }

        // email path — bad address never sends; director fixes it in the roster.
        if (gStatus !== "ok") {
          throw new DeliveryPreconditionError("guardian_email_not_deliverable");
        }
        if (!RESEND_API_KEY) throw new DeliveryPreconditionError("email_provider_not_configured");
        if (typeof gEmail !== "string" || !/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(gEmail)) {
          throw new DeliveryPreconditionError("recipient_email_invalid");
        }
        // Per-email suppression list (red fix 2026-09-04): authoritative even
        // when the guardian ROW was deleted and re-created — the address is
        // what complained, so the address is what's suppressed.
        const { data: supRow, error: suppressionError } = await deliveryRead(admin.from("email_suppressions")
          .select("reason").eq("email", gEmail.toLowerCase()).maybeSingle(), "email_suppression_unavailable");
        if (suppressionError) throw new DeliveryPreconditionError("email_suppression_unavailable");
        if (supRow) {
          throw new DeliveryPreconditionError("recipient_email_suppressed");
        }

        const { data: eClaimed } = await admin.from("outbound_messages")
          .update({ status: "processing" }).eq("id", er.id).eq("status", "approved").select("id").maybeSingle();
        if (!eClaimed) continue;
        const { data: prov } = await admin.from("providers")
          .select("business_name").eq("id", er.provider_id).maybeSingle();
        // business_name is TENANT input headed into an RFC 5322 From header.
        // Unsanitized it can smuggle a second angle-addr ("Chase <a@chase.com>")
        // or impersonate the platform; strip header-significant characters and
        // never let the display name claim to be Sporv itself.
        const rawName = (prov as { business_name?: string } | null)?.business_name ?? "Your club";
        let orgName = rawName.replace(/[<>@"\\,;:\r\n\x00-\x1f]/g, "").trim().slice(0, 64) || "Your club";
        if (/^sporv\b/i.test(orgName)) orgName = "Your club";
        const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "club";
        const { data: replyRow } = await admin.from("provider_settings")
          .select("value").eq("provider_id", er.provider_id).eq("key", "reply_to").maybeSingle();
        // Org-level override wins; the platform default is Sporv support so a
        // parent's reply always lands somewhere staffed (owner 2026-09-01:
        // support@sporv.ai is the support address once sporv.ai is owned).
        // reply_to is tenant input too — accept only a bare, plausible email.
        const rawReply = ((replyRow?.value ?? {}) as { email?: string }).email;
        const replyTo = (rawReply && /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(rawReply) ? rawReply : null)
          ?? Deno.env.get("SUPPORT_EMAIL") ?? "support@sporv.ai";
        // CAN-SPAM opt-out (launch-audit blocker 8): a signed one-click
        // unsubscribe link in the headers AND the body. Token = HMAC of the
        // guardian id under the service key — no new secret, nothing stored.
        let unsubUrl: string | null = null;
        if (c.guardian_id) {
          try {
            const k = await crypto.subtle.importKey("raw",
              new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
              { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
            const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(c.guardian_id));
            const tok = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
            unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/unsubscribe?g=${c.guardian_id}&t=${tok}`;
          } catch { /* a missing link must never block the send */ }
        }
        try {
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${orgName} via Sporv <${slug}@${MAIL_DOMAIN}>`,
              ...(replyTo ? { reply_to: replyTo } : {}),
              to: [gEmail],
              subject: c.subject || `A message from ${orgName}`,
              text: c.body + (unsubUrl ? `\n\n—\nUnsubscribe from these messages: ${unsubUrl}` : ""),
              headers: {
                "X-Sporv-Message-Id": er.id,
                ...(unsubUrl ? {
                  "List-Unsubscribe": `<${unsubUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                } : {}),
              },
            }),
          });
          const rj = await resp.json().catch(() => ({}));
          if (resp.ok && rj?.id) {
            await admin.from("outbound_messages").update({
              status: "sent", sent_at: new Date().toISOString(),
              provider: "resend", provider_message_id: String(rj.id), last_error: null,
            }).eq("id", er.id).is("sent_at", null);
            emailSummary.emailed++;
          } else {
            const attempts = (er.attempt_count ?? 0) + 1;
            await admin.from("outbound_messages").update({
              status: attempts >= 3 ? "failed" : "approved",
              attempt_count: attempts,
              last_error: String(rj?.message ?? `resend ${resp.status}`).slice(0, 300),
            }).eq("id", er.id);
            emailSummary.emailFailed++;
          }
        } catch (sendErr) {
          const attempts = (er.attempt_count ?? 0) + 1;
          await admin.from("outbound_messages").update({
            status: attempts >= 3 ? "failed" : "approved",
            attempt_count: attempts, last_error: String(sendErr).slice(0, 300),
          }).eq("id", er.id);
          emailSummary.emailFailed++;
        }
       } catch (rowErr) {
        if (rowErr instanceof DeliveryPreconditionError) {
          try {
            await holdForReview(admin, er, rowErr.message);
          } catch {
            // Do not report success or retry delivery when even the failure
            // receipt cannot be confirmed. No external call occurred for this row.
            return json({ error: "Delivery review receipt unavailable.", ...emailSummary }, 503);
          }
          emailSummary.needsReview++;
          continue;
        }
        // isolation net for anything above: record, bounded-retry, move on.
        const attempts = (er.attempt_count ?? 0) + 1;
        await admin.from("outbound_messages").update({
          status: attempts >= 3 ? "failed" : "approved",
          attempt_count: attempts, last_error: String(rowErr).slice(0, 300),
        }).eq("id", er.id).is("sent_at", null).then(() => {}, () => {});
        emailSummary.emailFailed++;
       }
      }
    }

    const { data: rows, error } = await generationDb(signal => admin.from("outbound_messages")
      .select("*")
      .eq("status", "pending")
      .is("approved_by", null).is("approved_at", null).is("sent_at", null)
      .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(BATCH).abortSignal(signal));
    if (error || !Array.isArray(rows)) return json({ error: "Draft queue unavailable." }, 503);

    const summary = { processed: 0, skipped: 0, drafted: 0, autoSent: 0, fellBackToDraft: 0, failed: 0 };

    for (const row of rows ?? []) {
      const eventType = row.event_type as string;
      const providerId = row.provider_id as string;

      // A missing preference row is the documented default, but a failed read
      // is not permission to override a possibly-off mode. Read before claiming
      // so an unavailable preference leaves the row eligible for a later tick.
      let prefResult;
      try {
        prefResult = await generationDb(signal => admin.from("lifecycle_message_prefs")
          .select("mode").eq("provider_id", providerId).eq("event_type", eventType).abortSignal(signal).maybeSingle());
      } catch { return json({ error: "Lifecycle preference unavailable." }, 503); }
      if (prefResult.error || (prefResult.data !== null &&
        !["off", "draft", "auto"].includes(prefResult.data?.mode))) {
        return json({ error: "Lifecycle preference unavailable." }, 503);
      }
      const mode = prefResult.data?.mode ?? "draft";
      let action = resolveAction(mode, eventType);

      // ATOMIC CLAIM: flip pending -> processing for THIS row only. If another
      // (overlapping) tick already claimed it, the update matches 0 rows and we
      // skip. Generation can only claim unapproved, unsent rows in this org.
      const { data: claimed, error: claimError } = await generationDb(signal => admin.from("outbound_messages")
        .update({ status: "processing" })
        .eq("id", row.id).eq("provider_id", providerId).eq("status", "pending")
        .is("approved_by", null).is("approved_at", null).is("sent_at", null)
        .select("id, provider_id, status, approved_by, approved_at, sent_at").abortSignal(signal).maybeSingle());
      if (claimError) return json({ error: "Draft claim unavailable." }, 503);
      if (!claimed) continue;
      if (claimed.id !== row.id || claimed.provider_id !== providerId || claimed.status !== "processing" ||
        claimed.approved_by !== null || claimed.approved_at !== null || claimed.sent_at !== null) {
        return json({ error: "Draft claim receipt invalid." }, 503);
      }
      summary.processed++;

      if (action === "skip") {
        await finishGeneration(admin, row, "skipped", "lifecycle_mode_off");
        summary.skipped++;
        continue;
      }

      let ownerId: string | null;
      let ctx: Awaited<ReturnType<typeof resolveContext>>;
      try {
        ({ ownerId, ctx } = await generationDb(async signal => {
          const provider = await resolveProvider(admin, providerId, signal);
          const context = await resolveContext(admin, row, signal);
          signal.throwIfAborted();
          return { ownerId: provider.ownerId, ctx: context };
        }));
      } catch {
        await finishGeneration(admin, row, "pending", "draft_context_unavailable");
        summary.failed++;
        continue;
      }

      // Legacy AUTO keeps deterministic logistics preparation, not permission
      // to send. Every template lands in the same human approval queue.
      if (action === "auto") {
        const tpl = autoOrFallback(eventType, ctx);
        if (!tpl || !ctx.guardianId) {
          action = "draft";
          summary.fellBackToDraft++;
        } else {
          await storeDraft(admin, row, {
            ...(row.content && typeof row.content === "object" ? row.content : {}),
            body: tpl, auto: false, template: true,
          });
          summary.drafted++;
          continue;
        }
      }

      // DRAFT: generate, store, surface for approval. Nothing sends.
      let gen;
      try { gen = await generateDraft(admin, row, ownerId, ctx.childFirstName, ctx.guardianId); }
      catch { gen = { error: "draft_generation_unavailable" }; }
      if ("error" in gen) {
        // Retry policy still needs a separate generation budget/backoff; don't
        // consume the delivery attempt counter for a model-generation failure.
        await finishGeneration(admin, row, "pending", gen.error);
        summary.failed++;
        continue;
      }
      await storeDraft(admin, row, {
        ...(row.content && typeof row.content === "object" ? row.content : {}),
        body: gen.body, model: gen.model, removed: gen.removed, auto: false,
      });
      summary.drafted++;
    }

    return json({ ok: true, ...summary, ...emailSummary });
  } catch (e) {
    console.error("lifecycle-process error:", e);
    return json({ error: "Lifecycle processing failed." }, 500);
  }
});
