/* Doc 28 law 4 — failure is loud, local and legible. Every dependency is cut
 * in turn, on every surface that reads it, and the page must still render with
 * a message that names what went wrong and a way to retry. A blank panel, a
 * generic "something went wrong", or a surface that quietly shows stale rows
 * as if they were fresh, all fail. Doc 29.8. */
import { appText } from '../lib/harness.mjs';

/* [label, url predicate, the surfaces it should be felt on] */
/* Each entry names a dependency and ONLY the surfaces that actually read it.
   The first run had edge functions listed against the dashboard, which reads
   its home through a REST rpc — the check called a healthy screen a liar. A
   test that is wrong about the architecture is worse than no test. */
const DEPENDENCIES = [
  ['PostgREST (all table reads)', (u) => /\/rest\/v1\/(?!rpc)/.test(u), ['roster', 'schedule', 'queue']],
  ['every RPC', (u) => /\/rest\/v1\/rpc\//.test(u), ['dashboard', 'finances']],
  ['the home RPC', (u) => u.includes('/rpc/dashboard_home'), ['dashboard']],
  ['the money RPC', (u) => u.includes('/rpc/money_aged_balances'), ['finances']],
  ['the schedule read', (u) => /\/rest\/v1\/event\?/.test(u), ['schedule']],
  ['the conflict RPC', (u) => u.includes('/rpc/event_conflicts_in_range'), ['schedule']],
  ['the whole backend', (u) => u.includes('supabase.co'), ['dashboard', 'schedule', 'finances', 'roster', 'queue']],
];

export function plan() {
  const out = [];
  for (const [label, pred, surfaces] of DEPENDENCIES) {
    for (const surface of surfaces) {
      out.push({
        id: `law4.${surface}.${label.replace(/\W+/g, '_')}`, law: 4, severity: 'P1', isolate: true,
        title: `${surface} with ${label} dead: renders, says so, offers a way back`,
        /* cut BEFORE the page boots: the surface must fail from cold, not
           inherit rows from a healthy load */
        ctx: { org: 'small', role: 'owner', surface, cut: pred },
        async run({ page }) {
          await page.evaluate((t) => { S.coachTab = t; render(); }, surface);
          await page.waitForTimeout(1600);
          const t = await appText(page);
          if (!t.trim()) return 'blank panel — the surface rendered nothing';
          if (/undefined|\[object Object\]|NaN/.test(t)) return `broken render: ${t.slice(0, 140)}`;
          /* It must either say something legible about the failure, or show its
             own empty state. What it must never do is look like success. */
          const saysSomething = /(couldn't|could not|can't|unable|unavailable|try again|reach|offline)/i.test(t);
          const generic = /^(error|something went wrong)\.?$/i.test(t.trim());
          if (generic) return 'a generic error with nothing actionable';
          /* An empty state is an honest answer only if the surface genuinely has
             nothing cached; showing FIGURES with the source cut is not. */
          const figures = await page.evaluate(() => {
            const el = document.querySelector('#app'); if (!el) return false;
            return /\$\s?[1-9]/.test(el.innerText) || [...el.querySelectorAll('.cui-list__row, .sch-row, .mny-fam, .obcard')].length > 0;
          });
          if (!saysSomething && figures) return 'shows rows or figures while its source is dead';
          if (!saysSomething) return `no legible failure message: ${t.slice(0, 140)}`;
        },
      });
    }
  }
  return out;
}
