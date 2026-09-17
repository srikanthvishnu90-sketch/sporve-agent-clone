// tests/e2e/schedule.spec.mjs — audit 2026-09-17 P1-2 in a real browser over
// the fake backend: the Schedule tab is the org's `event` rows (list and
// month), conflicts render on the event, a cancellation is two taps and
// draft-first, and attendance is written locally first and replayed with a
// stable client_id. Rows on screen are exactly the rows the server returned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, UID, PID, SUPABASE } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
const H = 3600e3, D = 86400e3;
const iso = (ms) => new Date(ms).toISOString();
function orgDb() {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  db.teams.push({ id: 't14', provider_id: PID, name: '14U Flight' }, { id: 't16', provider_id: PID, name: '16U Flight' });
  db.team_athletes.push({ id: 'a1', provider_id: PID, team_id: 't14', first_name: 'Ava', last_name: 'Bell', status: 'active' }, { id: 'a2', provider_id: PID, team_id: 't14', first_name: 'Ben', last_name: 'Ortiz', status: 'active' }, { id: 'a3', provider_id: PID, team_id: 't16', first_name: 'Cara', last_name: 'Nguyen', status: 'active' });
  return db;
}
function ev(id, title, startMs, extra = {}) { return { id, provider_id: PID, team_id: 't14', kind: 'practice', title, starts_at: iso(startMs), ends_at: iso(startMs + H), timezone: 'America/Chicago', location_text: 'Field 1', status: 'scheduled', published_at: iso(startMs - D), sequence: 0, ...extra }; }
async function open(db, { tab = 'schedule' } = {}) {
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); const { log } = await mount(page, db);
  const seen = []; page.on('request', (r) => { if (r.url().startsWith(SUPABASE)) seen.push(r.method() + ' ' + r.url().slice(SUPABASE.length).split('?')[0]); });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider && Array.isArray(S.teamRoster), null, { timeout: 15000 });
  await page.waitForTimeout(400); seen.length = 0;
  await page.evaluate((t) => { S.coachTab = t; S.schedulePageTab = 'calendar'; render(); }, tab);
  if (tab === 'schedule') await page.waitForFunction(() => S.sched && !S.sched.loading && (S.sched.events || S.sched.error), null, { timeout: 10000 });
  else await page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.data, null, { timeout: 10000 });
  await page.waitForTimeout(150);
  return { ctx, page, log, seen, errors, text: async () => page.evaluate(() => document.body.innerText) };
}

