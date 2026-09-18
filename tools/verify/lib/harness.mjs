/* The verification agent's harness — audit doc 29 run as a program.
 *
 * Deterministic by construction: the built page is served from a local http
 * origin and every backend answer comes from the same in-memory double the
 * browser suites use (tests/e2e/fake-supabase.mjs). No live project, no live
 * model, no API key, no money. That is deliberate — a standard you can only
 * check by spending is a standard you will stop checking.
 *
 * Checks declare the CONTEXT they need (org fixture · role · viewport). The
 * runner groups by context and opens one page per group, so ~250 checks cost
 * ~20 page loads. A check that has to break the network declares isolate:true
 * and gets a page of its own.
 */
import { chromium } from 'playwright';
import { mount, freshDb, session, UID, PID, SUPABASE } from '../../../tests/e2e/fake-supabase.mjs';
import { serve } from '../../../tests/e2e/serve.mjs';

export { UID, PID, SUPABASE };
const D = 86400e3, H = 3600e3;
export const iso = (ms) => new Date(ms).toISOString();

/* ── the org fixtures every check is measured against ────────────────────── */
export const ORGS = {
  /* A club that just signed up. Every surface must render its own empty state
     and invent nothing (doc 28 law 1). */
  empty: () => freshDb({ onboarded: true, name: 'Rivertown FC' }),

  /* One week of a real small club: two teams, twelve athletes, three events,
     four families owing money, four agent drafts. */
  small: () => {
    const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
    const now = Date.now();
    db.teams.push({ id: 't14', provider_id: PID, name: '14U Flight' }, { id: 't16', provider_id: PID, name: '16U Flight' });
    for (let i = 0; i < 12; i++) db.team_athletes.push({ id: 'a' + i, provider_id: PID, team_id: i % 2 ? 't16' : 't14', first_name: 'Athlete' + i, last_name: 'Surname' + i, jersey_number: String(i), dob: '2012-04-0' + ((i % 9) + 1), status: 'active' });
    for (let i = 0; i < 4; i++) db.guardians.push({ id: 'g' + i, provider_id: PID, first_name: 'Guardian' + i, last_name: 'Family' + i, email: `g${i}@example.com`, email_status: 'ok' });
    for (let i = 0; i < 3; i++) db.event.push({ id: 'e' + i, provider_id: PID, team_id: i % 2 ? 't16' : 't14', kind: 'practice', title: 'Practice ' + i, starts_at: iso(now + (i + 1) * D), ends_at: iso(now + (i + 1) * D + H), timezone: 'America/Chicago', location_text: 'Field 1', status: 'scheduled', published_at: iso(now - D), sequence: 0 });
    for (let i = 0; i < 4; i++) db.obligations.push({ id: 'o' + i, provider_id: PID, kind: 'fee', status: i % 2 ? 'approved' : 'draft', source_kind: i % 2 ? 'manual' : 'agent', draft_type: i % 2 ? null : 'dues_reminder', title: 'Spring dues ' + i, detail: 'The family still owes the spring balance.', amount_cents: 12000, due_at: iso(now - (i * 20 + 5) * D), guardian_id: 'g' + i, member_id: 'a' + i });
    return db;
  },

  /* A season at the scale doc 29 names: 200 athletes, 12 teams, 400 events,
     600 fee obligations. Every performance row is measured here. */
  season: () => {
    const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
    const now = Date.now(); const base = new Date(); base.setDate(1); base.setHours(18, 0, 0, 0);
    for (let t = 0; t < 12; t++) db.teams.push({ id: 't' + t, provider_id: PID, name: `Team ${t}` });
    for (let i = 0; i < 200; i++) db.team_athletes.push({ id: 'a' + i, provider_id: PID, team_id: 't' + (i % 12), first_name: 'Athlete' + i, last_name: 'Surname' + i, jersey_number: String(i % 99), dob: '2011-06-15', status: 'active' });
    for (let i = 0; i < 40; i++) db.guardians.push({ id: 'g' + i, provider_id: PID, first_name: 'Guardian' + i, last_name: 'Family' + i, email: `g${i}@example.com`, email_status: 'ok' });
    for (let i = 0; i < 400; i++) db.event.push({ id: 'e' + i, provider_id: PID, team_id: 't' + (i % 12), kind: i % 5 === 0 ? 'game' : 'practice', title: 'Session ' + i, starts_at: iso(base.getTime() + (i % 28) * D + (i % 3) * H), ends_at: iso(base.getTime() + (i % 28) * D + (i % 3) * H + H), timezone: 'America/Chicago', location_text: 'Field ' + (i % 4), status: 'scheduled', published_at: iso(now - D), sequence: 0 });
    for (let i = 0; i < 600; i++) db.obligations.push({ id: 'o' + i, provider_id: PID, kind: 'fee', status: i % 3 ? 'approved' : 'draft', source_kind: i % 3 ? 'manual' : 'agent', draft_type: i % 3 ? null : 'dues_reminder', title: 'Dues ' + i, detail: 'Season balance.', amount_cents: 10000, due_at: iso(now - ((i % 4) - 1) * 20 * D), guardian_id: 'g' + (i % 40), member_id: 'a' + (i % 200) });
    return db;
  },
};

