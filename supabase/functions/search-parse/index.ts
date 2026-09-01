// ============================================================================
// search-parse  (Supabase Edge Function) — NL query -> editable constraint chips
// ============================================================================
// Turns a parent's free-text search into structured, EDITABLE constraints (the
// parse-to-chips pattern). Routes through ai-gateway (task="parse" -> haiku,
// feature="search_parse"). It ONLY extracts constraints explicitly present in the
// query — it does not search, rank, or invent. Every field is nullable so the UI
// renders only what was actually said.
//
// Output: {
//   sport, athlete_age (int), metro, max_price (number), radius_miles (number),
//   soft_attributes: string[]   // ranking HINTS ("beginner-friendly", "patient",
//                               // "competitive") — never hard filters
// }
//
// Rules: leave unstated fields null. Apply a sensible default radius ONLY when a
// location is present (parsed metro or parentLocationHint) and radius is unstated.
// Identical query strings are served from a cache (no model call, no audit row).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateCaller } from "../_shared/auth.ts";

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
const DEFAULT_RADIUS_MILES = Number(Deno.env.get("SEARCH_DEFAULT_RADIUS_MILES") ?? 25);

const PARSE_TOOL = {
  name: "search_constraints",
  description:
    "Extract ONLY the constraints explicitly present in the parent's query. Leave anything not stated as null. Never infer, guess, or invent values.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sport: { type: ["string", "null"], description: "The sport, if named (e.g. 'basketball'). Null if not stated." },
      athlete_age: { type: ["integer", "null"], description: "The athlete's age in years, if stated. Null otherwise." },
      metro: { type: ["string", "null"], description: "City/metro named in the query (e.g. 'Chicago'). Null if no place is named." },
      max_price: { type: ["number", "null"], description: "An upper price limit if stated (e.g. 'under $80' -> 80). Null otherwise." },
      radius_miles: { type: ["number", "null"], description: "A distance/radius ONLY if the parent stated one. Null otherwise — do not default it." },
      soft_attributes: {
        type: "array",
        items: { type: "string" },
        description: "Ranking HINTS, not hard filters — qualities like 'beginner-friendly', 'patient', 'competitive'. Normalize to short kebab/lowercase phrases. Empty array if none.",
      },
    },
    required: ["sport", "athlete_age", "metro", "max_price", "radius_miles", "soft_attributes"],
  },
};

const SYSTEM = [
  "You convert a parent's free-text youth-sports search into structured constraints by calling the search_constraints tool exactly once.",
  "Extract ONLY what the parent explicitly said. If something is not stated, return null for it (or [] for soft_attributes). Never infer, default, or invent.",
  "- max_price: a stated upper bound only (e.g. 'under $80' -> 80; 'around $50' -> 50). No price stated -> null.",
  "- athlete_age: a number of years only when stated ('my 12 year old' -> 12). Otherwise null.",
  "- metro: only a place actually named in the query. Do NOT use any external location hint here.",
  "- radius_miles: ONLY if the parent stated a distance. Otherwise null — never default it yourself.",
  "- soft_attributes: subjective ranking hints ('good with beginners' -> 'beginner-friendly', 'patient', 'competitive'). These are NOT hard filters. Empty if none.",
  "A vague query with no constraints (e.g. 'a good coach') must return all nulls and an empty soft_attributes.",
].join("\n");

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Coerce the model's tool output into the strict, nullable shape.
function sanitize(input: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const int = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v) : null);
  const arr = Array.isArray(input.soft_attributes)
    ? input.soft_attributes.map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  return {
    sport: str(input.sport),
    athlete_age: int(input.athlete_age),
    metro: str(input.metro),
    max_price: num(input.max_price),
    radius_miles: num(input.radius_miles),
    soft_attributes: arr,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    if (!(await validateCaller(authHeader, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY))) {
      return json({ error: "Not authenticated" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const query: string = typeof body?.query === "string" ? body.query : "";
    if (!query.trim()) return json({ error: "query is required." }, 400);
    const hint = body?.parentLocationHint ?? null;

    const norm = normalizeQuery(query);
    const cacheKey = await sha256Hex(`${norm}|${JSON.stringify(hint ?? null)}`);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Cache hit: identical query -> no model call, no audit row.
    const { data: cached } = await admin.from("search_parse_cache")
      .select("result").eq("query_hash", cacheKey).maybeSingle();
    if (cached?.result) {
      return json({ result: cached.result, cached: true });
    }

    // Miss: parse via the gateway (forward caller's auth so the call is attributed).
    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "parse",
        feature: "search_parse",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: `Parent's search query:\n"""${query}"""` }] }],
        tools: [PARSE_TOOL],
        tool_choice: { type: "tool", name: "search_constraints" },
        maxTokens: 400,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    if (!call?.input) return json({ error: "Model did not return parsed constraints.", raw: g }, 502);

    const result = sanitize(call.input as Record<string, unknown>);

    // Default radius ONLY when a location is present (parsed metro or hint) and
    // the parent did not state a radius. Applied in code, never by the model.
    const hasLocation = result.metro != null || (hint != null && hint !== "");
    let defaultRadiusApplied = false;
    if (hasLocation && result.radius_miles == null) {
      result.radius_miles = DEFAULT_RADIUS_MILES;
      defaultRadiusApplied = true;
    }

    // Persist to cache (best-effort).
    await admin.from("search_parse_cache").upsert({
      query_hash: cacheKey, query: norm, location_hint: hint, result,
    }, { onConflict: "query_hash" });

    return json({
      result,
      cached: false,
      defaultRadiusApplied,
      model: g?.model ?? null,
      audit_id: g?.audit?.id ?? null,
      note: "Constraints only — no search/ranking performed.",
    });
  } catch (e) {
    console.error("search-parse error:", e);
    return json({ error: "Search request could not be parsed." }, 500);
  }
});
