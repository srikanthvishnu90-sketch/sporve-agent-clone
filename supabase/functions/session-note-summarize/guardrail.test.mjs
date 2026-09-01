// Local unit test for the session-note grounding guardrail — no Supabase/Deno.
//   node supabase/functions/session-note-summarize/guardrail.test.mjs
import assert from "node:assert";
import { enforceSummaryGuardrail } from "./guardrail.ts";

// CASE A — rich notes: grounded skills survive, the model's ungrounded "shooting"
// (and a leaked medical claim) are stripped from EVERY field.
const richNotes =
  "Mia worked on dribbling with both feet and on her passing accuracy. " +
  "She stayed focused the whole hour and was a great teammate.";
const modelDraft = {
  type: "draft",
  summary_body: "Mia made real progress on dribbling and passing today. Her shooting also looked much sharper. She is cleared to play after her injury.",
  skills_worked: ["dribbling", "passing", "shooting"],
  progress_signal: "building consistency",
  practice_suggestions: ["Practice dribbling around cones at home", "Take 50 shooting reps a day"],
  encouragement: "Mia brought great energy — keep it up!",
};
const a = enforceSummaryGuardrail(modelDraft, richNotes);
const aBlob = JSON.stringify(a.result).toLowerCase();

assert.strictEqual(a.result.type, "draft", "A stays a draft");
assert.ok(!aBlob.includes("shooting"), "A: 'shooting' must appear NOWHERE (ungrounded)");
assert.ok(!/injur|cleared to play/.test(aBlob), "A: medical/safety claim must be stripped");
assert.deepStrictEqual(a.result.skills_worked, ["dribbling", "passing"], "A: only grounded skills survive");
assert.ok(/dribbling/.test(aBlob) && /passing/.test(aBlob), "A: grounded content preserved");
assert.strictEqual(a.result.practice_suggestions.length, 1, "A: ungrounded shooting suggestion dropped");
console.log("CASE A  skills      :", JSON.stringify(a.result.skills_worked));
console.log("CASE A  summary     :", JSON.stringify(a.result.summary_body));
console.log("CASE A  suggestions :", JSON.stringify(a.result.practice_suggestions));
console.log("CASE A  removed     :", JSON.stringify(a.removed));

// CASE B — needs_clarification passes through (sanitized to strings).
const b = enforceSummaryGuardrail(
  { type: "needs_clarification", questions: ["Which skills did you focus on?", "How did Mia do versus last time?"] },
  "good session",
);
assert.strictEqual(b.result.type, "needs_clarification", "B stays needs_clarification");
assert.strictEqual(b.result.questions.length, 2, "B keeps the questions");
console.log("CASE B  questions   :", JSON.stringify(b.result.questions));

// CASE C — notes never mention shooting: even an aggressive model can't surface it.
const cNotes = "We focused on footwork and positioning. Leo listened well and tried hard.";
const cDraft = {
  type: "draft",
  summary_body: "Leo improved his footwork. His shooting was the highlight of the day.",
  skills_worked: ["footwork", "shooting"],
  progress_signal: "improving",
  practice_suggestions: ["Work on shooting form"],
  encouragement: "Proud of Leo's effort!",
};
const c = enforceSummaryGuardrail(cDraft, cNotes);
const cBlob = JSON.stringify(c.result).toLowerCase();
assert.ok(!cBlob.includes("shooting"), "C: 'shooting' must appear nowhere");
assert.ok(cBlob.includes("footwork"), "C: grounded 'footwork' preserved");
console.log("CASE C  result      :", JSON.stringify(c.result));

console.log("\n[session-note guardrail tests] ALL PASS");
