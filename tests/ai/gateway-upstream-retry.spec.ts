// tests/ai/gateway-upstream-retry.spec.ts — incident 2026-10-22 (assistant 429).
//
// 1. The bounded upstream retry helper (supabase/functions/_shared/upstream-retry.mjs)
//    behaves: transient statuses retry with full-jitter backoff, retry-after wins,
//    attempts and total time are capped, non-transient answers return at once.
// 2. The copy INLINED in supabase/functions/ai-gateway/index.ts (between the
//    "upstream-retry mirror" markers) is run through the SAME cases, under
//    node's type stripping, so the shipped single-file function cannot drift
//    from the tested module.
// 3. The status contract the client relies on: plan allowance -> 402 with the
//    CONTEXT I3 payload, provider busy -> 503 + Retry-After, and coach-command
//    passes those through instead of relabelling them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const gw = read('supabase/functions/ai-gateway/index.ts');
const cmd = read('supabase/functions/coach-command/index.ts');

type Mod = {
  isTransientStatus: (s: unknown) => boolean;
  parseRetryAfter: (v: unknown, now?: number) => number | null;
  backoffDelay: (a: number, o?: { baseMs?: number; capMs?: number; random?: () => number }) => number;
  withUpstreamRetry: (fn: (i: number) => Promise<any>, o?: Record<string, unknown>) =>
    Promise<{ outcome: any; attempts: number; error: unknown; retryAfterMs: number | null }>;
};

const shared = await import(pathToFileURL(new URL('supabase/functions/_shared/upstream-retry.mjs', root).pathname).href) as Mod;

const begin = gw.indexOf('// ── upstream-retry mirror BEGIN');
const end = gw.indexOf('// ── upstream-retry mirror END');
assert.ok(begin > 0 && end > begin, 'ai-gateway carries the inlined retry mirror');
const tmp = join(tmpdir(), `gw-upstream-retry-${process.pid}-${Date.now()}.mts`);
writeFileSync(tmp, gw.slice(begin, end) +
  '\nexport { isTransientStatus, parseRetryAfter, backoffDelay, withUpstreamRetry };\n');
const inlined = await import(pathToFileURL(tmp).href) as Mod;

/* A fake clock: sleep advances time instead of waiting, so the budget logic
   is tested exactly and the suite stays instant. */
function clock() {
  let t = 1_000_000; const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps, advance: (ms: number) => { t += ms; } };
}

