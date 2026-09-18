// tests/e2e/offline.spec.mjs — audit 2026-09-17 P2-3 and P2-4. A backend that
// cannot be reached keeps a signed-in person signed in, in their workspace,
// with a named state and a retry (never a guest on the marketing page); and
// the app opens with no network at all through the service worker's shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, SUPABASE } from './fake-supabase.mjs';
import { serve } from './serve.mjs';
let browser, site; test.before(async () => { browser = await chromium.launch(); site = await serve(); }); test.after(async () => { await browser?.close(); await site?.close(); });
async function boot(db, { block } = {}) {
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); await mount(page, db);
  const state = { blocked: !!block }; await page.route((u) => u.href.startsWith(SUPABASE + '/rest/'), (route) => (state.blocked ? route.abort('connectionfailed') : route.fallback()));
  await page.goto(site.index, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors, state, text: () => page.evaluate(() => document.body.innerText) };
}
test('backend unreachable on a cold boot: still signed in, in the workspace, told why, retry recovers', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  // first, one good boot writes the cached profile
  const warm = await boot(db); await warm.page.waitForFunction(() => S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  const cached = await warm.page.evaluate(() => localStorage.getItem('sporve:profile:v1')); assert.ok(cached && JSON.parse(cached).role === 'provider', cached);
  await warm.page.evaluate(() => sessionStorage.clear());   // a cold tab, not a restored snapshot
  // now the same device boots with every REST call dead
  warm.state.blocked = true;
  await warm.page.reload({ waitUntil: 'domcontentloaded' });
  await warm.page.waitForFunction(() => S.backendDown && S.auth?.status === 'verified', null, { timeout: 15000 });
  const t = await warm.text(); assert.match(t, /Can't reach Sporv's server/i); assert.match(t, /still signed in as coach@example\.com/); assert.match(t, /Try again/i);
  assert.ok(!/Every sport\. One app|Get Started/.test(t), 'not the marketing page'); assert.equal(await warm.page.evaluate(() => S.route.name), 'dashboard');
  warm.state.blocked = false;
  await warm.page.locator('[data-net-retry]').first().click();
  await warm.page.waitForFunction(() => !S.backendDown && !!S.coachProvider && S.dashHome?.data, null, { timeout: 15000 });
  assert.match(await warm.text(), /Rivertown FC/); assert.deepEqual(warm.errors, []); await warm.ctx.close();
});
test('a real rejection is not a network failure: no cached profile + dead backend stays a guest, no fake sign-in', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); const s = await boot(db, { block: true });
  await s.page.waitForTimeout(2500); assert.equal(await s.page.evaluate(() => S.auth?.status), 'guest'); assert.equal(await s.page.evaluate(() => !!S.backendDown), false); await s.ctx.close();
});
test('offline shell: after one online open the app opens with no network, from the service worker cache', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); const s = await boot(db);
  await s.page.waitForFunction(() => S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await s.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(async () => { await s.page.reload({ waitUntil: 'load' }); await s.page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }); });
  const stamp = await s.page.evaluate(() => document.querySelector('meta[name="sporve-build"]')?.content);
  s.state.blocked = true; await s.ctx.setOffline(true); await s.page.evaluate(() => sessionStorage.clear());
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  await s.page.waitForFunction(() => typeof S === 'object' && document.querySelector('meta[name="sporve-build"]'), null, { timeout: 15000 });
  assert.equal(await s.page.evaluate(() => document.querySelector('meta[name="sporve-build"]').content), stamp, 'the cached shell is this build');
  await s.page.waitForFunction(() => S.backendDown && S.auth?.status === 'verified', null, { timeout: 15000 });
  assert.match(await s.text(), /Can't reach Sporv's server/i); await s.ctx.setOffline(false); await s.ctx.close();
});
