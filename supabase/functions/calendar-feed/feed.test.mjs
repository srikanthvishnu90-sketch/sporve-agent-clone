// calendar-feed control-flow: token shape, 404 semantics, and that no athlete
// name can reach the wire. The DB is an isolated double.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes((await readFile(new URL('./index.ts', import.meta.url), 'utf8'))
  .replace(/^import\s+[\s\S]*?;\n/gm, ''));
const good = 'a'.repeat(64);

async function invoke(token, rows = [], error = null) {
  let handler; const calls = [];
  vm.runInNewContext(source, { Response, URL, TextEncoder, Date, Number, String, console,
    createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: rows, error }; } }),
    Deno: { serve(fn) { handler = fn; }, env: { get: () => 'fixture' } } });
  const res = await handler(new Request(`https://fixture.invalid/calendar-feed?t=${token}`));
  return { status: res.status, body: await res.text(), calls };
}
const row = { uid: '11111111-1111-4111-8111-111111111111', sequence: 2, status: 'CONFIRMED', summary: '14U Flight — Tue/Thu practice',
  starts_at: '2026-11-03T00:00:00Z', ends_at: '2026-11-03T01:30:00Z', location: 'Field 1', description: 'Arrive 15 min early. ', calname: 'Rivertown FC' };

test('malformed token never reaches the database and is a plain 404', async () => {
  for (const t of ['', 'abc', 'A'.repeat(64), 'a'.repeat(63), "a'--"]) {
    const r = await invoke(t); assert.equal(r.status, 404); assert.equal(r.calls.length, 0);
  }
});
test('unknown or revoked token (zero rows) is 404, indistinguishable from malformed', async () => {
  const r = await invoke(good, []); assert.equal(r.status, 404); assert.equal(r.body, 'Not found');
});
test('valid token renders RFC 5545 with stable UID, SEQUENCE and STATUS', async () => {
  const r = await invoke(good, [row, { ...row, uid: '22222222-2222-4222-8222-222222222222', status: 'CANCELLED', sequence: 3 }]);
  assert.equal(r.status, 200);
  assert.match(r.body, /^BEGIN:VCALENDAR\r\n/); assert.match(r.body, /X-WR-CALNAME:Rivertown FC/);
  assert.match(r.body, /UID:11111111-1111-4111-8111-111111111111@sporv\.ai/); assert.match(r.body, /SEQUENCE:2/);
  assert.match(r.body, /STATUS:CANCELLED/); assert.match(r.body, /DTSTART:20261103T000000Z/);
  assert.equal(r.body.split('BEGIN:VEVENT').length - 1, 2);
});
test('the handler only ever emits what the RPC returned — it cannot add athlete names', async () => {
  const r = await invoke(good, [row]);
  assert.ok(!/Ava|Bell|Ortiz/.test(r.body));
  assert.deepEqual(r.calls.map(c => c.name), ['calendar_feed_events']);
});
test('a database error is 503, not a silent empty calendar', async () => {
  const r = await invoke(good, null, { message: 'down' }); assert.equal(r.status, 503);
});
