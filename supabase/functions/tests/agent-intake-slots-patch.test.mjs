// Regression tests for the 5 verified agent-intake bugs (2026-09-23).
//
// Fix 1: buildSessionPatch emitted non-columns (day_ref/weekday) → the
//   applier (apply_intake_patch) raises on unknown columns, so every
//   schedule-change approval 400'd. It now emits ONLY real sessions columns.
// Fix 2: program_inquiry had no proposal branch → stages a prospects INSERT.
// Fix 3: cancellation intent missed phrasings; order vs schedule_change.
// Fix 4: 24h time extraction ("18:00" → "6:00 pm"); card_mentioned honesty slot.
// Fix 5 (sc03): waiver-name extraction never invents a name.
//
// Runs under plain node --test, no Deno runtime needed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  INTENTS, classifyIntents, extractSlots, buildSessionPatch,
  resolveSessionDate, waiverNameFromText, matchWaiverDoc, buildProposal,
} from "../agent-intake/finding.mjs";

// 2026-09-23 12:00 UTC — a Wednesday. runNow is fixed so date math is stable.
const WED_NOON_UTC = Date.UTC(2026, 8, 23, 12, 0, 0);
const UTC = "UTC";
const REF = { guardians: [], staff: [], certs: [], sessions: [] };
const BASE_PROPOSAL = {
  providerId: "p1", eventId: "e1", confidence: 0.9, entityName: "",
  fromEmail: "parent@example.com", ref: REF, findingRef: "intake:e1:x",
  orgTz: UTC, runNow: WED_NOON_UTC,
};

/* ── Fix 1: real columns only ─────────────────────────────────────────── */
const REAL_SESSION_COLS = new Set([
  "start_date", "end_date", "start_time", "end_time", "timezone",
  "address", "capacity", "cancelled", "cancelled_at", "cancel_reason",
]);

test("buildSessionPatch: tomorrow resolves to a real start_date, no pseudo-columns", () => {
  const patch = buildSessionPatch({ day_ref: "tomorrow" }, WED_NOON_UTC, UTC);
  assert.equal(patch.start_date, "2026-09-24");
  assert.ok(!("day_ref" in patch), "day_ref must never reach a patch");
  assert.ok(!("weekday" in patch), "weekday must never reach a patch");
});

test("buildSessionPatch: tonight/today resolve to today", () => {
  assert.equal(buildSessionPatch({ day_ref: "tonight" }, WED_NOON_UTC, UTC).start_date, "2026-09-23");
  assert.equal(buildSessionPatch({ day_ref: "today" }, WED_NOON_UTC, UTC).start_date, "2026-09-23");
});

test("buildSessionPatch: weekday maps to its nearest future occurrence", () => {
  // 2026-09-23 is a Wednesday.
  assert.equal(buildSessionPatch({ weekday: "friday" }, WED_NOON_UTC, UTC).start_date, "2026-09-25");
  assert.equal(buildSessionPatch({ weekday: "wednesday" }, WED_NOON_UTC, UTC).start_date, "2026-09-23");
  assert.equal(buildSessionPatch({ weekday: "tuesday" }, WED_NOON_UTC, UTC).start_date, "2026-09-29");
});

test("buildSessionPatch: day_ref wins over a weekday name", () => {
  const patch = buildSessionPatch({ day_ref: "tomorrow", weekday: "friday" }, WED_NOON_UTC, UTC);
  assert.equal(patch.start_date, "2026-09-24");
});

test("buildSessionPatch: dates resolve in the provider's timezone", () => {
  // 2026-09-23 01:00 UTC is still 2026-09-22 20:00 in Chicago.
  const runNow = Date.UTC(2026, 8, 23, 1, 0, 0);
  assert.equal(resolveSessionDate({ day_ref: "today" }, runNow, "America/Chicago"), "2026-09-22");
  assert.equal(resolveSessionDate({ day_ref: "today" }, runNow, "UTC"), "2026-09-23");
});

test("buildSessionPatch: empty when nothing resolves (applier rejects empty patches)", () => {
  assert.deepEqual(buildSessionPatch({}, WED_NOON_UTC, UTC), {});
});

test("buildSessionPatch: time-only patch carries just start_time", () => {
  const patch = buildSessionPatch({ time: "6:00 pm" }, WED_NOON_UTC, UTC);
  assert.deepEqual(patch, { start_time: "6:00 pm" });
});

test("buildSessionPatch: every emitted key is a real sessions column", () => {
  const combos = [
    { day_ref: "tomorrow", time: "6:00 pm" },
    { weekday: "saturday", time: "9:00 am" },
    { time: "12:00 pm" },
  ];
  for (const slots of combos) {
    const patch = buildSessionPatch(slots, WED_NOON_UTC, UTC);
    for (const k of Object.keys(patch)) {
      assert.ok(REAL_SESSION_COLS.has(k), `non-column leaked into patch: ${k}`);
    }
  }
});

/* ── Fix 1: 24h time extraction ───────────────────────────────────────── */
test("extractSlots: 24h clock normalizes to h:mm am/pm", () => {
  assert.equal(extractSlots("Can we move the game to 18:00?").time, "6:00 pm");
  assert.equal(extractSlots("meet at 09:05").time, "9:05 am");
  assert.equal(extractSlots("midnight session 00:30").time, "12:30 am");
  assert.equal(extractSlots("noon game 12:00").time, "12:00 pm");
});

test("extractSlots: am/pm input is not double-parsed by the 24h branch", () => {
  assert.equal(extractSlots("practice at 6:30 pm").time, "6:30 pm");
  assert.equal(extractSlots("game at 11 AM").time, "11:00 am");
});

