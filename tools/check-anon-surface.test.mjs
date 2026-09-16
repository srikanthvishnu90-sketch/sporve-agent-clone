// The classifier behind the weekly anon-surface probe. Audit 2026-09-15 B14:
// `select=*` alone false-negatives on a partial column grant, and a 200 with
// zero rows was counted as a pass although it proves anon holds a grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probe, fails } from './check-anon-surface.mjs';

const res = (status, body) => ({ status, text: async () => JSON.stringify(body) });
const DENY = res(401, { code: '42501', message: 'permission denied for table x' });
const fake = (rules) => async (url) => {
  const sel = decodeURIComponent(new URL(url).searchParams.get('select'));
  const r = rules[sel] ?? rules['*'] ?? DENY;
  return typeof r === 'function' ? r() : r;
};

test('a table whose `*` is refused but one column is granted is a GRANT, not denied (the old false negative)', async () => {
  const p = await probe('teams', fake({ '*': DENY, name: res(200, []) }));
  assert.equal(p.state, 'GRANT'); assert.deepEqual(p.granted, ['name']); assert.ok(fails(p));
});
test('a 200 with zero rows on `*` is a GRANT — RLS is the only barrier and that fails', async () => {
  const p = await probe('teams', fake({ '*': res(200, []) }));
  assert.equal(p.state, 'GRANT'); assert.ok(fails(p));
});
test('rows back on any column is ANON READ', async () => {
  const p = await probe('teams', fake({ '*': DENY, sport: res(200, [{ sport: 'Basketball' }]) }));
  assert.equal(p.state, 'ANON READ'); assert.deepEqual(p.columns, ['sport']); assert.ok(fails(p));
});
test('every column refused is denied and passes', async () => {
  const p = await probe('teams', fake({}));
  assert.equal(p.state, 'denied'); assert.ok(!fails(p));
});
test('an absent table is absent and passes', async () => {
  const p = await probe('import_row', fake({ '*': res(404, { code: 'PGRST205', message: 'not found' }) }));
  assert.equal(p.state, 'absent'); assert.ok(!fails(p));
});
test('a column that no longer exists is STALE and fails — the probe proved nothing', async () => {
  const p = await probe('venue', fake({ '*': DENY, capacity: res(400, { code: '42703', message: 'column venue.capacity does not exist' }) }));
  assert.equal(p.state, 'STALE'); assert.deepEqual(p.columns, ['capacity']); assert.ok(fails(p));
});
test('an unexpected answer (a 500, a 403 without a code) never passes silently', async () => {
  const p = await probe('teams', fake({ '*': res(500, { message: 'boom' }) }));
  assert.match(p.state, /^unexpected/); assert.ok(fails(p));
});
