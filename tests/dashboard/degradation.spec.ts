// tests/dashboard/degradation.spec.ts — doc 25.11 robustness, in a real
// browser against the fake backend: one block failing shows its error text
// while the others render; the whole call failing leaves the shell and tabs
// standing with an actionable message and a retry; zero data shows each
// block's declared empty text; the model provider being down changes nothing
// because no block depends on the agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, dashboardHome } from '../e2e/fake-supabase.mjs';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
async function home(db) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const errors = [];
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await mount(page, db); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'dashboard'; render(); });
  await page.waitForFunction(() => S.dashHome && !S.dashHome.loading, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  const tabs = await page.evaluate(() => document.querySelectorAll('[data-coachtab],[data-ctab]').length);
  return { ctx, page, errors, text, tabs };
}

test('no inbox connected: agent.attention says so and offers the fix, instead of implying the agent found nothing (26.6)', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  const { ctx, text, errors } = await home(db);
  assert.match(text, /Nothing is connected yet/); assert.match(text, /connect gmail/i); assert.ok(!text.includes('Nothing needs you'));
  assert.deepEqual(errors, []); await ctx.close();
});
test('one block fails: its declared error text shows, the other blocks render, the page stands', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  db.org_connectors.push({ id: 'c1', provider_id: db.providers[0].id, kind: 'gmail', status: 'connected' });
  db.__home = (args, d) => { const h = dashboardHome(d, args.p_provider); h.blocks = h.blocks.map((b) => b.key === 'schedule.today' ? { ...b, failed: true, rows: [] } : b); return h; };
  const { ctx, errors, text } = await home(db);
  assert.match(text, /Could not load the schedule\./); assert.match(text, /The rest of your home is unaffected/);
  assert.match(text, /needs you/i); assert.match(text, /roster gaps/i); assert.match(text, /The agent is watching your inbox/);
  assert.deepEqual(errors, []); await ctx.close();
});
test('the whole home call fails: shell and tabs still render, the message says what happened and offers a retry, nothing is invented', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); db.__homeError = 'fixture outage';
  const { ctx, page, errors, text, tabs } = await home(db);
  assert.match(text, /couldn't load your home/i); assert.match(text, /fixture outage/); assert.match(text, /no value is invented/); assert.match(text, /try again/i);
  assert.ok(tabs > 0, 'the navigation is still there'); assert.match(text, /Rivertown FC/);
  db.__homeError = null; await page.click('[data-dashretry]'); await page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.data, null, { timeout: 8000 });
  assert.match(await page.evaluate(() => document.body.innerText), /needs you/i, 'retry recovers');
  assert.deepEqual(errors, []); await ctx.close();
});
test('zero data: every resolved block shows its declared empty string, never a blank panel', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  db.org_connectors.push({ id: 'c1', provider_id: db.providers[0].id, kind: 'gmail', status: 'connected' });
  const { ctx, text, errors } = await home(db);
  assert.ok(!text.includes('No records are available for this section'), 'no generic fallback under a declared empty text');
  for (const s of ['Nothing scheduled in the next two days.', 'The agent is watching your inbox and your schedule. Nothing needs you.', 'Every athlete and every staff member is current.']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('Nobody owes anything'), 'an org with no dues has no money block at all');
  assert.deepEqual(errors, []); await ctx.close();
});
test('the model provider is unavailable: the home renders fully because no block calls the agent', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const calls = []; const { log } = await mount(page, db);
  await page.route('**/functions/v1/ai-gateway**', (r) => { calls.push(1); r.fulfill({ status: 503, body: 'down' }); });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'dashboard'; render(); }); await page.waitForFunction(() => S.dashHome && !S.dashHome.loading, null, { timeout: 10000 });
  const text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /needs you/i); assert.equal(calls.length, 0, 'the home never called the model');
  /* The model surface is exactly ai-chat / ai-gateway. A loose /ai/ would
     false-positive on connectors-available ("avai-lable"), which is a
     registry probe, not a model call. */
  assert.ok(!log.some((l) => l.kind === 'fn' && /ai-chat|ai-gateway/.test(l.fn)));
  await ctx.close();
});
