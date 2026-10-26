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
  assert.match(m.text, /2 of 8 families are unpaid on the \$295 monthly team fee — \$590 outstanding/);
  assert.match(m.text, /Ida Nilsen \(guardian Tomas Nilsen\): \$295/);
  assert.match(m.text, /Eli Carter \(guardian Jordan Carter\): \$295/);
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
  assert.match(w.text, /3 athletes missing a signed waiver/); assert.match(w.text, /Nia O\., Marcus B\./);
  const c = await ask(page, 'Any schedule conflicts?');
  assert.match(c.text, /Sat 10:00 gym double-booked/);
  const r = await ask(page, 'How many athletes are on my roster?');
  assert.match(r.text, /8 athletes on the sample roster/); assert.match(r.text, /unavailable: Aarav Raman/);
  const k = await ask(page, 'Rank my top recruits');
  assert.match(k.text, /1\. Sam Okafor — ST, class of 2026, offer stage, 4\.60/);
  const wk = await ask(page, "What's on the schedule this week?");
  assert.match(wk.text, /This week in the sample calendar/); assert.match(wk.text, /Practice — Northside Community Gym/);
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
  assert.match(fee.detail, /8 rostered athletes x \$40 = \$320/); assert.match(fee.detail, /Team entry \$175 per team .* not charged to families/);
  assert.equal(waiver.kind, 'waiver'); assert.equal(waiver.title, 'Signed liability waiver for every athlete — Windy City Shootout, due Nov 10');
  assert.match(waiver.detail, /3 athletes with no waiver on file \(Nia O\., Marcus B\. and one more\)/);
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
