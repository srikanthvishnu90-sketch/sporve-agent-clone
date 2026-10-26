// tests/intake/intake-extract.spec.mjs — the deterministic forward-to-drafts
// extractor (src/mod-intake-extract.js), run as a pure function in node.
// The first case is the email that produced one truncated "Collect $175 — Hi
// coaches - ..." row on sporv.ai (2026-10-26); the other five are realistic
// variants: a gym's schedule change, a registration deadline, a camp priced
// per session, a multi-team entry with no per-athlete fee, and no amount.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../../src/mod-intake-extract.js', import.meta.url), 'utf8');
const sandbox = {}; vm.createContext(sandbox); vm.runInContext(src, sandbox);
const { extract } = sandbox.SporvIntakeExtract;
const CTX = { today: '2026-10-26', rosterCount: 8, familyCount: 8, missingWaivers: { count: 3, names: 'Nia O., Marcus B. and one more' } };
const plain = (x) => JSON.parse(JSON.stringify(x));
const kindsOf = (r) => plain(r.drafts.map((d) => d.kind));

test('tournament email: Collect $40 per athlete, Waiver, Event — every amount, date and time bound', () => {
  const r = extract('Hi coaches - Windy City Shootout, Nov 14-16 at Mount Prospect Sports Complex. Entry is $175 per team plus $40 per athlete, due Nov 3. Every athlete needs a signed liability waiver uploaded by Nov 10. Check-in opens 7:30am Saturday, first games 8:30am.', CTX);
  assert.deepEqual(kindsOf(r), ['fee', 'waiver', 'schedule']);
  assert.deepEqual(plain(r.facts.amounts), [{ cents: 17500, unit: 'team', unitWord: 'team', late: false }, { cents: 4000, unit: 'athlete', unitWord: 'athlete', late: false }]);
  assert.deepEqual(plain(r.facts.dates), [
    { purpose: 'event', start: '2026-11-14', end: '2026-11-16' },
    { purpose: 'payment', start: '2026-11-03', end: null },
    { purpose: 'waiver', start: '2026-11-10', end: null },
  ]);
  assert.deepEqual(plain(r.facts.times), [{ purpose: 'checkin', label: '7:30am Sat Nov 14' }, { purpose: 'start', label: '8:30am' }]);
  const [fee, waiver, ev] = r.drafts;
  assert.equal(fee.title, 'Collect $40 per athlete — Windy City Shootout, due Nov 3');
  assert.equal(fee.amountCents, 4000); assert.equal(fee.unit, 'athlete'); assert.equal(fee.dueISO, '2026-11-03');
  assert.match(fee.detail, /8 rostered athletes x \$40 = \$320/);
  assert.match(fee.detail, /Team entry \$175 per team is the club's fee to the organizer — noted here, not charged to families/);
  assert.deepEqual(plain(fee.unknown), ['who is attending — the total assumes all 8 rostered athletes']);
  assert.equal(waiver.title, 'Signed liability waiver for every athlete — Windy City Shootout, due Nov 10');
  assert.match(waiver.detail, /3 athletes with no waiver on file \(Nia O\., Marcus B\. and one more\)/);
  assert.deepEqual(plain(waiver.unknown), ['where to upload it — the text has no link']);
  assert.equal(ev.title, 'Windy City Shootout — Nov 14–16 at Mount Prospect Sports Complex');
  assert.equal(ev.startISO, '2026-11-14'); assert.equal(ev.endISO, '2026-11-16'); assert.equal(ev.location, 'Mount Prospect Sports Complex');
  assert.match(ev.detail, /^Check-in 7:30am Sat Nov 14 · first games 8:30am\./);
  for (const d of r.drafts) assert.doesNotMatch(d.title, /Hi coaches|\.\.\.|…/);
});

test('gym schedule change: old slot, new slot and venue, plus the family message; no charge', () => {
  const r = extract('Northside Gym here: we need the main court Thursday Nov 5, so your 6:00-7:30pm practice is moved to Friday Nov 6, 7:00-8:30pm in the auxiliary gym. Sorry for the short notice.', CTX);
  assert.deepEqual(kindsOf(r), ['schedule', 'message']);
  assert.equal(r.drafts[0].title, 'Schedule change: Thu Nov 5, 6:00–7:30pm practice moves to Fri Nov 6, 7:00–8:30pm in the auxiliary gym');
  assert.equal(r.drafts[1].title, 'Tell families: Practice moves to Fri Nov 6, 7:00–8:30pm in the auxiliary gym');
  assert.match(r.drafts[1].detail, /8 rostered families — nothing sends until you approve/);
  assert.ok(!r.drafts.some((d) => d.amountCents != null));
  // a weekday that contradicts its date is reported, never silently "fixed"
  const bad = extract('Your Thursday Nov 6 practice is moved to Saturday Nov 8 at 10am.', CTX);
  assert.ok(bad.drafts[0].unknown.some((u) => /Thursday Nov 6, but Nov 6 2026 is a Friday/.test(u)), JSON.stringify(bad.drafts[0].unknown));
});

test('registration deadline: per-player fee due at registration close, late fee kept apart, dated deadline', () => {
  const r = extract('Spring League registration closes March 1. The fee is $120 per player for the season; registrations after March 1 add a $25 late fee. Register at springleague.org.', CTX);
  assert.deepEqual(kindsOf(r), ['fee', 'deadline']);
  assert.equal(r.drafts[0].title, 'Collect $120 per player — Spring League, by Mar 1 (registration closes)');
  assert.equal(r.drafts[0].amountCents, 12000); assert.equal(r.drafts[0].dueISO, '2027-03-01');
  assert.match(r.drafts[0].detail, /Late fee in the text: \$25 — not drafted/);
  assert.equal(r.drafts[1].title, 'Registration closes Mar 1 — Spring League');
});

test('camp priced per session: per-session collect with the full-run total, recurring weekday, bundle noted', () => {
  const r = extract('Summer Shooting Camp runs 6 sessions, Tuesdays June 9 - July 14, 5-6:30pm at Lakeview Fieldhouse. Cost is $25 per session or $130 for all six, payable by June 1.', CTX);
  assert.deepEqual(kindsOf(r), ['fee', 'schedule']);
  assert.equal(r.drafts[0].title, 'Collect $25 per session — Summer Shooting Camp, due Jun 1');
  assert.match(r.drafts[0].detail, /6 sessions x \$25 = \$150 per athlete for the full run/);
  assert.match(r.drafts[0].detail, /Also in the text: \$130 with no unit stated/);
  assert.equal(r.drafts[1].title, 'Summer Shooting Camp — Jun 9–Jul 14 at Lakeview Fieldhouse');
  assert.match(r.drafts[1].detail, /^Tuesdays 5–6:30pm\./);
});

test('multiple teams, team fee only: club pays the organizer, no family charge, rosters deadline', () => {
  const r = extract("Holiday Hoops Classic, Dec 19-21 at Rolling Meadows HS. Entry is $350 per team. We're bringing our 14U and 16U teams. Rosters due Dec 1, payment due Dec 10.", CTX);
  assert.deepEqual(kindsOf(r), ['deadline', 'schedule', 'deadline']);
  assert.ok(!r.drafts.some((d) => d.kind === 'fee'), 'a team fee is never drafted as a family charge');
  assert.equal(r.drafts[0].title, 'Pay $350 per team entry — Holiday Hoops Classic, due Dec 10');
  assert.match(r.drafts[0].detail, /2 teams \(14U, 16U\) x \$350 = \$700 owed by the club to the organizer/);
  assert.match(r.drafts[0].detail, /No per-athlete amount in the text, so no family charge was drafted/);
  assert.equal(r.drafts[1].title, 'Holiday Hoops Classic — Dec 19–21 at Rolling Meadows HS');
  assert.ok(r.drafts[1].unknown.includes('check-in or start time'));
  assert.equal(r.drafts[2].title, 'Rosters due Dec 1 — Holiday Hoops Classic');
});

test('no amount: a schedule item, never a charge, and the card says what is missing', () => {
  const r = extract('Reminder: team photos are Saturday at 9am at Northside Community Gym. Wear home jerseys.', CTX);
  assert.deepEqual(kindsOf(r), ['schedule']);
  assert.equal(r.drafts[0].title, 'Team photos — Saturday 9am at Northside Community Gym');
  assert.ok(r.drafts[0].unknown.includes('the exact date — only a weekday is given'));
  assert.ok(!r.drafts.some((d) => d.amountCents != null));
  const none = extract('Thanks for a great season everyone, see you in the spring!', CTX);
  assert.deepEqual(kindsOf(none), ['message']);
  assert.equal(none.drafts[0].title, 'Review this message — no fee, form, event or date found');
  assert.equal(extract("   ", CTX).drafts.length, 0);
});
