// Shared by the doc 25/27 specs: pins the migration's shape and runs the SQL
// fixture (docs/red-drafts/2026-09-17-dashboard-home.test.sql) against a real
// Postgres when one is on the PATH. Each spec asserts the fixture group(s)
// that prove its clause, so a weakened group fails the spec that owns it.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
export const root = new URL('../../', import.meta.url);
export const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
export const mig = read('supabase/migrations/20260915_001073_dashboard_home.sql');
export const fixturePath = 'docs/red-drafts/2026-09-17-dashboard-home.test.sql';
export const fixture = read(fixturePath);
let ran: string | null = null;
export function runFixture(): string | null {
  assert.ok(existsSync(new URL(fixturePath, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened; see the PR body)'); return null; }
  if (ran === null) ran = execSync('bash tools/run-sql-fixtures.sh 2026-09-17-dashboard-home', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(ran, /PASS +2026-09-17-dashboard-home\.test\.sql/, ran.slice(-800));
  assert.match(ran, /10 assertion group\(s\)/, ran.slice(-300));
  return ran;
}
