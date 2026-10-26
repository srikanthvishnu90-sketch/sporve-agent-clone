// tests/e2e/assistant-retry.spec.mjs — incident 2026-10-22: the coach assistant
// failed hard on any non-200. The dock now (a) retries ONCE automatically when
// the server proves nothing ran (503 busy, or 429 with a short retry_after),
// showing "Still working, retrying" while it waits, and (b) tells the coach
// which failure it was — plan allowance (402, no retry, See plans), busy,
// signed out, offline — keeping the data-airetry "Try again" button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, SUPABASE } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

/* `answers` is consumed one per coach-command POST: [status, body, headers?]. */
async function boot(answers) {
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); await mount(page, freshDb({ onboarded: true, name: 'Rivertown FC' }));
  const calls = [];
  // Registered AFTER mount, so Playwright matches it first for this one function.
  await page.route(`${SUPABASE}/functions/v1/coach-command`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    calls.push({ at: Date.now(), body: JSON.parse(route.request().postData() || '{}') });
    const [status, body, headers] = answers[Math.min(calls.length - 1, answers.length - 1)];
    return route.fulfill({ status, contentType: 'application/json', headers: headers || {}, body: JSON.stringify(body) });
  });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider && S.route?.name === 'dashboard', null, { timeout: 15000 });
  await page.waitForSelector('#aiDockInput', { timeout: 10000 });
  return { ctx, page, calls };
}
async function ask(page, q) {
  await page.fill('#aiDockInput', q); await page.press('#aiDockInput', 'Enter');
}
const settled = (page) => page.waitForFunction(() => !S.chatThinking && (S.chat || []).some((m) => m.role !== 'user'), null, { timeout: 20000 });
const lastMsg = (page) => page.evaluate(() => { const m = S.chat[S.chat.length - 1]; return { err: !!m.err, retry: m.retry || null, text: m.text, nav: m.nav || null }; });

test('429 (short retry_after) then 200: retries once, shows the retrying state, renders the answer', async () => {
  const { ctx, page, calls } = await boot([
    [429, { error: 'Too many assistant requests.', reason: 'rate_limited', retry_after: 1 }, { 'Retry-After': '1' }],
    [200, { intent: 'read', reply_text: 'You have 3 sessions this week.', tool_calls: [], needs_confirmation: false, confidence: 0.9 }],
  ]);
  await ask(page, "What's on my schedule this week?");
  await page.waitForSelector('[data-airetrying="1"]', { timeout: 5000 });
  assert.match(await page.locator('[data-airetrying="1"]').first().innerText(), /Still working, retrying/);
  await settled(page);
  assert.equal(calls.length, 2, 'exactly one automatic retry');
  assert.equal(calls[1].body.text, calls[0].body.text, 'the retry resends the same question');
  assert.ok(calls[1].at - calls[0].at >= 900, 'it waited for retry_after before retrying');
  const m = await lastMsg(page);
  assert.equal(m.err, false); assert.equal(m.text, 'You have 3 sessions this week.');
  assert.equal(await page.locator('[data-airetrying]').count(), 0, 'retrying caption is gone once answered');
  assert.equal(await page.evaluate(() => S.chat.filter((x) => x.role === 'user').length), 1, 'the question is not duplicated');
  await ctx.close();
});

test('503 twice: one retry, then honest "busy" copy with Try again', async () => {
  const { ctx, page, calls } = await boot([
    [503, { error: 'The AI service is busy right now.', reason: 'upstream_busy', retry_after: 1 }, { 'Retry-After': '1' }],
  ]);
  await ask(page, 'How many athletes are on my roster?');
  await settled(page);
  assert.equal(calls.length, 2, 'one automatic retry, never a loop');
  const m = await lastMsg(page);
  assert.ok(m.err); assert.match(m.text, /busy/); assert.ok(m.retry, 'Try again offered');
  assert.equal(await page.locator('[data-airetry]').count(), 1);
  await ctx.close();
});

test('402 plan allowance: no retry, says the allowance is used up, offers See plans not Try again', async () => {
  const { ctx, page, calls } = await boot([
    [402, { error: "This month's assistant allowance is used up.", reason: 'ai_quota_exhausted', current_plan: 'free', upgrade_to: 'pro', limit: 3, current: 3 }],
  ]);
  await ask(page, 'Draft a reminder for Saturday practice');
  await settled(page);
  await page.waitForTimeout(300);
  assert.equal(calls.length, 1, 'a plan limit is never auto-retried');
  const m = await lastMsg(page);
  assert.ok(m.err); assert.match(m.text, /allowance is used up/); assert.match(m.text, /3 of 3 on the Free plan/);
  assert.equal(m.retry, null); assert.equal(await page.locator('[data-airetry]').count(), 0);
  assert.deepEqual(m.nav, { tab: 'billing', label: 'See plans' });
  await ctx.close();
});

test('429 with a long retry_after is not auto-retried and says how long to wait', async () => {
  const { ctx, page, calls } = await boot([
    [429, { error: 'Too many assistant requests.', reason: 'rate_limited', retry_after: 40 }, { 'Retry-After': '40' }],
  ]);
  await ask(page, 'Who is booked tomorrow?');
  await settled(page);
  assert.equal(calls.length, 1);
  const m = await lastMsg(page);
  assert.match(m.text, /Try again in 40 seconds/); assert.ok(m.retry);
  await ctx.close();
});
