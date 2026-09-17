// tests/dashboard/permission-revocation.spec.ts — doc 27.9. A member loses a
// role: their blocks are gone at the next render, no error, and the stored
// layout is left intact for when the role returns (fixture group H).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mig, fixture, runFixture } from './_fixture.ts';

test('permission is re-checked at every render, never cached on the layout row', () => {
  assert.match(mig, /select role, member_id into v_role, v_member from public\.dashboard_caller\(p_provider\);/);
  assert.ok(!/update public\.dashboard_layout/.test(mig), 'resolution never writes the layout');
});
test('demotion drops the block at next render; the stored layout survives; promotion restores it', () => {
  assert.match(fixture, /demoted member still sees roster\.gaps/); assert.match(fixture, /stored layout was altered/); assert.match(fixture, /layout did not return with the role/);
  assert.match(fixture, /PASS H:/);
});
test('the fixture runs for real', () => { runFixture(); });
