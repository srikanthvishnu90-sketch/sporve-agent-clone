/* Doc 29.9 — the field. A phone in one hand, at the narrowest width a person
 * actually carries, with a season's worth of rows on the screen. */
import { SURFACES, WIDTHS } from '../lib/harness.mjs';

export function plan() {
  const out = [];

  for (const width of WIDTHS) {
    for (const surface of SURFACES) {
      out.push({
        id: `mob.overflow.${width}.${surface}`, law: 'mobile', severity: 'P2',
        title: `${surface} at ${width}px never scrolls sideways`,
        ctx: { org: 'small', role: 'owner', surface, width },
        async run({ page }) {
          const m = await page.evaluate(() => ({
            sw: document.documentElement.scrollWidth,
            app: document.getElementById('app')?.scrollWidth || 0,
            cw: document.documentElement.clientWidth,
          }));
          if (m.sw > m.cw + 1 || m.app > m.cw + 1) return `document ${m.sw}px / app ${m.app}px wider than ${m.cw}px`;
        },
      });
    }
  }

  for (const surface of SURFACES) {
    out.push({
      id: `mob.targets.${surface}`, law: 'mobile', severity: 'P2',
      title: `${surface} at 320px: every control is at least 40px tall`,
      ctx: { org: 'small', role: 'owner', surface, width: 320 },
      async run({ page }) {
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('#app button, #app a[href], #app input, #app select, #app [role=button], #app [role=tab]')]
            .filter((e) => {
              const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
              return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && !e.closest('.rail, .aipill, .aidock, [hidden]');
            })
            .filter((e) => e.getBoundingClientRect().height < 40)
            .map((e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''} ${Math.round(e.getBoundingClientRect().height)}px`));
        if (small.length) return `${small.length} under 40px: ${small.slice(0, 5).join(', ')}`;
      },
    });
  }

  /* A season's rows on a phone: the surface must still paint something real. */
  for (const surface of ['dashboard', 'schedule', 'finances', 'roster']) {
    out.push({
      id: `mob.season.${surface}`, law: 'mobile', severity: 'P2',
      title: `${surface} at 320px with a season loaded still renders content`,
      ctx: { org: 'season', role: 'owner', surface, width: 320 },
      async run({ page }) {
        const t = await page.evaluate(() => (document.getElementById('app')?.innerText || '').trim());
        if (t.length < 40) return `almost nothing rendered (${t.length} chars)`;
        if (/undefined|\[object Object\]|NaN/.test(t)) return `broken render: ${t.slice(0, 120)}`;
      },
    });
  }

  return out;
}
