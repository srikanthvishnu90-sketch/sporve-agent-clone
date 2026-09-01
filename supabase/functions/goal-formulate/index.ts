// ============================================================================
// goal-formulate  (Supabase Edge Function) — grounded Plan-home headline
// ============================================================================
// Outcome-first Prompt 2. Turns a parent's RAW outcome sentence into a short,
// concise, GROUNDED headline for the Plan hero — e.g.
//   "I really want him to make the freshman basketball team next year"
//     -> "Make the freshman team"
// Routes through ai-gateway (task="extract" -> haiku, cheap tier,
// feature="goal_formulate"). A tool call constrains the output to a single
// string so the model returns ONLY the headline.
//
// HARD RULE (grounding): it may ONLY compress the parent's own words. It must
// NEVER inject a sport, team, level, age, date, or metric the parent didn't say.
// The caller (SupabaseRepository.formulateGoalHeadline) already falls back to a
// local, grounded truncation on any error/empty — so this function is
// best-effort and never blocks goal creation.
//
// Input:  { "outcome": "…", "sport"?: "Basketball" }
// Output: { "headline": string, "model"?, "audit_id"? } | { "error" }
// ============================================================================

import { HttpInputError, readBoundedJson } from "../_shared/http.ts";

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

const MAX_OUTCOME_CHARS = 600;
const MAX_HEADLINE_CHARS = 48;

const HEADLINE_TOOL = {
  name: "formulate_headline",
  description:
    "Return ONE short headline that compresses the parent's stated goal. Use ONLY words/ideas the parent actually expressed — never add a sport, team, level, age, date, or metric they did not say.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: {
        type: "string",
        description:
          "≤6 words, title-style, no trailing punctuation. A faithful compression of the parent's own goal — nothing invented.",
      },
    },
    required: ["headline"],
  },
};

const SYSTEM = [
  "You write a short Plan headline for a youth-sports family by calling the formulate_headline tool exactly once.",
  "",
  "HARD RULES (grounding — this is a safety-relevant product; do not break them):",
  "- Compress ONLY what the parent said. NEVER introduce a sport, team, skill level, age, date, place, or number they did not state.",
  "- Drop filler openers ('I want to', 'my goal is', 'I'd really like him to') and trailing rationale ('because…', 'so that…'). Keep the core outcome.",
  "- Do not add hype, adjectives, or coaching claims. No 'elite', 'best', 'guaranteed' unless the parent used that word.",
  "- Target ≤6 words, title-style capitalization, no trailing period.",
  "- If the parent's text is already short and concrete, return it essentially unchanged (just cleaned up).",
  "- A `sport` hint may be provided for context, but only use it in the headline if the parent's own words are about that sport.",
  "",
  "Examples:",
  "- 'I really want him to make the freshman basketball team next year' -> 'Make the freshman team'",
  "- 'we just want her to have fun and stay active' -> 'Have fun, stay active'",
  "- 'improve his ball-handling and confidence' -> 'Improve ball-handling and confidence'",
].join("\n");

// Server-side grounding guard: keep the headline short and free of trailing
// connective/punctuation dangle. Never fabricates — only trims the model output.
const TRAILING_STOPWORDS = new Set([
  "and", "or", "to", "the", "a", "an", "for", "with", "of", "in", "on", "at", "by", "&",
]);
function cleanHeadline(raw: unknown): string {
  let s = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  s = s.replace(/[\s.,;:!?]+$/g, ""); // strip trailing punctuation
  if (s.length > MAX_HEADLINE_CHARS) {
    // Word-safe cap, then drop a dangling connective.
    const words = s.split(" ");
    const kept: string[] = [];
    let len = 0;
    for (const w of words) {
      const add = kept.length === 0 ? w.length : len + 1 + w.length;
      if (kept.length > 0 && add > MAX_HEADLINE_CHARS) break;
      kept.push(w);
      len = add;
    }
    s = kept.join(" ");
  }
  const parts = s.split(" ");
  while (parts.length > 1 && TRAILING_STOPWORDS.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  return parts.join(" ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const body = await readBoundedJson(req);
    const outcome = typeof body?.outcome === "string" ? body.outcome.trim().slice(0, MAX_OUTCOME_CHARS) : "";
    if (!outcome) return json({ error: "Provide `outcome` (string)." }, 400);
    const sport = typeof body?.sport === "string" && body.sport.trim() ? body.sport.trim() : null;

    const userText = sport
      ? `SPORT (context only): ${sport}\nPARENT'S GOAL: """${outcome}"""`
      : `PARENT'S GOAL: """${outcome}"""`;

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "extract", // cheap/structured -> haiku
        feature: "goal_formulate",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
        tools: [HEADLINE_TOOL],
        tool_choice: { type: "tool", name: "formulate_headline" },
        maxTokens: 120,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) {
      // Non-fatal for the caller (it falls back locally); surface for observability.
      return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);
    }

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    const headline = cleanHeadline((call?.input as { headline?: unknown })?.headline);
    if (!headline) return json({ error: "Model did not return a headline." }, 502);

    return json({ headline, model: g?.model ?? null, audit_id: g?.audit?.id ?? null });
  } catch (e) {
    if (e instanceof HttpInputError) return json({ error: e.message }, e.status);
    console.error("goal-formulate error:", e);
    return json({ error: "The goal headline could not be generated." }, 500);
  }
});
