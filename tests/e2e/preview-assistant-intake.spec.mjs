// tests/e2e/preview-assistant-intake.spec.mjs — two defects found live on
// sporv.ai (2026-10-26) in the signed-out coach preview ("Northside Flight
// Basketball" sample workspace), pinned against the built page:
//   1. The dock answered "Which families owe money and how much?" with the
//      retired family-marketplace fallback ("No coach has cleared a background
//      check yet ... Join the waitlist"). It must answer from the sample data,
//      with the sample-workspace label, and never call a model.
//   2. "Turn into drafts" turned a tournament email into one truncated
//      "Collect $175 — Hi coaches - ..." row. It must produce the Collect
//      ($40 per athlete, due Nov 3), Waiver (due Nov 10) and Event drafts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
const EMAIL = 'Hi coaches - Windy City Shootout, Nov 14-16 at Mount Prospect Sports Complex. Entry is $175 per team plus $40 per athlete, due Nov 3. Every athlete needs a signed liability waiver uploaded by Nov 10. Check-in opens 7:30am Saturday, first games 8:30am.';
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

async function guest(tab) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = [], fns = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://aveqjeafghmwafkbbnor.supabase.co/**', (r) => { if (/functions\/v1\//.test(r.request().url())) fns.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  await page.route('**/api/ai**', (r) => { fns.push(r.request().url()); return r.fulfill({ status: 500, body: '{}' }); });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && typeof render === 'function' && !!window.SporvSampleAnswers && !!window.SporvIntakeExtract);
  await page.evaluate((t) => { enterCoachPortal(); if (t) S.coachTab = t; render(); }, tab);
  return { ctx, page, errors, fns };
}
async function ask(page, q) {
  const before = await page.evaluate(() => S.chat.length);
  await page.waitForSelector('#aiDockInput');
  await page.fill('#aiDockInput', q); await page.press('#aiDockInput', 'Enter');
  await page.waitForFunction((n) => !S.chatThinking && S.chat.length >= n + 2, before, { timeout: 8000 });
  return page.evaluate(() => S.chat[S.chat.length - 1]);
}

