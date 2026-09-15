// ops-health contract: token or nothing, read-only, counts only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes((await readFile(new URL('./index.ts', import.meta.url), 'utf8')).replace(/^import\s+[\s\S]*?;\n/gm, ''));
const TOKEN = 'ops_' + 'x'.repeat(40);

async function run(req, { token = TOKEN, rows = [], rpcError = null } = {}) {
  let handler; const calls = [];
  vm.runInNewContext(source, { Response, Request, URL, Date, String, Number, console,
    createClient: () => ({ rpc: async (name) => { calls.push(name); return rpcError ? { data: null, error: rpcError } : { data: rows, error: null }; } }),
    Deno: { serve(fn) { handler = fn; }, env: { get: (k) => (k === 'OPS_HEALTH_TOKEN' ? token : 'fixture') } } });
  const res = await handler(req); return { status: res.status, body: JSON.parse(await res.text()), calls, h: res.headers };
}
const GET = (auth) => new Request('https://x.invalid/functions/v1/ops-health', { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });

test('no token, wrong token, wrong length: 403 with no database call', async () => {
  for (const bad of [undefined, '', 'ops_' + 'y'.repeat(40), TOKEN.slice(0, -1), TOKEN + 'x']) {
    const r = await run(GET(bad)); assert.equal(r.status, 403); assert.deepEqual(r.calls, []);
  }
});
test('unconfigured function refuses everyone with 503, never 200', async () => {
  const r = await run(GET(TOKEN), { token: '' }); assert.equal(r.status, 503); assert.deepEqual(r.calls, []);
});
test('only GET', async () => {
  const r = await run(new Request('https://x.invalid/functions/v1/ops-health', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } }));
  assert.equal(r.status, 405); assert.deepEqual(r.calls, []);
});
test('quiet system: ok=true, one rpc, no-store', async () => {
  const r = await run(GET(TOKEN)); assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.critical, 0);
  assert.deepEqual(r.calls, ['ops_alerts']); assert.equal(r.h.get('Cache-Control'), 'no-store');
});
test('a critical alert flips ok=false and is counted; high is counted separately', async () => {
  const rows = [
    { severity: 'critical', check_name: 'webhook_dead_letter_unresolved', failing_count: 2, detail: 'Stripe events that failed to apply.' },
    { severity: 'high', check_name: 'delivery_failed_24h', failing_count: 1, detail: 'Approved messages that failed.' }];
  const r = await run(GET(TOKEN), { rows }); assert.equal(r.body.ok, false); assert.equal(r.body.critical, 1); assert.equal(r.body.high, 1);
  assert.equal(r.body.checks[0].failing_count, 2);
});
test('the monitor failing is itself a critical, not a silent 200', async () => {
  const r = await run(GET(TOKEN), { rpcError: { message: 'boom' } }); assert.equal(r.status, 503); assert.equal(r.body.ok, false); assert.equal(r.body.critical, 1);
  assert.ok(!JSON.stringify(r.body).includes('boom'), 'database error text is not echoed');
});
