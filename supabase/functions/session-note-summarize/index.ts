// ============================================================================
// session-note-summarize  (Supabase Edge Function)
// ============================================================================
// Turns a coach's raw session notes into a parent-facing DRAFT update — or asks
// for clarification when the notes are too thin to summarize honestly. Routes
// through ai-gateway (task="summarize" -> sonnet-4-6, feature="session_notes").
//
// Output is forced via tool-use to exactly ONE of two shapes:
//   { type:"draft", summary_body, skills_worked[], progress_signal,
//     practice_suggestions[], encouragement }
//   { type:"needs_clarification", questions[] }
//
// HARD GUARDRAILS — enforced in the system prompt AND post-validated
// (guardrail.ts): never invent skills/progress not in rawNotes; truthful over
// flattering; no credentials/certifications/safety/medical claims; when in doubt
// drop it or ask. Returns a DRAFT only: writes nothing, sends nothing, approves
// nothing. Audit logging happens inside ai-gateway.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { enforceSummaryGuardrail } from "./guardrail.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

const DRAFT_TOOL = {
  name: "session_update_draft",
  description: "Emit a parent-facing draft update. Use ONLY when the raw notes contain enough concrete detail to summarize honestly.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary_body: { type: "string", description: "2-4 warm, plain-language sentences for the parent. Truthful over flattering. Only facts from the raw notes." },
      skills_worked: { type: "array", items: { type: "string" }, description: "Skills explicitly present in the raw notes. If a skill isn't mentioned, omit it." },
      progress_signal: { type: "string", description: "An honest, grounded read on progress (e.g. 'building consistency', 'early stages'). No fabricated milestones." },
      practice_suggestions: { type: "array", items: { type: "string" }, description: "Optional at-home suggestions tied to what was actually worked on." },
      encouragement: { type: "string", description: "A short, genuine encouraging note." },
    },
    required: ["summary_body", "skills_worked", "progress_signal", "practice_suggestions", "encouragement"],
  },
};

const CLARIFY_TOOL = {
  name: "needs_clarification",
  description: "Use when the raw notes are too thin/vague to summarize honestly. Ask specific questions instead of guessing.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: { type: "array", items: { type: "string" }, description: "1-4 specific questions that would let you write an honest update." },
    },
    required: ["questions"],
  },
};

const SYSTEM = [
  "You write a warm, honest, parent-facing update from a youth-sports coach's RAW session notes. The raw notes are the ONLY source of truth.",
  "You MUST call exactly one tool: session_update_draft (when the notes support an honest summary) or needs_clarification (when they do not).",
  "",
  "HARD RULES (non-negotiable):",
  "- NEVER invent progress, skills, drills, or outcomes that are not in the raw notes. If a skill isn't mentioned, it does not appear anywhere in your output.",
  "- Truthful over flattering. Do not inflate. No fabricated milestones or results.",
  "- NO credentials, certifications, or safety/medical claims of any kind (no 'cleared to play', injuries, diagnoses, etc.).",
  "- When in doubt about whether the notes support a statement, drop it — or, if the notes are too thin overall, call needs_clarification with specific questions instead of guessing.",
  "- Plain language a parent will understand. Use the child's first name naturally.",
  "- Previous-update text and tone-anchor samples are for VOICE/CONTINUITY ONLY — never a source of new facts.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const rawNotes: string = typeof body?.rawNotes === "string" ? body.rawNotes.trim() : "";
    const childFirstName: string = typeof body?.childFirstName === "string" ? body.childFirstName.trim() : "";
    const sport: string = typeof body?.sport === "string" ? body.sport.trim() : "";
    const lastUpdateSummary: string = typeof body?.lastUpdateSummary === "string" ? body.lastUpdateSummary.trim() : "";
    const coachStyleSamples: string[] = Array.isArray(body?.coachStyleSamples)
      ? body.coachStyleSamples.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 2)
      : [];

    if (!rawNotes) return json({ error: "rawNotes is required." }, 400);

    const parts: string[] = [
      `Child's first name: ${childFirstName || "(not given)"}`,
      `Sport: ${sport || "(not given)"}`,
      "",
      "Coach's raw notes (the ONLY source of truth — do not go beyond these):",
      `"""\n${rawNotes}\n"""`,
    ];
    if (lastUpdateSummary) {
      parts.push("", "Previous update (for continuity of voice ONLY — not a source of new facts):", lastUpdateSummary);
    }
    if (coachStyleSamples.length) {
      parts.push("", "Tone anchors — match the warmth/voice ONLY, never copy their facts:",
        ...coachStyleSamples.map((s) => `- ${s}`));
    }
    parts.push("", `Write the update for ${childFirstName || "the athlete"} using ONLY facts in the raw notes. If the notes are too thin to be honest, call needs_clarification.`);

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "summarize",
        feature: "session_notes",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: parts.join("\n") }] }],
        tools: [DRAFT_TOOL, CLARIFY_TOOL],
        tool_choice: { type: "any" }, // must use one of the two tools
        maxTokens: 1200,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    if (!call?.name || !call?.input) {
      return json({ error: "Model did not return a tool result.", raw: g }, 502);
    }

    let result: Record<string, unknown>;
    let removed: string[] = [];
    if (call.name === "needs_clarification") {
      ({ result } = enforceSummaryGuardrail({ type: "needs_clarification", ...call.input }, rawNotes));
    } else {
      ({ result, removed } = enforceSummaryGuardrail({ type: "draft", ...call.input }, rawNotes));
    }

    return json({
      result,                       // DRAFT or needs_clarification — nothing written/sent
      model: g?.model ?? null,
      audit_id: g?.audit?.id ?? null,
      removed,                      // what post-validation stripped (ungrounded/claims)
      note: "Draft only — not saved, not sent, not approved.",
    });
  } catch (e) {
    console.error("session-note-summarize error:", e);
    return json({ error: "Session note could not be summarized." }, 500);
  }
});
