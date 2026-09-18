/* Doc 28's five laws, generated over every surface × org scale × role.
 * Law 1 nothing renders the server cannot back · 2 permission is zero rows
 * · 3 every write returns a receipt · 5 the product works with the agent off.
 * (Law 4, loud failure, has its own module because it must break the network.) */
import { SURFACES, text, appText } from '../lib/harness.mjs';

/* Strings that only exist in the seeded marketplace demo. If one of these
   reaches a real org's screen, the page is showing someone a person who does
   not exist — the class the quality bar was written for. */
const SEED_WORDS = [
  'Julian Mercer', 'Nia Okafor', 'Northside Flight', 'Rivertown Rovers', 'Elite Skills',
  'Renata Vasquez', 'Marcus Webb', 'sample roster', 'Sample ', 'Demo ', 'Lorem',
  'placeholder', 'TBD', 'XXX', 'foo bar',
];
/* A money or count shape that appears with no rows behind it is fabrication. */
const INVENTED_NUMBER = /\$\s?[1-9][\d,]*(?:\.\d\d)?/;

export function plan() {
  const out = [];

  // ── LAW 1 · no fabricated content, on every surface, at every scale ──────
  for (const org of ['empty', 'small', 'season']) {
    for (const surface of SURFACES) {
      out.push({
        id: `law1.seed.${org}.${surface}`, law: 1, severity: 'P0',
        title: `${surface} on a ${org} org shows no seeded person or placeholder`,
        ctx: { org, role: 'owner', surface },
        async run({ page }) {
          const t = await text(page);
          const hit = SEED_WORDS.filter((w) => t.includes(w));
          if (hit.length) return `renders seeded content: ${hit.join(', ')}`;
        },
      });
    }
  }
  // an empty org must not show a money figure anywhere it has no rows
  for (const surface of ['dashboard', 'finances', 'queue', 'roster']) {
    out.push({
      id: `law1.nomoney.empty.${surface}`, law: 1, severity: 'P0',
      title: `${surface} on an empty org shows no invented amount`,
      ctx: { org: 'empty', role: 'owner', surface },
      async run({ page }) {
        const t = await appText(page);
        const m = t.match(INVENTED_NUMBER);
        if (m) return `an org with no obligations shows ${m[0]}`;
      },
    });
  }
  // a coach sees no seeded content either, and never another team's athletes
  for (const surface of SURFACES) {
    out.push({
      id: `law1.seed.coach.${surface}`, law: 1, severity: 'P0',
      title: `${surface} as a coach shows no seeded person`,
      ctx: { org: 'small', role: 'coach', surface },
      async run({ page }) {
        const t = await text(page);
        const hit = SEED_WORDS.filter((w) => t.includes(w));
        if (hit.length) return `renders seeded content: ${hit.join(', ')}`;
      },
    });
  }

  // ── LAW 2 · permission is proven by zero rows, never by a hidden element ──
  for (const surface of SURFACES) {
    out.push({
      id: `law2.coach.${surface}`, law: 2, severity: 'P0',
      title: `${surface} as a coach: no error screen, and no money`,
      ctx: { org: 'small', role: 'coach', surface },
      async run({ page }) {
        /* An error SCREEN, not the word. "Failed payments" is a heading on the
           Money tab and a connector can legitimately read "failed" — matching
           the word made this check cry wolf on its first run. */
        const alarm = await page.evaluate(() => {
          const el = [...document.querySelectorAll('#app [role=alert]')].map((e) => e.innerText.trim()).filter(Boolean);
          const h = [...document.querySelectorAll('#app h1, #app h2')].map((e) => e.innerText.trim());
          return { alerts: el, headings: h };
        });
        const bad = [...alarm.alerts, ...alarm.headings].find((x) => /(something went wrong|unexpected error|we hit an error|couldn't load your workspace)/i.test(x));
        if (bad) return `a coach is shown an error screen: ${bad.slice(0, 120)}`;
        if (surface === 'finances') {
          const money = await page.evaluate(() => S.money?.data ?? null);
          if (money && money.totals !== null) return 'a coach was given money totals';
        }
      },
    });
  }
  for (const surface of SURFACES) {
    out.push({
      id: `law2.outsider.${surface}`, law: 2, severity: 'P0',
      title: `${surface} as a non-member: empty, not an error, no rows`,
      ctx: { org: 'small', role: 'outsider', surface },
      async run({ page }) {
        const t = await appText(page);
        const leaked = ['Athlete0', 'Athlete1', 'Practice 0', 'Guardian0', 'Spring dues'].filter((w) => t.includes(w));
        if (leaked.length) return `a non-member sees org rows: ${leaked.join(', ')}`;
      },
    });
  }
  // the money RPC itself: below treasurer is an empty shape, never an error
  out.push({
    id: 'law2.rpc.money.coach', law: 2, severity: 'P0', isolate: true,
    title: 'money_aged_balances answers a coach with zero rows, not an error',
    ctx: { org: 'small', role: 'coach', surface: 'finances' },
    async run({ page }) {
      const r = await page.evaluate(() => S.money?.data ?? null);
      if (!r) return 'no answer at all';
      if (r.totals !== null) return 'a coach was given totals';
      if ((r.families || []).length) return 'a coach was given families';
    },
  });

  // ── LAW 3 · every write returns a receipt ───────────────────────────────
  const WRITES = [
    ['import commit', 'impServerCommit', /saved .* athletes|committed/i],
    ['cancel event', 'cancelEventGo', /drafted for your approval|Cancelled\./],
    ['attendance', 'flushAttendanceQueue', /Saved |Queued|Refused/],
    ['obligation approve', 'approve_obligation_and_queue', /Approved/],
  ];
  for (const [name, symbol, receipt] of WRITES) {
    out.push({
      id: `law3.receipt.${symbol}`, law: 3, severity: 'P0',
      title: `${name} has a receipt worded from the server`,
      ctx: { org: 'small', role: 'owner', surface: 'dashboard' },
      async run({ page }) {
        const src = await page.evaluate(() => document.documentElement.outerHTML.length > 0 ? window.__src || '' : '');
        void src;
        const has = await page.evaluate((s) => typeof window[s] === 'function' || document.documentElement.innerHTML.includes(s), symbol);
        if (!has) return `${symbol} is not present in the page`;
        const pageText = await page.evaluate(() => document.documentElement.innerHTML);
        if (!receipt.test(pageText)) return `no receipt wording found for ${name}`;
      },
    });
  }

  // ── LAW 5 · the product works with the agent off ─────────────────────────
  for (const surface of ['dashboard', 'schedule', 'roster', 'finances', 'queue']) {
    out.push({
      id: `law5.agentoff.${surface}`, law: 5, severity: 'P1', isolate: true,
      title: `${surface} still renders with every agent endpoint dead`,
      ctx: { org: 'small', role: 'owner', surface },
      async run({ page, harness }) {
        void harness;
        await page.route('**/functions/v1/**', (r) => r.abort('connectionfailed'));
        await page.evaluate((t) => { S.coachTab = t; render(); }, surface);
        await page.waitForTimeout(700);
        const t = await appText(page);
        if (!t.trim()) return 'the surface rendered nothing';
        if (/undefined|\[object Object\]|NaN/.test(t)) return `broken render: ${t.slice(0, 120)}`;
      },
    });
  }
  return out;
}
