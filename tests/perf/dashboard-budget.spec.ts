// tests/perf/dashboard-budget.spec.ts — doc 25.11 performance. The home
// resolves and renders in ≤ 4 queries; blocks batch into one round trip;
// a sixth block adds no query. Measured in a real browser against the fake
// backend: every request to the Supabase origin after the dashboard tab is
// opened is counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, dashboardHome, SUPABASE } from '../e2e/fake-supabase.mjs';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
async function measure(db) {
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); await mount(page, db); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'queue'; render(); }); await page.waitForTimeout(1500);   // let boot-time hydration settle on another tab
  const seen = []; page.on('request', (r) => { if (r.url().startsWith(SUPABASE)) seen.push(r.method() + ' ' + r.url().slice(SUPABASE.length, SUPABASE.length + 60)); });
  const t0 = Date.now(); await page.evaluate(() => { S.dashHome = null; S.coachTab = 'dashboard'; render(); });
  await page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.data, null, { timeout: 10000 }); const ms = Date.now() - t0;
  await page.waitForTimeout(500);
  const blocks = await page.evaluate(() => document.querySelectorAll('.cui-block').length);
  await ctx.close(); return { seen, ms, blocks };
}
test('opening the home is ≤ 4 requests — in fact one: dashboard_home', async () => {
  const { seen, ms } = await measure(freshDb({ onboarded: true, name: 'Rivertown FC' }));
  assert.ok(seen.length <= 4, `home issued ${seen.length} requests: ${seen.join(' | ')}`);
  assert.equal(seen.filter((s) => s.includes('/rpc/dashboard_home')).length, 1);
  console.log(`   home: ${seen.length} request(s), resolved+rendered in ${ms}ms (fake backend)`);
});
test('a sixth block adds no query', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  db.__home = (args, d) => { const h = dashboardHome(d, args.p_provider);
    const extra = ['x.one', 'x.two', 'x.three'].map((k) => ({ key: k, title: 'Extra ' + k, description: 'a sixth block', params: {}, empty: 'nothing', error: 'err', drill_to: 'queue', rows: [], failed: false }));
    h.blocks = h.blocks.concat(extra); return h; };
  const { seen, blocks } = await measure(db);
  assert.ok(blocks >= 6, `rendered ${blocks} blocks`); assert.equal(seen.filter((s) => s.startsWith('POST /rest/v1/rpc/dashboard_home')).length, 1); assert.ok(seen.length <= 4, seen.join(' | '));
});
