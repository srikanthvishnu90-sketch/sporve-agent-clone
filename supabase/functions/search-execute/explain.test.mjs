// Unit tests for the extractive "why it matched" guardrail — no Supabase/Deno.
//   node supabase/functions/search-execute/explain.test.mjs
import assert from "node:assert";
import { stripUnsupported, enforceExplanations, hasClaim, buildBatchPrompt } from "./explain.ts";

// A grounded, claim-free explanation passes untouched.
const a = stripUnsupported("Coaches younger players with a patient, fundamentals-first style.");
assert.strictEqual(a.removed.length, 0, "A: clean line kept");
assert.ok(/patient/.test(a.why), "A: content preserved");

// A credential / background-check claim sentence is stripped; the grounded part stays.
const b = stripUnsupported("Great with beginners. NASM certified and fully background-checked.");
assert.ok(!/nasm|certified|background/i.test(b.why), "B: credential + background-check stripped");
assert.ok(/beginners/i.test(b.why), "B: grounded part kept");
assert.ok(b.removed.length >= 1, "B: removals reported");

// A line that is ONLY an unsupported claim becomes empty (dropped, not shown).
const c = stripUnsupported("This coach is a licensed physical therapist who is CPR certified.");
assert.strictEqual(c.why, "", "C: all-claim line emptied");

// enforceExplanations drops unsupported-only lines and keeps grounded ones.
const res = enforceExplanations([
  { program_id: "p1", why: "Focuses on fundamentals for young players." },
  { program_id: "p2", why: "Background-checked and ACE certified." }, // all-claim -> dropped
  { program_id: "p3", why: "Beginner-friendly. Also a licensed trainer." }, // claim sentence stripped
]);
assert.ok(res.byId["p1"], "p1 kept");
assert.ok(!res.byId["p2"], "p2 (all-claim) dropped");
assert.ok(res.byId["p3"] && !/licensed/i.test(res.byId["p3"]), "p3 claim stripped, rest kept");
assert.ok(res.removed.length >= 2, "removed reasons reported");

// hasClaim catches the forbidden categories.
assert.ok(hasClaim("background check"), "bg check");
assert.ok(hasClaim("CSCS"), "cert acronym");
assert.ok(hasClaim("cleared to play"), "medical/safety");
assert.ok(!hasClaim("patient and encouraging with beginners"), "clean text not flagged");

// The batch prompt includes the grounding text + the anti-credential instruction.
const prompt = buildBatchPrompt(
  [{ program_id: "p1", title: "Hoops Academy", specialty: "Basketball", bio: "Patient with beginners.", review_excerpts: ["Great with my 9 year old."] }],
  ["beginner-friendly"],
);
assert.ok(/Hoops Academy/.test(prompt) && /Great with my 9 year old/.test(prompt), "prompt embeds grounding");
assert.ok(/NEVER mention credentials/i.test(prompt), "prompt forbids credentials");
assert.ok(/beginner-friendly/.test(prompt), "prompt includes soft attributes");

console.log("[search-execute explain guardrail] ALL PASS");
