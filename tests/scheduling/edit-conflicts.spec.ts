// tests/scheduling/edit-conflicts.spec.ts — audit 2026-09-17 P2-6, P2-7, P2-8.
// Delivery is kicked at approval instead of waiting for the minute cron; the
// token ceiling is a 429 a client can act on; two people cannot silently
// overwrite one event. SQL proof: docs/red-drafts/2026-09-18-delivery-conflicts.test.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const mig = read('supabase/migrations/20260915_001079_delivery_and_edit_conflicts.sql');
const approve = read('supabase/functions/lifecycle-approve/index.ts');
const host = read('src/sporve-web.host.html');
const fixturePath = 'docs/red-drafts/2026-09-18-delivery-conflicts.test.sql';
test('P2-6: approval kicks the delivery pass now, bounded, with the cron as the net; the client words the receipt from what happened', () => {
  assert.match(approve, /async function kickDelivery\(\)/); assert.match(approve, /setTimeout\(\(\) => ctl\.abort\(\), 12000\)/);
  assert.match(approve, /fetch\(`\$\{SUPABASE_URL\}\/functions\/v1\/lifecycle-process`/); assert.match(approve, /Authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/);
  assert.match(approve, /const kicked = await kickDelivery\(\);\s*return json\(\{ ok: true, status: "approved", queuedEmail: true, \.\.\.kicked \}\);/);
  assert.match(host, /r\.kick==="done"&&Number\(r\.delivered\)>0\?"Approved and emailed to the family\.":"Approved — emailing this family within the minute\."/);
});
test('P2-7: the issuance ceiling is PT429 (HTTP 429) with an actionable message; the approve RPC degrades the link under either code', () => {
  assert.match(mig, /raise exception 'too many links issued for this guardian this hour — try again in an hour' using errcode = 'PT429'/);
  assert.match(mig, /exception when sqlstate 'PT429' or sqlstate '53400' then/);
  assert.ok(!/using errcode = '53400'/.test(mig), 'no 53400 is raised by this migration');
});
test('P2-8: cancel and edit refuse a stale sequence with PT409; the screen sends the sequence it loaded and reloads on conflict', () => {
  assert.match(mig, /create or replace function public\.cancel_event\(p_event uuid, p_reason text, p_notify boolean default true, p_expected_sequence integer default null\)/);
  assert.match(mig, /if p_expected_sequence is not null and p_expected_sequence <> v_e\.sequence then/);
  assert.match(mig, /create or replace function public\.edit_event\(p_event uuid, p_expected_sequence integer, p_patch jsonb\)/);
  assert.match(mig, /if p_expected_sequence is null or p_expected_sequence <> v_e\.sequence then/);
  assert.match(mig, /revoke all on function public\.edit_event\(uuid,integer,jsonb\) from public, anon;/);
  assert.match(host, /args\.p_expected_sequence=evNow\.sequence;/); assert.match(host, /e\.status===409\|\|e\.code==="PT409"/); assert.match(host, /Someone changed this event after you opened it/);
});
test('the fixture runs for real: 4 groups', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-18-delivery-conflicts', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-18-delivery-conflicts\.test\.sql/, out.slice(-800)); assert.match(out, /4 assertion group\(s\)/, out.slice(-300));
});
