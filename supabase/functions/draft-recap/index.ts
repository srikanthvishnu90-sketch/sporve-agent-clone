// ============================================================================
// draft-recap  (Supabase Edge Function)  — AI Front Office doc #11
// ============================================================================
// Turns a coach's three taps (skills + effort + optional one-line note) into a
// warm, honest, 2–4 sentence parent recap. Routes through ai-gateway
// (task="summarize" -> sonnet, feature="session_recap"). Personalises VOICE from
// the coach's own draft_feedback corpus (the #9 moat) — never facts.
//
// Output is forced via tool-use to exactly ONE shape: { recap_text }.
//
// HARD GUARDRAILS (system prompt + the doc #11 rules): warm + specific; NO
// fabricated milestones; no promises about outcomes/results; athlete FIRST NAME
// ONLY (never last name / DOB — L-005); nothing in the recap that wasn't tapped
// (L-012). Returns a DRAFT only — writes nothing, sends nothing. The coach
// reviews + Sends through the existing parent-update rails (doc #12). Audit
// logging happens inside ai-gateway.
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
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

const RECAP_TOOL = {
  name: "session_recap",
  description: "Emit a warm, parent-facing recap of the session. 2-4 sentences. Only facts from the tapped skills/effort/note.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      recap_text: {
        type: "string",
        description:
          "2-4 warm, plain-language sentences for the parent, using the child's FIRST NAME only. " +
          "Built ONLY from the tapped skills, the effort level, and the optional note. " +
          "No fabricated milestones, no promises about future outcomes/results, no credentials/medical/safety claims.",
      },
    },
    required: ["recap_text"],
  },
};

const EFFORT_WORDS: Record<number, string> = { 1: "steady effort", 2: "solid effort", 3: "outstanding effort" };

const SYSTEM = [
  "You write a short, warm, honest recap of a youth-sports session for a parent, from a coach's three taps.",
  "The tapped skills, the effort level, and the optional one-line note are the ONLY source of truth.",
  "You MUST call the session_recap tool exactly once.",
  "",
  "HARD RULES (non-negotiable):",
  "- 2 to 4 sentences. Warm and specific, never generic filler.",
  "- Use ONLY the tapped skills, the effort level, and the note. If it wasn't tapped, it does not appear.",
  "- NO fabricated milestones ('first ever…', 'best in the group') unless the note literally says so.",
  "- NO promises about future outcomes or results ('will make the team', 'guaranteed to improve').",
  "- NO credentials, certifications, or safety/medical claims of any kind.",
  "- Use the athlete's FIRST NAME only. Never a last name.",
  "- Tone samples (if given) are for VOICE/warmth ONLY — never a source of facts.",
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
    const childFirstName: string = typeof body?.childFirstName === "string" ? body.childFirstName.trim() : "";
    const sport: string = typeof body?.sport === "string" ? body.sport.trim() : "";
    const skills: string[] = Array.isArray(body?.skills)
      ? body.skills.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 8)
      : [];
    const effortRaw = Number(body?.effort);
    const effort = Number.isFinite(effortRaw) && effortRaw >= 1 && effortRaw <= 3 ? Math.round(effortRaw) : null;
    const note: string = typeof body?.note === "string" ? body.note.trim().slice(0, 280) : "";

    // At least one real fact to ground on.
    if (skills.length === 0 && effort === null && !note) {
      return json({ error: "Tap at least one skill, an effort level, or a note." }, 400);
    }

    // Tone samples: the coach's OWN recent sent/edited drafts (#9 corpus). RLS on
    // draft_feedback is coach-owns-own, so the user client only ever sees theirs.
    // Voice only — never facts. Best-effort: an empty/failed read just omits them.
    let toneSamples: string[] = [];
    try {
      const { data: fb } = await userClient
        .from("draft_feedback")
        .select("final_text, action, edited_at")
        .in("action", ["sent_as_is", "edited"])
        .not("final_text", "is", null)
        .order("edited_at", { ascending: false })
        .limit(3);
      toneSamples = (fb ?? [])
        .map((r: Record<string, unknown>) => String(r?.final_text ?? "").trim())
        .filter(Boolean)
        .slice(0, 2);
    } catch (_) {
      // logged-and-ignored: tone personalisation is best-effort, never blocks a recap.
      console.error("draft-recap: tone-sample lookup failed (continuing without)");
    }

    const parts: string[] = [
      `Child's first name: ${childFirstName || "(not given — write generically, no name)"}`,
      `Sport: ${sport || "(not given)"}`,
      "",
      "The coach's three taps (the ONLY source of truth):",
      `- Skills worked on: ${skills.length ? skills.join(", ") : "(none tapped)"}`,
      `- Effort: ${effort !== null ? EFFORT_WORDS[effort] : "(not tapped)"}`,
      `- Coach's note: ${note ? `"${note}"` : "(none)"}`,
    ];
    if (toneSamples.length) {
      parts.push("", "Tone anchors — match the warmth/voice ONLY, never copy their facts:",
        ...toneSamples.map((s) => `- ${s}`));
    }
    parts.push("", `Write the recap for ${childFirstName || "the athlete"} using ONLY the three taps above.`);

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "summarize",
        feature: "session_recap",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: parts.join("\n") }] }],
        tools: [RECAP_TOOL],
        tool_choice: { type: "tool", name: "session_recap" },
        maxTokens: 600,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    const recapText = typeof call?.input?.recap_text === "string" ? call.input.recap_text.trim() : "";
    if (!recapText) {
      // No fabricated success (doc #2 rule): if the model returned nothing usable,
      // surface an error rather than an empty/fake recap.
      return json({ error: "Recap could not be drafted from these taps.", raw: g }, 502);
    }

    return json({
      result: { recap_text: recapText },   // DRAFT only — nothing written/sent/approved
      model: g?.model ?? null,
      audit_id: g?.audit?.id ?? null,
      note: "Draft only — the coach reviews and Sends through the existing parent-update rails.",
    });
  } catch (e) {
    console.error("draft-recap error:", e);
    return json({ error: "Recap could not be drafted." }, 500);
  }
});
