// tests/e2e/dock-maywood.spec.mjs — Maywood chatbox restyle (owner 2026-09-27).
//
// The chatbox — and only the chatbox — wears Maywood's institutional fintech
// language: deep navy ground, serif wordmark, flat restrained surfaces. This
// spec pins that contract in computed styles so a later palette edit can't
// silently drift the panel back to black/slate or reintroduce the glow, and
// so dashboard chrome outside the chatbox provably stays untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session } from './fake-supabase.mjs';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

async function boot(chat) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage();
  await mount(page, freshDb({ onboarded: true, name: 'Rivertown FC' }));
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider && S.route?.name === 'dashboard', null, { timeout: 15000 });
  await page.evaluate((c) => {
    S.portal = 'coach'; S.aiOpen = true; S.aiMax = false;
    S.chat = c !== undefined ? c : [
      { role: 'user', text: 'What needs my attention today?' },
      { role: 'ai', text: 'Two athletes have incomplete waiver forms for Saturday.' },
    ];
    render();
  }, chat);
  await page.waitForSelector('.aidock-panel', { timeout: 10000 });
  return { ctx, page };
}

const css = (page, sel, prop) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s); if (!el) return null;
  return getComputedStyle(el)[p];
}, [sel, prop]);

test('the panel is deep navy, flat, and the dashboard chrome stays black', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const panelBg = await css(page, '.aidock-panel', 'backgroundColor');
  assert.equal(panelBg, 'rgb(19, 40, 63)', `panel ground is Maywood navy, got ${panelBg}`);
  const shadow = await css(page, '.aidock-panel', 'boxShadow');
  assert.ok(!/rgba\(148, 163, 184/.test(shadow) && !/rgba\(71, 85, 105/.test(shadow), `no slate glow on the panel, got ${shadow}`);
  const dashCard = await css(page, '.stat, .dash .card, .card', 'backgroundColor');
  assert.ok(dashCard === null || !/19, 40, 63/.test(dashCard), `dashboard chrome is not navy, got ${dashCard}`);
});

test('the wordmark is serif and sentence case', async (t) => {
  const { ctx, page } = await boot([]); t.after(() => ctx.close());
  const face = await css(page, '.aidock-head .aidock-head-t', 'fontFamily');
  assert.ok(/Georgia/i.test(face), `header wordmark is serif, got ${face}`);
  const transform = await css(page, '.aidock-head .aidock-head-t', 'textTransform');
  assert.equal(transform, 'none', 'wordmark is sentence case, not uppercase');
  const empty = await css(page, '.aidock-empty-coach h3', 'textTransform');
  assert.equal(empty, 'none', 'empty-state greeting is sentence case, not uppercase');
  const emptyFace = await css(page, '.aidock-empty-coach h3', 'fontFamily');
  assert.ok(/Georgia/i.test(emptyFace), `empty-state greeting is serif, got ${emptyFace}`);
});

test('bubbles carry the navy palette with readable text', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const me = await css(page, '.aidock-panel .bub.me', 'backgroundColor');
  const them = await css(page, '.aidock-panel .bub.them', 'backgroundColor');
  assert.equal(me, 'rgb(44, 84, 128)', `user bubble is lifted navy, got ${me}`);
  assert.equal(them, 'rgb(29, 58, 88)', `assistant bubble is deep navy, got ${them}`);
  const ratios = await page.evaluate(() => {
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const a = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    const ratio = (fg, bg) => { const l1 = lum(fg), l2 = lum(bg); const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1]; return (a + 0.05) / (b + 0.05); };
    const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
    const fg = (sel) => getComputedStyle(document.querySelector(sel)).color;
    return {
      me: ratio(fg('.aidock-panel .bub.me'), bg('.aidock-panel .bub.me')),
      them: ratio(fg('.aidock-panel .bub.them'), bg('.aidock-panel .bub.them')),
      panel: ratio(fg('.aidock-panel .bub.them'), bg('.aidock-panel')),
    };
  });
  for (const [k, v] of Object.entries(ratios)) assert.ok(v >= 4.5, `${k} text clears 4.5:1 (got ${v.toFixed(2)})`);
});

test('the composer is flat navy with no glow, and the launcher is static navy', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const composeBg = await css(page, '.aidock-compose', 'backgroundColor');
  assert.equal(composeBg, 'rgb(26, 48, 73)', `composer is navy, got ${composeBg}`);
  const composeShadow = await css(page, '.aidock-compose', 'boxShadow');
  assert.ok(composeShadow === 'none' || /0px 0px 0px/.test(composeShadow), `composer has no glow, got ${composeShadow}`);
  await page.evaluate(() => { S.aiOpen = false; render(); });
  const launchBg = await css(page, '.aidock .aidock-launch', 'backgroundColor');
  assert.equal(launchBg, 'rgb(27, 58, 92)', `launcher is Maywood navy, got ${launchBg}`);
  const anim = await css(page, '.aidock .aidock-launch', 'animationName');
  assert.ok(anim === 'none' || anim === '', `launcher pulse is retired, got ${anim}`);
  // the launcher still opens the dock — behaviour preserved
  await page.click('.aidock .aidock-launch');
  assert.equal(await page.locator('.aidock-panel').count(), 1, 'launcher still opens the panel');
});
