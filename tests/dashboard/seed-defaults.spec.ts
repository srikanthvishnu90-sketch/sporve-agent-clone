// tests/dashboard/seed-defaults.spec.ts — doc 25.11 migration safety: every
// role's seeded default resolves to a non-empty, permission-valid list, and
// re-running the seed produces zero duplicates (fixture group A).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mig, fixture, runFixture } from './_fixture.ts';

const rank: Record<string, number> = { coach: 1, registrar: 2, treasurer: 2, director: 3, owner: 4 };
const blockRoles: Record<string, string> = {};
for (const m of mig.matchAll(/\('([a-z]+\.[a-z]+)',\s+'[^']+',\s+'[^']+',\s+'(coach|registrar|treasurer|director|owner)'/g)) blockRoles[m[1]] = m[2];
const defaults: Record<string, string[]> = {};
for (const m of mig.matchAll(/\('(owner|director|treasurer|registrar|coach)',\s+'(\[[^\]]*\])'\)/g)) defaults[m[1]] = JSON.parse(m[2]);

test('exactly the five CORE blocks are seeded, each with min_role', () => {
  assert.deepEqual(Object.keys(blockRoles).sort(), ['agent.attention', 'money.overdue', 'people.recent', 'roster.gaps', 'schedule.today']);
});
test('every role default is non-empty and names only blocks that role may see', () => {
  for (const role of ['owner', 'director', 'treasurer', 'registrar', 'coach']) {
    assert.ok(defaults[role]?.length, `${role} default is empty`);
    for (const k of defaults[role]) { assert.ok(k in blockRoles, `${role} default names unknown block ${k}`); assert.ok(rank[role] >= rank[blockRoles[k]], `${role} default names ${k} (min_role ${blockRoles[k]})`); }
  }
  assert.ok(!defaults.coach.some((k) => k.startsWith('money.')), "a coach's default has no money block");
});
test('the seed is idempotent: on conflict do nothing on both tables, proved by re-seeding in the fixture', () => {
  assert.equal((mig.match(/on conflict \(key\) do nothing;/g) || []).length, 1); assert.equal((mig.match(/on conflict \(role\) do nothing;/g) || []).length, 1);
  assert.match(fixture, /re-seed duplicated a block/); assert.match(fixture, /re-seed overwrote the coach default/); assert.match(fixture, /PASS A:/);
});
test('the fixture runs for real', () => { runFixture(); });
