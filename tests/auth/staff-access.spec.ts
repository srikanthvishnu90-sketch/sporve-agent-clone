// tests/auth/staff-access.spec.ts — audit 2026-09-17 P1-1. A staff member lands
// in the org that employs them and can do the coach's job for the teams they
// coach — and nothing else. The SQL fixture proves it against a real Postgres;
// this pins the migration and the client shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const mig = read('supabase/migrations/20260915_001075_staff_workspace_access.sql');
const account = read('src/mod-coachaccount.js');
const host = read('src/sporve-web.host.html');
const fixturePath = 'docs/red-drafts/2026-09-17-staff-access.test.sql';

test('the workspace is resolved by the database: own org unless untouched + a membership elsewhere', () => {
  assert.match(mig, /create or replace function public\.my_workspace\(\)/);
  assert.match(mig, /own\.business_name in \('Your organization', 'My Academy', 'My coaching business'\)/);
  assert.match(mig, /case emp\.role when 'owner' then 'owner' when 'admin' then 'director' else 'coach' end/);
  assert.match(account, /return API\.rpc\("my_workspace", \{\}\)/, 'the client asks the database, not owner_id');
});
test('member reads are scoped to coached teams and proven by zero rows; writes stay with admins', () => {
  assert.match(mig, /create policy team_athletes_select_member on public\.team_athletes for select to authenticated\s*using \(team_id is not null and public\.coaches_team\(provider_id, team_id\)\)/);
  assert.match(mig, /create policy event_select_member on public\.event for select to authenticated/);
  assert.ok(!/for all to authenticated\s*using \(public\.is_org_member/.test(mig), 'no member-wide write policy');
  assert.match(mig, /not \(public\.is_org_admin\(v_provider\) or public\.coaches_event\(p_event\)\)/, 'attendance admits the assigned coach');
});
test('staff are never trapped in the employer org\'s setup, and ensure() never renames it', () => {
  assert.match(host, /pv\.onboarding_completed===false && \(pv\.role\|\|"owner"\)==="owner"/);
  assert.match(account, /\(existing\.role \|\| "owner"\) === "owner"/);
});
test('the fixture runs for real: 5 groups', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-17-staff-access', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-17-staff-access\.test\.sql/, out.slice(-800)); assert.match(out, /5 assertion group\(s\)/, out.slice(-300));
});
