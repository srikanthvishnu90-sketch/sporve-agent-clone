// ============================================================================
// message-draft  (Supabase Edge Function)
// ============================================================================
// Drafts 1–2 reply options a youth-sports coach could send to a parent in a
// message thread. Routes through ai-gateway (task="draft" -> sonnet-4-6,
// feature="message_draft"). The coach's OWN approved writing is injected as
// tone guidance via buildCoachVoiceProfile — voice continuity only, never facts.
//
// This is a DRAFT step: it writes nothing and sends nothing. It does not insert
// into messages/notifications — a later deterministic send step would do that
// (mirrors the session-note-summarize -> parent-update-send split).
//
// HARD GUARDRAILS — system prompt AND post-validation (guardrail.ts): no
// certifications, credentials, licenses, degrees, or medical/safety claims;
// truthful over flattering; never invent facts about the child or sessions. A
// draft that is only a forbidden claim is stripped; if every draft is stripped
// the function REFUSES (returns needs_revision). Audit logging is one row per
// call inside ai-gateway (feature="message_draft").
//
// Input: {
//   providerId: string,                       // the coach drafting (must be caller)
//   threadContext: { role: string, body: string }[],  // recent thread messages
//   intent?: "reply" | "reschedule" | "followup",
//   childFirstName?: string,
//   bookingContext?: string                   // optional plain-text booking facts
// }
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCoachVoiceProfile } from "../_shared/coach_voice.ts";
import { enforceMessageDraftGuardrail } from "./guardrail.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

const VALID_INTENTS = new Set(["reply", "reschedule", "followup"]);

const DRAFTS_TOOL = {
  name: "message_drafts",
  description:
    "Emit 1-2 DISTINCT reply drafts for the coach to choose from and edit. Drafts only — they are never sent automatically.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      drafts: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        description: "1-2 distinct, ready-to-edit replies in the coach's voice.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", description: "A complete, warm, concise reply the coach could send as-is or lightly edit." },
          },
          required: ["text"],
        },
      },
    },
    required: ["drafts"],
  },
};

const SYSTEM = [
  "You draft a reply a youth-sports coach could send to a parent in a private message thread.",
  "You MUST call the message_drafts tool with 1-2 DISTINCT options (vary tone/length, not facts).",
  "",
  "HARD RULES (non-negotiable):",
  "- NO certifications, credentials, licenses, accreditations, or degrees of any kind — never claim or imply them.",
  "- NO medical or safety claims (injuries, diagnoses, 'cleared to play', 'safe to return', recovery, etc.).",
  "- Truthful over flattering. Never invent facts about the child, the sessions, schedules, prices, or availability. Use only what is given in the thread and bookingContext.",
  "- This is a DRAFT only: you write nothing and send nothing. Do not promise that something has been booked/changed — propose next steps instead.",
  "- If the parent asks to reschedule, acknowledge warmly and propose concrete next steps using only any availability given in bookingContext (do not invent times).",
  "- Tone anchors are the coach's OWN past writing — match their warmth/voice ONLY, never copy their facts.",
  "- Plain, warm language. Use the child's first name naturally when provided.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Identify the caller from their JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json({ error: "Not authenticated" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const providerId: string = typeof body?.providerId === "string" ? body.providerId : "";
    if (!providerId) return json({ error: "providerId is required." }, 400);

    const threadContext: { role: string; body: string }[] = Array.isArray(body?.threadContext)
      ? body.threadContext
          .map((m: unknown) => ({
            role: String((m as { role?: unknown })?.role ?? "").trim() || "parent",
            body: String((m as { body?: unknown })?.body ?? "").trim(),
          }))
          .filter((m: { body: string }) => m.body)
          .slice(-12)
      : [];
    if (threadContext.length === 0) {
      return json({ error: "threadContext must contain at least one message." }, 400);
    }

    const intentRaw = typeof body?.intent === "string" ? body.intent.toLowerCase().trim() : "";
    const intent = VALID_INTENTS.has(intentRaw) ? intentRaw : "reply";
    const childFirstName = typeof body?.childFirstName === "string" ? body.childFirstName.trim() : "";
    const bookingContext = typeof body?.bookingContext === "string" ? body.bookingContext.trim() : "";

    // AUTHORIZATION: caller must own this provider. This also guarantees the
    // voice profile we inject is the CALLER's own writing, never another coach's.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: prov } = await admin
      .from("providers").select("id").eq("id", providerId).eq("owner_id", uid).maybeSingle();
    if (!prov) return json({ error: "Not authorized to draft for this provider." }, 403);

    // Tone anchors — the coach's OWN approved writing (read-only).
    const coachStyleSamples = await buildCoachVoiceProfile(admin, providerId);

    // Build the user message.
    const renderRole = (r: string) => (/^(coach|provider|me|self)$/i.test(r) ? "Coach" : "Parent");
    const parts: string[] = [
      `Intent: ${intent}`,
      `Child's first name: ${childFirstName || "(not given)"}`,
      "",
      "Recent thread (oldest first):",
      ...threadContext.map((m) => `${renderRole(m.role)}: ${m.body}`),
    ];
    if (bookingContext) {
      parts.push("", "Booking facts you MAY use (do not go beyond these):", bookingContext);
    }
    if (coachStyleSamples.length) {
      parts.push("", "Tone anchors — match the coach's warmth/voice ONLY, never copy their facts:",
        ...coachStyleSamples.map((s) => `- ${s}`));
    }
    parts.push("", `Draft 1-2 distinct ${intent} options the coach could send. Follow every hard rule.`);

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "draft",
        feature: "message_draft",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: parts.join("\n") }] }],
        tools: [DRAFTS_TOOL],
        tool_choice: { type: "tool", name: "message_drafts" },
        maxTokens: 900,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    if (!call?.input) return json({ error: "Model did not return a draft.", raw: g }, 502);

    // Post-validation: strip any credential/medical/safety claims (defense in depth).
    const { drafts, removed, refused } = enforceMessageDraftGuardrail(
      (call.input as { drafts?: unknown }).drafts,
    );

    if (refused || drafts.length === 0) {
      return json({
        result: { type: "needs_revision", drafts: [] },
        model: g?.model ?? null,
        audit_id: g?.audit?.id ?? null,
        removed,
        note: "Refused — the draft contained only credential/medical/safety claims, which are not allowed. Nothing was written or sent.",
      });
    }

    return json({
      result: { type: "drafts", drafts }, // DRAFTS only — nothing written/sent
      model: g?.model ?? null,
      audit_id: g?.audit?.id ?? null,
      removed,                            // sentences post-validation stripped
      usedToneAnchors: coachStyleSamples.length,
      note: "Drafts only — not saved, not sent.",
    });
  } catch (e) {
    console.error("message-draft error:", e);
    return json({ error: "Message draft could not be generated." }, 500);
  }
});
