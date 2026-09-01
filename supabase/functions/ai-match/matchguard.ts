// ============================================================================
// ai-match / matchguard.ts — Layer-2 post-validation (pure, testable)
// ============================================================================
// The model may ONLY reorder + explain the eligible set. This enforces that:
//   • drops any provider_id not in the eligible set (no resurrection/hallucination)
//   • OVERWRITES every fact (price/distance/rating/availability) from the real
//     eligible data — the model is never trusted for facts, so it cannot fabricate
//   • strips credential/background-check/medical claims from the "why" text
//   • clamps score to 0-100 and applies the §7 tie-breakers
// Mirrors the SQL ltad_max_tier so the §5/§11 ceilings can be unit-tested. No
// Deno deps — runs in plain Node.
// ============================================================================

const CLAIM_PATTERNS = [
  /\b(?:NSCA|NASM|ACE|ACSM|CSCS|CPT|USSF|USAW|PES|CES|ISSA|NCSF|NETA|NCCPT)\b/i,
  /\bcertif(?:ied|icate|ication)\b/i,
  /\b(?:licen[sc]ed|licen[sc]e|credential(?:ed|s)?|accredit(?:ed|ation))\b/i,
  /\b(?:background[\s-]?check\w*|vetted|screened|cleared|verified coach|verification)\b/i,
  /\b(?:cpr|aed|first[\s-]?aid)\b/i,
  /\b(?:bachelor|master|phd|degree|diploma)\b/i,
  /\b(?:injur\w*|concussion|diagnos\w*|medical|medication|cleared to play|rehab\w*)\b/i,
];
function splitSentences(t) {
  return String(t ?? "").split(/(?<=[.!?])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean);
}
export function stripClaims(why) {
  const removed = [], kept = [];
  for (const s of splitSentences(why)) (CLAIM_PATTERNS.some((re) => re.test(s)) ? removed : kept).push(s);
  return { why: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}

// §5 LTAD ceiling — mirror of SQL public.ltad_max_tier (for §11 regression tests).
export function ltadMaxTier(age, maturation = null, skill = null) {
  let base;
  if (age <= 6) base = 0;
  else if (age <= 11) base = 1;
  else if (age <= 13) base = 2;
  else if (age <= 15) base = 3;
  else if (age <= 17) base = ["advanced", "elite"].includes(String(skill ?? "").toLowerCase()) ? 4 : 3;
  else base = 4;
  let t = base;
  if (age >= 11 && age <= 16) {
    if (maturation === "early") t += 1;
    else if (maturation === "late") t -= 1;
  }
  return Math.max(0, Math.min(4, t));
}

function clampScore(s) {
  const n = Number(s);
  return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

/**
 * Enforce the Layer-2 contract over the model's ranked matches.
 * @param modelMatches the model's [{provider_id, score, why}] (facts ignored)
 * @param eligible the Layer-1 rows (each has program_id used as provider_id + real facts)
 */
export function enforceMatches(modelMatches, eligible) {
  const byId = new Map((eligible ?? []).map((e) => [String(e.program_id), e]));
  const dropped = [];
  const out = [];
  for (const m of Array.isArray(modelMatches) ? modelMatches : []) {
    const id = String(m?.provider_id ?? "");
    const e = byId.get(id);
    if (!e) { dropped.push(id); continue; }            // gated-out / hallucinated -> drop
    const { why } = stripClaims(m?.why);
    out.push({
      provider_id: id,
      // Identity facts from the eligible row (public, safety-neutral) so the UI
      // can render a card. Like all facts here, they come from data, not the model.
      name: e.name ?? null,
      title: e.title ?? null,
      sport: e.sport ?? null,
      score: clampScore(m?.score),
      why,                                              // text only (facts overwritten below)
      price_per_session: e.price_per_session ?? null,   // FACTS from data, never the model
      distance_km: e.distance_km != null ? Math.round(e.distance_km * 10) / 10 : null,
      rating_avg: e.rating_avg != null ? Number(e.rating_avg) : null,
      rating_count: e.rating_count ?? 0,
      available_this_week: !!e.available_this_week,
    });
  }
  // §7 tie-breakers: score, then review count, then distance, then availability.
  out.sort((a, b) =>
    b.score - a.score ||
    (b.rating_count - a.rating_count) ||
    ((a.distance_km ?? 1e9) - (b.distance_km ?? 1e9)) ||
    ((b.available_this_week ? 1 : 0) - (a.available_this_week ? 1 : 0)));
  return { matches: out, droppedIneligible: dropped };
}

// Deterministic, honest fallback note when nothing (or little) is eligible.
export function buildNote(client, eligibleCount) {
  if (eligibleCount > 0) return "";
  const age = Number(client?.athlete_age);
  if (isFinite(age) && age <= 8) {
    return "No verified, age-appropriate matches yet. For this age, look for recreational or intro (skill-development) programs, or widen your distance.";
  }
  return "No matches passed the safety and age checks within your filters. Try widening your distance or budget — we never relax the safety or age-appropriateness gates.";
}
