// tests/e2e/dock.spec.mjs — audit 2026-09-17 P1-4, the half that is code: Enter
// in the Sporv AI dock sends the question. The audit watched /api/ai and saw
// nothing; the dock posts to the coach-command edge function (verified live
// 2026-09-18: HTTP 200, grounded replies). This pins the path and the loud
// failure when the function answers nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
async function boot() {
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const { log } = await mount(page, freshDb({ onboarded: true, name: 'Rivertown FC' }));
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider && S.route?.name === 'dashboard', null, { timeout: 15000 });
  await page.waitForSelector('#aiDockInput', { timeout: 10000 });
  return { ctx, page, log };
}
test('Enter in the dock sends the typed question to coach-command, once, with the text intact', async () => {
  const { ctx, page, log } = await boot();
  await page.fill('#aiDockInput', "What's on my schedule this week?"); await page.press('#aiDockInput', 'Enter');
  for (let i = 0; i < 50 && !log.some((l) => l.kind === 'fn' && l.fn === 'coach-command'); i++) await page.waitForTimeout(100);
  const calls = log.filter((l) => l.kind === 'fn' && l.fn === 'coach-command');
  assert.equal(calls.length, 1); assert.equal(calls[0].body.text, "What's on my schedule this week?"); assert.equal(await page.inputValue('#aiDockInput'), '', 'the box clears once sent');
  assert.equal(log.filter((l) => l.kind === 'fn' && l.fn === 'ai-chat').length, 0, 'the coach side never uses the family chat');
  await ctx.close();
});
test('an empty answer from the function is a loud failure with a retry, never a silent nothing', async () => {
  const { ctx, page } = await boot();   // the fake answers {} → no reply_text
  await page.fill('#aiDockInput', 'How many athletes are on my roster?'); await page.press('#aiDockInput', 'Enter');
  await page.waitForFunction(() => !S.chatThinking && (S.chat || []).some((m) => m.role !== 'user'), null, { timeout: 10000 });
  const last = await page.evaluate(() => { const m = S.chat[S.chat.length - 1]; return { err: !!m.err, retry: !!m.retry, text: m.text }; });
  assert.ok(last.err, 'marked as an error'); assert.ok(last.retry, 'offers retry'); assert.equal(await page.locator('[data-airetry]').count(), 1);
  await ctx.close();
});
