// tests/perf/boot-requests.spec.ts — audit 2026-09-17 P1-5 (the request half).
// A returning org's cold boot to its home issues ≤ 4 backend requests: the
// profile, the workspace row, the roster, the home RPC. Everything a tab reads
// loads when that tab renders, once per session. Measured in a real browser
// over the fake backend from a real http origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, SUPABASE } from '../e2e/fake-supabase.mjs';
import { serve } from '../e2e/serve.mjs';
declare const S: any; declare function render(): void;   // page-side globals (S is a lexical const in the page, not on globalThis)
let browser: any, site: any;
test.before(async () => { browser = await chromium.launch(); site = await serve(); }); test.after(async () => { await browser?.close(); await site?.close(); });
async function bootTo(tab: string | null) {
  const ctx = await browser.newContext(); await ctx.addInitScript((s: unknown) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); await mount(page, freshDb({ onboarded: true, name: 'Rivertown FC' }));
  const seen: string[] = []; page.on('request', (r: any) => { if (r.url().startsWith(SUPABASE)) seen.push(r.method() + ' ' + r.url().slice(SUPABASE.length).split('?')[0]); });
  await page.goto(site.index, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.dashHome?.data && Array.isArray(S.teamRoster), null, { timeout: 15000 });
  await page.waitForTimeout(1200); const boot = seen.slice();
  if (tab) { seen.length = 0; await page.evaluate((t: string) => { S.coachTab = t; render(); }, tab); await page.waitForTimeout(800); }
  const after = seen.slice(); await ctx.close(); return { boot, after };
}
test('cold boot to the home: 4 requests, named', async () => {
  const { boot } = await bootTo(null);
  assert.ok(boot.length <= 4, `boot issued ${boot.length}: ${boot.join(' | ')}`);
  assert.deepEqual([...boot].sort(), ['GET /rest/v1/profiles', 'GET /rest/v1/team_athletes', 'POST /rest/v1/rpc/dashboard_home', 'POST /rest/v1/rpc/my_workspace']);
  console.log(`   boot: ${boot.length} request(s)`);
});
test('the queue and operations tabs load their own rows when opened, once', async () => {
  const q = await bootTo('queue'); assert.ok(q.after.some((x) => x.includes('/outbound_messages')), q.after.join(' | ')); assert.ok(q.after.length <= 4, 'a view is at most 4 round trips: ' + q.after.join(' | '));
  const o = await bootTo('operations'); assert.ok(o.after.some((x) => x.includes('/organization_members')) && o.after.some((x) => x.includes('/staff_certifications')), o.after.join(' | '));
});
