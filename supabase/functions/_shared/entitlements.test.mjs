import assert from "node:assert/strict";
import { entitlementLimitResponse } from "./entitlements.mjs";

const valid = { code: "PT402", details: JSON.stringify({
  reason: "member_cap", current_plan: "free", upgrade_to: "individual", limit: 15, current: 15,
}) };
assert.deepEqual(entitlementLimitResponse(valid), { status: 402, body: {
  reason: "member_cap", current_plan: "free", upgrade_to: "individual", limit: 15, current: 15,
} });
assert.equal(entitlementLimitResponse({ code: "23505", details: valid.details }), null);
assert.equal(entitlementLimitResponse({ code: "PT402", details: "not-json" }), null);
assert.equal(entitlementLimitResponse({ code: "PT402", details: JSON.stringify({ reason: "member_cap" }) }), null);
assert.equal(entitlementLimitResponse({ code: "PT402", details: JSON.stringify({
  reason: "member_cap", current_plan: "free", upgrade_to: "individual", limit: "15", current: 15,
}) }), null);
for (const body of [
  { reason: "", current_plan: "free", upgrade_to: "individual", limit: 15, current: 15 },
  { reason: "member cap", current_plan: "free", upgrade_to: "individual", limit: 15, current: 15 },
  { reason: "member_cap", current_plan: "Free", upgrade_to: "individual", limit: 15, current: 15 },
  { reason: "member_cap", current_plan: "free", upgrade_to: "https://elsewhere", limit: 15, current: 15 },
  { reason: "member_cap", current_plan: "free", upgrade_to: undefined, limit: 15, current: 15 },
  { reason: "member_cap", current_plan: "free", upgrade_to: null, limit: -1, current: 15 },
  { reason: "member_cap", current_plan: "free", upgrade_to: null, limit: 15.1, current: 15 },
  { reason: "member_cap", current_plan: "free", upgrade_to: null, limit: 15, current: -1 },
  { reason: "member_cap", current_plan: "free", upgrade_to: null, limit: 15, current: Number.MAX_SAFE_INTEGER + 1 },
]) assert.equal(entitlementLimitResponse({ code: "PT402", details: JSON.stringify(body) }), null);
