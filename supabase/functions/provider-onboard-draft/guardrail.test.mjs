// Local unit test for the HARD GUARDRAIL — no Supabase, no Deno.
//   node supabase/functions/provider-onboard-draft/guardrail.test.mjs
import assert from "node:assert";
import { enforceClaimsGuardrail } from "./guardrail.ts";

// CASE A — model leaked "NSCA certified, 10 years experience" + raw claims a
// background check. Those must end up ONLY in claimsToVerify, never in bio/specialties.
const leaked = {
  bio: "I'm NSCA certified with 10 years of experience coaching youth soccer. I focus on ball control and making practice fun.",
  specialties: ["NSCA certified strength coach", "youth soccer", "ball control"],
  ageGroupsServed: ["U8-U12"],
  sessionTypes: ["one_on_one", "small_group"],
  suggestedPriceRange: { min: 40, max: 70, rationale: "Suggestion based on typical youth soccer sessions." },
  claimsToVerify: [],
};
const rawA = "I'm NSCA certified, 10 years experience, background checked. I coach youth soccer.";
const a = enforceClaimsGuardrail(leaked, rawA);

assert.ok(!/NSCA/i.test(a.draft.bio), "bio must NOT contain NSCA");
assert.ok(!/\b\d+\s*years?\b/i.test(a.draft.bio), "bio must NOT contain years-of-experience");
assert.ok(!a.draft.specialties.some((s) => /NSCA|certif/i.test(s)), "specialties must NOT contain credentials");
assert.ok(a.draft.claimsToVerify.some((c) => /NSCA/i.test(c)), "claimsToVerify must contain the NSCA claim");
assert.ok(a.draft.claimsToVerify.some((c) => /background[\s-]?check/i.test(c)), "claimsToVerify must capture background-check from raw input");
assert.ok(/ball control/i.test(a.draft.bio), "descriptive bio content must be preserved");

console.log("CASE A  bio          :", JSON.stringify(a.draft.bio));
console.log("CASE A  specialties  :", JSON.stringify(a.draft.specialties));
console.log("CASE A  claimsToVerify:", JSON.stringify(a.draft.claimsToVerify));
console.log("CASE A  moved        :", JSON.stringify(a.moved));

// CASE B — clean descriptive bio with no claims: nothing moved, no claims.
const clean = {
  bio: "I help young players build confidence with fun, game-based soccer drills.",
  specialties: ["youth soccer", "dribbling"],
  ageGroupsServed: ["U6-U10"],
  sessionTypes: ["small_group"],
  suggestedPriceRange: { min: 35, max: 55, rationale: "Suggestion only." },
  claimsToVerify: [],
};
const b = enforceClaimsGuardrail(clean, "");
assert.strictEqual(b.moved.length, 0, "clean bio must move nothing");
assert.strictEqual(b.draft.claimsToVerify.length, 0, "clean bio must have no claims");
console.log("CASE B  ok (nothing moved, claimsToVerify empty)");

console.log("\n[guardrail tests] ALL PASS");
