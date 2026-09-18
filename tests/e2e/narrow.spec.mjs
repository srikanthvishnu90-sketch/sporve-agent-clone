// tests/e2e/narrow.spec.mjs — audit 2026-09-17 P2-5: a phone in one hand.
// At 320px no coach surface scrolls sideways, and on the Roster and the Queue
// every control a thumb can hit is at least 40px tall. Real data on screen
// (twelve athletes, four drafts, three events), the way the audit ran it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, PID } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
function orgDb() {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); db.teams.push({ id: 't14', provider_id: PID, name: '14U Flight' });
  for (let i = 0; i < 12; i++) db.team_athletes.push({ id: 'a' + i, provider_id: PID, team_id: 't14', first_name: 'Athlete' + i, last_name: 'Surname' + i, jersey_number: String(i), status: 'active' });
  for (let i = 0; i < 4; i++) db.obligations.push({ id: 'o' + i, provider_id: PID, kind: 'fee', status: 'draft', source_kind: 'agent', draft_type: 'dues_reminder', title: 'Dues reminder ' + i, detail: 'The family still owes the spring balance and has not answered two reminders.', amount_cents: 12000, due_at: new Date(Date.now() - 86400e3 * 20).toISOString(), guardian_id: null });
  for (let i = 0; i < 3; i++) db.event.push({ id: 'e' + i, provider_id: PID, team_id: 't14', kind: 'practice', title: 'Practice ' + i, starts_at: new Date(Date.now() + (i + 1) * 86400e3).toISOString(), ends_at: new Date(Date.now() + (i + 1) * 86400e3 + 3600e3).toISOString(), timezone: 'America/Chicago', status: 'scheduled', published_at: new Date().toISOString(), sequence: 0 });
  return db;
}
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); await mount(page, orgDb()); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider && Array.isArray(S.teamRoster), null, { timeout: 15000 });
  return { ctx, page };
}
const measure = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  const els = [...document.querySelectorAll('#app button, #app a[href], #app input, #app select, #app [role=button], #app [role=tab]')]
    .filter((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && !e.closest('.rail, .aipill, .aidock, [hidden]'); });
  const small = els.filter((e) => e.getBoundingClientRect().height < 40).map((e) => { const b = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''} ${Math.round(b.width)}x${Math.round(b.height)} "${(e.textContent || '').trim().slice(0, 18)}"`; });
  return { sw: document.documentElement.scrollWidth, appSw: document.getElementById('app').scrollWidth, cw, targets: els.length, small };
});
for (const tab of ['dashboard', 'queue', 'roster', 'schedule', 'finances']) {
  test(`${tab} at 320px: no sideways scroll` + (tab === 'roster' || tab === 'queue' ? ', every control ≥ 40px tall' : ''), async () => {
    const { ctx, page } = await open();
    await page.evaluate((t) => { S.coachTab = t; render(); }, tab); await page.waitForTimeout(1000);
    if (tab === 'queue') await page.waitForFunction(() => document.querySelectorAll('.obcard').length >= 4, null, { timeout: 8000 }).catch(() => {});
    const m = await measure(page);
    assert.ok(m.sw <= m.cw && m.appSw <= m.cw, `${tab}: document ${m.sw}px / app ${m.appSw}px wider than ${m.cw}px`);
    if (tab === 'roster' || tab === 'queue') { assert.ok(m.targets >= 10, `${tab}: only ${m.targets} controls found`); assert.deepEqual(m.small, [], `${tab}: ${m.small.length} of ${m.targets} controls under 40px`); }
    await ctx.close();
  });
}
