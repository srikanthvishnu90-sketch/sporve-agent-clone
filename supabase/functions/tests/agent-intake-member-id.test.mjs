// Regression test for the agent-intake member_id bug (scenario 0 "James").
//
// Bug: buildFinding() never wrote member_id, so high-confidence intake
// findings (e.g. intake_unavailability with a resolved athlete) carried a
// NULL member_id. The proposal staged the correct target_row_id, but
// generate_intake_followups() joins team_athletes on f.member_id — so the
// availability_ack obligation draft was never created.
// Runs under plain node --test, no Deno runtime needed.
import test from "node:test";
import assert from "node:assert/strict";
import { buildFinding, findingMemberId } from "../agent-intake/finding.mjs";

const SPEC = { kind: "people", code: "intake_unavailability", severity: "attention" };
const ATHLETE_ID = "ce3a6aa2-5133-409e-a64f-8a0f65174c64"; // team_athletes.id

test("high-confidence athlete finding binds member_id to the resolved team_athletes id", () => {
  const row = buildFinding({
    providerId: "p1", spec: SPEC, title: "James Carter is out of the lineup",
    detail: "Proposed: mark James Carter unavailable (awaits your approval).",
    sourceRef: "intake:e1:intake_unavailability",
    memberId: findingMemberId({ need: "athlete", entityId: ATHLETE_ID }),
  });
  assert.equal(row.member_id, ATHLETE_ID);
});

test("findingMemberId returns null for non-athlete entities (never misbind)", () => {
  assert.equal(findingMemberId({ need: "session", entityId: "some-session-id" }), null);
  assert.equal(findingMemberId({ need: "guardian", entityId: "some-guardian-id" }), null);
  assert.equal(findingMemberId({ need: null, entityId: "some-id" }), null);
});

test("findingMemberId returns null when nothing resolved", () => {
  assert.equal(findingMemberId({ need: "athlete", entityId: null }), null);
});

test("ambiguous / confirmation findings keep member_id null by design", () => {
  const row = buildFinding({
    providerId: "p1", spec: SPEC,
    title: "Which athlete? — confirm before we act",
    detail: "This update names someone I can't pin down.",
    sourceRef: "intake:e2:intake_unavailability",
    // memberId intentionally omitted — the coach has not confirmed identity
  });
  assert.equal(row.member_id, null);
});

test("buildFinding keeps the legacy row shape (no field lost in the move)", () => {
  const row = buildFinding({
    providerId: "p9", spec: SPEC, title: "T", detail: "D",
    sourceRef: "intake:e3:intake_unavailability", memberId: ATHLETE_ID,
  });
  assert.equal(row.provider_id, "p9");
  assert.equal(row.kind, "people");
  assert.equal(row.code, "intake_unavailability");
  assert.equal(row.severity, "attention");
  assert.equal(row.title, "T");
  assert.equal(row.detail, "D");
  assert.equal(row.source_ref, "intake:e3:intake_unavailability");
  assert.equal(row.status, "open");
  assert.equal(row.member_id, ATHLETE_ID);
});
