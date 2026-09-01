// Unit tests for the matching Layer-2 guard + §5 LTAD ceilings (the §11 cases).
//   node supabase/functions/ai-match/matchguard.test.mjs
import assert from "node:assert";
import { ltadMaxTier, enforceMatches, stripClaims, buildNote } from "./matchguard.ts";

// ── §5/§11 LTAD ceiling (the safety gate's brain) ───────────────────────────
assert.strictEqual(ltadMaxTier(6), 0, "case1: 6yo -> tier 0 (no competitive/elite)");
assert.strictEqual(ltadMaxTier(10), 1, "case2: 10yo -> tier 1 (no select/travel)");
assert.strictEqual(ltadMaxTier(9), 1, "case8: talented 9yo still capped at 1 (no elite AAU)");
assert.strictEqual(ltadMaxTier(14, null, "advanced"), 3, "case3: 14yo advanced -> 3");
assert.strictEqual(ltadMaxTier(17, null, "elite"), 4, "case4: 17yo elite -> 4");
assert.strictEqual(ltadMaxTier(17, null, "intermediate"), 3, "17yo non-advanced -> 3 (no tier 4)");
assert.strictEqual(ltadMaxTier(25), 4, "adult -> no ceiling (4)");
// maturation: 11-16 only
assert.strictEqual(ltadMaxTier(13, "early"), 3, "13yo early -> 2+1=3");
assert.strictEqual(ltadMaxTier(13, "late"), 1, "13yo late -> 2-1=1");
assert.strictEqual(ltadMaxTier(8, "early"), 1, "8yo early -> unchanged (no adj below 11)");
assert.strictEqual(ltadMaxTier(6, "early"), 0, "6yo early -> absolute ceiling holds");
console.log("LTAD ceilings (§5/§11): OK");

// ── enforceMatches: eligible-only + fact override + credential strip ────────
const eligible = [
  { program_id: "p1", price_per_session: 7000, distance_km: 12.34, rating_avg: 4.7, rating_count: 90, available_this_week: true },
  { program_id: "p2", price_per_session: 6000, distance_km: 3.2, rating_avg: 5.0, rating_count: 2, available_this_week: false },
];
const model = [
  // model tries to inflate facts + sneak a credential claim -> all corrected/stripped
  { provider_id: "p2", score: 95, why: "Highest rated. NASM certified and background-checked.", rating_avg: 5.0, rating_count: 999, price_per_session: 1 },
  { provider_id: "p1", score: 90, why: "Strong fit, 4.7 from 90 reviews, close by." },
  { provider_id: "ghost", score: 99, why: "Should never appear." }, // gated-out/hallucinated
];
const { matches, droppedIneligible } = enforceMatches(model, eligible);
assert.deepStrictEqual(droppedIneligible, ["ghost"], "hallucinated provider dropped");
assert.strictEqual(matches.length, 2, "only eligible providers kept");
const p2 = matches.find((m) => m.provider_id === "p2");
assert.strictEqual(p2.rating_avg, 5.0, "fact from data");
assert.strictEqual(p2.rating_count, 2, "review count from data (not the model's 999)");
assert.strictEqual(p2.price_per_session, 6000, "price from data (not the model's 1)");
assert.ok(!/nasm|certified|background/i.test(p2.why), "credential/background claim stripped from why");
console.log("enforce: eligible-only + fact override + credential strip: OK");

// ── §7 tie-breaker: p2 has higher score but check ordering is score-first ───
assert.strictEqual(matches[0].provider_id, "p2", "p2 (95) ranks above p1 (90)");

// ── score clamp ─────────────────────────────────────────────────────────────
const clamped = enforceMatches([{ provider_id: "p1", score: 250, why: "x" }], eligible).matches[0];
assert.strictEqual(clamped.score, 100, "score clamped to 100");

// ── note: empty eligible -> helpful, age-aware, never relaxes safety ────────
assert.ok(/recreational|intro/i.test(buildNote({ athlete_age: 6 }, 0)), "young -> recreational suggestion");
assert.ok(/distance or budget/i.test(buildNote({ athlete_age: 14 }, 0)), "older -> widen distance/budget");
assert.strictEqual(buildNote({ athlete_age: 14 }, 3), "", "note empty when matches exist");

console.log("\n[ai-match matchguard] ALL PASS");
