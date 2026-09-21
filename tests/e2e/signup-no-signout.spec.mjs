/* Owner, 2026-09-18, "this is a must implement": signing up is for a brand-new
 * account, so the signup flow never shows a Sign out control — signed in or not.
 * And nothing in it renders under the site-wide 14px floor (design-rules,
 * owner 2026-09-19). Both regressed once already when main moved under the fix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;

async function signup(page) {
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && typeof render === 'function', null, { timeout: 15000 });
  await page.evaluate(() => { S.ob = { step: '1', email: '', providers: { google: true, apple: false } }; S.route = { name: 'setup', arg: null }; render(); });
  await page.waitForSelector('.ob', { timeout: 10000 });
}

test('signup never offers Sign out, and keeps one Back control that cannot trap', async () => {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    await signup(page);
    const st = await page.evaluate(() => {
      const root = document.querySelector('.ob');
      return { signout: /sign\s*out/i.test(root.innerText), attr: !!root.querySelector('[data-obsignout]'), back: root.querySelectorAll('.obout[data-obexit]').length };
    });
    assert.equal(st.signout, false, 'the words "Sign out" appear in signup');
    assert.equal(st.attr, false, 'a data-obsignout control still renders');
    assert.equal(st.back, 1, 'exactly one Back control');
    /* the template must not branch back to Sign out for an authenticated visitor */
    const src = await page.evaluate(() => document.documentElement.innerHTML.includes('data-obsignout'));
    assert.equal(src, false, 'the built page still carries a sign-out variant for signup');
  } finally { await browser.close(); }
});

test('no signup text renders under 14px at desktop or phone width', async () => {
  const browser = await chromium.launch();
  try {
    for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
      const page = await (await browser.newContext({ viewport: vp })).newPage();
      await signup(page);
      const small = await page.evaluate(() => {
        const out = [];
        for (const e of document.querySelector('.ob').querySelectorAll('*')) {
          if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const fs = parseFloat(getComputedStyle(e).fontSize);
          if (fs < 14) out.push(`${fs}px "${e.textContent.trim().slice(0, 20)}"`);
        }
        return out;
      });
      assert.deepEqual(small, [], `text under 14px at ${vp.width}px: ${small.join(', ')}`);
    }
  } finally { await browser.close(); }
});
