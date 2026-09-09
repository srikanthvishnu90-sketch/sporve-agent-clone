import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingWebhook } from './handler.mjs';

const provider = '10000000-0000-4000-8000-000000000001';
const event = () => ({ id: 'evt_fixture', type: 'customer.subscription.updated',
  created: 1700000000, livemode: false, data: { object: { id: 'sub_fixture', customer: 'cus_fixture',
    metadata: { provider_id: 'victim', plan: 'organization' } } } });
const subscription = () => ({ id: 'sub_fixture', customer: 'cus_fixture', livemode: false,
  status: 'active', cancel_at_period_end: false, current_period_start: 1700000000,
  current_period_end: 1702600000, items: { data: [{ price: { id: 'price_fixture' }, quantity: 1 }] } });
const receiptFor = input => ({ receipt_id: 'receipt-fixture', event_id: input.event_id,
  subscription_id: input.subscription.subscription_id, customer_id: input.subscription.customer_id,
  provider_id: provider, outcome: 'applied', payload_sha256: input.payload_sha256,
  assignment_revision: 1, effective_plan: 'solo', subscription: { ...input.subscription } });
function fixture(options = {}) {
  const calls = { verify: 0, load: 0, apply: [] };
  const current = options.current ?? subscription();
  const handler = createBillingWebhook({ livemode: false,
    verify: async () => { calls.verify++; if (options.invalid) throw new Error('secret provider details'); return options.event ?? event(); },
    loadSubscription: async (_, signal) => { calls.load++; return options.load ? options.load(signal) : current; },
    apply: async (input, signal) => {
      calls.apply.push(input);
      if (options.apply) return options.apply(input, signal);
      return receiptFor(input);
    }, ...options.config,
  });
  return { handler, calls };
}
const request = (body = '{}', signed = true) => new Request('https://fixture.invalid', {
  method: 'POST', headers: signed ? { 'stripe-signature': 'test-verifier-fixture' } : {}, body,
});

test('unsigned and invalid signatures cause no subscription retrieval or projection', async () => {
  const unsigned = fixture();
  assert.equal((await unsigned.handler(request('{}', false))).status, 401);
  assert.deepEqual(unsigned.calls, { verify: 0, load: 0, apply: [] });
  const forged = fixture({ invalid: true });
  const response = await forged.handler(request());
  assert.equal(response.status, 401); assert.equal(forged.calls.load, 0);
  assert.doesNotMatch(await response.text(), /secret provider/);
});
test('connected-account and wrong-mode events cannot modify platform subscriptions', async () => {
  for (const extra of [{ account: 'acct_other' }, { account: '' }, { livemode: true }]) {
    const f = fixture({ event: { ...event(), ...extra } });
    assert.equal((await f.handler(request())).status, 400); assert.equal(f.calls.load, 0);
  }
});
test('dues and unrelated signed events perform no billing work', async () => {
  for (const e of [{ ...event(), type: 'charge.succeeded' },
    { ...event(), type: 'checkout.session.completed', data: { object: { mode: 'payment' } } }]) {
    const f = fixture({ event: e });
    assert.deepEqual(await (await f.handler(request())).json(), { received: true, ignored: true });
    assert.equal(f.calls.load, 0); assert.equal(f.calls.apply.length, 0);
  }
});
test('only current Stripe identity and price reach projection; metadata cannot choose plan or org', async () => {
  const f = fixture(); const result = await f.handler(request('signed event bytes'));
  assert.equal(result.status, 200); assert.equal(f.calls.apply.length, 1);
  const input = f.calls.apply[0];
  assert.equal(input.subscription.price_id, 'price_fixture');
  assert.equal(input.subscription.customer_id, 'cus_fixture');
  assert.equal(input.subscription.status, 'active');
  assert.match(input.payload_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(input).includes('victim'), false);
  assert.equal('plan' in input.subscription, false);
});
test('checkout and invoice events resolve the same platform subscription', async () => {
  for (const type of ['checkout.session.completed', 'invoice.payment_failed']) {
    const f = fixture({ event: { ...event(), type, data: { object: {
      mode: 'subscription', subscription: 'sub_fixture', customer: { id: 'cus_fixture' },
    } } } });
    assert.equal((await f.handler(request())).status, 200);
    assert.equal(f.calls.apply[0].event_type, type);
  }
});
test('first failed invoice retains the observed past_due status for dunning policy', async () => {
  const f = fixture({ event: { ...event(), type: 'invoice.payment_failed', data: { object: {
    subscription: 'sub_fixture', customer: 'cus_fixture',
  } } }, current: { ...subscription(), status: 'past_due' } });
  assert.equal((await f.handler(request())).status, 200);
  assert.equal(f.calls.apply[0].subscription.status, 'past_due');
});
test('identity mismatch or malformed price/period never reaches entitlement projection', async () => {
  for (const patch of [{ id: 'sub_other' }, { customer: 'cus_other' }, { livemode: true },
    { status: 'invented' }, { cancel_at_period_end: 'false' }, { current_period_end: 0 },
    { items: { data: [] } }, { items: { data: [{ price: { id: 'price_fixture' }, quantity: 2 }] } }]) {
    const f = fixture({ current: { ...subscription(), ...patch } });
    assert.equal((await f.handler(request())).status, 503, JSON.stringify(patch));
    assert.equal(f.calls.apply.length, 0);
  }
});
test('silent no-op, error, and wrong receipt never acknowledge an entitlement change', async () => {
  for (const value of [null, {}, { outcome: 'ignored_bad_plan' }, {
    receipt_id: 'receipt', event_id: 'evt_other', subscription_id: 'sub_fixture',
    customer_id: 'cus_fixture', provider_id: provider, outcome: 'applied',
  }]) {
    const f = fixture({ apply: async () => value });
    assert.equal((await f.handler(request())).status, 503);
  }
  const f = fixture({ apply: async () => { throw new Error('private DB detail'); } });
  const response = await f.handler(request());
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private DB detail/);
});
test('verified duplicate receipts acknowledge safely without assuming a second write', async () => {
  const f = fixture({ apply: async input => ({ ...receiptFor(input), receipt_id: 'original-receipt',
    outcome: 'duplicate', subscription: { ...input.subscription, status: 'past_due' } }) });
  const response = await f.handler(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).outcome, 'duplicate');
});
test('applied receipt must prove the exact projected subscription, hash and revision', async () => {
  for (const [key, value] of Object.entries({ price_id: 'price_wrong', status: 'unpaid',
    current_period_start: 1700000001, current_period_end: 1702600001, cancel_at_period_end: true })) {
    const f = fixture({ apply: async input => ({ ...receiptFor(input),
      subscription: { ...input.subscription, [key]: value } }) });
    assert.equal((await f.handler(request())).status, 503, key);
  }
  for (const patch of [{ payload_sha256: 'a'.repeat(64) }, { assignment_revision: 0 },
    { effective_plan: null }, { subscription: null }]) {
    const f = fixture({ apply: async input => ({ ...receiptFor(input), ...patch }) });
    assert.equal((await f.handler(request())).status, 503);
  }
});
test('body byte cap and stalled or late retrieval cannot start a DB write', async () => {
  const oversized = fixture({ config: { maxBodyBytes: 3 } });
  assert.equal((await oversized.handler(request('éé'))).status, 413);
  assert.equal(oversized.calls.verify, 0);
  let release;
  const late = fixture({ load: () => new Promise(resolve => { release = resolve; }), config: { timeoutMs: 15 } });
  assert.equal((await late.handler(request())).status, 503);
  release(subscription()); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(late.calls.apply.length, 0);
});
