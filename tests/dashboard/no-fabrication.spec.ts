// tests/dashboard/no-fabrication.spec.ts — doc 25.11 integrity, the recurring
// defect class (the badge, the fabricated queue). Every block renders only from
// rows its own query returned. An empty org renders every block in its empty
// state with ZERO fabricated rows: no athlete name, no amount, no date that is
// not in the response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { mount, freshDb, session } from '../e2e/fake-supabase.mjs';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
const host = readFileSync(new URL('../../src/sporve-web.host.html', import.meta.url), 'utf8');
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

test('source: the home renderers carry no literal rows, samples or fallback values', () => {
  const fn = host.slice(host.indexOf('function dashRowsHTML'), host.indexOf('function coachHomePage'));
  assert.ok(!/SEED|approvalDrafts|sample|Julian|Northside|Apex|\$1[0-9]{2}\b/.test(fn), 'a literal or seed reference in the home renderer');
  assert.match(fn, /const blocks=\(st\.data&&Array\.isArray\(st\.data\.blocks\)\)\?st\.data\.blocks:\[\];/, 'blocks come from the response only');
  assert.match(host, /if\(queueIsLive\(\)\)\{\s*loadDashboardHome\(\);/, 'a real org renders the data-driven home');
});
test('an empty org: every block in its empty state, zero fabricated names, amounts or dates in the DOM', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  db.org_connectors.push({ id: 'c1', provider_id: db.providers[0].id, kind: 'gmail', status: 'connected' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); await mount(page, db); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'dashboard'; render(); }); await page.waitForFunction(() => S.dashHome && !S.dashHome.loading, null, { timeout: 10000 });
  const homeText = await page.evaluate(() => (document.querySelector('.cui-page, #app') || document.body).innerText);
  const main = await page.evaluate(() => [...document.querySelectorAll('.cui-block')].map((b) => b.innerText).join('\n'));
  for (const s of ['Nothing scheduled in the next two days.', 'The agent is watching your inbox and your schedule. Nothing needs you.', 'Every athlete and every staff member is current.']) assert.ok(main.includes(s), s);
  assert.ok(!/\$\d/.test(main), 'no amount on an org with none'); assert.ok(!/\b(Ava|Ben|Julian|Nia|Marcus|Renata|Mercer|Okafor)\b/.test(main), 'no athlete or family name');
  assert.ok(!/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*\d{1,2}:\d{2}/.test(main), 'no event time'); assert.ok(!/\d+ days? overdue/.test(main));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.cui-list__row').length), 0, 'zero list rows rendered');
  assert.match(homeText, /Rivertown FC/); assert.ok(!main.includes('No records are available'), 'no generic fallback text');
  await ctx.close();
});
test('rows on screen are exactly the rows the query returned', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  db.obligations.push({ id: 'o1', provider_id: db.providers[0].id, kind: 'fee', status: 'draft', title: 'Fall dues', amount_cents: 15000, due_at: new Date(Date.now() - 20 * 86400e3).toISOString(), source_kind: 'agent', guardian_id: 'g1' });
  db.guardians.push({ id: 'g1', provider_id: db.providers[0].id, first_name: 'Renata' });
  db.agent_findings.push({ id: 'f1', provider_id: db.providers[0].id, kind: 'dues', severity: 'warn', title: '1 family 20+ days late', status: 'open', created_at: new Date().toISOString() });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); await mount(page, db); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'dashboard'; render(); }); await page.waitForFunction(() => S.dashHome && !S.dashHome.loading, null, { timeout: 10000 });
  const main = await page.evaluate(() => [...document.querySelectorAll('.cui-block')].map((b) => b.innerText).join('\n'));
  assert.match(main, /Renata/); assert.match(main, /\$150/); assert.match(main, /20 days overdue/); assert.match(main, /1 family 20\+ days late/); assert.match(main, /Fall dues/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.cui-list__row').length), 3, 'one money row + one finding + one draft — nothing else');
  await ctx.close();
});
