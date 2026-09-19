// tests/e2e/chat-duplicate.spec.mjs — regression: one assistant message must
// render exactly once in the DOM. A 2026-09-19 audit saw a single reply's
// text twice in raw DOM extraction (one visible bubble); the render layer
// must never duplicate a thread entry across #app/#layer or inside the dock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

test('an assistant message appears exactly once in the DOM', async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage();
  await mount(page, freshDb({ onboarded: true, name: 'Rivertown FC' }));
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  const MARK = 'DUPCHK_' + Date.now();
  await page.evaluate((mark) => {
    S.chat.push({ role: 'user', text: 'first touch drills?' });
    S.chat.push({ role: 'assistant', text: mark + ' do these three drills' });
    render();
  }, MARK);
  await page.waitForTimeout(400);
  const hits = await page.evaluate((mark) => document.body.innerHTML.split(mark).length - 1, MARK);
  assert.equal(hits, 1, `assistant text occurs ${hits}x in the DOM, expected exactly once`);
  const bubbles = await page.evaluate((mark) => [...document.querySelectorAll('.bub.them')]
    .filter((e) => e.textContent.includes(mark))
    .map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }), MARK);
  assert.equal(bubbles.length, 1, 'exactly one assistant bubble node in the DOM');
  assert.ok(bubbles[0], 'that bubble is the visible one, not a hidden copy');
  await ctx.close();
});
