// ============================================================================
// enrich-listing  (Supabase Edge Function) — AI fills the gate facts a listing
// needs to be matchable, for the provider to CONFIRM.
// ============================================================================
// The deterministic matcher (match_eligible, §6 gates) needs structured facts on
// each program: intensity_tier (0-4, drives the LTAD age-appropriateness gate),
// typical_client (who the program is for), and session_types (private/group/…).
// Providers write listings as free text, so those columns sit empty and the
// program fails CLOSED (unknown intensity = 4 = gated out for younger athletes).
//
// This function reads a listing's DESCRIPTIVE text and asks the model (task=
// "extract" -> Haiku, via ai-gateway) to PROPOSE those facts. It does NOT write
// them: intensity_tier is safety-adjacent, so the provider reviews + confirms in
// the app (human-in-loop, like message-draft). All model output is clamped to
// valid ranges/enums before it leaves this function — the model can't set an
// out-of-range tier or invent a session type.
//
// Authorization: caller must own the provider that owns the program.
// Input:  { programId: string }
// Output: { proposal: { intensity_tier, intensity_label, typical_client,
//           session_types, rationale }, audit_id }
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

// Canonical session types (must mirror the values the matcher's G7 gate accepts).
const SESSION_TYPES = ["private", "group", "clinic", "camp", "team", "online"];
const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "elite"];

// LTAD tier meanings, given to the model so its choice is grounded, and shown
// back to the provider on the confirm screen.
const TIER_LABELS: Record<number, string> = {
  0: "Active Start — play-based, no competition",
  1: "FUNdamentals / Learn to Train — fundamentals, no selection",
  2: "Early Train to Train — introductory competitive",
  3: "Train to Train — competitive",
  4: "Train to Compete — elite / high performance",
};

const SYSTEM = [
  "You classify a youth-sports program listing into structured facts a safety-first matching engine needs. You serve parents choosing coaching for children, so age-appropriateness matters above all.",
  "",
  "You are given ONLY descriptive listing text (title, description, sport, stated skill level, age group, what's included). From it, infer:",
  "- intensity_tier (0-4) using the LTAD developmental framework:",
  "    0 = Active Start (play-based, no competition)",
  "    1 = FUNdamentals / Learn to Train (fundamentals, no selection/elite)",
  "    2 = Early Train to Train (introductory competitive)",
  "    3 = Train to Train (competitive)",
  "    4 = Train to Compete (elite / high performance)",
  "  When the text is ambiguous, choose the LOWER tier that still fits — never overstate intensity for a program aimed at young or beginner athletes.",
  "- typical_client: age_min, age_max, skill_level (beginner|intermediate|advanced|elite), and 1-4 short goal tags (e.g. 'skill development', 'fitness', 'college recruiting').",
  "- session_types: which of [private, group, clinic, camp, team, online] the listing offers. Choose only those clearly supported by the text.",
  "",
  "Rules: infer only from the given text; do not invent credentials, prices, locations, or availability. Prefer conservative (lower) intensity when unsure. Call propose_listing_facts exactly once; output only via the tool.",
].join("\n");

const PROPOSE_TOOL = {
  name: "propose_listing_facts",
  description: "Structured, age-appropriate facts inferred from the listing text.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intensity_tier: { type: "integer", minimum: 0, maximum: 4 },
      typical_client: {
        type: "object",
        additionalProperties: false,
        properties: {
          age_min: { type: "integer", minimum: 3, maximum: 22 },
          age_max: { type: "integer", minimum: 3, maximum: 22 },
          skill_level: { type: "string", enum: SKILL_LEVELS },
          goals: { type: "array", items: { type: "string" }, maxItems: 4 },
        },
        required: ["age_min", "age_max", "skill_level", "goals"],
      },
      session_types: {
        type: "array",
        items: { type: "string", enum: SESSION_TYPES },
      },
      rationale: { type: "string", description: "One short sentence, provider-facing, on why this tier fits." },
    },
    required: ["intensity_tier", "typical_client", "session_types", "rationale"],
  },
};

