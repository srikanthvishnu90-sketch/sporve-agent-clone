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
//   • auto  -> ONLY logistics types. Fill a FIXED template with thin
//              personalization (child first name, date/time, place), status
//              'approved', then send via the notifications/inbox channel,
//              status='sent'. HARD GUARDRAIL: the auto path never calls the model
//              and never emits free-form content — if a clean logistics template
//              can't be built it FALLS BACK to draft (a human approves).
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
const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN") ?? "mail.sporv.com";
const BATCH = Number(Deno.env.get("LIFECYCLE_BATCH") ?? 25);

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

/** Resolve the coach's profile id (notification recipient author) + display name. */
async function resolveProvider(admin: Admin, providerId: string) {
  const { data } = await admin.from("providers")
    .select("owner_id, business_name").eq("id", providerId).maybeSingle();
  return {
    ownerId: (data as { owner_id?: string } | null)?.owner_id ?? null,
    businessName: (data as { business_name?: string } | null)?.business_name ?? null,
  };
}

/** Logistics vars + guardian for a row (child first name, date/time/place, guardian id). */
async function resolveContext(admin: Admin, row: Record<string, unknown>) {
  let childFirstName = "";
  let guardianId: string | null = null;
  if (row.child_id) {
    const { data: child } = await admin.from("athletes")
      .select("first_name, parent_id").eq("id", row.child_id as string).maybeSingle();
    childFirstName = (child as { first_name?: string } | null)?.first_name ?? "";
    guardianId = (child as { parent_id?: string } | null)?.parent_id ?? null;
  }
  let dateText = "", timeText = "", place = "";
  if (row.booking_id) {
    const { data: b } = await admin.from("bookings")
      .select("session_id, athlete_first_name").eq("id", row.booking_id as string).maybeSingle();
    if (!childFirstName) childFirstName = (b as { athlete_first_name?: string } | null)?.athlete_first_name ?? "";
    const sessionId = (b as { session_id?: string } | null)?.session_id ?? null;
    if (sessionId) {
      const { data: s } = await admin.from("sessions")
        .select("start_date, start_time, address").eq("id", sessionId).maybeSingle();
      const sd = s as { start_date?: string; start_time?: string; address?: string } | null;
      dateText = sd?.start_date ?? "";
      timeText = sd?.start_time ?? "";
      place = sd?.address ?? "";
    }
  }
  return { childFirstName, guardianId, dateText, timeText, place };
}

/** Deliver a finalized body to the child's guardian via the notifications channel. */
async function deliver(admin: Admin, guardianId: string, childFirstName: string, body: string) {
  const title = childFirstName ? `Message from your coach about ${childFirstName}` : "Message from your coach";
  const { error } = await admin.from("notifications")
    .insert([{ user_id: guardianId, title, message: body.slice(0, 280) }]);
  return !error;
}

