// Regression tests: vendor-only background-check verification (decision a, 2026-09-23).
//
// The agent must NEVER stage a proposal that sets a staff background check
// (or any staff credential) to 'verified' — verification is vendor-only
// (staff-cert-webhook is the sole path; the DB trigger
// trg_enforce_staff_check_attestation is the second lock, the intake fence
// is the first). Credential-EXPIRY scenarios stage:
//   (1) an information/warning finding (warn), and
//   (2) a renewal-request message DRAFT addressed to the staff member
//       (kind 'message_draft', approval-gated, never auto-sent).
// Vendor "cleared" notices are informational findings only — no proposal.
// No proposal may touch verified/attestation fields.
//
// Runs under plain node --test, no Deno runtime needed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  INTENTS, classifyIntents, buildFinding, buildProposal, isCredentialExpiry,
  credentialFindingSpec, fenceVerifiedProposal,
} from "../agent-intake/finding.mjs";

const STAFF_ID = "staff-11111111-1111-4111-8111-111111111111";
const CERT_ID = "cert-22222222-2222-4222-8222-222222222222";
const REF = {
  guardians: [],
  staff: [{ id: STAFF_ID, name: "Mike Ross", member_user_id: "mu-1" }],
  certs: [{
    id: CERT_ID, member_user_id: "mu-1", kind: "background_check",
    expires_at: "2026-10-31", status: "pending",
  }],
  sessions: [{ id: "sess-1", assigned_member_id: STAFF_ID }],
};
const BASE = {
  providerId: "p1", eventId: "e1", confidence: 0.9, entityName: "Mike Ross",
  fromEmail: "coach@example.com", ref: REF, findingRef: "intake:e1:intake_credential_update",
  orgTz: "UTC", runNow: Date.UTC(2026, 8, 23, 12, 0, 0),
};

/* ── The fence: legacy verified-flag proposals are blocked ─────────────── */
test("fence: the exact proposal the old code staged is BLOCKED", () => {
  const legacy = {
    provider_id: "p1", event_id: "e1", kind: "data_change", confidence: 0.9,
    status: "draft", target_table: "staff_certifications", target_row_id: CERT_ID,
    patch: { status: "verified" },
  };
  const hit = fenceVerifiedProposal(legacy);
  assert.ok(typeof hit === "string" && hit.includes("verified"),
    `expected a block reason, got ${hit}`);
});

test("fence: attestation-trail fields are blocked (any case, any intent)", () => {
  for (const patch of [
    { attested_by: "u1" },
    { attested_at: "2026-09-23T00:00:00Z" },
    { evidence_source: "director_attestation" },
    { verified_at: "2026-09-23T00:00:00Z" },
    { status: "attested" },
    { STATUS: "VERIFIED" },
  ]) {
    assert.ok(fenceVerifiedProposal({ patch }) !== null,
      `patch ${JSON.stringify(patch)} must be blocked`);
  }
});

test("fence: legitimate proposals pass (no false positives)", () => {
  assert.equal(fenceVerifiedProposal({ patch: { is_available: false } }), null);
  assert.equal(fenceVerifiedProposal({ patch: { cancelled: true } }), null);
  assert.equal(fenceVerifiedProposal({ patch: { name: "", email: "a@b.c", status: "trial" } }), null);
  assert.equal(fenceVerifiedProposal({ patch: {} }), null);
  assert.equal(fenceVerifiedProposal({ kind: "message_draft" }), null);
});

/* ── Exhaustive: no intent can stage a verified/attestation proposal ────── */
const INTENT_ARGS = {
  unavailability: { entityId: "athlete-1" },
  schedule_change: { entityId: "sess-1", slots: { day_ref: "tomorrow" } },
  cancellation: { entityId: "sess-1" },
  credential_update: { entityId: STAFF_ID, entityName: "Mike Ross", credentialExpiry: true },
  credential_update_vendor: { intent: "credential_update", entityId: STAFF_ID, entityName: "Mike Ross", credentialExpiry: false },
  staff_unavailable: { entityId: STAFF_ID },
  trial_request: {},
  enrollment_request: {},
  program_inquiry: {},
  staff_onboarding: {},
  waiver_claim: { entityId: "athlete-1" },
  payment_hardship: {},
  payment_issue: {},
};

test("exhaustive: no intent stages a proposal touching verified/attestation fields", () => {
  for (const [label, extra] of Object.entries(INTENT_ARGS)) {
    const intent = extra.intent ?? label;
    const prop = buildProposal({
      ...BASE, intent, slots: extra.slots ?? {},
      entityId: extra.entityId ?? null, findingRef: `intake:e1:${INTENTS[intent].code}`,
      credentialExpiry: extra.credentialExpiry ?? false,
    });
    if (prop === null) continue; // finding-only by design
    const hit = fenceVerifiedProposal(prop);
    assert.equal(hit, null, `${label}: fence tripped on ${JSON.stringify(prop.patch)} (${hit})`);
    assert.ok(!(prop.kind === "data_change" && prop.target_table === "staff_certifications"),
      `${label}: must never stage a staff_certifications data_change`);
  }
});

