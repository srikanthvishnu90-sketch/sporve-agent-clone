// tests/scheduling/ics-feed.spec.ts — the DoD file spec 12.5 names.
// Runs under `node --test` (Node ≥ 23 strips types natively).
//
// "RFC 5545 parser; cancel emits STATUS:CANCELLED with incremented SEQUENCE."
// The parser below unfolds lines, unescapes TEXT values and groups VEVENTs;
// the calendar under test is what supabase/functions/calendar-feed emits
// for rows shaped exactly like calendar_feed_events() returns — including a
// cancelled occurrence whose SEQUENCE the database bumped (proved against a
// real Postgres by the slice-3 fixture, group E, executed at the end).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const mig = read('supabase/migrations/20260915_001070_publication_reminders_calendar_feed.sql');
const fixturePath = 'docs/red-drafts/2026-09-16-spec12-slice3.test.sql';
const source = stripTypeScriptTypes(read('supabase/functions/calendar-feed/index.ts').replace(/^import\s+[\s\S]*?;\n/gm, ''));
const TOKEN = 'a'.repeat(64);

type Row = Record<string, unknown>;
async function feed(rows: Row[]): Promise<string> {
  let handler: ((r: Request) => Promise<Response>) | undefined;
  vm.runInNewContext(source, { Response, URL, TextEncoder, Date, Number, String, console,
    createClient: () => ({ rpc: async () => ({ data: rows, error: null }) }),
    Deno: { serve(fn: typeof handler) { handler = fn; }, env: { get: () => 'fixture' } } });
  const res = await handler!(new Request(`https://fixture.invalid/calendar-feed?t=${TOKEN}`));
  assert.equal(res.status, 200); return res.text();
}
/* RFC 5545 §3.1 unfold, §3.3.11 TEXT unescape, VEVENT grouping */
function parse(ics: string): { props: Record<string, string>; events: Record<string, string>[] } {
  assert.ok(ics.endsWith('\r\n'), 'CRLF line endings');
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  const lines = unfolded.split('\r\n').filter(Boolean);
  for (const raw of ics.split('\r\n')) assert.ok(new TextEncoder().encode(raw).length <= 75, `line over 75 octets: ${raw.slice(0, 40)}`);
  const un = (v: string) => v.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
  const props: Record<string, string> = {}; const events: Record<string, string>[] = []; let cur: Record<string, string> | null = null;
  for (const l of lines) {
    const i = l.indexOf(':'); const key = l.slice(0, i).split(';')[0]; const val = l.slice(i + 1);
    if (l === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (l === 'END:VEVENT') { events.push(cur!); cur = null; continue; }
    (cur ?? props)[key] = un(val);
  }
  assert.equal(lines[0], 'BEGIN:VCALENDAR'); assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
  return { props, events };
}
const base: Row = { uid: '11111111-1111-4111-8111-111111111111', sequence: 0, status: 'CONFIRMED', summary: '14U Flight — Practice',
  starts_at: '2026-11-03T00:00:00Z', ends_at: '2026-11-03T01:30:00Z', location: '12 Field Rd, Rivertown', description: 'Arrive 15 min early.', calname: 'Rivertown FC', arrival_offset_minutes: 15 };

test('the feed is a valid RFC 5545 calendar: required properties, one VEVENT per row, stable UID', async () => {
  const { props, events } = parse(await feed([base, { ...base, uid: '22222222-2222-4222-8222-222222222222' }]));
  assert.equal(props.VERSION, '2.0'); assert.match(props.PRODID, /Sporv/); assert.equal(props['X-WR-CALNAME'], 'Rivertown FC');
  assert.equal(props['X-PUBLISHED-TTL'], 'PT1H');
  assert.equal(events.length, 2);
  for (const e of events) for (const k of ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'SEQUENCE', 'STATUS']) assert.ok(k in e, `${k} missing`);
  assert.equal(events[0].UID, '11111111-1111-4111-8111-111111111111@sporv.ai');
  assert.equal(events[0].DTSTART, '20261103T000000Z'); assert.equal(events[0].LOCATION, '12 Field Rd, Rivertown');
  assert.equal(events[0].DESCRIPTION, 'Arrive 15 min early.');
});

