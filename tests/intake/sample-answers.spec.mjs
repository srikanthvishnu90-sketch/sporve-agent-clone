// tests/intake/sample-answers.spec.mjs — the signed-out preview assistant's
// deterministic responder (src/mod-sample-answers.js), as a pure function.
// The snapshot is built from the REAL sample model (src/mod-preview.js
// MOD_PREVIEW.model()), the same one the Money, Clients, Teams, Home and
// Schedule pages render — so these numbers are the preview's numbers.
// Every answer carries the sample-workspace label; an unknown question gets
// suggestions, not a guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8');
const TODAY = '2026-08-03';
const dayAfter = (n) => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sb = { dayAfter }; sb.window = sb; vm.createContext(sb);
vm.runInContext(read('mod-preview.js'), sb); vm.runInContext(read('mod-sample-answers.js'), sb);
const { answer, LABEL } = sb.SporvSampleAnswers;
const model = JSON.parse(JSON.stringify(sb.MOD_PREVIEW.model()));
const SNAP = Object.assign({}, model, {
  today: TODAY,
  queue: [
    { kind: 'fee', status: 'draft', title: 'Collect $150 Fall Classic entry — 8 families', detail: '' },
    { kind: 'waiver', status: 'draft', title: '3 athletes missing a signed waiver', detail: '' },
    { kind: 'schedule', status: 'draft', title: 'Schedule conflict — Sat 10:00 gym double-booked', detail: 'Drafted a move to 11:30.' },
    { kind: 'fee', status: 'approved', title: 'Already approved — not waiting', detail: '' },
  ],
  recruits: [
    { name: 'Sam Okafor', stage: 'offer', position: 'SF', gradYear: 2026, overall: 4.6 },
    { name: 'Maya Torres', stage: 'visit', position: 'PG', gradYear: 2027, overall: 4.4 },
    { name: 'Noah Patel', stage: 'signed', position: 'SG', gradYear: 2026, overall: 5 },
  ], recruitSport: 'basketball',
});

test('every answer starts with the sample-workspace label', () => {
  for (const q of ['Which families owe money and how much?', 'roster?', 'what is the capital of France']) assert.ok(answer(q, SNAP).text.startsWith(LABEL + '\n\n'));
  assert.equal(LABEL, 'Sample workspace — this answer comes from the example data, not the AI. Sign in to ask about your own program.');
});
test('dues: the overdue families, amounts and totals of the sample model, plus fee drafts still waiting', () => {
  const a = answer('Which families owe money and how much?', SNAP);
  assert.deepEqual([...a.intents], ['dues']);
  assert.match(a.text, /3 families are overdue, \$800 in total/);
  assert.match(a.text, /- Jordan Carter \(Eli Carter, 14U\): \$400, 33 days late\n- Tomas Nilsen \(Ida Nilsen, 14U\): \$200, 12 days late\n- Keisha Bell \(Marcus Bell, 16U\): \$200, 12 days late/);
  assert.match(a.text, /\$4,800 of \$8,400 billed has been collected; \$2,800 is not yet due/);
  assert.match(a.text, /- Collect \$150 Fall Classic entry — 8 families \(\$1,200 if approved\)/);
  assert.doesNotMatch(a.text, /Already approved/);
});
test('waivers, conflicts, roster, recruits, schedule each answer from the model', () => {
  const w = answer('Who is missing a waiver?', SNAP).text;
  assert.match(w, /3 athletes have no signed waiver on file/);
  assert.match(w, /- Nia Okafor \(14U, guardian Renata Okafor\)\n- Marcus Bell \(16U, guardian Keisha Bell\)\n- Owen Kowalski \(16U, guardian Beth Kowalski\)/);
  const c = answer('any double-bookings?', SNAP).text;
  assert.match(c, /Sat Aug 8, 10:00 AM 16U practice at Northside Community Gym/); assert.match(c, /fix is drafted in the Queue: Schedule conflict/);
  const r = answer('How many athletes are on the roster?', SNAP).text;
  assert.match(r, /14 athletes across 14U and 16U/);
  assert.match(r, /Northside Flight 14U: 8 athletes, coach Marcus Vale, 6 of 8 paid to date, 1 waiver missing/);
  assert.match(r, /Northside Flight 16U: 6 athletes, coach Dana Ruiz, 5 of 6 paid to date, 2 waivers missing/);
  const k = answer('who are my top recruits?', SNAP).text;
  assert.match(k, /sample basketball board/); assert.match(k, /3 prospects, 2 still active/);
  assert.match(k, /1\. Sam Okafor — SF, class of 2026, offer stage, 4\.60/); assert.doesNotMatch(k, /Noah Patel/);
  const wk = answer("What's on the schedule this week?", SNAP).text;
  assert.match(wk, /Tue Aug 4, 6:00 PM 14U practice — Northside Community Gym/);
  assert.match(wk, /Sat Aug 8, 10:00 AM 16U practice — Northside Community Gym \(conflict\)/);
  assert.doesNotMatch(wk, /Fall Classic/, 'Sep 19 is outside this week');
  const t = answer('anything today?', SNAP).text;
  assert.match(t, /Today in the sample calendar \(Mon Aug 3\):\*\* nothing scheduled/); assert.match(t, /Next up: Tue Aug 4, 6:00 PM 14U practice/);
});
test('unknown question: an honest line and three suggestions it can answer, no marketplace copy', () => {
  const a = answer('Should I raise prices next year?', SNAP);
  assert.equal(a.intents.length, 0);
  assert.match(a.text, /can only answer a few questions from its example data/);
  assert.match(a.text, /- Which families owe money and how much\?\n- Who is missing a waiver\?\n- What's on the schedule this week\?$/);
  for (const q of ['Should I raise prices next year?', 'Which families owe money and how much?']) assert.doesNotMatch(answer(q, SNAP).text, /background check|waitlist|catalogue/i);
});
