// Platform subscription intake. Deliberately independent of the dues webhook.
// Dependencies are injected so every failure boundary is executable in tests.
const TYPES = new Set([
  'checkout.session.completed', 'customer.subscription.created',
  'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.payment_failed',
]);
const STATUSES = new Set([
  'active', 'trialing', 'past_due', 'unpaid', 'canceled',
  'incomplete', 'incomplete_expired', 'paused',
]);
const identifier = (value, prefix) => typeof value === 'string'
  && value.length <= 255 && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const reference = value => typeof value === 'string' ? value : value?.id;
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
class IntakeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function boundedBody(req, signal, maxBytes) {
  if (!req.body) throw new IntakeError(400, 'Missing webhook body.');
  const reader = req.body.getReader();
  const chunks = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new IntakeError(413, 'Webhook body too large.');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock();
  }
}
function normalizeSubscription(subscription, expectedId, expectedCustomer) {
  const customer = reference(subscription?.customer);
  const items = subscription?.items?.data;
  if (!identifier(subscription?.id, 'sub') || subscription.id !== expectedId
      || !identifier(customer, 'cus') || customer !== expectedCustomer
      || !STATUSES.has(subscription.status) || typeof subscription.cancel_at_period_end !== 'boolean'
      || !Array.isArray(items) || items.length !== 1 || subscription.items.has_more === true
      || !identifier(reference(items[0]?.price), 'price') || items[0]?.quantity !== 1) {
    throw new IntakeError(503, 'Subscription could not be verified.');
  }
  for (const key of ['current_period_start', 'current_period_end']) {
    if (!Number.isSafeInteger(subscription[key]) || subscription[key] <= 0) {
      throw new IntakeError(503, 'Subscription period could not be verified.');
    }
  }
  if (subscription.current_period_end <= subscription.current_period_start) {
    throw new IntakeError(503, 'Subscription period could not be verified.');
  }
  return {
    subscription_id: subscription.id, customer_id: customer,
    price_id: reference(items[0].price), status: subscription.status,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
}

export function createBillingWebhook({ verify, loadSubscription, apply, livemode,
  timeoutMs = 15000, maxBodyBytes = 1000000 }) {
  return async req => {
    if (req.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);
    const signature = req.headers.get('stripe-signature');
    // Reject unsigned input before body reads, Stripe retrieval or DB access.
    if (!signature) return response({ error: 'Webhook signature required.' }, 401);
    if (typeof livemode !== 'boolean') return response({ error: 'Billing is not configured.' }, 503);
    const controller = new AbortController();
    const { signal } = controller;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(); reject(new IntakeError(503, 'Billing intake timed out.'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([(async () => {
        const raw = await boundedBody(req, signal, maxBodyBytes);
        let event;
        try { event = await verify(raw, signature); }
        catch { throw new IntakeError(401, 'Invalid webhook signature.'); }
        signal.throwIfAborted();
        if (!identifier(event?.id, 'evt') || !Number.isSafeInteger(event.created)
            || event.created <= 0 || typeof event.type !== 'string') {
          throw new IntakeError(400, 'Malformed billing event.');
        }
        if (event.account != null || event.livemode !== livemode) {
          throw new IntakeError(400, 'Incorrect billing account or mode.');
        }
        if (!TYPES.has(event.type)) return response({ received: true, ignored: true });
        const object = event.data?.object;
        if (event.type === 'checkout.session.completed' && object?.mode !== 'subscription') {
          return response({ received: true, ignored: true });
        }
        const subscriptionId = event.type.startsWith('customer.subscription.')
          ? object?.id : reference(object?.subscription);
        const customerId = reference(object?.customer);
        if (!identifier(subscriptionId, 'sub') || !identifier(customerId, 'cus')) {
          throw new IntakeError(400, 'Missing subscription identity.');
        }
        // Read the current PLATFORM subscription, not a stale event projection.
        // Metadata cannot choose an org or plan; SQL resolves the verified price
        // through billing_prices and the customer through billing_customers.
        const current = await loadSubscription(subscriptionId, signal);
        signal.throwIfAborted();
        if (current?.livemode !== livemode) throw new IntakeError(503, 'Subscription mode mismatch.');
        const subscription = normalizeSubscription(current, subscriptionId, customerId);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        signal.throwIfAborted();
        const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
        const receipt = await apply({ event_id: event.id, event_type: event.type,
          occurred_at: event.created, livemode, payload_sha256: hash, subscription }, signal);
        signal.throwIfAborted();
        if (!receipt || receipt.event_id !== event.id
            || receipt.subscription_id !== subscriptionId || receipt.customer_id !== customerId
            || receipt.payload_sha256 !== hash
            || !['applied', 'duplicate', 'superseded'].includes(receipt.outcome)
            || typeof receipt.receipt_id !== 'string' || !receipt.receipt_id
            || !Number.isSafeInteger(receipt.assignment_revision) || receipt.assignment_revision < 1
            || typeof receipt.effective_plan !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(receipt.effective_plan)
            || typeof receipt.provider_id !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.provider_id)) {
          throw new IntakeError(503, 'Billing change could not be confirmed.');
        }
        // A no-op returning the right event id still is not proof of the write.
        // Duplicates echo their stored payload hash above; their original
        // snapshot can differ from the current subscription fetched on retry.
        if (receipt.outcome === 'applied' && Object.entries(subscription).some(
          ([key, value]) => receipt.subscription?.[key] !== value,
        )) throw new IntakeError(503, 'Billing change could not be confirmed.');
        return response({ received: true, receipt_id: receipt.receipt_id, outcome: receipt.outcome });
      })(), timeout]);
    } catch (error) {
      return response({ error: error instanceof IntakeError ? error.message : 'Billing intake unavailable.' },
        error instanceof IntakeError ? error.status : 503);
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
