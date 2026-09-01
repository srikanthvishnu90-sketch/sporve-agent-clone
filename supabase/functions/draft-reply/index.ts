// ============================================================================
// draft-reply  (Supabase Edge Function) — AUTOMATIC grounded reply draft
// ============================================================================
// AI Front Office items #5 (gather) + #6 (one grounded Claude call) + #7 (save an
// invisible-to-parent draft). Invoked by the DB webhook (20260728_000701) when a
// PARENT posts a message. It gathers ONLY server-side facts the coach has actually
// entered, asks Claude — THROUGH ai-gateway — for a strict-JSON reply, and INSERTS
// that reply back into the SAME conversation as a coach-only draft
// (status='ai_draft', visible_to_parent=false). It NEVER auto-sends in v1.
//
// Auth: server-only. Requires the exact service-role bearer (same as
// lifecycle-process). verify_jwt is OFF; there is no user JWT here — the caller is
// the trigger. A forged/absent bearer is rejected 403.
//
// GROUNDING (L-012 — the whole point): the reply may cite ONLY the coach's own
// recurring_slots (pricing/times), the five policy columns, service area,
// verification status, and the last ~10 messages. If a fact is missing, the reply
// must say the coach will confirm — NEVER guess a price or a time. Nothing invented.
//
// NO FAKE SUCCESS (doc #2): on any model/parse failure we LOG and insert NOTHING —
// a bad draft is worse than no draft. The parent's message already persisted; the
// coach simply gets no auto-draft that turn.
//
// Input (from the trigger): { message_id, conversation_id }
//   Also tolerates a Dashboard Database-Webhook payload: { record: { id, ... } }.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

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

type Admin = ReturnType<typeof createClient>;

const VALID_INTENTS = new Set(["booking", "pricing", "scheduling", "other"]);
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Strict-JSON contract for the reply. Forced tool_choice => the model MUST fill it.
const REPLY_TOOL = {
  name: "drafted_reply",
  description:
    "Emit ONE grounded reply draft for the coach to review. Draft only — never sent automatically. Cite only facts present in the provided context.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply_text: {
        type: "string",
        description: "The reply, in the coach's voice, under ~80 words. If a needed fact is missing, say the coach will confirm — never guess.",
      },
      intent: {
        type: "string",
        enum: ["booking", "pricing", "scheduling", "other"],
        description: "The parent's primary intent in their latest message.",
      },
      booking_link: {
        type: ["string", "null"],
        description: "A booking link ONLY when intent='booking' AND a matching open slot exists in the context; otherwise null.",
      },
      confidence: {
        type: "number",
        description: "0..1 — how well the gathered facts actually cover the parent's question.",
      },
    },
    required: ["reply_text", "intent", "booking_link", "confidence"],
  },
};

const SYSTEM = [
  "You draft a reply a youth-sports coach could send to a parent in a private message thread. You will CALL the drafted_reply tool — nothing else.",
  "",
  "GROUNDING — non-negotiable (you are quoted verbatim to a real parent):",
  "- Use ONLY facts in the CONTEXT block (the coach's slots, prices, policies, FAQ, service area, verification, and the recent thread). Treat that block as the ENTIRE world.",
  "- NEVER state a price, time, day, or availability that is not present in the context. If the parent asks something the context does not answer, say the coach will confirm — do NOT guess, estimate, or invent.",
  "- NEVER confirm or promise a booking, a change, or a charge. You draft; the coach decides. Propose next steps instead.",
  "- Prices in the context are in CENTS. When you quote money, convert to dollars (e.g. 8000 -> $80). You MAY do arithmetic ONLY on numbers that appear in the context (e.g. two sessions/week = 2 x the per-session price). Never introduce a number that isn't derivable from the context.",
  "- NO certifications, credentials, licenses, degrees, or medical/safety claims of any kind.",
  "",
  "STYLE:",
  "- Match the coach's tone from the recent thread. Warm, plain, concise — keep the reply under ~80 words.",
  "- Set intent to the parent's primary ask (booking|pricing|scheduling|other).",
  "- booking_link: provide a value ONLY when intent='booking' AND the context lists at least one matching OPEN slot; otherwise null. If unsure, null.",
  "- confidence reflects how fully the context answers the parent — low when you had to defer to the coach.",
].join("\n");

