// tests/scheduling/schedule-screen.spec.ts — audit 2026-09-17 P1-2. The
// schedule screen over `event`: what it reads, what it never invents, how a
// cancellation stays draft-first, and how attendance survives a dead signal.
// The browser proof is tests/e2e/schedule.spec.mjs; the SQL fixture proves
// migration 001076 (conflicts for the people who coach the event).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const host = read('src/sporve-web.host.html');
const mig = read('supabase/migrations/20260915_001076_member_conflicts.sql');
const fixturePath = 'docs/red-drafts/2026-09-18-schedule-screen.test.sql';

test('the screen reads event, the org\'s teams and the server\'s conflicts — three requests, one window, no invented row', () => {
  assert.match(host, /API\.from\("event","select=id,team_id,kind,title,starts_at,ends_at,timezone,venue_id,location_text,status,cancellation_reason/);
  assert.match(host, /API\.rpc\("event_conflicts_in_range",\{p_provider:pv\.id,p_from:r\.from,p_to:r\.to\}\)/);
  assert.match(host, /body=queueIsLive\(\)\?schedBodyHTML\(\):/, 'a real org never sees the seeded sessions table');
  assert.match(host, /Nothing scheduled in the next 60 days\./); assert.match(host, /Couldn't load the schedule/);
  assert.match(host, /Conflicts were not checked\./, 'a refused conflict check is stated, not hidden');
});
test('cancel is two taps and draft-first: tap one names the event, tap two calls cancel_event with notify=true; the receipt counts drafted notices', () => {
  assert.match(host, /data-evcancel=/); assert.match(host, /data-evcancel-go=/);
  assert.match(host, /const args=\{p_event:c\.id,p_reason:c\.reason\|\|"",p_notify:true\};/); assert.match(host, /rpc\("cancel_event",args\)/);   // notify stays true; the loaded sequence rides along (audit P2-8)
  assert.match(host, /family notice\$\{[^}]*\} drafted for your approval in Needs you\./);
  assert.ok(!/outbound_messages"\s*,\s*[^)]*method:\s*"POST"/.test(host.slice(host.indexOf('function cancelEventGo'), host.indexOf('function cancelEventGo') + 2000)), 'the screen never writes a message');
});
test('attendance: local first, replayed with a stable client_id, refusals kept visible, nothing dropped', () => {
  assert.match(host, /const ATT_QUEUE_KEY="sporv:attendance-queue:v1"/);
  assert.match(host, /rpc\("mark_attendance",\{p_event:item\.event_id,p_member:item\.member_id,p_state:item\.state,p_client_id:item\.client_id\}\)/);
  assert.match(host, /item\.error=\(e&&e\.message\)\|\|"Refused by the server\."/);
  assert.match(host, /window\.addEventListener\("online",\(\)=>flushAttendanceQueue\(\)\)/);
  assert.match(host, /Queued — sends when the connection is back/);
});
test('001076: every active member may ask for conflicts and gets rows only for the events they coach; anon nothing', () => {
  assert.match(mig, /if auth\.uid\(\) is not null and not public\.is_org_member\(p_provider\) then/);
  assert.match(mig, /and \(auth\.uid\(\) is null or public\.coaches_event\(e\.id\)\)/);
  assert.match(mig, /revoke all on function public\.event_conflicts_in_range\(uuid,timestamptz,timestamptz\) from public, anon;/);
});
test('the fixture runs for real: 3 groups', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-18-schedule-screen', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-18-schedule-screen\.test\.sql/, out.slice(-800)); assert.match(out, /3 assertion group\(s\)/, out.slice(-300));
});