/** Generate a drafted body via the gateway (service role, attributed to coach). */
async function generateDraft(
  admin: Admin, row: Record<string, unknown>, ownerId: string | null, childFirstName: string,
): Promise<{ body: string; removed: string[]; model: string | null; audit_id: string | null } | { error: string }> {
  const eventType = row.event_type as string;
  const samples = await buildCoachVoiceProfile(admin, row.provider_id as string);
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
  const g = await gResp.json();
  if (!gResp.ok) return { error: g?.error ?? `ai-gateway error (${gResp.status})` };
  const { body, removed } = enforceLifecycleDraft(g?.text ?? "");
  return { body, removed, model: g?.model ?? null, audit_id: g?.audit?.id ?? null };
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
    // Idempotency: the sent_at-null guard on the final UPDATE means a row can
    // never be delivered twice even across overlapping ticks.
    const emailSummary = { emailed: 0, emailSkipped: 0, emailFailed: 0, inApp: 0, windowDeferred: 0, needsReview: 0 };
    {
      const nowIso = new Date().toISOString();
      const { data: eRows } = await admin.from("outbound_messages")
        .select("id, provider_id, content, approved_by, attempt_count, send_after")
        .not("approved_by", "is", null)
        .is("sent_at", null)
        .in("status", ["approved"])
        .or(`send_after.is.null,send_after.lte.${nowIso}`)
        .order("created_at", { ascending: true })
        .limit(50);
      for (const er of eRows ?? []) {
        const c = er.content as { body?: string; subject?: string; to_email?: string; guardian_id?: string } | null;
        if (!c?.body || (!c?.to_email && !c?.guardian_id)) continue;

        // send window from settings (default 8am-8pm org tz, blocked days)
        const { data: winRow } = await admin.from("provider_settings")
          .select("value").eq("provider_id", er.provider_id).eq("key", "send_window").maybeSingle();
        const { data: tzRow } = await admin.from("provider_settings")
          .select("value").eq("provider_id", er.provider_id).eq("key", "org_tz").maybeSingle();
        const win = (winRow?.value ?? {}) as { start?: string; end?: string; blocked_days?: (string|number)[]; pause_until?: string };
        const tz = ((tzRow?.value ?? {}) as { tz?: string }).tz ?? "America/Chicago";
        const orgNow = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
        const hm = orgNow.getHours() * 60 + orgNow.getMinutes();
        const [ws, we] = [win.start ?? "08:00", win.end ?? "20:00"].map(t => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); });
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
          const { data: gg } = await admin.from("guardians")
            .select("user_id, email, email_status").eq("id", c.guardian_id).maybeSingle();
          const gr = gg as { user_id?: string; email?: string; email_status?: string } | null;
          claimedUser = gr?.user_id ?? null;
          gEmail = gr?.email ?? gEmail;
          gStatus = gr?.email_status ?? "ok";
        }

        if (claimedUser) {
          const { data: iClaim } = await admin.from("outbound_messages")
            .update({ status: "processing" }).eq("id", er.id).eq("status", "approved").select("id").maybeSingle();
          if (!iClaim) continue;
          const { error: nErr } = await admin.from("notifications")
            .insert([{ user_id: claimedUser, title: c.subject || "Message from your club", message: c.body.slice(0, 280) }]);
          if (nErr) {
            await admin.from("outbound_messages").update({ status: "approved", last_error: nErr.message.slice(0, 300) }).eq("id", er.id);
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
          await admin.from("outbound_messages").update({
            status: "needs_review", last_error: `guardian email_status=${gStatus}`,
          }).eq("id", er.id).eq("status", "approved");
          emailSummary.needsReview++; continue;
        }
        if (!RESEND_API_KEY || !gEmail) continue;   // key unset: leave for a future tick

        const { data: eClaimed } = await admin.from("outbound_messages")
          .update({ status: "processing" }).eq("id", er.id).eq("status", "approved").select("id").maybeSingle();
        if (!eClaimed) continue;
        const { data: prov } = await admin.from("providers")
          .select("business_name").eq("id", er.provider_id).maybeSingle();
        const orgName = (prov as { business_name?: string } | null)?.business_name ?? "Your club";
        const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "club";
        const { data: replyRow } = await admin.from("provider_settings")
          .select("value").eq("provider_id", er.provider_id).eq("key", "reply_to").maybeSingle();
        // Org-level override wins; the platform default is Sporv support so a
        // parent's reply always lands somewhere staffed (owner 2026-09-01:
        // support@sporv.com is the support address once sporv.com is owned).
        const replyTo = ((replyRow?.value ?? {}) as { email?: string }).email
          ?? Deno.env.get("SUPPORT_EMAIL") ?? "support@sporv.com";
        try {
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${orgName} via Sporv <${slug}@${MAIL_DOMAIN}>`,
              ...(replyTo ? { reply_to: replyTo } : {}),
              to: [gEmail],
              subject: c.subject || `A message from ${orgName}`,
              text: c.body,
              headers: { "X-Sporv-Message-Id": er.id },
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
      }
    }

    const { data: rows, error } = await admin.from("outbound_messages")
      .select("*")
      .eq("status", "pending")
      .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) return json({ error: error.message }, 500);

    const summary = { processed: 0, skipped: 0, drafted: 0, autoSent: 0, fellBackToDraft: 0, failed: 0 };

    for (const row of rows ?? []) {
      const eventType = row.event_type as string;
      const providerId = row.provider_id as string;

      // ATOMIC CLAIM: flip pending -> processing for THIS row only. If another
      // (overlapping) tick already claimed it, the update matches 0 rows and we
      // skip — this is the single guard against double-draft / double-send.
      const { data: claimed } = await admin.from("outbound_messages")
        .update({ status: "processing" })
        .eq("id", row.id).eq("status", "pending")
        .select("id").maybeSingle();
      if (!claimed) continue;
      summary.processed++;

      // Effective mode for this coach + event (default 'draft' when no pref row).
      const { data: pref } = await admin.from("lifecycle_message_prefs")
        .select("mode").eq("provider_id", providerId).eq("event_type", eventType).maybeSingle();
      const mode = (pref as { mode?: string } | null)?.mode ?? "draft";
      let action = resolveAction(mode, eventType);

      if (action === "skip") {
        await admin.from("outbound_messages").update({ status: "skipped" }).eq("id", row.id);
        summary.skipped++;
        continue;
      }

      const { ownerId } = await resolveProvider(admin, providerId);
      const ctx = await resolveContext(admin, row);

      // AUTO (logistics only): fixed template, no model. Fall back to draft if a
      // clean logistics template can't be built OR there's no guardian to deliver
      // to (the hard guardrail — a human approves instead of auto-sending).
      if (action === "auto") {
        const tpl = autoOrFallback(eventType, ctx);
        if (!tpl || !ctx.guardianId) {
          action = "draft";
          summary.fellBackToDraft++;
        } else {
          const sent = await deliver(admin, ctx.guardianId, ctx.childFirstName, tpl);
          await admin.from("outbound_messages").update({
            content: { body: tpl, auto: true, template: true },
            status: sent ? "sent" : "approved",
            approved_at: new Date().toISOString(),
            sent_at: sent ? new Date().toISOString() : null,
          }).eq("id", row.id);
          if (sent) summary.autoSent++; else summary.failed++;
          continue;
        }
      }

      // DRAFT: generate, store, surface for approval. Nothing sends.
      const gen = await generateDraft(admin, row, ownerId, ctx.childFirstName);
      if ("error" in gen) {
        // release the claim so a later tick can retry (see follow-up: add an
        // attempts cap to avoid unbounded retries on a permanently-bad row).
        await admin.from("outbound_messages").update({ status: "pending" }).eq("id", row.id);
        summary.failed++;
        continue;
      }
      await admin.from("outbound_messages").update({
        content: { body: gen.body, model: gen.model, removed: gen.removed, auto: false },
        status: "drafted",
      }).eq("id", row.id);
      summary.drafted++;
    }

    return json({ ok: true, ...summary, ...emailSummary });
  } catch (e) {
    console.error("lifecycle-process error:", e);
    return json({ error: "Lifecycle processing failed." }, 500);
  }
});
