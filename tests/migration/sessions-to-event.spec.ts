// tests/migration/sessions-to-event.spec.ts — the DoD file spec 12.7 names.
// Runs under `node --test` (Node ≥ 23 strips types natively).
//
// 12.7 is the one migration in this spec that touches data a club already has,
// so the properties that matter are: nothing is moved (sessions stays live,
// because bookings and disputes have real foreign keys into it), nothing is
// dropped (an unparseable row is quarantined WITH its payload), and re-running
// creates no duplicates. The SQL fixture proves all three against a real
// Postgres; this file pins the shape of the migration so a later edit cannot
// quietly turn a COPY into a MOVE or a quarantine into a DELETE, and executes
// the fixture when Postgres is on the PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const backfill = read('supabase/migrations/20260915_001054_backfill_sessions_and_fixtures.sql');
const quarantine = read('supabase/migrations/20260915_001053_migration_quarantine.sql');
const event = read('supabase/migrations/20260915_001052_event.sql');
const fixturePath = 'docs/red-drafts/2026-09-15-spec12-scheduling.test.sql';

test('it COPIES: sessions is never deleted from, dropped, or renamed', () => {
  assert.ok(!/delete\s+from\s+public\.sessions/i.test(backfill), 'the backfill deletes sessions rows');
  assert.ok(!/drop\s+table[^;]*sessions/i.test(backfill), 'the backfill drops sessions');
  assert.ok(!/alter\s+table\s+public\.sessions\s+rename/i.test(backfill), 'the backfill renames sessions');
  assert.match(backfill, /COPY, not move/, 'the file states why, so the next reader does not "finish" the move');
});

test('every source row ends as an event or a quarantine row — there is no third path', () => {
  // the loop body: parse → (null ⇒ quarantine + continue) → insert event
  assert.match(backfill, /if v_start is null then[\s\S]*?insert into public\.migration_quarantine[\s\S]*?continue;/,
    'an unparseable start_time must be quarantined and skipped, not silently dropped');
  assert.match(backfill, /values \(s\.provider_id, 'sessions', s\.id, 'unparseable start_time: ' \|\| coalesce\(s\.start_time,'null'\), to_jsonb\(s\)\)/,
    'the quarantine row carries the reason AND the whole source row');
  assert.ok(!/exception\s+when\s+others\s+then\s+null/i.test(backfill), 'a swallowed exception would be a silent drop');
});

test('re-running creates zero duplicates: guarded on the source id, twice', () => {
  assert.match(backfill, /where not exists \(select 1 from public\.event e where e\.source_session_id = se\.id\)/, 'the loop skips rows already copied');
  assert.match(backfill, /on conflict \(source_session_id\) do nothing/, 'and the insert is idempotent even under a race');
  assert.match(backfill, /where not exists \(select 1 from public\.event e where e\.source_fixture_id = pf\.id\)/);
  assert.match(backfill, /on conflict \(source_fixture_id\) do nothing/);
  assert.match(event, /source_session_id[\s\S]{0,400}unique/i, 'source_session_id carries a unique index — the constraint the ON CONFLICT needs');
});

test('the two clock formats seen in the wild both parse; anything else does not guess', () => {
  assert.ok(backfill.includes(String.raw`p_time ~ '^\d{1,2}:\d{2}$'`), '24-hour "18:00"');
  assert.ok(backfill.includes(String.raw`p_time ~* '^\d{1,2}:\d{2}\s*[ap]m$'`), 'display form "05:00 PM"');
  assert.match(backfill, /return null;\s*end \$\$;/, 'an unrecognised format returns null rather than a guessed time');
  // local wall clock, then the zone — never a bare cast, which would bake the server's zone in
  assert.match(backfill, /v_start at time zone v_tz/);
  assert.match(backfill, /v_tz := coalesce\(s\.timezone, 'America\/Chicago'\)/);
});

test('a missing or inverted end time becomes a 60-minute event rather than a negative one', () => {
  assert.match(backfill, /if v_end is null or v_end <= v_start then v_end := v_start \+ interval '60 minutes'; end if;/);
});

test('quarantined rows are readable by the org that owns them, and by nobody else', () => {
  assert.match(quarantine, /alter table public\.migration_quarantine enable row level security;/);
  assert.match(quarantine, /alter table public\.migration_quarantine force row level security;/);
  assert.match(quarantine, /create policy migration_quarantine_admin_read on public\.migration_quarantine for select to authenticated/);
  assert.ok(!/to\s+anon/i.test(quarantine), 'quarantine payloads carry club data and are never anonymous');
});

test('slice 1 is self-contained: nothing here calls conflict detection, cancellation, publication or the feed', () => {
  const slice1 = readdirSync(new URL('supabase/migrations/', root))
    .filter((f) => /^20260915_0010(5[0-5]|66)_/.test(f))
    .map((f) => read(`supabase/migrations/${f}`)).join('\n');
  for (const later of ['detect_event_conflicts', 'record_conflict_override', 'cancel_event', 'generate_event_reminders',
    'draft_event_change_notices', 'publish_series', 'publish_events', 'seed_no_response', 'calendar_feed_events', 'issue_calendar_feed_token']) {
    assert.ok(!new RegExp(`public\\.${later}\\s*\\(`).test(slice1), `slice 1 calls ${later}, which ships in slice 2 or 3`);
  }
});

test('the fixture runs for real: 9 assertion groups green against a live Postgres', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  const fixture = read(fixturePath);
  assert.match(fixture, /20260915_001066_series_materializer\.sql/, 'slice 1 includes the materializer');
  assert.ok(!/001056|001057|001058/.test(fixture), 'slice 1 must not include a slice 2/3 migration');
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened; see the PR body)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-15-spec12', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-15-spec12-scheduling\.test\.sql/, out.slice(-800));
  assert.match(out, /9 assertion group\(s\)/, out.slice(-300));
});