test('preview dock: a dues question is answered from the sample roster, labelled, with no model call', async () => {
  const { ctx, page, errors, fns } = await guest('dashboard');
  assert.equal(await page.evaluate(() => isCoachGuest()), true, 'signed-out preview');
  const m = await ask(page, 'Which families owe money and how much?');
  assert.ok(m.sample, 'marked as a sample answer');
  assert.match(m.text, /^Sample workspace — this answer comes from the example data, not the AI\. Sign in to ask about your own program\./);
  assert.match(m.text, /3 families are overdue, \$800 in total/);
  assert.match(m.text, /Jordan Carter \(Eli Carter, 14U\): \$400, 33 days late/);
  assert.match(m.text, /Tomas Nilsen \(Ida Nilsen, 14U\): \$200/);
  assert.match(m.text, /Keisha Bell \(Marcus Bell, 16U\): \$200/);
  assert.match(m.text, /\$4,800 of \$8,400 billed has been collected/);
  assert.match(m.text, /Collect \$150 Fall Classic entry — 8 families \(\$1,200 if approved\)/);
  assert.doesNotMatch(m.text, /background check|waitlist|catalogue/i);
  const bubble = await page.locator('.aidock .bub.them, .bub.them').last().innerText();
  assert.match(bubble, /Sample workspace/); assert.doesNotMatch(bubble, /background check|waitlist/i);
  assert.equal(fns.length, 0, 'no edge function or /api/ai call: ' + fns.join(', '));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('preview dock: waivers, conflicts, roster and recruits answer from the same sample records; unknowns get suggestions', async () => {
  const { ctx, page } = await guest('dashboard');
  const w = await ask(page, 'Who is missing a waiver?');
  assert.match(w.text, /3 athletes have no signed waiver on file/); assert.match(w.text, /Nia Okafor \(14U[\s\S]*Marcus Bell \(16U[\s\S]*Owen Kowalski \(16U/);
  const c = await ask(page, 'Any schedule conflicts?');
  assert.match(c.text, /10:00 AM 16U practice at Northside Community Gym/); assert.match(c.text, /Sat 10:00 gym double-booked/);
  const r = await ask(page, 'How many athletes are on my roster?');
  assert.match(r.text, /14 athletes across 14U and 16U/); assert.match(r.text, /Northside Flight 16U: 6 athletes/);
  const k = await ask(page, 'Rank my top recruits');
  assert.match(k.text, /sample basketball board/); assert.match(k.text, /1\. Sam Okafor — SF, class of 2026, offer stage, 4\.60/);
  const wk = await ask(page, "What's on the schedule this week?");
  assert.match(wk.text, /This week in the sample calendar/); assert.match(wk.text, /14U practice — Northside Community Gym/); assert.match(wk.text, /14U vs\. Westside Hoops/);
  const u = await ask(page, 'What is the weather on Saturday in Denver?');
  assert.match(u.text, /^Sample workspace/); assert.match(u.text, /Which families owe money and how much\?/);
  for (const m of [w, c, r, k, wk, u]) assert.doesNotMatch(m.text, /background check|waitlist/i);
  await ctx.close();
});

test('forward box: the tournament email becomes Collect $40 per athlete, Waiver and Event drafts', async () => {
  const { ctx, page, errors } = await guest('queue');
  await page.waitForSelector('#obligIn');
  await page.fill('#obligIn', EMAIL); await page.click('[data-oblig-parse]');
  await page.waitForFunction(() => (S.obligations || []).some((o) => o.parsed));
  const parsed = await page.evaluate(() => S.obligations.filter((o) => o.parsed).map((o) => ({ kind: o.kind, title: o.title, status: o.status, amountCents: o.amountCents, dueISO: o.dueISO, detail: o.detail, unknown: o.unknown })));
  assert.equal(parsed.length, 3, JSON.stringify(parsed, null, 1));
  const [fee, waiver, ev] = parsed;
  assert.equal(fee.kind, 'fee'); assert.equal(fee.title, 'Collect $40 per athlete — Windy City Shootout, due Nov 3');
  assert.equal(fee.amountCents, 4000); assert.match(fee.dueISO, /-11-03$/);
  assert.match(fee.detail, /8 athletes on the 14U roster x \$40 = \$320/);
  assert.ok(fee.unknown.includes('which team — the text names none, so the 14U roster is used')); assert.match(fee.detail, /Team entry \$175 per team .* not charged to families/);
  assert.equal(waiver.kind, 'waiver'); assert.equal(waiver.title, 'Signed liability waiver for every athlete — Windy City Shootout, due Nov 10');
  assert.match(waiver.detail, /Your 14U roster already has 1 athlete with no waiver on file \(Nia O\.\)/);
  assert.equal(ev.kind, 'schedule'); assert.equal(ev.title, 'Windy City Shootout — Nov 14–16 at Mount Prospect Sports Complex');
  assert.match(ev.detail, /Check-in 7:30am Sat Nov 14 · first games 8:30am/);
  for (const d of parsed) { assert.equal(d.status, 'draft'); assert.doesNotMatch(d.title, /Hi coaches/); }
  // the cards render the reading, the "could not determine" line and Approve / Dismiss
  const html = await page.locator('.qcard').filter({ hasText: 'Windy City Shootout' }).allInnerTexts();
  assert.equal(html.length, 3);
  assert.ok(html.every((t) => /Approve/.test(t) && /Dismiss/.test(t)));
  assert.ok(html.some((t) => /Could not determine: who is attending/.test(t)));
  assert.ok(html.some((t) => /\$40/.test(t)));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('one sample model: Money, Clients, Teams, Home, Schedule, Queue, the assistant and the dock chip agree', async () => {
  const { ctx, page, errors } = await guest('dashboard');
  const m = await page.evaluate(() => MOD_PREVIEW.model());
  // the model itself: 14 athletes, 3 overdue families, $800 overdue, $4,800 of $8,400 collected
  assert.equal(m.roster.length, 14); assert.deepEqual(m.teams.map((t) => [t.short, t.count]), [['14U', 8], ['16U', 6]]);
  assert.equal(m.totals.overdue, 800); assert.equal(m.totals.collected, 4800); assert.equal(m.totals.billed, 8400);
  assert.deepEqual(m.overdue.map((a) => a.guardian + ':' + a.owed), ['Jordan Carter:400', 'Tomas Nilsen:200', 'Keisha Bell:200']);
  assert.deepEqual(m.missingWaivers.map((a) => a.initial), ['Nia O.', 'Marcus B.', 'Owen K.']);
  const usd = (n) => '$' + n.toLocaleString('en-US');
  // Money tab renders the same totals and the same families
  await page.evaluate(() => { S.coachTab = 'finances'; render(); });
  const money = await page.locator('#app').innerText();
  assert.ok(money.includes(usd(m.totals.collected)) && money.includes('of ' + usd(m.totals.billed)), 'collected/billed');
  assert.ok(money.includes(usd(m.totals.overdue)) && money.includes(m.totals.overdueFamilies + ' families past due'), 'overdue');
  for (const a of m.overdue) assert.ok(money.includes(a.guardian), a.guardian);
  // Clients tab: the same paid / overdue / waiver status per athlete
  await page.evaluate(() => { S.coachTab = 'roster'; render(); });
  const clients = await page.locator('#app').innerText();
  for (const a of m.roster) assert.ok(clients.includes(a.name), a.name);
  assert.equal((clients.match(/Overdue \$/g) || []).length, m.overdue.length, 'overdue badges = overdue families');
  assert.equal((clients.match(/\bMissing\b/g) || []).length, m.missingWaivers.length, 'missing badges = missing waivers');
  // Home stats and Schedule count
  await page.evaluate(() => { S.coachTab = 'dashboard'; render(); });
  const home = await page.locator('#app').innerText();
  assert.match(home, new RegExp('Athletes\\s+' + m.roster.length)); assert.match(home, new RegExp('Upcoming events\\s+' + m.events.length));
  assert.ok(home.includes(usd(m.totals.overdue) + ' overdue'));
  assert.ok(await page.locator('text=What\'s on the schedule this week?').count() >= 1, 'club chip on Home');
  assert.equal(await page.locator("text=Who's booked this week?").count(), 0);
  assert.equal(await page.evaluate(() => MOD_PREVIEW.eventCount()), m.events.length);
  // Queue sample drafts name the same people and counts
  const q = await page.evaluate(() => obligationQueue().map((o) => ({ id: o.id, title: o.title, detail: o.detail })));
  const ob2 = q.find((o) => o.id === 'ob_2');
  assert.equal(ob2.title, m.missingWaivers.length + ' athletes missing a signed waiver');
  assert.match(ob2.detail, /Nia O\. \(14U\), Marcus B\. \(16U\) and Owen K\. \(16U\)/);
  assert.match(q.find((o) => o.id === 'ob_1').title, new RegExp('— ' + m.teams[0].count + ' families$'));
  // the assistant's dues answer: same total, same families, same order
  const dues = await ask(page, 'Which families owe money and how much?');
  assert.match(dues.text, new RegExp(m.overdue.length + ' families are overdue, \\' + usd(m.totals.overdue) + ' in total'));
  const listed = [...dues.text.matchAll(/^- (.+?) \(/gm)].map((x) => x[1]).filter((g) => !/^Collect/.test(g));
  assert.deepEqual(listed, m.overdue.map((a) => a.guardian));
  const owed = [...dues.text.matchAll(/\): \$(\d+),/g)].reduce((t, x) => t + +x[1], 0);
  assert.equal(owed, m.totals.overdue, 'listed amounts sum to the Money overdue total');
  // the Home chip has a working sample answer
  await page.click('[data-aichip="What\'s on the schedule this week?"]');   // the chip fills the box; Enter sends
  assert.equal(await page.inputValue('#aiDockInput'), "What's on the schedule this week?");
  await page.press('#aiDockInput', 'Enter');
  await page.waitForFunction(() => !S.chatThinking && /This week in the sample calendar/.test(S.chat[S.chat.length - 1].text || ''), null, { timeout: 8000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});
