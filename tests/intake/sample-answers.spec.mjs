// tests/intake/sample-answers.spec.mjs — the signed-out preview assistant's
// deterministic responder (src/mod-sample-answers.js), as a pure function.
// Every answer carries the sample-workspace label and is built only from the
// snapshot it is given; an unknown question gets suggestions, not a guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../../src/mod-sample-answers.js', import.meta.url), 'utf8');
const sandbox = {}; vm.createContext(sandbox); vm.runInContext(src, sandbox);
const { answer, LABEL } = sandbox.SporvSampleAnswers;
const SNAP = {
  team: 'Northside Flight 14U', monthlyFee: 295, today: '2026-08-03',
  roster: [
    { name: 'Julian Mercer', paid: true, available: true }, { name: 'Aarav Raman', paid: true, available: false },
    { name: 'Ida Nilsen', paid: false, available: true, guardian: 'Tomas Nilsen' }, { name: 'Eli Carter', paid: false, available: true, guardian: 'Jordan Carter' },
  ],
  queue: [
    { kind: 'fee', status: 'draft', title: 'Collect $150 Fall Classic entry — 8 families', detail: '' },
    { kind: 'waiver', status: 'draft', title: '3 athletes missing a signed waiver', detail: 'Nia O., Marcus B. and one more have no waiver on file.' },
    { kind: 'schedule', status: 'draft', title: 'Schedule conflict — Sat 10:00 gym double-booked', detail: 'Drafted a move to 11:30.' },
    { kind: 'fee', status: 'approved', title: 'Already approved — not waiting', detail: '' },
  ],
  events: [
    { date: '2026-08-04', time: '9:00 AM', title: '14U tryout', place: '' },
    { date: '2026-08-05', time: '6:00 PM–7:30 PM', title: 'Practice', place: 'Northside Community Gym' },
    { date: '2026-08-20', time: '6:00 PM', title: 'Out of range', place: '' },
  ],
  recruits: [
    { name: 'Sam Okafor', stage: 'offer', position: 'ST', gradYear: 2026, overall: 4.6 },
    { name: 'Maya Torres', stage: 'visit', position: 'GK', gradYear: 2027, overall: 4.4 },
    { name: 'Noah Patel', stage: 'signed', position: 'W', gradYear: 2026, overall: 5 },
  ], recruitSport: 'soccer',
};

test('every answer starts with the sample-workspace label', () => {
  for (const q of ['Which families owe money and how much?', 'roster?', 'what is the capital of France']) assert.ok(answer(q, SNAP).text.startsWith(LABEL + '\n\n'));
  assert.equal(LABEL, 'Sample workspace — this answer comes from the example data, not the AI. Sign in to ask about your own program.');
});
test('dues: unpaid families with amounts and the total, plus fee drafts still waiting', () => {
  const a = answer('Which families owe money and how much?', SNAP);
  assert.deepEqual([...a.intents], ['dues']);
  assert.match(a.text, /2 of 4 families are unpaid on the \$295 monthly team fee — \$590 outstanding/);
  assert.match(a.text, /- Ida Nilsen \(guardian Tomas Nilsen\): \$295/);
  assert.match(a.text, /- Collect \$150 Fall Classic entry — 8 families \(\$1,200 if approved\)/);
  assert.doesNotMatch(a.text, /Already approved/);
});
test('waivers, conflicts, roster, recruits, schedule each answer from the snapshot', () => {
  assert.match(answer('Who is missing a waiver?', SNAP).text, /3 athletes missing a signed waiver: Nia O\./);
  assert.match(answer('any double-bookings?', SNAP).text, /Schedule conflict — Sat 10:00 gym double-booked/);
  const r = answer('How many athletes are on the roster?', SNAP).text;
  assert.match(r, /4 athletes on the sample roster/); assert.match(r, /Available: 3 \(unavailable: Aarav Raman\)/); assert.match(r, /Paid: 2, unpaid: 2/);
  const k = answer('who are my top recruits?', SNAP).text;
  assert.match(k, /3 prospects, 2 still active/); assert.match(k, /1\. Sam Okafor — ST, class of 2026, offer stage, 4\.60/); assert.doesNotMatch(k, /Noah Patel/);
  const w = answer("what's on this week?", SNAP).text;
  assert.match(w, /Tue Aug 4, 9:00 AM 14U tryout/); assert.match(w, /Wed Aug 5, 6:00 PM–7:30 PM Practice — Northside Community Gym/);
  assert.doesNotMatch(w, /Out of range/); assert.match(w, /Heads up: the Queue also flags schedule conflict/);
  const t = answer('anything today?', SNAP).text;
  assert.match(t, /Today in the sample calendar \(Mon Aug 3\):\*\* nothing scheduled/); assert.match(t, /Next up: Tue Aug 4, 9:00 AM 14U tryout/);
});
test('unknown question: an honest line and three suggestions it can answer, no marketplace copy', () => {
  const a = answer('Should I raise prices next year?', SNAP);
  assert.equal(a.intents.length, 0);
  assert.match(a.text, /can only answer a few questions from its example data/);
  assert.match(a.text, /- Which families owe money and how much\?\n- Who is missing a waiver\?\n- What's on the schedule this week\?$/);
  for (const q of ['Should I raise prices next year?', 'Which families owe money and how much?']) assert.doesNotMatch(answer(q, SNAP).text, /background check|waitlist|catalogue/i);
});
