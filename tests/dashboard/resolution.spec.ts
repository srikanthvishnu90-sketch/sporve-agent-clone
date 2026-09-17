// tests/dashboard/resolution.spec.ts — doc 25.11. Table-driven resolution over
// role × capability flags × stored layout, proved by fixture groups B, E, I.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mig, fixture, runFixture } from './_fixture.ts';

test('resolution order is default → refinement → user layout → permission filter LAST, in SQL', () => {
  const fn = mig.slice(mig.indexOf('function public.dashboard_resolve'), mig.indexOf('function public.dashboard_home'));
  assert.match(fn, /if p_layout is not null and jsonb_typeof\(p_layout\) = 'array' and jsonb_array_length\(p_layout\) > 0 then\s*v_keys := p_layout;/, 'an explicit layout wins over the default');
  assert.match(fn, /if b\.key is null then continue; end if;/, 'an unknown key drops silently');
  assert.match(fn, /if public\.dashboard_role_rank\(p_role\) < public\.dashboard_role_rank\(b\.min_role\) then continue; end if;/, 'the permission filter applies to whichever list won');
  assert.match(fn, /foreach req in array b\.requires loop/, 'capability requirements are checked per block');
  assert.match(fn, /if p_role is null then return '\[\]'::jsonb; end if;/, 'no role → no blocks');
});
test('the matrix: owner, coach, coach with a forbidden stored layout, no-dues org, unknown key, params merge, null role', () => {
  for (const s of ['FAIL B: owner resolved', 'FAIL B: coach resolved', 'stored layout leaked forbidden blocks to a coach', 'money block shown to an org that collects no dues',
    'an unknown key was not dropped', 'layout params not merged', 'a null role resolved to blocks', 'PASS B:']) assert.ok(fixture.includes(s), s);
});
test('a member with no layout row resolves to their role default; a stored layout naming a forbidden block resolves without it', () => {
  assert.match(fixture, /PASS E: every registry block × every role/); assert.match(fixture, /stored layout leaked money\.overdue to a coach/);
});
test('the fixture runs for real', () => { runFixture(); });