/* ── Fix 3: cancellation patterns + order ─────────────────────────────── */
test("INTENTS: cancellation is defined before schedule_change (tie-break order)", () => {
  const keys = Object.keys(INTENTS);
  assert.ok(keys.indexOf("cancellation") < keys.indexOf("schedule_change"),
    "cancellation must be checked before schedule_change");
});

test("classifyIntents: day-agnostic cancellation phrasings fire", () => {
  for (const text of [
    "We need to cancel the game on Saturday",
    "We have to cancel practice this week",
    "Let's cancel the scrimmage",
    "We're calling it off tonight",
    "Can we cancel Tuesday's training session?",
    "The game is cancelled",
  ]) {
    const intents = classifyIntents(text).map((i) => i.intent);
    assert.ok(intents.includes("cancellation"), `missed cancellation: ${text}`);
  }
});

test("classifyIntents: a cancel+move message resolves to cancellation first", () => {
  const intents = classifyIntents("We need to cancel and move the game to Friday");
  assert.ok(intents.length >= 2, "both intents should fire");
  assert.equal(intents[0].intent, "cancellation");
});

test("classifyIntents: natural schedule-change phrasings fire (and are not cancellations)", () => {
  for (const text of [
    "Can we move the game to Friday?",
    "What if we moved practice to 6pm",
    "Can we shift the scrimmage?",
    "Could we push the game back an hour?",
    "Is there a new date for the session?",
  ]) {
    const intents = classifyIntents(text).map((i) => i.intent);
    assert.ok(intents.includes("schedule_change"), `missed schedule_change: ${text}`);
    assert.ok(!intents.includes("cancellation"), `misclassified as cancellation: ${text}`);
  }
});

/* ── Fix 2: program_inquiry proposal branch ───────────────────────────── */
test("buildProposal: program_inquiry stages a prospects INSERT (never enrolled)", () => {
  const prop = buildProposal({ ...BASE_PROPOSAL, intent: "program_inquiry", entityId: null });
  assert.ok(prop, "program_inquiry must stage a proposal");
  assert.equal(prop.target_table, "prospects");
  assert.equal(prop.target_row_id, null);
  assert.equal(prop.patch.source, "intake_program_inquiry");
  assert.equal(prop.patch.status, "inquiry");
  assert.notEqual(prop.patch.status, "enrolled");
  assert.equal(prop.patch.name, "");
  assert.equal(prop.patch.email, "parent@example.com");
});

test("buildProposal: program_inquiry links the sender to a guardian by email", () => {
  const ref = {
    ...REF,
    guardians: [{ id: "g1", name: "Jane Doe", extra: "jane@example.com" }],
  };
  const prop = buildProposal({
    ...BASE_PROPOSAL, intent: "program_inquiry", entityId: null,
    fromEmail: "Jane@Example.com", ref,
  });
  assert.equal(prop.patch.note, "Sender matches guardian Jane Doe");
});

test("buildProposal: program_inquiry omits the note when the sender is unknown", () => {
  const prop = buildProposal({ ...BASE_PROPOSAL, intent: "program_inquiry", entityId: null });
  assert.ok(!("note" in prop.patch), "note must be omitted, not empty");
});

test("buildProposal: schedule_change with no resolvable date/time stages nothing", () => {
  const prop = buildProposal({
    ...BASE_PROPOSAL, intent: "schedule_change", entityId: "s1", slots: {},
  });
  assert.equal(prop, null);
});

test("buildProposal: schedule_change with a resolved date stages a real-column patch", () => {
  const prop = buildProposal({
    ...BASE_PROPOSAL, intent: "schedule_change", entityId: "s1",
    slots: { day_ref: "tomorrow", time: "6:00 pm" },
  });
  assert.ok(prop);
  assert.equal(prop.target_table, "sessions");
  assert.equal(prop.patch.start_date, "2026-09-24");
  assert.equal(prop.patch.start_time, "6:00 pm");
  for (const k of Object.keys(prop.patch)) {
    assert.ok(REAL_SESSION_COLS.has(k), `non-column leaked: ${k}`);
  }
});

/* ── Fix 4: card_mentioned honesty slot ────────────────────────────────── */
test("extractSlots: card_mentioned only when the email names a card", () => {
  assert.equal(extractSlots("My card was declined").card_mentioned, true);
  assert.equal(extractSlots("The payment failed").card_mentioned, false);
  assert.equal(extractSlots("Charge failed for invoice 123").card_mentioned, false);
});

/* ── Fix 5 (sc03): waiver-name extraction never invents ───────────────── */
test("waiverNameFromText: quoted waiver names are extracted", () => {
  assert.equal(waiverNameFromText('We signed the "Liability Waiver" waiver'), "Liability Waiver");
  assert.equal(waiverNameFromText('"Medical Release" waiver is attached'), "Medical Release");
});

test("waiverNameFromText: generic claims without a name return null (never invented)", () => {
  assert.equal(waiverNameFromText("We signed the waiver already"), null);
  assert.equal(waiverNameFromText("The waiver is signed"), null);
  assert.equal(waiverNameFromText("the medical release waiver is attached"), null);
});

test("matchWaiverDoc: matches by title substring, null when unknown", () => {
  const docs = [{ id: "d1", title: "2026 Liability Waiver" }];
  const hit = matchWaiverDoc(docs, "Liability Waiver");
  assert.ok(hit && hit.id === "d1");
  assert.equal(matchWaiverDoc(docs, null), null);
  assert.equal(matchWaiverDoc(docs, "Some Other Form"), null);
  assert.equal(matchWaiverDoc([], "Liability Waiver"), null);
});