// Clamp EVERY field to a valid range/enum so the model can never emit an
// out-of-range tier, a bogus session type, or an inverted age band.
function sanitize(raw: Record<string, unknown>): Record<string, unknown> {
  const tier = Math.max(0, Math.min(4, Math.round(Number(raw?.intensity_tier ?? 4))));
  const tc = (raw?.typical_client ?? {}) as Record<string, unknown>;
  let ageMin = Math.round(Number(tc?.age_min));
  let ageMax = Math.round(Number(tc?.age_max));
  if (!isFinite(ageMin)) ageMin = 6;
  if (!isFinite(ageMax)) ageMax = 18;
  ageMin = Math.max(3, Math.min(22, ageMin));
  ageMax = Math.max(3, Math.min(22, ageMax));
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  const skill = SKILL_LEVELS.includes(String(tc?.skill_level)) ? String(tc?.skill_level) : "beginner";
  const goals = Array.isArray(tc?.goals)
    ? (tc.goals as unknown[]).map((g) => String(g).slice(0, 40)).filter(Boolean).slice(0, 4)
    : [];
  const seen = new Set<string>();
  const sessionTypes = Array.isArray(raw?.session_types)
    ? (raw.session_types as unknown[])
        .map((s) => String(s).toLowerCase())
        .filter((s) => SESSION_TYPES.includes(s) && !seen.has(s) && seen.add(s))
    : [];
  return {
    intensity_tier: tier,
    intensity_label: TIER_LABELS[tier],
    typical_client: { age_min: ageMin, age_max: ageMax, skill_level: skill, goals },
    session_types: sessionTypes,
    rationale: String(raw?.rationale ?? "").slice(0, 280),
  };
}

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
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const programId: string = typeof body?.programId === "string" ? body.programId : "";
    if (!programId) return json({ error: "programId is required." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Load the listing + its provider, then AUTHORIZE: caller must own it.
    const { data: prog, error: pErr } = await admin.from("programs")
      .select("id, provider_id, title, description, sport_type, skill_level, age_group, whats_included, providers(owner_id, bio)")
      .eq("id", programId).maybeSingle();
    if (pErr) return json({ error: pErr.message }, 400);
    if (!prog) return json({ error: "Listing not found." }, 404);
    // PostgREST may embed a to-one relation as an object OR a 1-element array.
    const provRel = Array.isArray(prog.providers) ? prog.providers[0] : prog.providers;
    const owner = (provRel as { owner_id?: string } | null)?.owner_id ?? null;
    if (owner !== uid) return json({ error: "Not authorized to enrich this listing." }, 403);

    // Grounding text — DESCRIPTIVE content only (same rule as embeddings).
    const included = Array.isArray(prog.whats_included) ? (prog.whats_included as string[]).join(", ") : "";
    const listingText = [
      `Title: ${prog.title ?? ""}`,
      `Sport: ${prog.sport_type ?? ""}`,
      `Stated skill level: ${prog.skill_level ?? "(unstated)"}`,
      `Age group: ${prog.age_group ?? "(unstated)"}`,
      `Description: ${prog.description ?? ""}`,
      included ? `What's included: ${included}` : "",
      (provRel as { bio?: string } | null)?.bio ? `Coach bio: ${(provRel as { bio?: string }).bio}` : "",
    ].filter(Boolean).join("\n");

    // Ask the model (extract -> Haiku) via the gateway chokepoint.
    let toolInput: Record<string, unknown> | null = null;
    let auditId: string | null = null;
    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "extract",
        feature: "enrich_listing",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: listingText }] }],
        tools: [PROPOSE_TOOL],
        tool_choice: { type: "tool", name: "propose_listing_facts" },
        maxTokens: 600,
      }),
    });
    if (!gResp.ok) {
      const t = await gResp.text().catch(() => "");
      return json({ error: `AI gateway error (${gResp.status}): ${t.slice(0, 200)}` }, 502);
    }
    const g = await gResp.json();
    auditId = g?.audit?.id ?? null;
    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    if (call?.input) toolInput = call.input as Record<string, unknown>;
    if (!toolInput) return json({ error: "Model returned no proposal." }, 502);

    return json({ proposal: sanitize(toolInput), audit_id: auditId });
  } catch (e) {
    console.error("enrich-listing error:", e);
    return json({ error: "Listing enrichment failed." }, 500);
  }
});
