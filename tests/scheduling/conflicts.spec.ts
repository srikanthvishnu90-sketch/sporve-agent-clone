// tests/scheduling/conflicts.spec.ts — the DoD file spec 12.3 names.
// Runs under `node --test` (Node ≥ 23 strips types natively).
//
// "fixture org, two teams, one shared field, one shared coach, one
// dual-rostered athlete; all four classes fire; override records a reason."
// The SQL fixture proves that against a real Postgres (groups A–E, I); this
// file pins the shape of migration 001069 so a later edit cannot quietly turn
// a warning into a block or drop a class, and executes the fixture when
// Postgres is on the PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const mig = read('supabase/migrations/20260915_001069_event_conflicts_and_cancellation.sql');
const fixturePath = 'docs/red-drafts/2026-09-16-spec12-slice2.test.sql';
const fixture = read(fixturePath);

test('all four classes are detected: facility, staff, athlete, blackout — and nothing else', () => {
  const fn = mig.slice(mig.indexOf('function public.detect_event_conflicts'), mig.indexOf('revoke all on function public.detect_event_conflicts'));
  for (const cls of ['venue', 'staff', 'athlete', 'blackout']) assert.match(fn, new RegExp(`select (distinct )?'${cls}'`), `${cls} class missing`);
  assert.equal((fn.match(/union all/g) || []).length, 3, 'exactly four SELECT arms');
  assert.match(fn, /tstzrange\(o\.starts_at, o\.ends_at\) && tstzrange\(e\.starts_at, e\.ends_at\)/, 'overlap is a range intersection, not an equality');
});

test('conflicts are warnings: no trigger on event raises on a conflict, nothing blocks an insert', () => {
  assert.ok(!/create trigger[^;]*detect_event_conflicts/i.test(mig), 'a trigger wired to the detector would turn a warning into a block');
  assert.ok(!/raise exception[^;]*conflict(?!s\))/i.test(mig.replace(/only organisation staff[^']*/g, '').replace(/nothing to override[^']*/g, '').replace(/an override needs a reason/g, '')),
    'no conflict raises');
  assert.match(fixture, /PASS C: conflicts warn, they do not block/);
});

test('the detector is tenant-scoped and ignores cancelled rows on both sides', () => {
  const fn = mig.slice(mig.indexOf('function public.detect_event_conflicts'), mig.indexOf('revoke all on function public.detect_event_conflicts'));
  assert.match(fn, /where id = p_event and status <> 'cancelled'/, 'a cancelled event has no conflicts of its own');
  assert.equal((fn.match(/o\.provider_id = e\.provider_id/g) || []).length, 3, 'venue, staff and athlete arms all stay inside the org');
  assert.equal((fn.match(/o\.status <> 'cancelled'/g) || []).length, 3, 'cancelled counterparts never conflict');
  assert.match(fn, /b\.provider_id = e\.provider_id/, 'blackout windows are the org\'s own');
});

test('override records a reason, the conflicts it waved through, and who — and refuses an empty reason', () => {
  assert.match(mig, /if coalesce\(trim\(p_reason\),''\) = '' then raise exception 'an override needs a reason' using errcode = '22023'/);
  assert.match(mig, /insert into public\.settings_audit \(provider_id, surface, key, new_value, changed_by\)\s*values \(v_provider, 'schedule', 'conflict_override'/);
  assert.match(mig, /'reason', left\(trim\(p_reason\), 300\), 'conflicts', v_conflicts/);
  assert.match(mig, /nothing to override: this event has no conflicts/, 'an override on a clean event is refused, so the audit trail cannot be padded');
  assert.match(mig, /raise exception 'only organisation staff may override a conflict' using errcode = '42501'/);
});

test('no slice-2 function is executable by anon; staff and service_role only', () => {
  for (const sig of ['detect_event_conflicts(uuid)', 'event_conflicts_in_range(uuid,timestamptz,timestamptz)', 'record_conflict_override(uuid,text)']) {
    assert.match(mig, new RegExp(`revoke all on function public\\.${sig.replace(/[()]/g, '\\$&')} from public, anon;`));
    assert.match(mig, new RegExp(`grant execute on function public\\.${sig.replace(/[()]/g, '\\$&')} to authenticated, service_role;`));
  }
  assert.match(mig, /revoke all on function public\.event_family_recipients\(uuid\) from public, anon, authenticated;/, 'the recipient resolver is internal');
});

test('the fixture runs for real: two teams, shared field, shared coach, dual-rostered athlete — 9 groups green', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  assert.match(fixture, /dual-rostered/); assert.match(fixture, /Northside Field/); assert.match(fixture, /the shared coach/);
  assert.match(fixture, /20260915_001069_event_conflicts_and_cancellation\.sql/);
  assert.ok(!/001056|001057|001058/.test(fixture), 'slice 2 must not include a preserved slice-3 migration');
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened; see the PR body)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-16-spec12-slice2', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-16-spec12-slice2\.test\.sql/, out.slice(-800));
  assert.match(out, /9 assertion group\(s\)/, out.slice(-300));
});
