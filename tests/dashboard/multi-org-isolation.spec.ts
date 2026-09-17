// tests/dashboard/multi-org-isolation.spec.ts — doc 27.7/27.9. One person, two
// orgs, two roles → two homes; nothing carries across (fixture group G).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mig, fixture, runFixture } from './_fixture.ts';

test('the caller is resolved per org: owner_id first, then THIS org\'s membership row', () => {
  const fn = mig.slice(mig.indexOf('function public.dashboard_caller'), mig.indexOf('function public.dashboard_flags'));
  assert.match(fn, /where m\.organization_id = p_provider and m\.member_user_id = v_uid and m\.is_active limit 1/);
  assert.match(fn, /role := case v_row\.role when 'owner' then 'owner' when 'admin' then 'director' when 'trainer' then 'coach' else null end;/);
});
test('layouts are keyed per (org, member), never per user', () => {
  assert.match(mig, /unique \(provider_id, member_id\)/);
  assert.match(mig, /select l\.blocks into v_layout from public\.dashboard_layout l where l\.provider_id = p_provider and l\.member_id = v_member;/);
});
test('coach in A, director in B: two different lists, org B carries no org A rows', () => {
  assert.match(fixture, /PASS G: same person, two orgs, two homes; nothing carries across/);
  assert.match(fixture, /org B home carried org A rows/);
});
test('the fixture runs for real', () => { runFixture(); });
