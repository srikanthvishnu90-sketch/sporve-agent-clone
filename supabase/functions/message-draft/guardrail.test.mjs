// Local unit test for the message-draft claim guardrail — no Supabase/Deno.
//   node supabase/functions/message-draft/guardrail.test.mjs
import assert from "node:assert";
import { enforceMessageDraftGuardrail } from "./guardrail.ts";

// CASE A — a normal reschedule reply passes through untouched (no claims).
const reschedule = [
  { text: "Hi! No problem at all — I can move Mia's session. Would Thursday at 4pm or Saturday morning work better for you? Just let me know and I'll get it set." },
  { text: "Thanks for the heads up! Happy to reschedule. I have a couple of openings later this week — what days are easiest on your end?" },
];
const a = enforceMessageDraftGuardrail(reschedule);
assert.strictEqual(a.refused, false, "A: not refused");
assert.strictEqual(a.drafts.length, 2, "A: both reschedule drafts survive");
assert.strictEqual(a.removed.length, 0, "A: nothing stripped from clean drafts");
assert.ok(/reschedule|move|openings/i.test(JSON.stringify(a.drafts)), "A: reschedule intent preserved");
console.log("CASE A  drafts  :", JSON.stringify(a.drafts.map((d) => d.text)));

// CASE B — a draft that mixes a real reply with a credential/medical claim has
// only the claim sentences stripped; the helpful sentence survives.
const mixed = [
  { text: "Happy to set up extra sessions for Leo! I'm a NASM certified trainer and CPR certified. He looked great today." },
];
const b = enforceMessageDraftGuardrail(mixed);
const bBlob = JSON.stringify(b.drafts).toLowerCase();
assert.strictEqual(b.refused, false, "B: a clean sentence remains, so not refused");
assert.ok(!/nasm|certified|cpr/.test(bBlob), "B: credential/CPR claims stripped");
assert.ok(/extra sessions|looked great/.test(bBlob), "B: legitimate content preserved");
assert.ok(b.removed.length >= 1, "B: stripped sentences are reported");
console.log("CASE B  kept    :", JSON.stringify(b.drafts.map((d) => d.text)));
console.log("CASE B  removed :", JSON.stringify(b.removed));

// CASE C — a draft that is ONLY a credential claim is emptied and dropped; with
// nothing left, the result is REFUSED (caller returns needs_revision).
const onlyClaim = [
  { text: "Absolutely — as a licensed physical therapist I've cleared Mia to play and she is fully recovered from her injury." },
];
const c = enforceMessageDraftGuardrail(onlyClaim);
assert.strictEqual(c.drafts.length, 0, "C: the all-claim draft is dropped");
assert.strictEqual(c.refused, true, "C: refused when every draft is emptied");
console.log("CASE C  refused :", c.refused, " removed:", JSON.stringify(c.removed));

console.log("\n[message-draft guardrail tests] ALL PASS");
