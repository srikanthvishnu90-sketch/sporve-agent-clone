/* Doc 29.3 — every row gets a number. A missing number is a failed check.
 * Measured against the fake backend on the season fixture, so the numbers
 * isolate the CLIENT's cost (parse, render, layout) from network weather.
 * They are comparable run to run, and they are NOT a substitute for the live
 * audit's numbers — the report says so. */
import { SURFACES } from '../lib/harness.mjs';

const BUDGET = {
  'boot.requests': { max: 4, unit: 'requests', title: 'backend round trips on a cold boot' },
  'home.blocks': { max: 2500, unit: 'ms', title: 'home renders its blocks (200 athletes)' },
  'schedule.month': { max: 2500, unit: 'ms', title: 'schedule month view (400 events)' },
  'roster.200': { max: 2000, unit: 'ms', title: 'roster with 200 athletes' },
  'money.aged': { max: 2000, unit: 'ms', title: 'money, aged balances (600 obligations)' },
  'nav.any': { max: 300, unit: 'ms', title: 'any navigation between tabs' },
  'attendance.local': { max: 100, unit: 'ms', title: 'an attendance tap appears on screen' },
  'doc.bytes': { max: 1_000_000, unit: 'bytes', title: 'the document on the wire (gzip)' },
};

export function plan() {
  const out = [];
  const M = (id, ctx, fn, extra = {}) => out.push({
    id: `perf.${id}`, law: 'perf', severity: 'P1', measure: true, isolate: true,
    title: BUDGET[id]?.title || id, budget: BUDGET[id], ctx, run: fn, ...extra,
  });

  M('boot.requests', { org: 'season', role: 'owner', surface: 'dashboard' }, async ({ requests }) => {
    const n = requests.length;
    return { value: n, fail: n > BUDGET['boot.requests'].max ? `${n} requests: ${requests.join(' | ')}` : null };
  });
  M('home.blocks', { org: 'season', role: 'owner', surface: 'queue' }, async ({ page }) => {
    const t0 = Date.now();
    await page.evaluate(() => { S.dashHome = null; S.coachTab = 'dashboard'; render(); });
    await page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.data && document.querySelectorAll('.cui-block').length, null, { timeout: 30000 });
    const ms = Date.now() - t0;
    return { value: ms, fail: ms > BUDGET['home.blocks'].max ? `${ms}ms` : null };
  });
  M('schedule.month', { org: 'season', role: 'owner', surface: 'schedule' }, async ({ page }) => {
    await page.waitForFunction(() => S.sched && !S.sched.loading && S.sched.events, null, { timeout: 30000 });
    const t0 = Date.now();
    await page.evaluate(() => { const b = document.querySelector('[data-schview="month"]'); if (b) b.click(); });
    await page.waitForFunction(() => document.querySelectorAll('.sch-day').length === 42, null, { timeout: 30000 });
    const ms = Date.now() - t0;
    return { value: ms, fail: ms > BUDGET['schedule.month'].max ? `${ms}ms` : null };
  });
  M('roster.200', { org: 'season', role: 'owner', surface: 'dashboard' }, async ({ page }) => {
    const t0 = Date.now();
    await page.evaluate(() => { S.coachTab = 'roster'; render(); });
    await page.waitForFunction(() => (document.getElementById('app')?.innerText || '').includes('Athlete1'), null, { timeout: 30000 });
    const ms = Date.now() - t0;
    return { value: ms, fail: ms > BUDGET['roster.200'].max ? `${ms}ms` : null };
  });
  M('money.aged', { org: 'season', role: 'owner', surface: 'dashboard' }, async ({ page }) => {
    const t0 = Date.now();
    await page.evaluate(() => { S.money = null; S.coachTab = 'finances'; render(); });
    await page.waitForFunction(() => S.money && !S.money.loading && S.money.data, null, { timeout: 30000 });
    const ms = Date.now() - t0;
    return { value: ms, fail: ms > BUDGET['money.aged'].max ? `${ms}ms` : null };
  });
  M('nav.any', { org: 'season', role: 'owner', surface: 'dashboard' }, async ({ page }) => {
    const times = [];
    for (const s of SURFACES.slice(0, 6)) {
      const t0 = Date.now();
      await page.evaluate((x) => { S.coachTab = x; render(); }, s);
      times.push(Date.now() - t0);
    }
    const worst = Math.max(...times);
    return { value: worst, fail: worst > BUDGET['nav.any'].max ? `worst ${worst}ms across six tabs` : null };
  });
  M('attendance.local', { org: 'small', role: 'owner', surface: 'schedule' }, async ({ page }) => {
    await page.waitForFunction(() => S.sched && S.sched.events && S.sched.events.length, null, { timeout: 30000 });
    await page.waitForSelector('[data-evatt]', { timeout: 20000 });
    await page.click('[data-evatt]');
    /* Wait with the page's own machinery, not a fixed pause inside evaluate:
       the attendance panel renders once the roster is in state, and a 400ms
       guess reported "no control to measure" on a perfectly good build. */
    await page.waitForSelector('[data-attstate="present"]', { timeout: 20000 });
    const ms = await page.evaluate(() => {
      /* A tap re-renders the surface, so the node that was clicked is detached
         a moment later. Measure against the LIVE dom — the question is "how
         long until the coach sees the mark", not "did this node change". */
      const sel = '[data-attstate="present"]';
      const t0 = performance.now();
      document.querySelector(sel).click();
      return new Promise((res) => {
        const tick = () => {
          const now = document.querySelector(sel);
          if (now && now.classList.contains('on')) return res(performance.now() - t0);
          if (performance.now() - t0 > 1000) return res(-1);
          requestAnimationFrame(tick);
        };
        tick();
      });
    });
    if (ms < 0) return { value: null, fail: 'the tap did not appear on screen at all' };
    return { value: Math.round(ms), fail: ms > BUDGET['attendance.local'].max ? `${Math.round(ms)}ms` : null };
  });
  M('doc.bytes', { org: 'empty', role: 'owner', surface: 'dashboard' }, async ({ page }) => {
    const n = await page.evaluate(async () => {
      const r = await fetch(location.href, { headers: { 'accept-encoding': 'gzip' } });
      return Number(r.headers.get('content-length') || 0) || (await r.text()).length;
    });
    return { value: n, fail: n > BUDGET['doc.bytes'].max ? `${(n / 1024).toFixed(0)}KB on the wire` : null };
  });
  // per-surface render cost, measured but not budgeted individually
  for (const surface of SURFACES) {
    M(`render.${surface}`, { org: 'season', role: 'owner', surface: 'dashboard' }, async ({ page }) => {
      const t0 = Date.now();
      await page.evaluate((s) => { S.coachTab = s; render(); }, surface);
      await page.waitForTimeout(60);
      return { value: Date.now() - t0, fail: null };
    }, { budget: { max: null, unit: 'ms', title: `render ${surface}` }, title: `render cost: ${surface}` });
  }
  return out;
}
