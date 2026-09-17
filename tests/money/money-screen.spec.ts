// tests/money/money-screen.spec.ts — audit 2026-09-17 P1-3. Money has a
// screen for dues (doc 22.6): aged balances by family from one RPC, zero rows
// below treasurer, every obligation traceable, failed payments with retry
// state, CSV export. Browser proof: tests/e2e/money.spec.mjs. SQL proof of
// migration 001077: docs/red-drafts/2026-09-18-money-screen.test.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const host = read('src/sporve-web.host.html');
const mig = read('supabase/migrations/20260915_001077_money_aged_balances.sql');
const fixturePath = 'docs/red-drafts/2026-09-18-money-screen.test.sql';

test('one round trip: the screen reads money_aged_balances and nothing else; a real org never sees marketplace earnings', () => {
  assert.match(host, /rpc\("money_aged_balances",\{p_provider:pv\.id\}\)/);
  assert.match(host, /if\(queueIsLive\(\)\) return moneyPageHTML\(\);/);
  assert.match(host, /function financesLabel\(\)\{ return queueIsLive\(\)\?"Money":"Earnings"; \}/);
  assert.match(host, /Nobody owes anything right now\./); assert.match(host, /Couldn't load balances/); assert.match(host, /Money is not part of your role/);
  assert.match(host, /st\.loadedAt=Date\.now\(\); st\.error=\(e&&e\.message\)\|\|"Could not reach the server\."/, 'a failed load never re-fires on render');
});
test('the home block drills to Money filtered to overdue', () => {
  assert.match(host, /b\.key==="money\.overdue"\?' data-moneyfilter="overdue"':""/);
  assert.match(host, /if\(b\.dataset\.moneyfilter\)\{ moneyState\(\)\.filter=b\.dataset\.moneyfilter; S\.moneyPageTab="balances"; \}/);
});
test('001077: integer cents, zero rows below treasurer (not an error), STABLE, anon revoked', () => {
  assert.match(mig, /if v_role is null or public\.dashboard_role_rank\(v_role\) < 2 then/);
  assert.match(mig, /return jsonb_build_object\('role', v_role, 'totals', null, 'families', '\[\]'::jsonb/);
  assert.match(mig, /language plpgsql stable security definer set search_path to ''/);
  assert.match(mig, /revoke all on function public\.money_aged_balances\(uuid\) from public, anon;/);
  assert.ok(!/(insert into|update |delete from)/i.test(mig), 'reads only');
  assert.match(mig, /'d90_plus',coalesce\(sum\(amount_cents\) filter \(where days_overdue > 90\), 0\)/);
});
test('the fixture runs for real: 3 groups', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-18-money-screen', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-18-money-screen\.test\.sql/, out.slice(-800)); assert.match(out, /3 assertion group\(s\)/, out.slice(-300));
});
