// tests/e2e/money.spec.mjs — audit 2026-09-17 P1-3 in a real browser over the
// fake backend: the Money tab is aged balances by family from ONE request;
// the home block drills into it filtered to overdue; every family opens to
// its obligations with what created them; a coach gets zero rows and is told
// so; a failed load says so and offers a retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, UID, PID, SUPABASE } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
const D = 86400e3; const iso = (ms) => new Date(ms).toISOString();
function orgDb() {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  db.teams.push({ id: 't14', provider_id: PID, name: '14U Flight' });
  db.team_athletes.push({ id: 'a1', provider_id: PID, team_id: 't14', first_name: 'Ava', last_name: 'Bell', status: 'active' }, { id: 'a2', provider_id: PID, team_id: 't14', first_name: 'Ben', last_name: 'Ortiz', status: 'active' });
  db.guardians.push({ id: 'g1', provider_id: PID, first_name: 'Renata', last_name: 'Bell' }, { id: 'g2', provider_id: PID, first_name: 'Marco', last_name: 'Ortiz' });
  return db;
}
const fee = (id, title, cents, dueMs, extra = {}) => ({ id, provider_id: PID, kind: 'fee', status: 'approved', title, amount_cents: cents, due_at: iso(dueMs), source_kind: 'manual', source_ref: 'fee:' + id, ...extra });
async function open(db, { tab = 'finances' } = {}) {
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); const { log } = await mount(page, db);
  const seen = []; page.on('request', (r) => { if (r.url().startsWith(SUPABASE)) seen.push(r.method() + ' ' + r.url().slice(SUPABASE.length).split('?')[0]); });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider && Array.isArray(S.teamRoster), null, { timeout: 15000 });
  await page.waitForTimeout(400); seen.length = 0;
  const t0 = Date.now(); await page.evaluate((t) => { S.coachTab = t; render(); }, tab);
  if (tab === 'finances') await page.waitForFunction(() => S.money && !S.money.loading && (S.money.data || S.money.error), null, { timeout: 10000 });
  else await page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.data, null, { timeout: 10000 });
  const ms = Date.now() - t0; await page.waitForTimeout(150);
  return { ctx, page, log, seen, errors, ms, text: async () => page.evaluate(() => document.body.innerText) };
}
test('an org with no dues: the named empty state, the tab is called Money, one request, no invented number', async () => {
  const s = await open(orgDb()); const t = await s.text();
  assert.match(t, /Nobody owes anything right now\./); assert.ok(!/GROSS|Platform fee|Booking totals/.test(t), 'no marketplace earnings'); assert.match(t, /0 open fee obligations across 0 families/, 'the server\'s own zero, not an invented one');
  assert.equal(await s.page.locator('.cui-page[data-cui-page-root="money"]').count(), 1); assert.match(t, /\nMoney\n/, 'nav says Money');
  assert.deepEqual(s.seen, ['POST /rest/v1/rpc/money_aged_balances']); assert.deepEqual(s.errors, []); await s.ctx.close();
});
test('a season of dues (600 obligations): totals, buckets and families are the server\'s numbers, rendered inside 2.0s from one request', async () => {
  const db = orgDb(); const now = Date.now();
  for (let i = 0; i < 600; i++) db.obligations.push(fee('o' + i, 'Dues ' + i, 10000, now - ((i % 4) - 1) * 20 * D, { guardian_id: i % 2 ? 'g1' : 'g2', member_id: i % 2 ? 'a1' : 'a2', status: i % 3 ? 'approved' : 'draft' }));
  db.obligations.push(fee('paid1', 'Winter dues', 9000, now - 80 * D, { status: 'done', done_at: iso(now - 30 * D), guardian_id: 'g2' }), fee('void1', 'Voided', 99900, now - 5 * D, { status: 'void' }));
  const s = await open(db); console.log(`   money, 600 obligations: ${s.ms}ms (fake backend)`); assert.ok(s.ms <= 2000, `took ${s.ms}ms`);
  const t = await s.text(); const exp = await s.page.evaluate(() => S.money.data.totals);
  assert.equal(exp.outstanding_cents, 6000000); assert.equal(exp.overdue_count, 300); assert.match(t, /\$60,000\.00/); assert.match(t, /\$30,000\.00/, 'overdue total'); assert.match(t, /300 past due/);
  assert.match(t, /\$90\.00/, 'collected in 90 days'); assert.ok(!/\$999\.00/.test(t), 'void never counts');
  assert.equal(await s.page.locator('.mny-fam').count(), 2); assert.deepEqual(s.seen, ['POST /rest/v1/rpc/money_aged_balances']);
  await s.page.locator('[data-moneyopen="g1"]').click(); await s.page.waitForSelector('.mny-items .mny-item');
  assert.equal(await s.page.locator('.mny-items .mny-item').count(), 300, 'every open item of the family, from the same response'); assert.match(await s.text(), /from manual · fee:o1\b/);
  await s.ctx.close();
});
test('drill-through from the home block lands on Money filtered to overdue; Show all clears it', async () => {
  const db = orgDb(); const now = Date.now();
  db.obligations.push(fee('late', 'Spring dues', 12000, now - 45 * D, { guardian_id: 'g1', member_id: 'a1' }), fee('ontime', 'Spring dues', 12000, now + 20 * D, { guardian_id: 'g2', member_id: 'a2' }));
  const s = await open(db, { tab: 'dashboard' }); assert.match(await s.text(), /Renata Bell/);
  await s.page.locator('[data-ctab="finances"][data-moneyfilter="overdue"]').click();
  await s.page.waitForFunction(() => S.coachTab === 'finances' && S.money && S.money.data, null, { timeout: 8000 }); await s.page.waitForTimeout(150);
  let t = await s.text(); assert.match(t, /Families with an overdue balance/i); assert.equal(await s.page.locator('.mny-fam').count(), 1); assert.match(t, /Renata Bell/); assert.ok(!/Marco Ortiz/.test(t));
  await s.page.locator('[data-moneyfilter="all"]:not([data-ctab])').first().click(); await s.page.waitForTimeout(100);
  t = await s.text(); assert.equal(await s.page.locator('.mny-fam').count(), 2); assert.match(t, /Marco Ortiz/); assert.match(t, /not yet due/); await s.ctx.close();
});
test('an obligation with no family, a failed installment, and the collected tab', async () => {
  const db = orgDb(); const now = Date.now();
  db.obligations.push(fee('u1', 'Uniform', 5000, now - 100 * D, { source_kind: 'pdf', source_ref: 'invoice.pdf' }), fee('p1', 'Winter dues', 9000, now - 80 * D, { status: 'done', done_at: iso(now - 30 * D), guardian_id: 'g2' }));
  db.fee_schedules.push({ id: 'fs1', provider_id: PID, member_id: 'a2', total_cents: 24000 }); db.installments.push({ id: 'i1', fee_schedule_id: 'fs1', member_id: 'a2', due_date: '2026-09-10', amount_cents: 6000, status: 'failed', attempt_count: 2, last_attempt_at: iso(now - D) });
  const s = await open(db); let t = await s.text(); assert.match(t, /No family on file/); assert.match(t, /Over 90 days/);
  await s.page.locator('[data-moneyopen="none"]').click(); await s.page.waitForSelector('.mny-items'); assert.match(await s.text(), /from pdf · invoice\.pdf/);
  await s.page.locator('[data-cui-tab="failed"]').click(); await s.page.waitForTimeout(150); t = await s.text(); assert.match(t, /Ben Ortiz/); assert.match(t, /\$60\.00/); assert.match(t, /\b2\b/);
  await s.page.locator('[data-cui-tab="collected"]').click(); await s.page.waitForTimeout(150); t = await s.text(); assert.match(t, /Winter dues/); assert.match(t, /Marco Ortiz/); assert.match(t, /\$90\.00/);
  assert.deepEqual(s.seen, ['POST /rest/v1/rpc/money_aged_balances'], 'tabs add no request'); await s.ctx.close();
});
test('a coach: the server returns zero rows and the screen says money is not part of their role — no number anywhere', async () => {
  const db = orgDb(); db.providers[0].owner_id = 'someone-else'; db.providers.push({ id: 'own', owner_id: UID, business_name: 'Your organization', onboarding_completed: false });
  db.organization_members.push({ id: 'm1', organization_id: PID, member_user_id: UID, role: 'trainer', is_active: true });
  db.obligations.push(fee('late', 'Spring dues', 12000, Date.now() - 45 * D, { guardian_id: 'g1', member_id: 'a1' }));
  const s = await open(db); const t = await s.text(); assert.equal(await s.page.evaluate(() => coachRole()), 'coach');
  assert.match(t, /Money is not part of your role/i); assert.ok(!/\$120\.00|Renata Bell|\$\d/.test(t)); assert.equal(await s.page.locator('.cui-stat').count(), 0); await s.ctx.close();
});
test('backend down: says so, offers a retry, never re-fires by itself', async () => {
  const db = orgDb(); db.obligations.push(fee('late', 'Spring dues', 12000, Date.now() - 45 * D, { guardian_id: 'g1', member_id: 'a1' })); db.__moneyError = 'upstream unavailable';
  const s = await open(db); const t = await s.text(); assert.match(t, /Couldn't load balances/i); assert.match(t, /upstream unavailable/); assert.ok(!/Renata Bell/.test(t));
  await s.page.waitForTimeout(700); assert.equal(s.seen.length, 1, 'one attempt until the person retries');
  delete db.__moneyError; await s.page.locator('[data-moneyretry]').click(); await s.page.waitForFunction(() => S.money.data && S.money.data.totals, null, { timeout: 8000 });
  assert.match(await s.text(), /Renata Bell/); await s.ctx.close();
});
