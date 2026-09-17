// tests/dashboard/capability-derivation.spec.ts — doc 27.9. Each flag flips in
// both directions when the underlying state changes (fixture group C), and
// deriving them adds no round trip: dashboard_flags() is called inside
// dashboard_home(), never by the client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mig, fixture, runFixture } from './_fixture.ts';

test('six flags, each a live query, none stored', () => {
  const fn = mig.slice(mig.indexOf('function public.dashboard_flags'), mig.indexOf('function public.dashboard_resolve'));
  for (const f of ['has_staff', 'rents_facilities', 'collects_dues', 'runs_registration', 'multi_team', 'has_connected_inbox']) assert.ok(fn.includes(`'${f}'`), f);
  assert.ok(!/create table[^;]*flags|alter table[^;]*add column[^;]*(has_staff|collects_dues)/i.test(mig), 'no stored flag column');
  assert.match(fn, /language sql stable security definer/);
});
test('flags flip on and off within one call, in the fixture', () => {
  assert.match(fixture, /flags did not flip on/); assert.match(fixture, /flags did not flip off/); assert.match(fixture, /PASS C: flags are live counts/);
});
test('derivation adds zero round trips: the home RPC computes them itself', () => {
  assert.match(mig, /v_flags := public\.dashboard_flags\(p_provider\);/);
  const host = readFileSync(new URL('../../src/sporve-web.host.html', import.meta.url), 'utf8');
  assert.ok(!/rpc\("dashboard_flags"/.test(host), 'the client never asks for flags separately');
});
test('the two flags that cannot be derived today are false, and say why', () => {
  assert.match(mig, /'rents_facilities',\s+false,\s+-- venue carries no ownership today/); assert.match(mig, /'runs_registration',\s+false,\s+-- registration forms are spec 13\.7/);
});
test('the fixture runs for real', () => { runFixture(); });
