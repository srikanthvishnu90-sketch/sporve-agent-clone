// ============================================================================
// generate-proposals (Supabase Edge Function) — the concierge's curated picks
// ============================================================================
// Outcome-first Prompt 4. Given a plan_id:
//   a. load goal (outcome_type, sport, budget, constraints) + athlete
//   b. run the EXISTING deterministic gate (match_eligible = G1..G7) — the model
//      NEVER sees a disqualified provider; no gate is ever relaxed here
//   c. score with a goal-alignment-weighted rubric, take the top few
//   d. ONE ai-gateway call (workhorse tier) writes a grounded, parent-facing
//      reason per pick; claims (creds/background/medical) are stripped
//   e. insert plan_proposals rank 1..3 (service role). Never > 3 pending;
//      replace-don't-pile; expire unanswered proposals after 14 days
// Empty supply => write NO proposals, set an honest plan-level note. Never pad.
//
// The concierge PROPOSES only. Approval/booking/payment stay explicit + parent-
// driven (Prompt 3 UI + existing booking rails). This function never books.
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
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

const MAX_PENDING = 3;

// ── claim stripping (mirror of ai-match/matchguard stripClaims) ──────────────
const CLAIM_PATTERNS = [
  /\b(?:NSCA|NASM|ACE|ACSM|CSCS|CPT|USSF|USAW|PES|CES|ISSA|NCSF|NETA|NCCPT)\b/i,
  /\bcertif(?:ied|icate|ication)\b/i,
  /\b(?:licen[sc]ed|licen[sc]e|credential(?:ed|s)?|accredit(?:ed|ation))\b/i,
  /\b(?:background[\s-]?check\w*|vetted|screened|cleared|verified coach|verification)\b/i,
  /\b(?:cpr|aed|first[\s-]?aid)\b/i,
  /\b(?:bachelor|master|phd|degree|diploma)\b/i,
  /\b(?:injur\w*|concussion|diagnos\w*|medical|medication|cleared to play|rehab\w*)\b/i,
];
function stripClaims(t: string): string {
  const sentences = String(t ?? "").split(/(?<=[.!?])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean);
  return sentences.filter((s) => !CLAIM_PATTERNS.some((re) => re.test(s))).join(" ").replace(/\s+/g, " ").trim();
}

// outcome_type -> intensity band + goal keywords (goal-alignment scoring)
const OUTCOME: Record<string, { tier: number; band: [number, number]; kw: string[] }> = {
  fitness_fun:       { tier: 1, band: [0, 1], kw: ["fun", "fitness", "recreational", "intro", "beginner"] },
  skill_development: { tier: 2, band: [1, 2], kw: ["skill", "development", "fundamentals", "technique"] },
  make_team:         { tier: 3, band: [2, 3], kw: ["team", "competitive", "tryout", "roster"] },
  elite_pathway:     { tier: 4, band: [3, 4], kw: ["elite", "college", "showcase", "advanced", "performance"] },
  other:             { tier: 2, band: [0, 4], kw: [] },
};

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) a--;
  return a;
}

type Row = Record<string, any>;

function score(e: Row, out: { tier: number; band: [number, number]; kw: string[] }, budgetCents: number | null): number {
  // goal alignment 35 — closeness of program intensity to the outcome band + typical_client match
  const tierRaw = e.intensity_tier;
  const tier = tierRaw != null && isFinite(Number(tierRaw)) ? Number(tierRaw) : null;
  const [lo, hi] = out.band;
  // These rows already PASSED the age/intensity safety gate. When a row's
  // intensity tier is unknown, score it neutrally (not worst-case) — failing an
  // unknown tier to the bottom silently penalizes a genuinely-eligible provider
  // (L-010: a missing-shape read must not masquerade as a real signal).
  let align: number;
  if (tier == null) {
    align = 24;
  } else {
    const inBand = tier >= lo && tier <= hi;
    const tierDist = inBand ? 0 : Math.min(Math.abs(tier - lo), Math.abs(tier - hi));
    align = inBand ? 30 : Math.max(0, 30 - tierDist * 12);
  }
  const tc = JSON.stringify(e.typical_client ?? "").toLowerCase();
  if (out.kw.some((k) => tc.includes(k))) align += 5;
  align = Math.min(35, align);
  // rating quality 20 — dampened by review count
  const ravg = e.rating_avg != null ? Number(e.rating_avg) : 0;
  const rcount = Number(e.rating_count ?? 0);
  const conf = rcount >= 40 ? 1 : rcount / 40;
  const rating = (ravg / 5) * 20 * (0.5 + 0.5 * conf);
  // price fit 12 — within budget full; scaled if over
  let price = 12;
  if (budgetCents != null && e.price_per_session != null) {
    price = e.price_per_session <= budgetCents ? 12 : Math.max(0, 12 - ((e.price_per_session - budgetCents) / budgetCents) * 12);
  }
  // distance 12 — closer is better (within the already-gated radius)
  const dist = e.distance_km != null ? Math.max(0, 12 - (Number(e.distance_km) / 40) * 12) : 6;
  // coach experience 8
  const exp = Math.min(8, ((Number(e.coach_years_coaching ?? 0)) / 15) * 8);
  // availability 8, review count 5
  const avail = e.available_this_week ? 8 : 0;
  const reviews = Math.min(5, rcount / 20);
  return Math.round(align + rating + price + dist + exp + avail + reviews);
}

