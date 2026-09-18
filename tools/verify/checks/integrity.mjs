/* Doc 29.7 (integrity on an empty org) and doc 28's excellence checks:
 * consistency — two surfaces never disagree, the home block and the screen it
 * drills into read the same rows; forgiveness — nothing traps you; honesty in
 * absence — a disconnected integration says so instead of showing nothing. */
import { SURFACES, appText } from '../lib/harness.mjs';

export function plan() {
  const out = [];

  /* 29.7 · an empty org: every surface names what it is watching, rather than
     showing a bare zero or nothing at all. */
  const EMPTY_PHRASES = /(nothing|no |none|not yet|empty|add |import |connect |get started|once you)/i;
  for (const surface of SURFACES) {
    out.push({
      id: `int.empty.${surface}`, law: 'integrity', severity: 'P2',
      title: `${surface} on an empty org says what it is waiting for`,
      ctx: { org: 'empty', role: 'owner', surface },
      async run({ page }) {
        const t = (await appText(page)).trim();
        if (!t) return 'the surface rendered nothing at all';
        if (!EMPTY_PHRASES.test(t)) return `no empty state in words: ${t.slice(0, 140)}`;
      },
    });
  }

  /* Consistency: the home's schedule block and the schedule screen must agree
     on how many events are in the next two days. Two surfaces, one truth. */
  out.push({
    id: 'int.consistency.schedule', law: 'integrity', severity: 'P1', isolate: true,
    title: 'the home schedule block and the schedule screen agree',
    ctx: { org: 'small', role: 'owner', surface: 'dashboard' },
    async run({ page }) {
      await page.waitForFunction(() => S.dashHome?.data, null, { timeout: 20000 });
      const block = await page.evaluate(() => {
        const b = (S.dashHome.data.blocks || []).find((x) => x.key === 'schedule.today');
        return b ? (b.rows || []).map((r) => r.id).sort() : null;
      });
      if (block === null) return { skip: 'no schedule block for this role' };
      await page.evaluate(() => { S.coachTab = 'schedule'; S.schedulePageTab = 'calendar'; render(); });
      await page.waitForFunction(() => S.sched && !S.sched.loading && S.sched.events, null, { timeout: 20000 });
      const screen = await page.evaluate(() => {
        const now = Date.now();
        return (S.sched.events || []).filter((e) => e.status !== 'cancelled' && Date.parse(e.starts_at) >= now - 3600e3 && Date.parse(e.starts_at) < now + 48 * 3600e3).map((e) => e.id).sort();
      });
      const a = JSON.stringify(block), b = JSON.stringify(screen);
      if (a !== b) return `home says ${a}, the schedule says ${b}`;
    },
  });

  /* Consistency: the money block's overdue families and the Money screen's. */
  out.push({
    id: 'int.consistency.money', law: 'integrity', severity: 'P1', isolate: true,
    title: 'the home money block and the Money screen agree on who is overdue',
    ctx: { org: 'small', role: 'owner', surface: 'dashboard' },
    async run({ page }) {
      await page.waitForFunction(() => S.dashHome?.data, null, { timeout: 20000 });
      const block = await page.evaluate(() => {
        const b = (S.dashHome.data.blocks || []).find((x) => x.key === 'money.overdue');
        return b ? (b.rows || []).map((r) => r.id).sort() : null;
      });
      if (block === null) return { skip: 'no money block for this role' };
      await page.evaluate(() => { S.money = null; S.coachTab = 'finances'; render(); });
      await page.waitForFunction(() => S.money?.data?.totals, null, { timeout: 20000 });
      const screen = await page.evaluate(() => (S.money.data.items || []).filter((i) => i.days_overdue > 0).map((i) => i.id).sort());
      const missing = block.filter((id) => !screen.includes(id));
      if (missing.length) return `the home shows ${missing.length} overdue item(s) the Money screen does not: ${missing.slice(0, 3).join(', ')}`;
    },
  });

  /* Forgiveness: no surface traps you — every one offers a way to another. */
  for (const surface of SURFACES) {
    out.push({
      id: `int.escape.${surface}`, law: 'integrity', severity: 'P2',
      title: `${surface} is not a trap: another surface is reachable from it`,
      ctx: { org: 'small', role: 'owner', surface },
      async run({ page }) {
        const n = await page.evaluate(() => document.querySelectorAll('[data-ctab]').length);
        if (!n) return 'no navigation control on the page';
      },
    });
  }

  /* Honesty in absence: with no inbox connected, the agent block must say so
     rather than claiming there is nothing to do. */
  out.push({
    id: 'int.honesty.inbox', law: 'integrity', severity: 'P1',
    title: 'with no inbox connected the agent block offers the connection',
    ctx: { org: 'empty', role: 'owner', surface: 'dashboard' },
    async run({ page }) {
      const t = await appText(page);
      if (!/connect/i.test(t)) return 'no connect prompt where an integration is missing';
    },
  });

  /* Doc 28: the shell never moves. The rail is in the same place on every tab. */
  out.push({
    id: 'int.shell.stable', law: 'integrity', severity: 'P2', isolate: true,
    title: 'the shell does not move between tabs',
    ctx: { org: 'small', role: 'owner', surface: 'dashboard' },
    async run({ page }) {
      const boxes = [];
      for (const s of SURFACES.slice(0, 6)) {
        await page.evaluate((x) => { S.coachTab = x; render(); }, s);
        await page.waitForTimeout(120);
        boxes.push(await page.evaluate(() => {
          const r = document.querySelector('.rail, nav, [class*=rail]');
          const b = r?.getBoundingClientRect();
          return b ? `${Math.round(b.x)},${Math.round(b.width)}` : 'none';
        }));
      }
      const uniq = [...new Set(boxes)];
      if (uniq.length > 1) return `the rail moved between tabs: ${uniq.join(' vs ')}`;
    },
  });

  return out;
}
