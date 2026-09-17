// tests/dashboard/rls-per-block.spec.ts — doc 25.11. For every block in the
// registry, for every role: the block's rows as that role. Denial is ZERO
// ROWS (the block absent from the resolved list, or empty when a layout names
// it), never a thrown error. Cross-tenant callers get an empty home.
// THE FIXTURE ITERATES THE REGISTRY TABLE (group E: `for b in select * from
// public.dashboard_block`), so a block added without a test cannot exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mig, fixture, runFixture } from './_fixture.ts';

test('the per-role check enumerates dashboard_block, not a hand-written list', () => {
  assert.match(fixture, /for b in select \* from public\.dashboard_block loop/);
  assert.match(fixture, /if public\.dashboard_role_rank\(who\.role\) < public\.dashboard_role_rank\(b\.min_role\) then\s*if blk is not null then raise exception/);
});
test('a coach running money.overdue gets zero rows, asserted as absence, not as an error', () => {
  assert.match(fixture, /a coach home has a money block/);
  assert.match(mig, /if v_key = 'money\.overdue' and public\.dashboard_role_rank\(v_role\) >= 2 then/, 'the money query itself is role-gated in SQL — a layout cannot reach it');
  assert.match(mig, /if v_key = 'roster\.gaps' and public\.dashboard_role_rank\(v_role\) >= 2 then/);
});
test('cross-tenant: a member of org B, and an anonymous caller, get an EMPTY home for org A — no exception', () => {
  assert.match(mig, /return jsonb_build_object\('role', null, 'flags', '\{\}'::jsonb, 'blocks', '\[\]'::jsonb\);/);
  assert.match(fixture, /PASS F: cross-tenant and anonymous callers get an empty home/);
});
test('the RPC is the only read path and anon cannot execute it', () => {
  assert.match(mig, /revoke all on function public\.dashboard_home\(uuid\) from public, anon;/);
  assert.match(mig, /revoke all on public\.dashboard_block, public\.dashboard_role_default, public\.dashboard_layout from public, anon, authenticated;/);
  assert.match(fixture, /PASS J: dashboard functions and tables hold nothing for anon/);
});
test('the fixture runs for real', () => { runFixture(); });