/* A coach works in someone else's org: the provider is owned elsewhere and the
   signed-in user holds a trainer membership (migration 001075). */
export function asCoach(db) {
  db.providers[0].owner_id = 'someone-else';
  db.providers.push({ id: 'own-org', owner_id: UID, business_name: 'Your organization', onboarding_completed: false });
  db.organization_members.push({ id: 'm-coach', organization_id: PID, member_user_id: UID, role: 'trainer', is_active: true });
  return db;
}
/* Nobody: a signed-in person with no membership anywhere near this org. */
export function asOutsider(db) {
  db.providers[0].owner_id = 'someone-else';
  db.providers.push({ id: 'own-org', owner_id: UID, business_name: 'Your organization', onboarding_completed: false });
  return db;
}

export const SURFACES = ['dashboard', 'queue', 'roster', 'schedule', 'finances', 'operations', 'settings', 'listings', 'approvals', 'billing'];
export const WIDTHS = [320, 390, 1280];

export function buildDb({ org = 'small', role = 'owner' } = {}) {
  const db = ORGS[org]();
  if (role === 'coach') return asCoach(db);
  if (role === 'outsider') return asOutsider(db);
  return db;
}

export class Harness {
  constructor() { this.browser = null; this.site = null; this.pool = new Map(); }
  async start() { this.browser = await chromium.launch(); this.site = await serve(); }
  async stop() {
    for (const p of this.pool.values()) { try { await p.ctx.close(); } catch {} }
    await this.browser?.close(); await this.site?.close();
  }
  /* The pool key deliberately EXCLUDES the surface: switching tabs is a
     render() call, opening a browser context is seconds. Keying on the surface
     turned 44 mobile checks into 44 contexts and a 33-minute run. */
  key(ctx) { return `${ctx.org || 'small'}|${ctx.role || 'owner'}|${ctx.width || 1280}`; }

  /* One page per (org · role · width), switched to whichever surface the check
     asked for. */
  async page(ctx) {
    const k = this.key(ctx);
    let env = this.pool.get(k);
    if (!env) { env = await this.open(ctx); this.pool.set(k, env); }
    const surface = ctx.surface || 'dashboard';
    if (env.surface !== surface) {
      await env.page.evaluate((t) => { S.coachTab = t; render(); }, surface);
      await env.page.waitForTimeout(surface === 'dashboard' ? 700 : 500);
      env.surface = surface;
    }
    return env;
  }
  /* A page nobody else shares — for checks that cut the network or type. */
  async isolated(ctx) { return this.open(ctx); }

  async open(ctx) {
    const width = ctx.width || 1280;
    const context = await this.browser.newContext({ viewport: { width, height: width <= 430 ? 780 : 900 }, ...(width <= 430 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await context.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message)));
    const db = ctx.db || buildDb(ctx);
    if (typeof ctx.mutate === 'function') ctx.mutate(db);   // adversarial data fixtures
    const { log } = await mount(page, db);
    /* The cut goes in AFTER mount and BEFORE navigation. After, because
       Playwright gives the last-registered route priority and the backend
       double would otherwise answer everything this check means to kill —
       which is exactly how the first version of this harness graded a
       never-cut backend as healthy. Before navigation, so the surface boots
       with the dependency dead instead of inheriting a healthy load's rows. */
    if (typeof ctx.cut === 'function') await page.route((u) => ctx.cut(u.href), (r) => r.abort('connectionfailed'));
    const requests = []; page.on('request', (r) => { if (r.url().startsWith(SUPABASE)) requests.push(r.method() + ' ' + r.url().slice(SUPABASE.length).split('?')[0]); });
    await page.goto(this.site.index, { waitUntil: 'domcontentloaded' });
    if (ctx.cut) {
      /* With the backend cut the workspace may never arrive; wait for the app
         to exist, not for a provider it cannot fetch. */
      await page.waitForFunction(() => typeof S === 'object' && typeof render === 'function', null, { timeout: 30000 });
      await page.waitForTimeout(1200);
    } else {
      await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 30000 });
    }
    const surface = ctx.surface || 'dashboard';
    await page.evaluate((t) => { S.coachTab = t; render(); }, surface);
    await page.waitForTimeout(surface === 'dashboard' ? 900 : 700);
    return { ctx: context, page, db, log, errors, requests, surface };
  }
}

/* Helpers every check may use. */
export const text = (page) => page.evaluate(() => document.body.innerText);
export const appText = (page) => page.evaluate(() => document.getElementById('app')?.innerText || '');
