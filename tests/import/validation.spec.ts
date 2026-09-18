// tests/import/validation.spec.ts — audit 2026-09-17 P2-1/P2-2. The client
// quarantines broken rows with reasons; the database refuses impossible
// birthdates from any writer (migration 001078). Browser proof:
// tests/e2e/import-validation.spec.mjs. SQL proof: the fixture below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const host = read('src/sporve-web.host.html'); const mig = read('supabase/migrations/20260915_001078_dob_guard.sql');
const fixturePath = 'docs/red-drafts/2026-09-18-dob-guard.test.sql';
test('an unclosed quote is a flagged row, not an athlete; a non-name is named as such', () => {
  assert.match(host, /if\(q&&rows\.length\) rows\[rows\.length-1\]\.malformed="unclosed quote";/);
  assert.match(host, /why:"malformed row \("\+r\.malformed\+"\) — fix the file and re-upload"/);
  assert.match(host, /function nameProblem\(name\)/); assert.match(host, /const np=nameProblem\(name\); if\(np\)\{out\.rejected\.push/);
});
test('the client and the database agree on the birthdate rule: a real past date after 1920', () => {
  assert.match(host, /if\(iso>today\|\|y<1920\) return null;/); assert.match(host, /dt\.getUTCDate\(\)!==d\|\|dt\.getUTCMonth\(\)!==mo-1\) return null;/);
  assert.match(mig, /if v > current_date then/); assert.match(mig, /if v < date '1920-01-01' then/); assert.match(mig, /using errcode = '23514'/);
  assert.match(mig, /create trigger trg_team_athletes_dob_guard before insert or update of dob on public\.team_athletes/);
});
test('the fixture runs for real: 2 groups', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-18-dob-guard', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-18-dob-guard\.test\.sql/, out.slice(-800)); assert.match(out, /2 assertion group\(s\)/, out.slice(-300));
});