function fallbackReason(e: Row, budgetCents: number | null): string {
  const bits: string[] = [];
  bits.push(`${e.sport ?? "Training"} coaching`);
  if (e.rating_avg != null && Number(e.rating_count ?? 0) > 0) bits.push(`${Number(e.rating_avg).toFixed(1)}★ from ${e.rating_count} reviews`);
  if (e.distance_km != null) bits.push(`${Math.round(Number(e.distance_km))} km away`);
  const over = budgetCents != null && e.price_per_session != null && e.price_per_session > budgetCents;
  let s = `${bits.join(", ")}.`;
  if (over) s += " Slightly over your budget, but a verified match that fits the goal.";
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Missing Authorization header" }, 401);
    const isService = bearer === SERVICE_ROLE_KEY;

    const body = await req.json().catch(() => ({}));
    const planId = body?.plan_id;
    if (!planId) return json({ error: "plan_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Load plan -> goal -> athlete.
    const { data: plan, error: planErr } = await admin
      .from("development_plans").select("id, goal_id").eq("id", planId).single();
    if (planErr || !plan) return json({ error: "plan not found" }, 404);
    const { data: goal, error: goalErr } = await admin
      .from("athlete_goals")
      .select("id, athlete_id, created_by, outcome_text, outcome_type, sport, budget_monthly_cents, constraints, status")
      .eq("id", plan.goal_id).single();
    if (goalErr || !goal) return json({ error: "goal not found" }, 404);

    // Ownership: a user JWT may only generate for their own athlete's plan.
    if (!isService) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: u } = await userClient.auth.getUser();
      if (!u?.user) return json({ error: "Not authenticated" }, 401);
      const { data: ath } = await admin.from("athletes").select("parent_id").eq("id", goal.athlete_id).single();
      if (!ath || ath.parent_id !== u.user.id) return json({ error: "Forbidden" }, 403);
    }

    // Expire stale unanswered proposals (14 days).
    await admin.from("plan_proposals")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("plan_id", planId).eq("status", "proposed")
      .lt("created_at", new Date(Date.now() - 14 * 864e5).toISOString());

    // Existing live proposals: never pile past MAX_PENDING; don't re-propose same service.
    const { data: live } = await admin.from("plan_proposals")
      .select("id, service_id, status, rank").eq("plan_id", planId).in("status", ["proposed", "accepted"]);
    const pending = (live ?? []).filter((p) => p.status === "proposed");
    const excludeServiceIds = new Set((live ?? []).map((p) => p.service_id).filter(Boolean));
    const need = MAX_PENDING - pending.length;
    if (need <= 0) return json({ proposals: pending, generated: 0, note: "3 pending proposals already" });

    // Build the client profile for the deterministic gate.
    const { data: athlete } = await admin.from("athletes").select("date_of_birth").eq("id", goal.athlete_id).single();
    const c = (goal.constraints ?? {}) as Row;
    const age = ageFromDob(athlete?.date_of_birth ?? null);
    const lat = c.lat ?? null, lng = c.lng ?? null;
    const budgetPerSession = goal.budget_monthly_cents != null ? Math.round(Number(goal.budget_monthly_cents) / 4) : null;

    async function noSupply(reason: string) {
      await admin.from("development_plans").update({
        concierge_note: reason, concierge_checked_at: new Date().toISOString(),
      }).eq("id", planId);
      return json({ proposals: pending, generated: 0, no_supply: true, note: reason, eligible_count: 0 });
    }
    if (age == null) return await noSupply("Add the athlete's date of birth so we can match age-appropriate, verified coaches.");
    if (lat == null || lng == null) return await noSupply("Set a location for this goal so we can find verified coaches near you.");

    const client = {
      athlete_age: age,
      sport: goal.sport,
      lat, lng,
      max_distance_km: c.max_distance_km ?? 40,
      budget_max_per_session: budgetPerSession,
      session_type_pref: c.session_type_pref ?? "any",
    };

    // LAYER 1 — deterministic gates (never relaxed). Service-role RPC.
    const { data: eligible, error: elErr } = await admin.rpc("match_eligible", { client });
    if (elErr) return json({ error: elErr.message }, 500);
    let elig: Row[] = Array.isArray(eligible) ? eligible : [];
    // Don't re-propose services already pending/accepted on this plan.
    elig = elig.filter((e) => !excludeServiceIds.has(e.program_id));
    if (elig.length === 0) {
      return await noSupply(`No verified matches within ${client.max_distance_km} km yet. Try widening the distance or budget — we never relax the safety or age gates.`);
    }

    // Score (goal-alignment weighted) + take the top `need`.
    const out = OUTCOME[goal.outcome_type] ?? OUTCOME.other;
    const ranked = elig.map((e) => ({ e, s: score(e, out, budgetPerSession) }))
      .sort((a, b) => b.s - a.s || (Number(b.e.rating_count ?? 0) - Number(a.e.rating_count ?? 0)))
      .slice(0, need);

    // LAYER 2 — ONE grounded reason call (workhorse tier) for the chosen picks.
    const facts = ranked.map(({ e }) => ({
      service_id: e.program_id, name: e.name, sport: e.sport,
      price_per_session_usd: e.price_per_session != null ? Math.round(e.price_per_session) / 100 : null,
      budget_per_session_usd: budgetPerSession != null ? Math.round(budgetPerSession) / 100 : null,
      distance_km: e.distance_km != null ? Math.round(Number(e.distance_km) * 10) / 10 : null,
      rating_avg: e.rating_avg != null ? Number(e.rating_avg) : null, rating_count: e.rating_count ?? 0,
      available_this_week: !!e.available_this_week, coach_years_coaching: e.coach_years_coaching,
    }));
    const SYSTEM = [
      "You are Sporve's concierge explaining why each proposed program fits a family's stated goal. Every program in the list has ALREADY passed the safety and age-appropriateness gates — you only explain FIT, and you never re-judge or comment on safety.",
      "For each service write reason_text: at most 2 sentences, warm and parent-facing, and TIE IT DIRECTLY TO THE STATED GOAL (outcome_text / outcome_type). Ground every claim ONLY in the provided fields: sport, rating_avg + rating_count, distance_km, price_per_session_usd vs budget_per_session_usd, coach_years_coaching, available_this_week. If a field is null, omit it — never guess or fill it in.",
      "NEVER state or imply a credential, certification, license, background-check, screening, or medical fact — not even to reassure the parent. NEVER invent a number, coach name, review, or detail that is not in the provided data.",
      "Be specific and honest about trade-offs (e.g. 'a little above your budget, but the closest option and its 4.8 rating comes from 60+ reviews'). No hype, no superlatives like 'best' or 'guaranteed' unless present in the data.",
      "Call write_reasons exactly once, with exactly one entry per provided service_id.",
    ].join("\n");
    const REASON_TOOL = {
      name: "write_reasons",
      description: "Grounded parent-facing reason per proposed service.",
      input_schema: {
        type: "object", additionalProperties: false,
        properties: { reasons: { type: "array", items: {
          type: "object", additionalProperties: false,
          properties: { service_id: { type: "string" }, reason: { type: "string" } },
          required: ["service_id", "reason"],
        } } }, required: ["reasons"],
      },
    };
    const userText = [
      `GOAL: ${JSON.stringify({ outcome_text: goal.outcome_text, outcome_type: goal.outcome_type, sport: goal.sport })}`,
      "", "PROPOSED (grounded facts — explain fit, cite only these):", JSON.stringify(facts),
    ].join("\n");

    const reasonMap = new Map<string, string>();
    try {
      const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
        method: "POST",
        headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "draft", feature: "proposals", system: SYSTEM,
          messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
          tools: [REASON_TOOL], tool_choice: { type: "tool", name: "write_reasons" },
          actorId: goal.created_by, actorRole: "searcher", maxTokens: 700,
        }),
      });
      const g = await gResp.json();
      const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
      const arr = call?.input?.reasons;
      if (Array.isArray(arr)) for (const r of arr) {
        const clean = stripClaims(r?.reason);
        if (r?.service_id && clean) reasonMap.set(String(r.service_id), clean);
      }
    } catch (_) { /* fall through to grounded fallback reasons */ }

    // Insert proposals (service role). Ranks continue after existing pending.
    let rank = pending.length;
    const rows = ranked.map(({ e }) => {
      rank += 1;
      const reason = reasonMap.get(String(e.program_id)) || fallbackReason(e, budgetPerSession);
      return {
        plan_id: planId, proposal_type: "book_service",
        service_id: e.program_id, provider_id: e.provider_id,
        reason_text: reason, rank, status: "proposed",
      };
    });
    const { data: inserted, error: insErr } = await admin.from("plan_proposals").insert(rows).select();
    if (insErr) return json({ error: insErr.message }, 500);

    // Clear any prior no-supply note now that we have picks.
    await admin.from("development_plans").update({
      concierge_note: null, concierge_checked_at: new Date().toISOString(),
    }).eq("id", planId);

    return json({
      proposals: [...pending, ...(inserted ?? [])],
      generated: (inserted ?? []).length,
      eligible_count: elig.length + excludeServiceIds.size,
      no_supply: false,
    });
  } catch (e) {
    console.error("generate-proposals error:", e);
    return json({ error: "Proposals could not be generated." }, 500);
  }
});