for (const [name, m] of [['shared module', shared], ['ai-gateway inlined copy', inlined]] as const) {
  test(`${name}: transient statuses are exactly the busy/overloaded ones`, () => {
    for (const s of [408, 429, 500, 502, 503, 504, 529]) assert.equal(m.isTransientStatus(s), true, String(s));
    for (const s of [200, 400, 401, 402, 403, 404, 413, 422]) assert.equal(m.isTransientStatus(s), false, String(s));
  });

  test(`${name}: retry-after parses seconds and HTTP dates`, () => {
    assert.equal(m.parseRetryAfter('3'), 3000);
    assert.equal(m.parseRetryAfter('0.5'), 500);
    assert.equal(m.parseRetryAfter(null), null);
    assert.equal(m.parseRetryAfter('soon'), null);
    const now = Date.parse('2026-10-22T12:00:00Z');
    assert.equal(m.parseRetryAfter('Thu, 22 Oct 2026 12:00:04 GMT', now), 4000);
  });

  test(`${name}: full-jitter backoff stays inside [0, min(cap, base*2^n))`, () => {
    assert.equal(m.backoffDelay(0, { random: () => 0 }), 0);
    assert.equal(m.backoffDelay(0, { random: () => 0.999 }), 499);
    assert.equal(m.backoffDelay(1, { random: () => 0.999 }), 999);
    assert.equal(m.backoffDelay(10, { random: () => 0.999 }), 3996, 'capped at 4s');
  });

  test(`${name}: 429 then 200 retries once and returns the answer`, async () => {
    const c = clock(); let calls = 0;
    const r = await m.withUpstreamRetry(async () => (++calls === 1 ? { status: 429, retryAfter: null } : { status: 200, ok: true }),
      { now: c.now, sleep: c.sleep, random: () => 0.5 });
    assert.equal(calls, 2); assert.equal(r.attempts, 2); assert.equal(r.outcome.status, 200);
    assert.deepEqual(c.sleeps, [250], 'jittered backoff before the retry');
  });

  test(`${name}: 529 overloaded honours retry-after over the computed delay`, async () => {
    const c = clock(); let calls = 0;
    await m.withUpstreamRetry(async () => (++calls === 1 ? { status: 529, retryAfter: '2' } : { status: 200 }),
      { now: c.now, sleep: c.sleep, random: () => 0 });
    assert.deepEqual(c.sleeps, [2000]);
  });

  test(`${name}: Retry-After: 0 (or a past date) falls back to the jittered backoff`, async () => {
    const c = clock(); let calls = 0;
    await m.withUpstreamRetry(async () => (++calls === 1 ? { status: 429, retryAfter: '0' } : { status: 200 }),
      { now: c.now, sleep: c.sleep, random: () => 0.5 });
    assert.deepEqual(c.sleeps, [250], 'zero is not an instruction to hammer the upstream');
    const c2 = clock(); let n2 = 0;
    await m.withUpstreamRetry(async () => (++n2 === 1 ? { status: 503, retryAfter: 'Thu, 01 Jan 1970 00:00:00 GMT' } : { status: 200 }),
      { now: c2.now, sleep: c2.sleep, random: () => 0.5 });
    assert.deepEqual(c2.sleeps, [250]);
  });

  test(`${name}: retries get min(attempt timeout, remaining budget); the first attempt keeps the full timeout`, async () => {
    const c = clock(); const seen: Array<{ remainingMs: number; timeoutMs: number }> = [];
    await m.withUpstreamRetry(async (_i: number, ctx: { remainingMs: number; timeoutMs: number }) => {
      seen.push(ctx); c.advance(4_000); return { status: 529, retryAfter: '1' };
    }, { now: c.now, sleep: c.sleep, budgetMs: 12_000, attemptTimeoutMs: 30_000 });
    assert.equal(seen[0].timeoutMs, 30_000, 'first attempt: full AI timeout');
    assert.equal(seen[1].remainingMs, 7_000); assert.equal(seen[1].timeoutMs, 7_000, 'retry: capped to what is left');
    assert.ok(seen.every((s) => s.timeoutMs > 0));
    const c2 = clock(); const t2: number[] = [];
    await m.withUpstreamRetry(async (_i: number, ctx: { timeoutMs: number }) => { t2.push(ctx.timeoutMs); return { status: 503, retryAfter: '1' }; },
      { now: c2.now, sleep: c2.sleep, budgetMs: 60_000, attemptTimeoutMs: 5_000 });
    assert.deepEqual(t2, [5_000, 5_000, 5_000], 'never longer than the per-attempt timeout');
  });

  test(`${name}: a TimeoutError comes back unwrapped`, async () => {
    const c = clock(); const boom = new DOMException('The operation timed out.', 'TimeoutError');
    const r = await m.withUpstreamRetry(async () => { c.advance(12_000); throw boom; }, { now: c.now, sleep: c.sleep });
    assert.equal(r.outcome, null); assert.equal(r.error, boom); assert.equal((r.error as DOMException).name, 'TimeoutError');
  });

  test(`${name}: never more than 3 attempts, and reports the busy verdict`, async () => {
    const c = clock(); let calls = 0;
    const r = await m.withUpstreamRetry(async () => { calls++; return { status: 503, retryAfter: '1' }; },
      { now: c.now, sleep: c.sleep });
    assert.equal(calls, 3); assert.equal(r.attempts, 3); assert.equal(r.outcome.status, 503);
    assert.equal(r.retryAfterMs, 1000, 'the last retry-after is handed back for the 503 response');
  });

  test(`${name}: a network error is retried; a 400 is not`, async () => {
    const c = clock(); let calls = 0;
    const r = await m.withUpstreamRetry(async () => { if (++calls === 1) throw new TypeError('reset'); return { status: 200 }; },
      { now: c.now, sleep: c.sleep, random: () => 0 });
    assert.equal(r.outcome.status, 200); assert.equal(calls, 2);
    let bad = 0;
    const r2 = await m.withUpstreamRetry(async () => { bad++; return { status: 400 }; }, { now: c.now, sleep: c.sleep });
    assert.equal(bad, 1); assert.equal(r2.outcome.status, 400);
  });

  test(`${name}: the total time budget stops a retry that would overrun 12s`, async () => {
    const c = clock(); let calls = 0;
    const r = await m.withUpstreamRetry(async () => { calls++; c.advance(11_600); return { status: 529, retryAfter: null }; },
      { now: c.now, sleep: c.sleep, random: () => 0.999 });
    assert.equal(calls, 1, 'an 11.6s attempt leaves no room for another');
    assert.deepEqual(c.sleeps, []); assert.ok((r.retryAfterMs ?? 0) > 0);
    const c2 = clock(); let n2 = 0;
    await m.withUpstreamRetry(async () => { n2++; return { status: 429, retryAfter: '30' }; }, { now: c2.now, sleep: c2.sleep });
    assert.equal(n2, 1, 'a 30s retry-after is longer than the person will wait');
  });
}

test('gateway: plan allowance is a 402 with the I3 payload, never a 429', () => {
  const i = gw.indexOf('budget.reason === "quota_exhausted"');
  const block = gw.slice(i, gw.indexOf('return json({ error: "AI quota service is unavailable." }, 503);', i));
  for (const k of ['reason:', 'current_plan:', 'upgrade_to:', 'limit:', 'current:']) assert.ok(block.includes(k), k);
  assert.match(block, /\}, 402\);[\s\S]*\}, 402\);/, 'both quota and spend cap answer 402');
  assert.ok(!/\}, 429\)/.test(block), 'no 429 left in the monthly budget branch');
});

test('gateway: an upstream that stays busy is a 503 with retry_after, other failures stay 502', () => {
  assert.match(gw, /if \(result\.upstream_busy\) \{[\s\S]*?reason: "upstream_busy"[\s\S]*?\}, 503, result\.retry_after \?\? 2\);/);
  assert.match(gw, /return json\(result, 502\);/);
  assert.match(gw, /"Retry-After": String\(retryAfterSec\)/);
  assert.match(gw, /await withUpstreamRetry\(async \(_attempt, \{ timeoutMs \}\) => \{/);
  assert.match(gw, /signal: AbortSignal\.timeout\(timeoutMs\)/, 'each attempt uses the timeout the retry loop hands it');
  assert.match(gw, /attemptTimeoutMs: AI_TIMEOUT_MS \}\);/);
});

test('coach-command passes 402 / 429 / 503 through instead of relabelling them', () => {
  assert.ok(!/AI request limit reached\. Please try again shortly\./.test(cmd), 'the misleading relabel is gone');
  assert.match(cmd, /if \(gResp\.status === 402\) \{/);
  assert.match(cmd, /if \(gResp\.status === 503\) \{/);
  assert.match(cmd, /if \(retried\.gResp\.ok\) \(\{ gResp, g \} = retried\);/, 'a failed improvement retry keeps the first answer');
});
