// ============================================================================
// search-execute  (Supabase Edge Function) — the discovery orchestrator
// ============================================================================
// Order of operations:
//   1. GATE FIRST: isMarketReady(sport, metro). If the market hasn't earned
//      search, return { gated:true } so the client shows the normal browse grid.
//      No embedding, no model — nothing runs in an unready market.
//   2. Embed the query (generate-embedding) and call search_listings (hard
//      constraints as SQL WHERE; soft signals only rank).
//   3. THIN/NO RESULTS -> search_relax returns the single cheapest constraint to
//      relax, computed from real data ("nearest is $85" / "expand radius to 10mi").
//   4. Otherwise produce a grounded "why it matched" per result with ONE batched
//      haiku call (feature="search"); post-validate so no explanation asserts
//      credentials/background-check/medical claims (explain.ts).
//
// Input: { constraints: { sport, athlete_age, metro, max_price, radius_miles,
//          soft_attributes[], query_text }, parentLocationHint?: {lat,lng} }
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateCaller } from "../_shared/auth.ts";
import { isMarketReady, metroKey } from "../_shared/market.ts";
import { buildBatchPrompt, EXPLAIN_TOOL, EXPLAIN_SYSTEM, enforceExplanations } from "./explain.ts";

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
const THIN_RESULTS = Number(Deno.env.get("SEARCH_THIN_RESULTS") ?? 3);

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
    const k = body?.constraints ?? {};
    const hint = body?.parentLocationHint ?? null;
    const sport: string | null = typeof k.sport === "string" && k.sport.trim() ? k.sport.trim() : null;
    const lat = hint && typeof hint.lat === "number" ? hint.lat : null;
    const lng = hint && typeof hint.lng === "number" ? hint.lng : null;
    const metro = metroKey(lat, lng, typeof k.metro === "string" ? k.metro : null, null);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) GATE FIRST — no AI search in an unready (or unidentifiable) market.
    if (!sport || !(await isMarketReady(admin, sport, metro))) {
      return json({ gated: true, reason: !sport ? "no_sport" : "market_not_ready", metro });
    }

    // 2) Embed the query (forward the parent's auth so it's attributed).
    const queryText: string = [k.query_text, ...(Array.isArray(k.soft_attributes) ? k.soft_attributes : [])]
      .filter(Boolean).join(" ").trim() || sport;
    let embedding: string | null = null;
    try {
      const eResp = await fetch(`${SUPABASE_URL}/functions/v1/generate-embedding`, {
        method: "POST",
        headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ text: queryText }),
      });
      const e = await eResp.json();
      if (eResp.ok && Array.isArray(e?.embedding)) embedding = `[${e.embedding.join(",")}]`;
    } catch (_) { /* semantic term degrades to 0; ranking still works */ }

    const searchConstraints = {
      sport,
      athlete_age: k.athlete_age ?? null,
      max_price: k.max_price ?? null,
      radius_miles: k.radius_miles ?? null,
      lat, lng,
      query_text: queryText,
      within_days: 30,
    };

    // 3) Hard-filtered + ranked candidates.
    const { data: rows, error } = await admin.rpc("search_listings", {
      constraints: searchConstraints, query_embedding: embedding,
    });
    if (error) return json({ error: error.message }, 500);
    const results: Record<string, unknown>[] = Array.isArray(rows) ? rows : [];

    // THIN/NO RESULTS — data-driven relax suggestion, not a generic apology.
    if (results.length < THIN_RESULTS) {
      const { data: relax } = await admin.rpc("search_relax", {
        constraints: searchConstraints, p_min_results: THIN_RESULTS,
      });
      return json({ gated: false, results, relax: relax ?? null });
    }

    // 4) Grounded "why it matched" — ONE batched haiku call, then post-validate.
    let byId: Record<string, string> = {};
    let removed: string[] = [];
    try {
      const items = results.map((r) => ({
        program_id: r.program_id, title: r.title, specialty: r.specialty,
        bio: r.bio, review_excerpts: r.review_excerpts,
      }));
      const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
        method: "POST",
        headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "parse",                 // cheap/structured -> haiku
          feature: "search",
          system: EXPLAIN_SYSTEM,
          messages: [{ role: "user", content: [{ type: "text", text: buildBatchPrompt(items, k.soft_attributes) }] }],
          tools: [EXPLAIN_TOOL],
          tool_choice: { type: "tool", name: "match_explanations" },
          maxTokens: 700,
        }),
      });
      const g = await gResp.json();
      const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
      if (call?.input) ({ byId, removed } = enforceExplanations((call.input as { explanations?: unknown }).explanations));
    } catch (_) { /* explanations are best-effort; results still return */ }

    const withWhy = results.map((r) => ({ ...r, why: byId[String(r.program_id)] ?? null }));
    return json({ gated: false, results: withWhy, relax: null, stripped: removed.length });
  } catch (e) {
    console.error("search-execute error:", e);
    return json({ error: "Search could not be completed." }, 500);
  }
});
