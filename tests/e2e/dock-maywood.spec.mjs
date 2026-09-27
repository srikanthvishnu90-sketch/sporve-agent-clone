// tests/e2e/dock-maywood.spec.mjs — chatbox layout + palette contract.
//
// Direction history: 2026-09-27 began as a Maywood format copy (serif
// wordmark etc.), then the owner sent a reference screenshot and clarified:
// "dont make the chatbox an overlay, but rather a backportion of the screen."
// So on desktop (>=1280, coach portal) the chatbox is a permanent right-hand
// LAYOUT COLUMN — nav | content | chat as real flex siblings, never a
// floating overlay — with the reference's widths (~24% viewport), large
// rounded bubbles, and pill status chips. COLOURS stay Sporv's ORIGINAL dark
// palette throughout. This spec pins that contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session } from './fake-supabase.mjs';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

async function boot(chat, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 } });
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

const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}, sel);

test('the chatbox is a layout column, never an overlay, on desktop', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const pos = await css(page, '.aipill.aidock-col', 'position');
  assert.equal(pos, 'sticky', `dock column is sticky (in-flow), not fixed overlay — got ${pos}`);
  const col = await rect(page, '.aipill.aidock-col');
  const app = await rect(page, '#app');
  assert.ok(col.left >= app.right - 1, `column starts at/beyond #app right edge (no overlap): col.left=${col.left} app.right=${app.right}`);
  assert.ok(app.right <= 1440, `#app does not run under the column: app.right=${app.right}`);
  const ratio = col.width / 1440;
  assert.ok(ratio >= 0.22 && ratio <= 0.27, `column is ~24% of viewport width, got ${(ratio * 100).toFixed(1)}%`);
  assert.ok(Math.abs(col.height - 900) <= 2, `column is full viewport height, got ${col.height}`);
});

test('collapsing the chatbox returns its space to the dashboard', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const wide = (await rect(page, '#app')).width;
  await page.evaluate(() => { S.aiOpen = false; render(); });
  await page.waitForSelector('.aidock-launch', { timeout: 10000 });
  assert.equal(await page.locator('.aipill.aidock-col').count(), 0, 'column is gone when collapsed');
  const full = (await rect(page, '#app')).width;
  assert.ok(full > wide + 200, `#app expands when the column collapses (was ${wide}, now ${full})`);
  // the launcher re-opens the column
  await page.click('.aidock-launch');
  await page.waitForSelector('.aipill.aidock-col', { timeout: 10000 });
  assert.equal(await css(page, '.aipill.aidock-col', 'position'), 'sticky', 're-opened as a layout column');
});

test('on mobile the chatbox stays a bottom sheet overlay', async (t) => {
  const { ctx, page } = await boot(undefined, { width: 390, height: 844 }); t.after(() => ctx.close());
  const pos = await css(page, '.aipill.aidock-col', 'position');
  assert.equal(pos, 'fixed', `mobile keeps the bottom-sheet overlay — got ${pos}`);
});

test('bubbles are large and generously rounded per the reference', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const radius = await css(page, '.aidock-panel .bub.me', 'borderRadius');
  assert.ok(radius.startsWith('24px'), `bubble radius is 24px, got ${radius}`);
  const padTop = await css(page, '.aidock-panel .bub.me', 'paddingTop');
  assert.equal(padTop, '16px', `bubble padding is comfortable, got ${padTop}`);
});

test('the panel is Sporv charcoal, flat, and the dashboard chrome stays black', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const panelBg = await css(page, '.aidock-panel', 'backgroundColor');
  assert.equal(panelBg, 'rgb(10, 12, 15)', `panel ground is Sporv charcoal #0A0C0F, got ${panelBg}`);
  const shadow = await css(page, '.aidock-panel', 'boxShadow');
  assert.ok(!/rgba\(148, 163, 184/.test(shadow) && !/rgba\(71, 85, 105/.test(shadow), `no slate glow on the panel, got ${shadow}`);
  const dashCard = await css(page, '.stat, .dash .card, .card', 'backgroundColor');
  assert.ok(dashCard === null || !/19, 40, 63/.test(dashCard), `dashboard chrome is not navy, got ${dashCard}`);
});

test('the wordmark is clean sans and sentence case', async (t) => {
  const { ctx, page } = await boot([]); t.after(() => ctx.close());
  const face = await css(page, '.aidock-head .aidock-head-t', 'fontFamily');
  assert.ok(!/Georgia/i.test(face), `header wordmark is clean sans (serif retired per reference), got ${face}`);
  const transform = await css(page, '.aidock-head .aidock-head-t', 'textTransform');
  assert.equal(transform, 'none', 'wordmark is sentence case, not uppercase');
  const emptyFace = await css(page, '.aidock-empty-coach h3', 'fontFamily');
  assert.ok(!/Georgia/i.test(emptyFace), `empty-state greeting is clean sans, got ${emptyFace}`);
});

test('bubbles carry the Sporv palette with readable text', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const me = await css(page, '.aidock-panel .bub.me', 'backgroundColor');
  const them = await css(page, '.aidock-panel .bub.them', 'backgroundColor');
  assert.equal(me, 'rgb(62, 76, 90)', `user bubble is slate #3E4C5A, got ${me}`);
  assert.equal(them, 'rgb(27, 33, 41)', `assistant bubble is charcoal #1B2129, got ${them}`);
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

test('the composer is flat slate with no glow, and the launcher is static', async (t) => {
  const { ctx, page } = await boot(); t.after(() => ctx.close());
  const composeBg = await css(page, '.aidock-compose', 'backgroundColor');
  assert.equal(composeBg, 'rgb(62, 76, 90)', `composer is slate #3E4C5A, got ${composeBg}`);
  const composeShadow = await css(page, '.aidock-compose', 'boxShadow');
  assert.ok(composeShadow === 'none' || /0px 0px 0px/.test(composeShadow), `composer has no glow, got ${composeShadow}`);
  await page.evaluate(() => { S.aiOpen = false; render(); });
  const launchBg = await css(page, '.aidock .aidock-launch', 'backgroundColor');
  assert.equal(launchBg, 'rgb(32, 38, 46)', `launcher is Sporv grey #20262E, got ${launchBg}`);
  const anim = await css(page, '.aidock .aidock-launch', 'animationName');
  assert.ok(anim === 'none' || anim === '', `launcher pulse is retired, got ${anim}`);
  // the launcher still opens the dock — behaviour preserved
  await page.click('.aidock .aidock-launch');
  assert.equal(await page.locator('.aidock-panel').count(), 1, 'launcher still opens the panel');
});