/** Coerce a Postgres `time` value ("17:00:00") to a friendly "5:00 PM". */
function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
  if (!m) return String(t ?? "");
  let h = Number(m[1]);
  const min = m[2];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    // Server-only: require the exact injected service-role secret. Never authorize
    // by decoding a JWT claim — a forged payload can claim any role.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (bearer !== SERVICE_ROLE_KEY) {
      return json({ error: "Forbidden (service role only)." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    // Accept our trigger shape { message_id } OR a Dashboard webhook { record.id }.
    const record = (body?.record ?? null) as { id?: unknown } | null;
    const messageId: string =
      typeof body?.message_id === "string" ? body.message_id
      : typeof record?.id === "string" ? record.id
      : "";
    if (!messageId) return json({ error: "message_id is required." }, 400);

    const admin: Admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Load the triggering message + its conversation (service role: RLS bypassed;
    //    we re-assert the parent-authored guard ourselves so a direct/bad call can't
    //    make us draft on a coach message or a draft). ─────────────────────────────
    const { data: msg, error: msgErr } = await admin
      .from("messages")
      .select("id, conversation_id, sender_id, body, status, visible_to_parent")
      .eq("id", messageId)
      .maybeSingle();
    if (msgErr || !msg) return json({ error: "Message not found." }, 404);

    // Never draft off a draft (no loop) or a coach-only row.
    if (msg.status !== "sent" || msg.visible_to_parent !== true) {
      return json({ skipped: "not a sent, parent-visible message." });
    }

    const { data: convo, error: cErr } = await admin
      .from("conversations")
      .select("id, searcher_id, provider_id, program_id")
      .eq("id", msg.conversation_id)
      .maybeSingle();
    if (cErr || !convo) return json({ error: "Conversation not found." }, 404);

    // The message MUST be from the parent (searcher). Coach messages never draft.
    if (msg.sender_id !== convo.searcher_id) {
      return json({ skipped: "message is not parent-authored." });
    }
    const coachProfileId = convo.provider_id; // the coach = provider owner's profile

    // ── #5 GATHER — server-side facts ONLY. Nothing invented. ───────────────────
    // The coach's provider row (owner_id = the coach's profile id). This is the
    // single source of truth for policies + verification the reply may cite.
    const { data: prov } = await admin
      .from("providers")
      .select(
        "id, business_name, verification_status, background_check_status, account_status, status, " +
        "cancellation_policy, what_to_bring, travel_radius, session_notes, faq",
      )
      .eq("owner_id", coachProfileId)
      .maybeSingle();
    if (!prov) {
      // No provider profile → nothing to ground on. Do NOT fabricate a reply.
      console.error("draft-reply: no provider row for coach", coachProfileId);
      return json({ skipped: "no provider profile to ground on." });
    }

    // Recurring slots = the coach's real, published availability + pricing.
    const { data: slots } = await admin
      .from("recurring_slots")
      .select("day_of_week, start_time, duration_minutes, capacity, price_cents, currency, active")
      .eq("provider_id", prov.id)
      .eq("active", true)
      .order("day_of_week", { ascending: true });
    const openSlots = Array.isArray(slots) ? slots : [];

    // Last ~10 messages of THIS conversation (oldest first), for tone + context.
    const { data: recent } = await admin
      .from("messages")
      .select("sender_id, body, created_at, status")
      .eq("conversation_id", convo.id)
      .eq("status", "sent")           // only real, sent messages — never prior drafts
      .order("created_at", { ascending: false })
      .limit(10);
    const thread = (Array.isArray(recent) ? recent : [])
      .reverse()
      .map((m) => ({
        who: m.sender_id === convo.searcher_id ? "Parent" : "Coach",
        body: String(m.body ?? "").trim(),
      }))
      .filter((m) => m.body);

    // Verification status the reply may state (fact, not a credential claim).
    const isVerified = prov.background_check_status === "verified" &&
      (prov.account_status ?? "active") === "active";

    // FAQ → readable Q/A lines (shape-guarded to an array at the DB — 20260728_000600).
    const faqLines: string[] = Array.isArray(prov.faq)
      ? (prov.faq as Array<{ question?: unknown; answer?: unknown }>)
          .map((f) => {
            const q = String(f?.question ?? "").trim();
            const a = String(f?.answer ?? "").trim();
            return q && a ? `Q: ${q} A: ${a}` : "";
          })
          .filter(Boolean)
          .slice(0, 20)
      : [];

    // ── Build the CONTEXT block — the ENTIRE world the model may cite. ──────────
    const ctx: string[] = [];
    ctx.push("COACH PROFILE FACTS (the only facts you may cite):");
    ctx.push(`- Name: ${String(prov.business_name ?? "the coach")}`);
    ctx.push(`- Background check: ${isVerified ? "verified/background-checked" : "not yet verified — do not claim verification"}`);
    ctx.push(`- Service area: ${prov.travel_radius ? String(prov.travel_radius) : "(not provided — say the coach will confirm)"}`);
    ctx.push(`- Cancellation policy: ${prov.cancellation_policy ? String(prov.cancellation_policy) : "(not provided — say the coach will confirm)"}`);
    ctx.push(`- What to bring: ${prov.what_to_bring ? String(prov.what_to_bring) : "(not provided — say the coach will confirm)"}`);
    if (prov.session_notes) ctx.push(`- Session notes: ${String(prov.session_notes)}`);
    ctx.push("");

    if (openSlots.length) {
      ctx.push("OPEN WEEKLY SLOTS (day, time, duration, capacity, price in CENTS — the ONLY prices/times you may cite):");
      for (const s of openSlots) {
        const day = DOW[Number(s.day_of_week)] ?? `day ${s.day_of_week}`;
        ctx.push(
          `- ${day} at ${fmtTime(String(s.start_time))}, ${s.duration_minutes} min, ` +
          `holds ${s.capacity}, price_cents=${s.price_cents} ${String(s.currency ?? "USD")}`,
        );
      }
    } else {
      ctx.push("OPEN WEEKLY SLOTS: (none published — do not state any specific price, time, or availability; say the coach will confirm openings).");
    }
    ctx.push("");

    if (faqLines.length) {
      ctx.push("COACH FAQ (you may answer from these verbatim):");
      for (const l of faqLines) ctx.push(`- ${l}`);
      ctx.push("");
    }

    ctx.push("RECENT THREAD (oldest first):");
    for (const m of thread) ctx.push(`${m.who}: ${m.body}`);
    ctx.push("");
    ctx.push("Draft the coach's reply to the Parent's LATEST message, following every grounding rule. Call drafted_reply.");

    // ── #6 ONE Claude call THROUGH ai-gateway (service role; sonnet via task=draft). ─
    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "draft",                 // -> sonnet workhorse tier
        feature: "draft_reply",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: ctx.join("\n") }] }],
        tools: [REPLY_TOOL],
        tool_choice: { type: "tool", name: "drafted_reply" },
        actorId: prov.id,
        actorRole: "provider",
        maxTokens: 600,
      }),
    });
    const g = await gResp.json().catch(() => ({}));
    if (!gResp.ok) {
      // NO FAKE SUCCESS: log + insert nothing.
      console.error("draft-reply: ai-gateway error", gResp.status, g?.error);
      return json({ error: g?.error ?? `ai-gateway error (${gResp.status})` }, 502);
    }

    // ── Parse defensively. Any shortfall => insert NOTHING (doc #2). ────────────
    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    const out = (call?.input ?? {}) as {
      reply_text?: unknown; intent?: unknown; booking_link?: unknown; confidence?: unknown;
    };
    const replyText = typeof out.reply_text === "string" ? out.reply_text.trim() : "";
    if (!replyText) {
      console.error("draft-reply: model returned no reply_text; no draft written.");
      return json({ error: "Model did not return a usable draft." }, 502);
    }
    const intentRaw = typeof out.intent === "string" ? out.intent.toLowerCase().trim() : "other";
    const intent = VALID_INTENTS.has(intentRaw) ? intentRaw : "other";
    let confidence = typeof out.confidence === "number" && Number.isFinite(out.confidence)
      ? out.confidence : 0.5;
    confidence = Math.min(1, Math.max(0, confidence)); // clamp to the DB check range

    // booking_link is server-authoritative (defense in depth): keep a link ONLY
    // when intent='booking' AND at least one open slot actually exists. Never trust
    // a model-invented URL — derive our own deep link to the coach's slots.
    const bookingLink = (intent === "booking" && openSlots.length > 0)
      ? `sporve://coach/${prov.id}/book`
      : null;

    // ── #7 INSERT the draft — coach-only, NEVER auto-sent. ──────────────────────
    // sender_id = the coach (so it renders as the coach's outgoing reply once sent).
    // status='ai_draft' + visible_to_parent=false => the parent can't read it (RLS)
    // and the 20260728_000701 trigger won't re-fire on it (no loop). We do NOT touch
    // conversations.last_message, so the parent's thread preview shows nothing new.
    const insertRow: Record<string, unknown> = {
      conversation_id: convo.id,
      sender_id: coachProfileId,
      body: bookingLink ? `${replyText}\n\nBook here: ${bookingLink}` : replyText,
      status: "ai_draft",
      visible_to_parent: false,
      intent,
      confidence,
    };
    const { data: draft, error: insErr } = await admin
      .from("messages").insert(insertRow).select("id").single();
    if (insErr || !draft) {
      console.error("draft-reply: draft insert failed:", insErr?.message);
      return json({ error: "Draft could not be saved." }, 500);
    }

    return json({
      result: "drafted",
      draft_id: draft.id,
      intent,
      confidence,
      booking_link: bookingLink,
      model: g?.model ?? null,
      audit_id: g?.audit?.id ?? null,
      grounded_on: {
        open_slots: openSlots.length,
        faq_items: faqLines.length,
        thread_messages: thread.length,
        verified: isVerified,
      },
      note: "Draft saved (coach-only). Never auto-sent — the coach reviews and sends.",
    });
  } catch (e) {
    console.error("draft-reply error:", e);
    return json({ error: "Draft reply could not be generated." }, 500);
  }
});
