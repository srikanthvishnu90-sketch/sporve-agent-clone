// guardian-link control flow. The DB is an isolated double; this proves the
// function's contract — never consume on GET, nothing to learn from a bad
// token, one RPC per action, CORS only for the parent origin — not the RPCs
// themselves (the SQL fixture does).
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
  vm.runInNewContext(source, { Response, Request, URL, Intl, Date, String, JSON, console, crypto, TextEncoder, Uint8Array,
    createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args });
      if (name === 'consume_edge_rate_limit') return { data: !limited, error: null };
      if (name === 'redeem_guardian_token') return { data: redeem, error: null };
      if (name === 'guardian_token_rsvp') return rsvpError ? { data: null, error: rsvpError } : { data: rsvp, error: null };
      throw new Error('unexpected rpc ' + name); } }),
    Deno: { serve(fn) { handler = fn; }, env: { get: () => undefined } } });
  const res = await handler(req); const text = await res.text();
  return { status: res.status, body: text, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), calls: calls.map(c => c.name), h: res.headers };
}
const GET = t => new Request(`https://x.invalid/functions/v1/guardian-link?t=${t}`, { headers: { Accept: 'application/json' } });
const POST = body => new Request('https://x.invalid/functions/v1/guardian-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('malformed token is 404 before any lookup', async () => {
  for (const t of ['', 'abc', 'B'.repeat(64), 'b'.repeat(63)]) { const r = await run(GET(t)); assert.equal(r.status, 404); assert.ok(!r.calls.includes('redeem_guardian_token')); }
});
test('unknown / expired / revoked / consumed (zero rows) is the same 404', async () => {
  const r = await run(GET(good), { redeem: [] }); assert.equal(r.status, 404); assert.deepEqual(r.json, { error: 'not_found' });
});
test('GET returns the grant summary and NEVER consumes or writes; no ids, no contact details', async () => {
  const r = await run(GET(good)); assert.equal(r.status, 200);
  assert.deepEqual(r.json, { scope: 'rsvp', subject_label: '14U Flight — Tue practice', subject_at: '2026-11-03T00:00:00Z', subject_tz: 'America/Chicago', guardian_first_name: 'Maria', single_use: false });
  assert.deepEqual(r.calls, ['consume_edge_rate_limit', 'redeem_guardian_token']);
  assert.equal(r.h.get('Cache-Control'), 'no-store'); assert.equal(r.h.get('Referrer-Policy'), 'no-referrer'); assert.match(r.h.get('X-Robots-Tag'), /noindex/);
  assert.equal(r.h.get('Content-Type'), 'application/json; charset=utf-8');
});
test('CORS: only the parent origin, and OPTIONS is a 204 that touches nothing', async () => {
  const r = await run(new Request('https://x.invalid/functions/v1/guardian-link', { method: 'OPTIONS' }));
  assert.equal(r.status, 204); assert.deepEqual(r.calls, []);
  assert.equal(r.h.get('Access-Control-Allow-Origin'), 'https://sporv.ai');
  const g = await run(GET(good)); assert.equal(g.h.get('Access-Control-Allow-Origin'), 'https://sporv.ai');
});
test('POST records through guardian_token_rsvp exactly once and confirms', async () => {
  const r = await run(POST({ t: good, response: 'yes' })); assert.equal(r.status, 200);
  assert.deepEqual(r.json, { saved: true, response: 'yes', members: ['m1'] });
  assert.deepEqual(r.calls, ['consume_edge_rate_limit', 'consume_edge_rate_limit', 'guardian_token_rsvp'], 'ip ceiling, token ceiling, then the one write');
});
test('POST with an invalid response vocabulary, a bad token, or a non-JSON body touches nothing', async () => {
  let r = await run(POST({ t: good, response: 'attending' })); assert.equal(r.status, 400); assert.ok(!r.calls.includes('guardian_token_rsvp'));
  r = await run(POST({ t: 'abc', response: 'yes' })); assert.equal(r.status, 404); assert.ok(!r.calls.includes('guardian_token_rsvp'));
  r = await run(new Request('https://x.invalid/functions/v1/guardian-link', { method: 'POST', body: 't=x' })); assert.equal(r.status, 400);
});
test('a rejected token (42501) is indistinguishable from unknown: 404', async () => {
  const r = await run(POST({ t: good, response: 'yes' }), { rsvpError: { message: 'link is not valid (42501)' } }); assert.equal(r.status, 404); assert.deepEqual(r.json, { error: 'not_found' });
});
test('a database failure is 503 with saved:false', async () => {
  const r = await run(POST({ t: good, response: 'yes' }), { rsvpError: { message: 'connection reset' } }); assert.equal(r.status, 503); assert.equal(r.json.saved, false);
});
test('rate-limited client gets 429 before any token work', async () => {
  const r = await run(GET(good), { limited: true }); assert.equal(r.status, 429); assert.deepEqual(r.calls, ['consume_edge_rate_limit']);
});
test('other methods are 405', async () => {
  const r = await run(new Request('https://x.invalid/functions/v1/guardian-link', { method: 'PUT' })); assert.equal(r.status, 405); assert.deepEqual(r.calls, []);
});

