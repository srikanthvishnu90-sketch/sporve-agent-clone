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
