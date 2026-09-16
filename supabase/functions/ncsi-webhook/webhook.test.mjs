// ncsi-webhook contract: fails closed, one RPC, consider is never clearance.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes((await readFile(new URL('./index.ts', import.meta.url), 'utf8')).replace(/^import\s+[\s\S]*?;\n/gm, ''));
const SECRET = 's'.repeat(48);

async function run(req, { secret = SECRET, rpcError = null } = {}) {
  let handler; const calls = [];
  vm.runInNewContext(source, { Response, Request, URL, Date, Number, String, Set, console,
    createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return rpcError ? { data: null, error: rpcError } : { data: 'chk-1', error: null }; } }),
    Deno: { serve(fn) { handler = fn; }, env: { get: (k) => (k === 'NCSI_WEBHOOK_SECRET' ? secret : 'fixture') } } });
  const res = await handler(req); return { status: res.status, body: JSON.parse(await res.text()), calls };
}
const POST = (body, secret) => new Request('https://x.invalid/functions/v1/ncsi-webhook', { method: 'POST',
  headers: { 'content-type': 'application/json', ...(secret !== undefined ? { 'x-ncsi-webhook-secret': secret } : {}) }, body: JSON.stringify(body) });

test('UNCONFIGURED FAILS CLOSED: no vendor secret → 503, nothing written, even with a perfect payload', async () => {
  const r = await run(POST({ reference: 'NCSI-1', status: 'clear', completed_at: '2026-09-16T00:00:00Z' }, ''), { secret: '' });
  assert.equal(r.status, 503); assert.deepEqual(r.calls, []);
});
test('missing, wrong or truncated secret → 401, nothing written', async () => {
  for (const s of [undefined, '', 'x'.repeat(48), SECRET.slice(0, -1)]) {
    const r = await run(POST({ reference: 'NCSI-1', status: 'clear' }, s)); assert.equal(r.status, 401); assert.deepEqual(r.calls, []);
  }
});
test('a clear result is recorded through exactly one RPC, with the vendor pinned', async () => {
  const r = await run(POST({ reference: 'NCSI-1', status: 'clear', completed_at: '2026-09-16T00:00:00Z', expires_at: '2028-09-16T00:00:00Z' }, SECRET));
  assert.equal(r.status, 200); assert.equal(r.calls.length, 1); assert.equal(r.calls[0].name, 'record_background_check_result');
  assert.equal(r.calls[0].args.p_vendor, 'ncsi'); assert.equal(r.calls[0].args.p_status, 'clear');
});
test('consider is passed through as consider and flagged for a human — never rewritten to clear', async () => {
  const r = await run(POST({ reference: 'NCSI-2', status: 'CONSIDER' }, SECRET));
  assert.equal(r.calls[0].args.p_status, 'consider'); assert.equal(r.body.adjudication, 'human review required');
});
test('unknown status or missing reference → 400 before any RPC', async () => {
  for (const b of [{ reference: 'NCSI-1', status: 'verified' }, { status: 'clear' }, { reference: '', status: 'clear' }]) {
    const r = await run(POST(b, SECRET)); assert.equal(r.status, 400); assert.deepEqual(r.calls, []);
  }
});
test('unknown reference (P0002) → 404; a database failure → 503; neither echoes the error text', async () => {
  const a = await run(POST({ reference: 'NCSI-9', status: 'clear' }, SECRET), { rpcError: { code: 'P0002', message: 'no ordered check carries that vendor reference' } });
  assert.equal(a.status, 404); assert.ok(!JSON.stringify(a.body).includes('ordered check'));
  const b = await run(POST({ reference: 'NCSI-9', status: 'clear' }, SECRET), { rpcError: { code: '08006', message: 'connection refused' } });
  assert.equal(b.status, 503); assert.ok(!JSON.stringify(b.body).includes('connection'));
});
test('report contents are never forwarded: only reference, status and two dates reach the database', async () => {
  const r = await run(POST({ reference: 'NCSI-1', status: 'clear', report: { records: ['secret'] }, ssn_last4: '1234' }, SECRET));
  assert.deepEqual(Object.keys(r.calls[0].args).sort(), ['p_completed_at', 'p_expires_at', 'p_status', 'p_vendor', 'p_vendor_reference']);
});