/* ── Credential-expiry event → warning finding + renewal draft ──────────── */
const EXPIRY_TEXT =
  "Hi — heads up that Coach Mike Ross's background check expires next Friday. Please renew it.";

test("credential-expiry text classifies as credential_update and is detected as expiry", () => {
  const intents = classifyIntents(EXPIRY_TEXT).map((i) => i.intent);
  assert.ok(intents.includes("credential_update"), `got ${JSON.stringify(intents)}`);
  assert.equal(isCredentialExpiry(EXPIRY_TEXT), true);
});

test("credential-expiry finding is a warning with the stable finding code", () => {
  const spec = credentialFindingSpec(true);
  assert.equal(spec.code, "intake_credential_update");
  assert.equal(spec.severity, "warn");
  const row = buildFinding({
    providerId: "p1", spec, title: "Mike Ross's credential needs renewal",
    detail: "Background-check verification is vendor-only.",
    sourceRef: "intake:e1:intake_credential_update", memberId: null,
  });
  assert.equal(row.severity, "warn");
  assert.equal(row.code, "intake_credential_update");
  assert.equal(row.status, "open");
});

test("credential-expiry stages a renewal message draft to the staff member (approval-gated)", () => {
  const prop = buildProposal({ ...BASE, intent: "credential_update", entityId: STAFF_ID, credentialExpiry: true });
  assert.ok(prop, "expected a staged draft");
  assert.equal(prop.kind, "message_draft");
  assert.equal(prop.status, "draft");
  assert.equal(prop.target_table, "organization_members");
  assert.equal(prop.target_row_id, STAFF_ID);
  // Addressed to the staff member, never auto-sent.
  assert.equal(prop.patch.to, "Mike Ross");
  assert.ok(prop.patch.subject && prop.patch.body, "draft needs subject + body");
  assert.ok(prop.patch.body.includes("Mike"), "body addresses the staff member by name");
  assert.ok(prop.patch.body.includes("2026-10-31"), "body cites the real DB expiry, never invented");
  assert.ok(prop.patch.body.includes("background check"), "body names the real cert kind");
  assert.ok(/draft/i.test(prop.patch.body), "body is marked as a draft");
  assert.ok(/vendor/i.test(prop.patch.body), "body says verification stays with the vendor");
  // Zero verified/attestation fields anywhere on the staged proposal.
  assert.equal(fenceVerifiedProposal(prop), null);
  assert.ok(prop.kind !== "data_change" || prop.target_table !== "staff_certifications");
});

test("credential-expiry with no cert row matched: draft stays honest, invents nothing", () => {
  const refNoCert = { ...REF, certs: [] };
  const prop = buildProposal({
    ...BASE, intent: "credential_update", entityId: STAFF_ID,
    credentialExpiry: true, ref: refNoCert,
  });
  assert.ok(prop, "expected a staged draft");
  assert.equal(prop.kind, "message_draft");
  assert.equal(fenceVerifiedProposal(prop), null);
  assert.ok(!prop.patch.body.includes("background_check"),
    "must not invent a credential kind from thin air");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(prop.patch.body),
    "must not invent an expiry date");
  assert.ok(prop.patch.body.includes("credential"), "honest generic copy");
});

test("credential-expiry with unresolved staff: finding only, never a guess", () => {
  const prop = buildProposal({
    ...BASE, intent: "credential_update", entityId: null, credentialExpiry: true,
  });
  assert.equal(prop, null);
});

/* ── Vendor notice ("cleared") → info finding, no proposal ──────────────── */
const VENDOR_TEXT = "NCSI update: background check cleared for Coach Mike Ross.";

test("vendor 'cleared' notice is NOT expiry; stages no proposal", () => {
  const intents = classifyIntents(VENDOR_TEXT).map((i) => i.intent);
  assert.ok(intents.includes("credential_update"), `got ${JSON.stringify(intents)}`);
  assert.equal(isCredentialExpiry(VENDOR_TEXT), false);
  assert.equal(credentialFindingSpec(false).severity, "info");
  const prop = buildProposal({
    ...BASE, intent: "credential_update", entityId: STAFF_ID, credentialExpiry: false,
  });
  assert.equal(prop, null, "a vendor notice must not stage any proposal");
});

test("vendor notice finding is informational", () => {
  const row = buildFinding({
    providerId: "p1", spec: credentialFindingSpec(false),
    title: "Mike Ross's credential update — vendor notice",
    detail: "No change staged — verification is vendor-only.",
    sourceRef: "intake:e1:intake_credential_update", memberId: null,
  });
  assert.equal(row.severity, "info");
});
