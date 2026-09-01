// ============================================================================
// chat-parse-query  (Supabase Edge Function) — customer AI chat NL → QueryIntent
// ============================================================================
// Prompt 1/3 of the customer AI chat: converts a user's free-text question into
// a structured QueryIntent filter object. PARSING ONLY — no searching, ranking,
// or answering here. Routes through ai-gateway (task="parse" -> haiku, cheap
// tier, feature="chat_query_parse"). A tool call constrains the output to the
// QueryIntent schema so the model returns ONLY structured JSON.
//
// It extracts ONLY what the user actually said; unstated fields stay null and
// nothing is invented. Defaults (location, radius, active child's age) are
// merged AFTER parsing IN CODE (client-side QueryIntent.mergeDefaults) — never
// by the model.
//
// Input:  { "query": "cheapest basketball trainer for my 12 year old" }
// Output: QueryIntent JSON (all fields nullable) | { "error" }
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

const SORTS = ["cheapest", "closest", "top_rated", "best_fit"];
const INTENTS = ["find_providers", "compare", "question_about_booking", "other"];
const SESSION_TYPES = ["one_on_one", "group"];
const SKILLS = ["beginner", "intermediate", "advanced", "all_levels"];

const QUERY_INTENT_TOOL = {
  name: "query_intent",
  description:
    "Return the structured QueryIntent for the user's message. Every field is nullable — set ONLY the fields the user explicitly stated.",
  input_schema: {
    type: "object",
    properties: {
      sport: { type: ["string", "null"], description: "e.g. basketball, soccer, tennis" },
      session_type: { type: ["string", "null"], enum: [...SESSION_TYPES, null] },
      price_max_cents: { type: ["integer", "null"], description: "money in CENTS, e.g. $75 -> 7500" },
      price_min_cents: { type: ["integer", "null"] },
      max_distance_km: { type: ["number", "null"] },
      age: { type: ["integer", "null"], description: "athlete age in years" },
      skill_level: { type: ["string", "null"], enum: [...SKILLS, null] },
      availability_window: { type: ["string", "null"], description: "e.g. this_weekend, today, evenings" },
      sort_preference: { type: ["string", "null"], enum: [...SORTS, null] },
      intent_type: { type: ["string", "null"], enum: INTENTS },
    },
    required: ["intent_type"],
    additionalProperties: false,
  },
};

const SYSTEM =
  `You convert a youth-sports customer's free-text message into a structured QueryIntent by calling the query_intent tool exactly once.

HARD RULES:
- Extract ONLY what the user actually said. NEVER invent a filter they didn't state. Unstated fields MUST be null.
- Normalize money to CENTS: "under $75" -> price_max_cents: 7500. "over $30" -> price_min_cents: 3000.
- Normalize ages: "my 12-year-old" / "for my 12 yo" -> age: 12.
- Normalize distances to kilometers (miles * 1.60934).
- "private lessons" / "1-on-1" / "individual training" / "one-on-one" -> session_type: "one_on_one".
- sort_preference is one of cheapest | closest | top_rated | best_fit — only when the user expresses a preference ("cheapest", "closest", "top rated", "best fit").
- intent_type: "find_providers" when they want coaches/programs; "compare" when they ask to compare options; "question_about_booking" for refunds/cancellation/payment/how-booking-works; "other" for anything ambiguous or off-topic.
- For "find_providers" and "compare", extract any stated filters (a comparison can still be scoped, e.g. "compare the two basketball coaches under $50"). For "question_about_booking" and "other", leave ALL filter fields null.`;

// Coerce the model's tool output into the strict nullable QueryIntent shape.
function coerce(o: Record<string, unknown>) {
  const str = (v: unknown, allow?: string[]) =>
    typeof v === "string" && v.trim() && (!allow || allow.includes(v)) ? v : null;
  const int = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v) : null);
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const intent = str(o.intent_type, INTENTS) ?? "other";
  const keep = intent === "find_providers" || intent === "compare";
  return {
    sport: keep ? str(o.sport) : null,
    session_type: keep ? str(o.session_type, SESSION_TYPES) : null,
    price_max_cents: keep ? int(o.price_max_cents) : null,
    price_min_cents: keep ? int(o.price_min_cents) : null,
    max_distance_km: keep ? num(o.max_distance_km) : null,
    age: keep ? int(o.age) : null,
    skill_level: keep ? str(o.skill_level, SKILLS) : null,
    availability_window: keep ? str(o.availability_window) : null,
    sort_preference: keep ? str(o.sort_preference, SORTS) : null,
    intent_type: intent,
    location: null, // defaults are merged in code (client), never by the model
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const body = await readBoundedJson(req);
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) return json({ error: "Provide `query` (string)." }, 400);

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "parse",
        feature: "chat_query_parse",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: query }] }],
        tools: [QUERY_INTENT_TOOL],
        tool_choice: { type: "tool", name: "query_intent" },
        maxTokens: 400,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) {
      return json({ error: g?.error ?? `ai-gateway error (${gResp.status})` }, 502);
    }
    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    if (!call?.input) return json({ error: "Model did not return a QueryIntent." }, 502);

    return json(coerce(call.input as Record<string, unknown>));
  } catch (e) {
    if (e instanceof HttpInputError) return json({ error: e.message }, e.status);
    console.error("chat-parse-query error:", e);
    return json({ error: "The query could not be parsed." }, 500);
  }
});