test('an empty org: the named empty state, zero invented rows, three requests', async () => {
  const s = await open(orgDb());
  const t = await s.text(); assert.match(t, /Nothing scheduled in the next 60 days\./); assert.equal(await s.page.locator('.sch-row').count(), 0);
  assert.ok(!/Rivertown Rovers|No sessions scheduled|Elite|Sample/.test(t), 'no seed content');
  assert.ok(s.seen.length <= 4, s.seen.join(' | ')); assert.deepEqual(s.seen.filter((x) => x.includes('/rpc/')), ['POST /rest/v1/rpc/event_conflicts_in_range']);
  assert.deepEqual(s.errors, []); await s.ctx.close();
});
test('rows on screen are exactly the server rows; the conflict is on the event; a cancelled event says so', async () => {
  const db = orgDb(); const now = Date.now();
  db.event.push(ev('e1', 'Tuesday practice', now + 2 * H, { __conflicts: [{ conflict: 'venue', other_id: 'e2', detail: '16U practice overlaps at the same venue' }] }), ev('e2', '16U practice', now + 2 * H, { team_id: 't16' }),
    ev('e3', 'Saturday game', now + 3 * D, { kind: 'game' }), ev('e4', 'Rained out', now + 4 * D, { status: 'cancelled', cancellation_reason: 'lightning' }), ev('e5', 'Far future', now + 90 * D));
  const s = await open(db); const t = await s.text();
  assert.equal(await s.page.locator('.sch-row').count(), 4, 'four inside the 60-day window; the 90-day event is not in the query');
  assert.match(t, /Tuesday practice/); assert.match(t, /CONFLICT: venue — 16U practice overlaps at the same venue/); assert.match(t, /Cancelled · lightning/); assert.ok(!/Far future/.test(t));
  assert.match(t, /14U Flight · Field 1 · practice/, 'team name resolved from the org\'s own teams');
  assert.match(t, /3 upcoming events in the next 60 days, 1 with a conflict/);
  await s.ctx.close();
});
test('month view with 400 events renders inside 2.5s, a day opens its list', async () => {
  const db = orgDb(); const base = new Date(); base.setDate(1); base.setHours(18, 0, 0, 0);
  for (let i = 0; i < 400; i++) db.event.push(ev('m' + i, 'Session ' + i, base.getTime() + (i % 28) * D + (i % 3) * H, { team_id: i % 2 ? 't14' : 't16' }));
  const s = await open(db);
  const t0 = Date.now(); await s.page.locator('[data-schview="month"]').click();
  await s.page.waitForFunction(() => S.sched && !S.sched.loading && S.sched.view === 'month' && document.querySelectorAll('.sch-day').length === 42, null, { timeout: 10000 }); const ms = Date.now() - t0;
  console.log(`   month view, 400 events: ${ms}ms (fake backend)`); assert.ok(ms <= 2500, `month took ${ms}ms`);
  const total = await s.page.evaluate(() => S.sched.events.length); assert.equal(total, 400);
  const dayKey = await s.page.evaluate(() => document.querySelector('.sch-day:not(.sch-day--spill) .sch-day__ev')?.closest('.sch-day').dataset.schday);
  await s.page.locator(`[data-schday="${dayKey}"]`).click(); await s.page.waitForSelector('.sch-daylist .sch-row');
  const n = await s.page.locator('.sch-daylist .sch-row').count(); const expected = await s.page.evaluate((k) => S.sched.events.filter((e) => new Intl.DateTimeFormat('en-CA', { timeZone: e.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.starts_at)) === k).length, dayKey);
  assert.equal(n, expected); await s.ctx.close();
});
test('cancel in two taps from home: tap one on the home row, tap two confirms; draft-first receipt; the home block refreshes', async () => {
  const db = orgDb(); db.event.push(ev('e1', 'Tuesday practice', Date.now() + 5 * H));
  const s = await open(db, { tab: 'dashboard' });
  assert.match(await s.text(), /Tuesday practice/);
  await s.page.locator('[data-evcancel="e1"]').click();                                   // tap one
  await s.page.waitForSelector('#schCancelReason'); assert.equal(await s.page.evaluate(() => S.coachTab), 'schedule');
  await s.page.fill('#schCancelReason', 'Field flooded');
  await s.page.locator('[data-evcancel-go]').click();                                     // tap two
  await s.page.waitForFunction(() => S.sched && !S.sched.cancel && S.sched.receipts.e1, null, { timeout: 5000 });
  const c = s.log.find((l) => l.kind === 'cancel_event'); assert.deepEqual({ id: c.id, reason: c.reason, notify: c.notify }, { id: 'e1', reason: 'Field flooded', notify: true });
  const t = await s.text(); assert.match(t, /Cancelled · Field flooded/); assert.match(t, /Cancelled\. 2 family notices drafted for your approval in Needs you\./);
  assert.equal(db.obligations.filter((o) => o.draft_type === 'schedule_cancellation').length, 2); assert.equal(db.outbound_messages.length, 0, 'nothing sent');
  await s.page.evaluate(() => { S.coachTab = 'dashboard'; render(); }); await s.page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.loadedAt > 0, null, { timeout: 5000 }); await s.page.waitForTimeout(200);
  assert.match(await s.text(), /Nothing scheduled in the next two days\./); await s.ctx.close();
});
test('a refused cancellation says so and changes nothing; Keep the event closes the question', async () => {
  const db = orgDb(); db.event.push(ev('e1', 'Tuesday practice', Date.now() + 5 * H)); db.__cancelError = 'only organisation staff may cancel an event';
  const s = await open(db); await s.page.locator('[data-evcancel="e1"]').click(); await s.page.locator('[data-evcancel-go]').click();
  await s.page.waitForFunction(() => S.sched.cancel && S.sched.cancel.error, null, { timeout: 5000 });
  assert.match(await s.text(), /only organisation staff may cancel an event Nothing changed\./); assert.equal(db.event[0].status, 'scheduled');
  await s.page.locator('[data-evcancel-keep]').click(); assert.equal(await s.page.locator('#schCancelReason').count(), 0); await s.ctx.close();
});
test('attendance: a tap is on screen within 100ms, reaches the server with a client_id, and reads back as saved', async () => {
  const db = orgDb(); db.event.push(ev('e1', 'Tuesday practice', Date.now() - 0.5 * H));
  const s = await open(db); await s.page.locator('[data-evatt="e1"]').click(); await s.page.waitForSelector('.att-row');
  assert.equal(await s.page.locator('.att-row').count(), 2, 'the 14U roster, not the 16U athlete');
  const ms = await s.page.evaluate(() => { const t0 = performance.now(); document.querySelector('[data-attmember="a1"][data-attstate="present"]').click(); const on = document.querySelector('[data-attmember="a1"][data-attstate="present"]').classList.contains('on'); return on ? performance.now() - t0 : -1; });
  assert.ok(ms >= 0 && ms <= 100, `local mark took ${ms}ms`); console.log(`   attendance local mark: ${ms.toFixed(1)}ms`);
  await s.page.waitForFunction(() => !(S.attQueue || []).length, null, { timeout: 5000 });
  const m = s.log.find((l) => l.kind === 'mark_attendance'); assert.equal(m.member_id, 'a1'); assert.equal(m.state, 'present'); assert.match(m.client_id, /^[0-9a-f-]{36}$/);
  assert.match(await s.page.locator('[data-attrow="a1"]').innerText(), /Saved \d/); await s.ctx.close();
});
test('offline: the mark is queued locally, survives a reload, and replays with the SAME client_id when the connection returns', async () => {
  const db = orgDb(); db.event.push(ev('e1', 'Tuesday practice', Date.now() - 0.5 * H));
  const s = await open(db); let offline = true;
  await s.page.route('**/rest/v1/rpc/mark_attendance', (route) => (offline ? route.abort('internetdisconnected') : route.fallback()));
  await s.page.locator('[data-evatt="e1"]').click(); await s.page.waitForSelector('.att-row');
  await s.page.locator('[data-attmember="a2"][data-attstate="absent"]').click();
  await s.page.waitForFunction(() => /Queued/.test(document.querySelector('[data-attrow="a2"]')?.innerText || ''), null, { timeout: 5000 });
  const queued = await s.page.evaluate(() => JSON.parse(localStorage.getItem('sporv:attendance-queue:v1'))); assert.equal(queued.length, 1); const cid = queued[0].client_id;
  assert.equal(s.log.filter((l) => l.kind === 'mark_attendance').length, 0, 'nothing reached the server');
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  await s.page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  offline = false; await s.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await s.page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('sporv:attendance-queue:v1') || '[]').length === 0; } catch { return false; } }, null, { timeout: 8000 });
  const sent = s.log.filter((l) => l.kind === 'mark_attendance'); assert.equal(sent.length, 1); assert.equal(sent[0].client_id, cid); assert.equal(sent[0].state, 'absent');
  await s.page.evaluate(() => { S.coachTab = 'schedule'; S.schedulePageTab = 'calendar'; render(); }); await s.page.waitForFunction(() => S.sched && S.sched.events, null, { timeout: 8000 });
  await s.page.locator('[data-evatt="e1"]').click(); await s.page.waitForFunction(() => /Saved \d/.test(document.querySelector('[data-attrow="a2"]')?.innerText || ''), null, { timeout: 5000 });
  await s.ctx.close();
});
test('a refused attendance mark stays visible with the server\'s words and is never retried', async () => {
  const db = orgDb(); db.event.push(ev('e1', 'Tuesday practice', Date.now() - 0.5 * H)); db.__attendanceError = 'only organisation staff may mark attendance';
  const s = await open(db); await s.page.locator('[data-evatt="e1"]').click(); await s.page.waitForSelector('.att-row');
  await s.page.locator('[data-attmember="a1"][data-attstate="late"]').click();
  await s.page.waitForFunction(() => /Refused: only organisation staff may mark attendance/.test(document.querySelector('[data-attrow="a1"]')?.innerText || ''), null, { timeout: 5000 });
  await s.page.waitForTimeout(600); assert.equal(s.seen.filter((x) => x.endsWith('/rpc/mark_attendance')).length, 1, 'one attempt, no retry loop'); await s.ctx.close();
});
test('a coach: lands in the employer org, sees the schedule, has no Cancel anywhere; conflicts not checked is stated, not hidden', async () => {
  const db = orgDb(); db.providers[0].owner_id = 'someone-else'; db.providers.push({ id: 'own', owner_id: UID, business_name: 'Your organization', onboarding_completed: false });
  db.organization_members.push({ id: 'm1', organization_id: PID, member_user_id: UID, role: 'trainer', is_active: true });
  db.event.push(ev('e1', 'Tuesday practice', Date.now() + 5 * H)); db.__conflictsError = 'only organisation staff may read conflicts';
  const s = await open(db); const t = await s.text();
  assert.equal(await s.page.evaluate(() => coachRole()), 'coach'); assert.match(t, /Tuesday practice/); assert.equal(await s.page.locator('[data-evcancel]').count(), 0);
  assert.match(t, /Conflicts were not checked\. only organisation staff may read conflicts/); assert.equal(await s.page.locator('[data-evatt="e1"]').count(), 1);
  await s.page.evaluate(() => { S.coachTab = 'dashboard'; render(); }); await s.page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.data, null, { timeout: 8000 }); await s.page.waitForTimeout(150);
  assert.equal(await s.page.locator('[data-evcancel]').count(), 0, 'no Cancel on the home row for a coach'); await s.ctx.close();
});
test('backend down: the schedule says so and offers a retry; nothing is shown in its place', async () => {
  const db = orgDb(); db.event.push(ev('e1', 'Tuesday practice', Date.now() + 5 * H));
  const s = await open(db, { tab: 'dashboard' }); let down = true;
  await s.page.route((u) => /\/rest\/v1\/event\?/.test(u.href), (route) => (down ? route.abort('connectionfailed') : route.fallback()));
  await s.page.evaluate(() => { S.coachTab = 'schedule'; S.schedulePageTab = 'calendar'; render(); }); await s.page.waitForFunction(() => S.sched && S.sched.error, null, { timeout: 8000 });
  const t = await s.text(); assert.match(t, /Couldn't load the schedule/i); assert.match(t, /Could not reach the server/); assert.equal(await s.page.locator('.sch-row').count(), 0);
  down = false; await s.page.locator('[data-schretry]').click(); await s.page.waitForFunction(() => S.sched && S.sched.events && S.sched.events.length === 1, null, { timeout: 8000 });
  assert.match(await s.text(), /Tuesday practice/); await s.ctx.close();
});
