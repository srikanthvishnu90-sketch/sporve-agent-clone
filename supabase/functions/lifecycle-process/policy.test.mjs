// Unit tests for the lifecycle-process control logic — no Supabase/Deno.
//   node supabase/functions/lifecycle-process/policy.test.mjs
import assert from "node:assert";
import {
  resolveAction,
  modelForEvent,
  buildAutoTemplate,
  autoOrFallback,
  enforceLifecycleDraft,
  isLogistics,
} from "./policy.ts";

// ── mode routing ────────────────────────────────────────────────────────────
assert.strictEqual(resolveAction("off", "booking_confirmed"), "skip", "off -> skip");
assert.strictEqual(resolveAction("draft", "booking_confirmed"), "draft", "draft -> draft");
assert.strictEqual(resolveAction("auto", "booking_confirmed"), "auto", "auto logistics -> auto");
assert.strictEqual(resolveAction("auto", "reminder_24h"), "auto", "auto logistics -> auto");
// auto on NON-logistics must fall back to draft (never auto-send substantive msgs)
assert.strictEqual(resolveAction("auto", "post_session"), "draft", "auto post_session -> draft");
assert.strictEqual(resolveAction("auto", "no_show_followup"), "draft", "auto no_show -> draft");
assert.strictEqual(resolveAction("auto", "rebook_nudge"), "draft", "auto rebook -> draft");
assert.strictEqual(resolveAction(undefined, "post_session"), "draft", "missing mode -> draft default");
console.log("routing: off/draft/auto + auto-only-logistics fallback  OK");

// ── model selection ─────────────────────────────────────────────────────────
assert.strictEqual(modelForEvent("reminder_24h"), "claude-haiku-4-5-20251001", "reminder -> haiku");
assert.strictEqual(modelForEvent("booking_confirmed"), "claude-haiku-4-5-20251001", "confirm -> haiku");
assert.strictEqual(modelForEvent("post_session"), "claude-sonnet-4-6", "post_session -> sonnet");
assert.strictEqual(modelForEvent("no_show_followup"), "claude-sonnet-4-6", "no_show -> sonnet");
console.log("model: haiku for logistics, sonnet for follow-ups          OK");

// ── auto template: thin personalization over a FIXED template ───────────────
const t1 = buildAutoTemplate("booking_confirmed", { childFirstName: "Mia", dateText: "Tue Jun 30", timeText: "5:00 PM", place: "Field 3" });
assert.ok(t1.includes("Mia") && t1.includes("Tue Jun 30") && t1.includes("5:00 PM") && t1.includes("Field 3"), "template personalizes child/date/time/place");
const t2 = buildAutoTemplate("reminder_24h", { childFirstName: "Leo", dateText: "Wed", timeText: "9:00 AM" });
assert.ok(t2.includes("Leo") && t2.includes("tomorrow"), "reminder template");
// missing 'when' -> cannot build -> null (caller falls back to draft)
assert.strictEqual(buildAutoTemplate("booking_confirmed", { childFirstName: "Mia" }), null, "no date/time -> null");
// non-logistics -> never a template
assert.strictEqual(buildAutoTemplate("post_session", { dateText: "x", timeText: "y" }), null, "non-logistics -> null");
console.log("auto template: personalized logistics only                  OK");

// ── HARD GUARDRAIL: autoOrFallback ──────────────────────────────────────────
// good logistics -> returns the template
assert.ok(autoOrFallback("reminder_24h", { childFirstName: "Mia", dateText: "Wed", timeText: "9 AM" }), "valid logistics auto allowed");
// missing logistics -> null (fall back to draft)
assert.strictEqual(autoOrFallback("reminder_24h", { childFirstName: "Mia" }), null, "missing when -> draft");
// non-logistics substantive -> null (fall back to draft, never auto-send)
assert.strictEqual(autoOrFallback("post_session", { dateText: "x", timeText: "y" }), null, "substantive -> draft");
assert.strictEqual(autoOrFallback("no_show_followup", { dateText: "x", timeText: "y" }), null, "no_show -> draft");
console.log("guardrail: auto only emits templated logistics, else draft   OK");

// ── claim stripping on drafted bodies ───────────────────────────────────────
const d = enforceLifecycleDraft("Looking forward to seeing Mia! I'm a NASM certified trainer and cleared her to play.");
assert.ok(!/nasm|certified|cleared to play/i.test(d.body), "claims stripped from draft");
assert.ok(/looking forward/i.test(d.body), "legit content kept");
assert.ok(d.removed.length >= 1, "removed reported");
console.log("draft guardrail: credential/medical claims stripped          OK");

assert.ok(isLogistics("booking_confirmed") && !isLogistics("rebook_nudge"), "isLogistics");

console.log("\n[lifecycle-process policy tests] ALL PASS");