// pentest 2026-09-16 follow-ups
test('the limiter fails CLOSED and keys on the gateway IP, not the client-written x-forwarded-for entry', async () => {
  let handler; const keys = [];
  vm.runInNewContext(source, { Response, Request, URL, Intl, Date, String, JSON, console, crypto, TextEncoder, Uint8Array,
    createClient: () => ({ rpc: async (name, args) => { if (name === 'consume_edge_rate_limit') { keys.push(args.p_actor_key); return { data: null, error: { message: 'down' } }; } return { data: [grant], error: null }; } }),
    Deno: { serve(fn) { handler = fn; }, env: { get: () => undefined } } });
  const res = await handler(new Request(`https://x.invalid/functions/v1/guardian-link?t=${good}`, { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'cf-connecting-ip': '198.51.100.7' } }));
  assert.equal(res.status, 429, 'limiter error → 429, never through');
  assert.deepEqual(keys, ['ip:198.51.100.7']);
  const res2 = await handler(new Request(`https://x.invalid/functions/v1/guardian-link?t=${good}`, { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } }));
  assert.equal(res2.status, 429); assert.equal(keys[1], 'ip:203.0.113.9', 'the LAST entry, which the proxy appended');
});
test('a POST from a foreign Origin is refused before any token work', async () => {
  const req = new Request('https://x.invalid/functions/v1/guardian-link', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, body: JSON.stringify({ t: good, response: 'yes' }) });
  const r = await run(req); assert.equal(r.status, 403); assert.deepEqual(r.calls, []);
  const ok = await run(new Request('https://x.invalid/functions/v1/guardian-link', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://sporv.ai' }, body: JSON.stringify({ t: good, response: 'yes' }) }));
  assert.equal(ok.status, 200);
});
test('a single link is metered per token as well as per IP, keyed by a hash', async () => {
  let handler; const keys = [];
  vm.runInNewContext(source, { Response, Request, URL, Intl, Date, String, JSON, console, crypto, TextEncoder, Uint8Array,
    createClient: () => ({ rpc: async (name, args) => { if (name === 'consume_edge_rate_limit') { keys.push(args.p_actor_key); return { data: !args.p_actor_key.startsWith('tok:'), error: null }; } return { data: { response: 'yes', members: ['m1'] }, error: null }; } }),
    Deno: { serve(fn) { handler = fn; }, env: { get: () => undefined } } });
  const res = await handler(new Request('https://x.invalid/functions/v1/guardian-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: good, response: 'yes' }) }));
  assert.equal(res.status, 429);
  assert.match(keys[1], /^tok:[0-9a-f]{32}$/); assert.ok(!keys[1].includes(good.slice(0, 8)), 'the key is a hash, not the secret');
});
