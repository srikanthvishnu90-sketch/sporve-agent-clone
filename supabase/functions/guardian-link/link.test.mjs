// guardian-link control flow. The DB is an isolated double; this proves the
// function's contract — never consume on GET, nothing to learn from a bad
// token, one RPC per action — not the RPCs themselves (the SQL fixture does).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes((await readFile(new URL('./index.ts', import.meta.url), 'utf8')).replace(/^import\s+[\s\S]*?;\n/gm, ''));
const good = 'b'.repeat(64);
const grant = { token_id: 't1', guardian_id: 'g1', provider_id: 'p1', scope: 'rsvp', subject_kind: 'event', subject_id: 'e1', channel: 'email',
  single_use: false, subject_label: '14U Flight — Tue practice', subject_at: '2026-11-03T00:00:00Z', subject_tz: 'America/Chicago', guardian_first_name: 'Maria' };

async function run(req, { redeem = [grant], rsvp = { event_id: 'e1', response: 'yes', members: ['m1'] }, rsvpError = null, limited = false } = {}) {
  let handler; const calls = [];
  vm.runInNewContext(source, { Response, Request, URL, FormData, Intl, Date, String, console,
    createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args });
      if (name === 'consume_edge_rate_limit') return { data: !limited, error: null };
      if (name === 'redeem_guardian_token') return { data: redeem, error: null };
      if (name === 'guardian_token_rsvp') return rsvpError ? { data: null, error: rsvpError } : { data: rsvp, error: null };
      throw new Error('unexpected rpc ' + name); } }),
    Deno: { serve(fn) { handler = fn; }, env: { get: () => 'fixture' } } });
  const res = await handler(req); return { status: res.status, body: await res.text(), calls: calls.map(c => c.name), h: res.headers };
}
const GET = t => new Request(`https://x.invalid/functions/v1/guardian-link?t=${t}`);
const POST = (t, response, extra = {}) => { const fd = new FormData(); fd.set('t', t); fd.set('response', response); for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return new Request('https://x.invalid/functions/v1/guardian-link', { method: 'POST', body: fd }); };

test('malformed token is 404 before any lookup', async () => {
  for (const t of ['', 'abc', 'B'.repeat(64), 'b'.repeat(63)]) { const r = await run(GET(t)); assert.equal(r.status, 404); assert.ok(!r.calls.includes('redeem_guardian_token')); }
});
test('unknown / expired / revoked / consumed (zero rows) is the same 404', async () => {
  const r = await run(GET(good), { redeem: [] }); assert.equal(r.status, 404); assert.match(r.body, /no longer valid/);
});
test('GET renders the RSVP form and NEVER consumes or writes', async () => {
  const r = await run(GET(good)); assert.equal(r.status, 200);
  assert.match(r.body, /14U Flight — Tue practice/); assert.match(r.body, /name="response" value="yes"/); assert.match(r.body, /Hi Maria/);
  assert.deepEqual(r.calls, ['consume_edge_rate_limit', 'redeem_guardian_token']);
  assert.equal(r.h.get('Cache-Control'), 'no-store'); assert.equal(r.h.get('Referrer-Policy'), 'no-referrer'); assert.match(r.h.get('X-Robots-Tag'), /noindex/);
});
test('POST records through guardian_token_rsvp exactly once and confirms', async () => {
  const r = await run(POST(good, 'yes')); assert.equal(r.status, 200); assert.match(r.body, /See you there/);
  assert.deepEqual(r.calls, ['consume_edge_rate_limit', 'guardian_token_rsvp']);
});
test('POST with an invalid response vocabulary is 400 and touches nothing', async () => {
  const r = await run(POST(good, 'attending')); assert.equal(r.status, 400); assert.ok(!r.calls.includes('guardian_token_rsvp'));
});
test('a rejected token (42501) is indistinguishable from unknown: 404', async () => {
  const r = await run(POST(good, 'yes'), { rsvpError: { message: 'link is not valid (42501)' } }); assert.equal(r.status, 404);
});
test('a database failure is 503 with the answer explicitly NOT saved', async () => {
  const r = await run(POST(good, 'yes'), { rsvpError: { message: 'connection reset' } }); assert.equal(r.status, 503); assert.match(r.body, /not saved/);
});
test('rate-limited client gets 429 before any token work', async () => {
  const r = await run(GET(good), { limited: true }); assert.equal(r.status, 429); assert.deepEqual(r.calls, ['consume_edge_rate_limit']);
});
test('a non-rsvp scope renders a holding page, not a form', async () => {
  const r = await run(GET(good), { redeem: [{ ...grant, scope: 'pay' }] }); assert.equal(r.status, 200); assert.ok(!/name="response"/.test(r.body));
});

test('the page meets the WCAG 2.1 AA basics a parent phone needs (item 11)', async () => {
  const r = await run(GET(good));
  assert.match(r.body, /<html lang="en">/, 'language declared (3.1.1)');
  assert.match(r.body, /<meta name="viewport" content="width=device-width,initial-scale=1">/, 'pinch-zoom not disabled (1.4.4)');
  assert.match(r.body, /<main id="main">/, 'one main landmark (1.3.1)');
  assert.match(r.body, /<h1 id="q">/, 'a heading names the question (2.4.6)');
  assert.match(r.body, /<form [^>]*aria-labelledby="q"/, 'the form is labelled by the question (1.3.1 / 4.1.2)');
  assert.match(r.body, /button:focus-visible\{outline:3px solid/, 'keyboard focus is visible (2.4.7)');
  assert.ok(!/user-scalable=no|maximum-scale=1/.test(r.body), 'zoom is never blocked');
  assert.ok(!/<[^>]+\bonclick=/.test(r.body), 'every control is a real button — no click handlers on non-controls');
  // 1.4.3 contrast: body copy #B4BBC5 on #0B0D0F ≈ 9.9:1, small #9BA3AD ≈ 7.2:1, primary button #fff on #4F6A85 ≈ 5.6:1 (#6B7F9E measured 4.07:1 and was replaced)
  for (const [fg, bg, min] of [['B4BBC5', '0B0D0F', 4.5], ['9BA3AD', '0B0D0F', 4.5], ['FFFFFF', '4F6A85', 4.5], ['EDEFF2', '131519', 4.5]]) {
    const L = (hex) => { const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (L(fg) + 0.05) / (L(bg) + 0.05);
    assert.ok(ratio >= min, `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}`);
  }
});