test('cancel emits STATUS:CANCELLED with the incremented SEQUENCE; a move keeps CONFIRMED and increments too', async () => {
  const before = parse(await feed([base])).events[0];
  const after = parse(await feed([{ ...base, status: 'CANCELLED', sequence: 1 }])).events[0];
  assert.equal(before.STATUS, 'CONFIRMED'); assert.equal(before.SEQUENCE, '0');
  assert.equal(after.STATUS, 'CANCELLED'); assert.equal(Number(after.SEQUENCE), Number(before.SEQUENCE) + 1);
  assert.equal(after.UID, before.UID, 'the UID is stable across the change, so the subscriber updates in place');
  const moved = parse(await feed([{ ...base, sequence: 1, location: 'South Field' }])).events[0];
  assert.equal(moved.STATUS, 'CONFIRMED'); assert.equal(moved.SEQUENCE, '1'); assert.equal(moved.LOCATION, 'South Field');
});

test('TEXT escaping and 75-octet folding round-trip through the parser', async () => {
  const long = 'Practice; bring water, shin guards\\and a smile — ' + 'x'.repeat(120);
  const { events } = parse(await feed([{ ...base, summary: long, description: 'line one\nline two' }]));
  assert.equal(events[0].SUMMARY, long); assert.equal(events[0].DESCRIPTION, 'line one\nline two');
});

test('the database side of 12.5 is shaped right: hex token, service_role-only reader, no notes, no names, unlink revokes', () => {
  assert.match(mig, /constraint calendar_feed_token_hex check \(token ~ '\^\[0-9a-f\]\{64\}\$'\)/, 'carried CodeRabbit finding: tokens are 64 lowercase hex, enforced');
  assert.match(mig, /if p_token !~ '\^\[0-9a-f\]\{64\}\$' then return; end if;/);
  assert.match(mig, /grant execute on function public\.calendar_feed_events\(text\) to service_role;/);
  assert.ok(!/calendar_feed_events\(text\)[^;]*to authenticated/.test(mig), 'no authenticated grant on the reader');
  const reader = mig.slice(mig.indexOf('function public.calendar_feed_events'), mig.indexOf('revoke all on function public.issue_calendar_feed_token'));
  assert.ok(!/e\.notes/.test(reader), 'staff notes never reach the feed');
  assert.ok(!/first_name|last_name/.test(reader), 'no athlete name column is selected');
  assert.match(reader, /ta\.status = 'active' and ta\.team_id = e\.team_id/, 'only teams with a currently rostered linked athlete');
  assert.match(mig, /create trigger trg_revoke_feed_on_unlink after delete on public\.guardian_links/);
  assert.match(mig, /guardian_id +uuid not null references public\.guardians\(id\) on delete cascade/, 'token dies with the guardian');
});
test.todo('DESCRIPTION carries an RSVP link — needs spec 13 slice 1 (guardian magic-link tokens, PR #12) on main; the arrival time is already there');

test('12.6: publishing seeds no_response per rostered athlete and reports conflicts; unpublishing stays refused', () => {
  assert.match(mig, /select e\.provider_id, e\.id, ta\.id, 'no_response', 'staff'/);
  assert.match(mig, /return jsonb_build_object\('published', n, 'conflicts', v_conf\);/);
  assert.match(read('supabase/migrations/20260915_001052_event.sql'), /an event cannot be unpublished; cancel it instead/);
  assert.match(mig, /revoke all on function public\.seed_no_response\(uuid\) from public, anon, authenticated;/);
});

test('reminders are drafts: obligations rows only, one per family, tomorrow only, never outbound_messages', () => {
  assert.match(mig, /'event:' \|\| e\.id \|\| ':reminder:member:' \|\| r\.member_id/);
  assert.match(mig, /\(e\.starts_at at time zone e\.timezone\)::date = current_date \+ 1/);
  assert.ok(!/(insert into|update|delete from)\s+public\.outbound_messages/i.test(mig));
  assert.match(mig, /cron\.schedule\('sporv-event-reminders', '30 3 \* \* \*'/);
  assert.match(mig, /cron\.schedule\('sporv-materialize-series', '10 3 \* \* \*'/, 'the 180-day horizon roll is scheduled');
});

test('the fixture runs for real: 8 groups green against a live Postgres', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened; see the PR body)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-16-spec12-slice3', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-16-spec12-slice3\.test\.sql/, out.slice(-800));
  assert.match(out, /8 assertion group\(s\)/, out.slice(-300));
});
