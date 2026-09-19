// The money gate, platform side. apply_platform_billing_event (red draft, not
// live) returns a jsonb receipt; the dues RPC apply_stripe_billing_event
// returns a bare text verdict. Neither may be acknowledged with 200 unless the
// receipt proves 'applied' or an idempotent 'duplicate'/'superseded'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingWebhook } from './handler.mjs';

const provider = '10000000-0000-4000-8000-000000000001';
const event = () => ({ id: 'evt_fixture', type: 'customer.subscription.updated',
  created: 1700000000, livemode: false, data: { object: { id: 'sub_fixture', customer: 'cus_fixture' } } });
const subscription = () => ({ id: 'sub_fixture', customer: 'cus_fixture', livemode: false,
  status: 'active', cancel_at_period_end: false, current_period_start: 1700000000,
  current_period_end: 1702600000, items: { data: [{ price: { id: 'price_fixture' }, quantity: 1 }] } });
const receiptFor = (input, outcome) => ({ receipt_id: 'receipt-fixture', event_id: input.event_id,
  subscription_id: input.subscription.subscription_id, customer_id: input.subscription.customer_id,
  provider_id: provider, outcome, payload_sha256: input.payload_sha256,
  assignment_revision: 1, effective_plan: 'solo', subscription: { ...input.subscription } });
const handlerWith = apply => createBillingWebhook({ livemode: false,
  verify: async () => event(), loadSubscription: async () => subscription(), apply });
const request = () => new Request('https://fixture.invalid', { method: 'POST',
  headers: { 'stripe-signature': 'fixture' }, body: 'signed event bytes' });

test('applied, duplicate and superseded receipts acknowledge 200', async () => {
  for (const outcome of ['applied', 'duplicate', 'superseded']) {
    const res = await handlerWith(async input => receiptFor(input, outcome))(request());
    assert.equal(res.status, 200, outcome);
    assert.equal((await res.json()).outcome, outcome);
  }
});

for (const outcome of ['stale', 'ignored_bad_plan:solo', 'ignored_unknown_status:paused',
  'provider_not_found', 'ignored', 'unknown_verdict']) {
  test(`receipt outcome '${outcome}' is REJECTED (503), never a silent 200`, async () => {
    const res = await handlerWith(async input => receiptFor(input, outcome))(request());
    assert.equal(res.status, 503);
  });
}

test('a bare text verdict (the dues RPC contract) is REJECTED, even applied:*', async () => {
  for (const verdict of ['applied:pro/active', 'duplicate', 'stale', 'ignored_bad_plan:solo',
    'ignored_unknown_status:paused', 'provider_not_found', '']) {
    const res = await handlerWith(async () => verdict)(request());
    assert.equal(res.status, 503, verdict);
  }
});

test('a thrown apply error is 503, never 200, and leaks no detail', async () => {
  const res = await handlerWith(async () => { throw new Error('private DB detail'); })(request());
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /private DB detail/);
});
