/* NOBODY IS EVER AUTO-LOGGED INTO SPORV.
 *
 * Owner's standing rule, restated 2026-09-18: "never autologin someone to
 * sporv ai". This module is that rule made mechanical, because it is the kind
 * of rule a well-meaning convenience feature breaks — a cached profile, a
 * remembered email, a "welcome back" shortcut. Each check arrives at the app
 * the way a stranger or a half-cleared device would, and asserts that the
 * product treats a missing session as signed out. Every one of these is P0:
 * an auto-login is an account takeover on a shared phone.
 *
 * The two states that matter:
 *   noSession   — nothing in storage at all. A stranger, or a signed-out device.
 *   profileOnly — a cached profile with NO session token. What a device looks
 *                 like after a partial clear, and the exact shape the offline
 *                 work of #52 introduced. It must not be a key.
 */
import { SURFACES, appText } from '../lib/harness.mjs';

const SIGNED_IN_TELLS = /(Rivertown FC|Athlete0|Spring dues|Practice 0|Guardian0)/;

export function plan() {
  const out = [];

  /* A stranger, on every surface: never a workspace, never someone's rows. */
  for (const surface of SURFACES) {
    out.push({
      id: `auth.stranger.${surface}`, law: 'auth', severity: 'P0',
      title: `${surface} with no session: signed out, no org data`,
      ctx: { org: 'small', role: 'owner', surface, noSession: true },
      async run({ page }) {
        const st = await page.evaluate(() => ({
          status: S.auth?.status ?? null,
          user: S.auth?.user ?? null,
          provider: S.coachProvider ?? null,
          real: typeof realSignedIn === 'function' ? realSignedIn() : null,
        }));
        if (st.real) return 'realSignedIn() is true with nothing in storage';
        if (st.status === 'verified') return 'the app reports a verified session with none present';
        if (st.user) return `an identity was invented: ${JSON.stringify(st.user).slice(0, 100)}`;
        if (st.provider) return `an organization was loaded for nobody: ${JSON.stringify(st.provider).slice(0, 80)}`;
        const t = await appText(page);
        const leak = t.match(SIGNED_IN_TELLS);
        if (leak) return `a signed-out visitor is shown org data: ${leak[0]}`;
      },
    });
  }

  /* A cached profile is a convenience, never a credential. */
  for (const surface of ['dashboard', 'roster', 'finances', 'schedule', 'queue']) {
    out.push({
      id: `auth.profileonly.${surface}`, law: 'auth', severity: 'P0',
      title: `${surface} with a cached profile but no session: still signed out`,
      ctx: { org: 'small', role: 'owner', surface, profileOnly: true },
      async run({ page }) {
        const st = await page.evaluate(() => ({
          status: S.auth?.status ?? null,
          real: typeof realSignedIn === 'function' ? realSignedIn() : null,
          provider: S.coachProvider ?? null,
          down: !!S.backendDown,
          unknown: !!S.authUnknown,
        }));
        if (st.real || st.status === 'verified') return 'a cached profile was accepted as a login';
        if (st.provider) return 'an organization was loaded from a cached profile alone';
        if (st.down || st.unknown) return 'the unreachable-server state was claimed without a session';
        const t = await appText(page);
        const leak = t.match(SIGNED_IN_TELLS);
        if (leak) return `org data rendered from a cached profile: ${leak[0]}`;
      },
    });
  }

  /* A stranger whose network is also dead must still be a stranger: the
     offline path added in #52 keys on a HELD SESSION, and this is the check
     that keeps it that way. */
  out.push({
    id: 'auth.stranger.offline', law: 'auth', severity: 'P0', isolate: true,
    title: 'no session and no backend: signed out, and no unreachable-server claim',
    ctx: { org: 'small', role: 'owner', surface: 'dashboard', noSession: true, cut: (u) => u.includes('supabase.co') },
    async run({ page }) {
      const st = await page.evaluate(() => ({ status: S.auth?.status ?? null, down: !!S.backendDown, real: typeof realSignedIn === 'function' ? realSignedIn() : null }));
      if (st.real || st.status === 'verified') return 'a dead backend produced a signed-in state';
      if (st.down) return 'the unreachable-server screen was shown to someone who is not signed in';
    },
  });

  /* The source itself: no code path may mint a session the server did not
     issue. A grep is the right instrument here — it catches the convenience
     feature at the moment someone writes it, on a surface no click reaches. */
  out.push({
    id: 'auth.source.no-minted-session', law: 'auth', severity: 'P0',
    title: 'no code path writes a session token the server did not issue',
    ctx: { org: 'empty', role: 'owner', surface: 'dashboard' },
    async run({ page }) {
      const bad = await page.evaluate(() => {
        const src = document.documentElement.innerHTML;
        const hits = [];
        /* writing the session key with anything but a server response */
        const re = /setItem\(\s*["']sporve:session:v1["']\s*,\s*([^)]{0,80})/g;
        let m;
        while ((m = re.exec(src))) {
          const arg = m[1];
          if (!/JSON\.stringify\(\s*(session|tokens|s)\b/.test(arg)) hits.push(arg.slice(0, 60));
        }
        /* and the classic shape of an auto-login */
        if (/auth\s*=\s*\{\s*status\s*:\s*["']verified["'][^}]*\}\s*;?\s*\/\/\s*auto/i.test(src)) hits.push('an explicitly automatic verified state');
        return hits;
      });
      if (bad.length) return `a session may be minted client-side: ${bad.join(' | ')}`;
    },
  });

  return out;
}
