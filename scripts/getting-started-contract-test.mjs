import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const onboarding = readFileSync(join(root, "src/mod-coachonboard.js"), "utf8");
const coachUi = readFileSync(join(root, "src/mod-coachui.js"), "utf8");
const host = readFileSync(join(root, "src/sporve-web.host.html"), "utf8");

const start = onboarding.indexOf("function guideSnapshot()");
const end = onboarding.indexOf("function guideDrawer(", start);
assert.ok(start >= 0 && end > start, "state-backed guide snapshot must exist");
const guide = onboarding.slice(start, end);

const expected = [
  ["identity", 1, 1],
  ["profile", 1, 2],
  ["listing", 1, 3],
  ["check", 2, 4],
  ["availability", 2, 5],
  ["payouts", 3, 6],
  ["policy", 3, 7],
];
const found = [...guide.matchAll(/id:"([^"]+)", phase:(\d), n:(\d)/g)]
  .map(match => [match[1], Number(match[2]), Number(match[3])]);
assert.deepEqual(found, expected, "guide must keep the approved seven steps in three phases");

for (let index = 0; index < expected.length; index += 1) {
  const [id] = expected[index];
  const offset = guide.indexOf(`id:"${id}"`);
  const next = index + 1 < expected.length
    ? guide.indexOf(`id:"${expected[index + 1][0]}"`, offset)
    : guide.length;
  const step = guide.slice(offset, next);
  for (const field of ["time", "owner", "description", "unlocks", "why", "requirements", "process", "completeWhen", "evidence", "limit"]){
    assert.match(step, new RegExp(`\\b${field}:`), `${id} must explain ${field}`);
  }
  const requirements = step.match(/requirements:\[(.*?)\],\n\s+process:/s)?.[1] || "";
  const process = step.match(/process:\[(.*?)\],\n\s+completeWhen:/s)?.[1] || "";
  assert.ok((requirements.match(/"/g) || []).length >= 6, `${id} needs at least three explicit requirements`);
  assert.ok((process.match(/"/g) || []).length >= 8, `${id} needs at least four ordered process actions`);
}

for (const signal of [
  "background_check_status",
  "background_check_completed_at",
  "stripe_charges_enabled",
  "listingHasFutureSession",
  "cancellationPolicy",
]) assert.ok(guide.includes(signal), `completion must derive from ${signal}`);
assert.match(onboarding, /providerId/, "owned-listing completion must bind to the provider id");

assert.match(guide, /const availabilityDone = futureSessions\.length > 0/, "no coach may complete availability from local recurring-demo state");
assert.doesNotMatch(onboarding, /data-gs-(?:done|complete)|step\.done\s*=/, "the guide must not expose a client-side mark-done path");
assert.match(onboarding, /Sample mode never counts as a real background-check result/, "sample screening must be disclosed");
assert.match(onboarding, /an account id by itself is not enough/, "Stripe redirect/account creation must not count as payout readiness");
assert.match(onboarding, /does not prove a named screening vendor/, "screening details must not be invented");
assert.match(onboarding, /does not promise a two-day payout/, "payout timing must remain Stripe-controlled");

for (const component of ["ProgressCard", "ProcessPhases", "Drawer"]){
  assert.match(coachUi, new RegExp(`function ${component}\\(`), `${component} must be shared UI`);
  assert.match(coachUi, new RegExp(`\\b${component}:${component}\\b`), `${component} must be exported`);
}
assert.match(coachUi, /\.cui-page,\.cui-drawer\{/, "the detached drawer must inherit the shared token set");
assert.match(coachUi, /\.cui-drawer\{position:fixed;z-index:211/, "the process drawer must sit above the AI layer");
assert.match(onboarding, /suppressGuideBackground\(drawer/, "the modal must isolate every background branch");
assert.match(onboarding, /data-gs-trigger="step-/, "row triggers need unique focus-return identities");
assert.match(host, /data-ctab="getting-started"/, "coach rail must address the guide");
assert.match(host, /data-ctab="getting-started"[\s\S]*?5 of 7|guide\(\)/, "host must derive onboarding progress through the guide adapter");

console.log("Getting Started contract: 7 evidence-derived steps, 3 phases, detailed drawers, and shared Media UI PASS");
