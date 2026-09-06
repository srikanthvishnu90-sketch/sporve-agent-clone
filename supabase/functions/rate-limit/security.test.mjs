import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const targets = [
  ["stripe-create-checkout", "stripe-checkout:minute", 10],
  ["billing-create-checkout", "billing-checkout:minute", 10],
  ["billing-portal", "billing-portal:minute", 10],
  ["stripe-provider-payouts", "stripe-payouts:minute", 30],
  ["draft-recap", "draft-recap:minute", 30],
  ["camp-recap", "camp-recap:minute", 20],
  ["camp-broadcast", "camp-broadcast:minute", 10],
  ["stripe-refund", "stripe-refund:minute", 10],
  ["installment-checkout", "installment-checkout:minute", 10],
  ["parent-update-send", "parent-update-send:minute", 30],
  ["lifecycle-approve", "lifecycle-approve:minute", 30],
];

test("authenticated money and recap endpoints consume durable user rate limits after auth", async () => {
  for (const [name, scope, limit] of targets) {
    const source = await fs.readFile(`supabase/functions/${name}/index.ts`, "utf8");
    const auth = source.indexOf("auth.getUser()");
    const limiter = source.indexOf('"consume_edge_rate_limit"');
    assert.notEqual(auth, -1, `${name} must authenticate the caller`);
    assert.notEqual(limiter, -1, `${name} must call the durable limiter`);
    assert.ok(limiter > auth, `${name} must rate-limit only after caller identity is known`);
    assert.ok(source.includes(`p_scope: "${scope}"`), `${name} scope must be explicit`);
    assert.ok(source.includes(`p_limit: ${limit}`), `${name} limit must be bounded`);
    assert.ok(source.includes("p_window_seconds: 60"), `${name} window must be one minute`);
    assert.match(source, /rateError/);
    assert.match(source, /withinLimit/);
    assert.match(source, /429/);
  }
});
