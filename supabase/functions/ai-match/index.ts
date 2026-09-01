// ============================================================================
// ai-match  (Supabase Edge Function) — Sporve AI Matching & Ranking Engine
// ============================================================================
// LAYER 1 (deterministic, safety): match_eligible(client) removes every provider
// that fails a hard gate (G1-G7) — the model never sees a disqualified provider.
// LAYER 2 (LLM): ai-gateway ranks the ELIGIBLE set with the §7 rubric and writes
// a parent-facing "why". The model may only reorder/explain — matchguard then:
//   • drops any provider not in the eligible set,
//   • OVERWRITES every fact (price/distance/rating/availability) from real data
//     so the model can never fabricate, and
//   • strips credential/background-check/medical claims from the "why".
// Audit: one ai_audit_log row per call inside ai-gateway (feature="matching").
//
// Input: { client: { athlete_age, maturation?, sport, skill_level, goal,
//   location:{lat,lng} | lat,lng, max_distance_km?, budget_max_per_session?,
//   session_type_pref? } }
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateCaller } from "../_shared/auth.ts";
import { enforceMatches, buildNote } from "./matchguard.ts";

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

const SYSTEM = [
  "You are Sporve's matching assistant. You receive a CLIENT profile and a list of ELIGIBLE providers that have ALREADY passed all safety and age-appropriateness gates. Rank them for fit and explain each match. You serve parents choosing youth sports coaching, so accuracy and child-appropriateness matter above all.",
  "",
  "HARD RULES:",
  "- Only rank providers from the ELIGIBLE list. Never add, invent, or imply others.",
  "- Never state a rating, credential, price, distance, or availability not present in the data. If a fact is missing, omit it — never guess or fabricate.",
  "- Never recommend a provider as more intense/competitive than the client's profile. The list is already safety-filtered; do not undo that in your wording.",
  "- If the eligible list is empty, return an empty matches array.",
  "",
  "RANK using this weighted rubric (0-100): goal alignment 25, rating quality 20, developmental fit 15, distance 12, price fit 10, coach experience 8, average-client similarity 6, availability 4. Dampen ratings that come from few reviews (a 5.0 from 2 reviews ranks below a 4.7 from 80). Tie-break by review count, then distance, then availability.",
  "For each match, write a one-to-two sentence 'why' in plain, parent-facing language grounded in concrete data (e.g. 'youth basketball skill development, 4.8 from 60 reviews, 12 km away, fits your skill-development goal'). Be honest about trade-offs; never oversell.",
  "Call the rank_matches tool exactly once. Output only via the tool.",
].join("\n");

const RANK_TOOL = {
  name: "rank_matches",
  description: "Return the eligible providers ranked by fit, each with a score (0-100) and a grounded parent-facing 'why'.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider_id: { type: "string" },
            score: { type: "number" },
            why: { type: "string", description: "1-2 sentences, parent-facing, grounded ONLY in the provided data. No credentials/background-check claims." },
          },
          required: ["provider_id", "score", "why"],
        },
      },
    },
    required: ["matches"],
  },
};

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
    const client = body?.client ?? {};
    // Accept either location:{lat,lng} or top-level lat/lng.
    const loc = client.location ?? {};
    const norm = {
      athlete_age: client.athlete_age,
      maturation: client.maturation ?? null,
      sport: client.sport ?? null,
      skill_level: client.skill_level ?? null,
      lat: loc.lat ?? client.lat ?? null,
      lng: loc.lng ?? client.lng ?? null,
      max_distance_km: client.max_distance_km ?? 40,
      budget_max_per_session: client.budget_max_per_session ?? null,
      session_type_pref: client.session_type_pref ?? "any",
    };
    if (norm.athlete_age == null || !norm.sport || norm.lat == null || norm.lng == null) {
      return json({ error: "client.athlete_age, sport, and location {lat,lng} are required." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── LAYER 1: deterministic gates. The model never sees disqualified rows.
    const { data: eligible, error } = await admin.rpc("match_eligible", { client: norm });
    if (error) return json({ error: error.message }, 500);
    const elig: Record<string, unknown>[] = Array.isArray(eligible) ? eligible : [];

    if (elig.length === 0) {
      return json({ matches: [], note: buildNote(norm, 0) });
    }

    // ── LAYER 2: rank + explain the eligible set (facts the model MAY cite).
    const goal = client.goal ?? null;
    const providersForModel = elig.map((e) => ({
      provider_id: e.program_id, name: e.name, sport: e.sport,
      intensity_tier: e.intensity_tier, age_range: { min: e.age_min, max: e.age_max },
      price_per_session: e.price_per_session, rating_avg: e.rating_avg, rating_count: e.rating_count,
      distance_km: e.distance_km != null ? Math.round((e.distance_km as number) * 10) / 10 : null,
      coach_years_coaching: e.coach_years_coaching, coach_years_played: e.coach_years_played,
      credentials: e.credentials, typical_client: e.typical_client,
      session_types: e.session_types, available_this_week: e.available_this_week, bio: e.bio,
    }));
    const userText = [
      `CLIENT: ${JSON.stringify({ ...norm, goal })}`,
      "",
      `ELIGIBLE PROVIDERS (already safety + age gated — rank these only):`,
      JSON.stringify(providersForModel),
    ].join("\n");

    let modelMatches: unknown = [];
    let auditId: string | null = null;
    try {
      const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
        method: "POST",
        headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "reason",                 // rubric ranking -> sonnet
          feature: "matching",
          system: SYSTEM,
          messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
          tools: [RANK_TOOL],
          tool_choice: { type: "tool", name: "rank_matches" },
          maxTokens: 1500,
        }),
      });
      const g = await gResp.json();
      auditId = g?.audit?.id ?? null;
      const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
      if (call?.input) modelMatches = (call.input as { matches?: unknown }).matches;
    } catch (_) { /* fall through — see fallback below */ }

    // ── ENFORCE: eligible-only + facts-from-data + claim-stripped why.
    const { matches, droppedIneligible } = enforceMatches(modelMatches, elig);

    // Fallback: if the model returned nothing usable, rank deterministically by
    // rating-confidence + proximity so a safety-gated result still comes back.
    let final = matches;
    if (final.length === 0) {
      final = elig.map((e) => ({
        provider_id: String(e.program_id),
        name: e.name ?? null,
        title: e.title ?? null,
        sport: e.sport ?? null,
        score: 0,
        why: "",
        price_per_session: e.price_per_session ?? null,
        distance_km: e.distance_km != null ? Math.round((e.distance_km as number) * 10) / 10 : null,
        rating_avg: e.rating_avg != null ? Number(e.rating_avg) : null,
        rating_count: (e.rating_count as number) ?? 0,
        available_this_week: !!e.available_this_week,
      })).sort((a, b) => (b.rating_count - a.rating_count) || ((a.distance_km ?? 1e9) - (b.distance_km ?? 1e9)));
    }

    return json({
      matches: final,
      note: buildNote(norm, final.length),
      audit_id: auditId,
      eligible_count: elig.length,
      dropped_ineligible: droppedIneligible.length,
    });
  } catch (e) {
    console.error("ai-match error:", e);
    return json({ error: "Matching request failed." }, 500);
  }
});
