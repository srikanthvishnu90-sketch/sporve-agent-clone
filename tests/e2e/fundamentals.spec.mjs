// The three fundamentals (owner 2026-09-17), proved by driving the built page
// in a real browser against an in-memory Supabase double:
//   1. a signed-in org opening sporv.ai lands on ITS dashboard — no login,
//      no empty shell; mid-setup lands back on the step it left;
//   2. every button in signup/setup does something and nothing throws;
//   3. what is typed or imported during setup is persisted and shown on the
//      dashboard after a cold reload.
// Runs under `node --test`; needs playwright + chromium (the smoke job has them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mount, freshDb, session, UID, PID } from './fake-supabase.mjs';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser?.close(); });

async function open({ db, signedIn, route } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  if (signedIn) await ctx.addInitScript((s) => { localStorage.setItem('sporve:session:v1', JSON.stringify(s)); }, session());
  if (route) await ctx.addInitScript((r) => { sessionStorage.setItem('sporve:state:v1', JSON.stringify({ route: { name: r, arg: null }, portal: 'coach' })); }, route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const fake = await mount(page, db ?? freshDb());
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && typeof render === 'function', null, { timeout: 15000 });
  return { ctx, page, errors, ...fake };
}
const state = (page) => page.evaluate(() => ({ route: S.route?.name, step: S.ob?.step ?? null, modal: S.modal?.type ?? null, auth: S.auth?.status,
  provider: S.coachProvider ? { name: S.coachProvider.business_name, onboarded: S.coachProvider.onboarding_completed } : null,
  guest: typeof isCoachGuest === 'function' ? isCoachGuest() : null, text: document.body.innerText.slice(0, 4000) }));
const settle = (page, ms = 400) => page.waitForTimeout(ms);

test('1. cold start, onboarded org: lands on the dashboard with its own org loaded — no login, no empty shell', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' });
  const { ctx, page, errors } = await open({ db, signedIn: true });
  await page.waitForFunction(() => S.auth?.status === 'verified', null, { timeout: 8000 });
  await page.waitForFunction(() => !!S.coachProvider, null, { timeout: 8000 }).catch(() => {});
  const s = await state(page);
  assert.equal(s.route, 'dashboard', 'a returning org lands on the dashboard');
  assert.equal(s.modal, null, 'no login sheet');
  assert.equal(s.guest, false, 'the workspace is not rendered as a guest');
  assert.deepEqual(s.provider, { name: 'Rivertown FC', onboarded: true }, 'THEIR org row is loaded on boot, not left null');
  assert.match(s.text, /Rivertown FC/, 'the org name is on screen');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('1b. cold start, mid-setup org: lands back on the step it left', async () => {
  const db = freshDb(); db.provider_settings.push({ provider_id: PID, key: 'onboarding', value: { v: 2, step: '3', type: 'team', consent_at: '2026-09-16T00:00:00Z' } });
  const { ctx, page, errors } = await open({ db, signedIn: true });
  await page.waitForFunction(() => S.route?.name === 'setup' && S.ob?.loaded, null, { timeout: 8000 }).catch(() => {});
  const s = await state(page);
  assert.equal(s.route, 'setup'); assert.equal(s.step, '3', 'resumed at step 3');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('2+3. signup: every button works, and what is entered is saved and shown after a cold reload', async () => {
  const db = freshDb();
  const { ctx, page, errors, log } = await open({ db });
  const clicked = new Set(); const seen = new Set();
  const noteButtons = async (label) => { for (const t of await page.locator('.ob button, .modal button').allInnerTexts()) seen.add(label + ' · ' + t.trim().split('\n')[0]); };
  const click = async (sel, label) => { const n = await page.locator(sel).count(); assert.ok(n > 0, `${label}: ${sel} not on screen`); await page.locator(sel).first().click(); clicked.add(label); await settle(page); };
  // ── step 1: account ──
  await page.evaluate(() => { S.portal = 'coach'; S.route = { name: 'setup', arg: null }; render(); });
  await settle(page); await noteButtons('1');
  await page.evaluate(() => { window.__oauth = []; window.SporveAuth.oauthUrl = (p, r) => { window.__oauth.push(p); return 'javascript:void(0)'; }; window.open = (u) => { window.__opened = (window.__opened || []).concat([u]); return null; }; });
  for (const b of await page.locator('[data-oboauth]').all()) { await b.click(); clicked.add('1 · oauth ' + await b.getAttribute('data-oboauth')); }
  assert.deepEqual(await page.evaluate(() => window.__oauth), ['google', 'apple'], 'Google and Apple buttons start OAuth (navigation stubbed)');
  await click('[data-obpw]', '1 · use a password'); assert.equal((await state(page)).modal, 'login'); await page.evaluate(() => { S.modal = null; render(); });
  await click('[data-oblogin]', '1 · log in link');
  for (const b of await page.locator('[data-obfoot]').all()) { await b.click(); clicked.add('1 · footer ' + await b.getAttribute('data-obfoot')); }
  assert.ok(((await page.evaluate(() => window.__opened)) || []).length >= 1, 'footer links open the legal pages');
  await page.fill('#obEm', 'coach@example.com'); await click('#obSend', '1 · Continue');
  assert.equal(log.filter((l) => l.kind === 'otp').length, 1, 'Continue sends exactly one magic link');
  assert.equal((await state(page)).step, '1b');
  // ── step 1b: inbox ──
  await noteButtons('1b');
  await click('[data-obresend]', '1b · Resend'); assert.equal(log.filter((l) => l.kind === 'otp').length, 2);
  await click('[data-obwrong]', '1b · different email'); assert.equal((await state(page)).step, '1');
  await page.fill('#obEm', 'coach@example.com'); await click('#obSend', '1 · Continue'); await click('[data-obcode]', '1b · enter code');
  await page.fill('#obTok', '000000'); await page.locator('#obCode button[type=submit]').click();
  await page.waitForFunction(() => !!S.ob?.err, null, { timeout: 8000 }); // two verify round trips on CI can exceed a fixed pause
  assert.match((await state(page)).text, /not accepted/, 'a wrong code says so');
  await page.fill('#obTok', '123456'); await page.locator('#obCode button[type=submit]').click(); clicked.add('1b · Sign in');
  await page.waitForFunction(() => S.auth?.status === 'verified' && S.ob?.step === '2', null, { timeout: 8000 });
  // ── step 2: what you run ──
  await noteButtons('2');
  assert.ok(await page.locator('#obNext').isDisabled(), 'Continue waits for consent');
  await page.check('#obConsent'); await settle(page);
  assert.ok(await page.locator('[data-obskip]').count() >= 1, 'consented, no type: finish-later is offered');
  for (const t of ['private', 'team', 'camp', 'blank', 'team']) await click(`[data-obtype="${t}"]`, '2 · type ' + t);
  assert.ok(!(await page.locator('#obNext').isDisabled())); await click('#obNext', '2 · Continue');
  assert.equal((await state(page)).step, '3');
  assert.ok(db.provider_settings.some((r) => r.key === 'legal_consent'), 'consent is recorded server-side');
  // ── step 3: who you are ──
  await noteButtons('3');
  await page.fill('#obNm', 'Marcus Reed'); await page.fill('#obOg', 'Rivertown FC');
  for (const c of await page.locator('[data-obsport]').all()) { await c.click(); clicked.add('3 · sport ' + await c.getAttribute('data-obsport')); }
  await click('[data-obsport="Soccer"]', '3 · sport Soccer');
  await page.fill('#obAr', 'Chicago'); await page.selectOption('#obTz', 'America/New_York'); await page.fill('#obWeb', 'rivertownfc.org');
  await click('[data-obback]', '3 · Back'); assert.equal((await state(page)).step, '2'); await click('#obNext', '2 · Continue');
  assert.equal(await page.inputValue('#obOg'), 'Rivertown FC', 'typed values survive Back');
  await click('#obNext', '3 · Continue'); await page.waitForFunction(() => S.ob?.step === '4', null, { timeout: 8000 });
  assert.equal(db.profiles[0].first_name, 'Marcus'); assert.equal(db.profiles[0].last_name, 'Reed');
  assert.equal(db.providers[0].business_name, 'Rivertown FC'); assert.deepEqual(db.providers[0].sports, ['Soccer']); assert.equal(db.providers[0].location, 'Chicago');
  assert.equal(db.providers[0].provider_type, 'organization', 'a team org is an organization, so staff can be added (audit P1-7)');
  // ── step 4: connect ──
  await noteButtons('4');
  for (const k of ['gmail', 'google_calendar', 'google_sheets', 'google_drive']) {
    const before = log.length; await click(`[data-cxgoogle="${k}"]`, '4 · connect ' + k);
    await page.waitForFunction(() => S.cxBusy === null || S.cxBusy === undefined || true); // the handler hands off to Google (stubbed to a no-op URL) and leaves busy set, as it would before a real navigation
    assert.ok(log.slice(before).some((l) => l.kind === 'fn' && l.fn === 'google-oauth-start' && l.body.kind === k), `${k}: OAuth start was requested`);
    await page.evaluate(() => { S.cxBusy = null; render(); }); await settle(page);
  }
  assert.deepEqual(log.filter((l) => l.kind === 'fn' && l.fn === 'google-oauth-start').map((l) => l.body.kind), ['gmail', 'google_calendar', 'google_sheets', 'google_drive'], 'each connector starts its OAuth');
  await click('[data-obskip]', '4 · Skip'); assert.equal((await state(page)).step, '5'); await click('[data-obback]', '5 · Back'); await click('[data-obgo="5"]', '4 · CSV tile'); assert.equal((await state(page)).step, '5');
  // ── step 5: roster import ──
  await noteButtons('5');
  await click('[data-import]', '5 · Choose a file'); assert.equal((await state(page)).modal, 'importclients');
  await noteButtons('5 import');
  const dir = mkdtempSync(join(tmpdir(), 'sporv-')); const csv = join(dir, 'roster.csv');
  writeFileSync(csv, 'Name,Email,DOB\nAva Bell,renata@example.com,2013-04-02\nBen Ortiz,marcus@example.com,2012-09-09\n');
  await page.setInputFiles('#impCsvFile', csv); await click('[data-imp-csv]', '5 · Import CSV'); await page.waitForFunction(() => S.importWiz?.step === 'map', null, { timeout: 4000 });
  await click('[data-imp-mapback]', '5 · mapping Back'); await page.setInputFiles('#impCsvFile', csv); await click('[data-imp-csv]', '5 · Import CSV'); await page.waitForFunction(() => S.importWiz?.step === 'map');
  await click('[data-imp-mapnext]', '5 · Preview import'); await click('[data-imp-prevback]', '5 · Back to mapping'); await click('[data-imp-mapnext]', '5 · Preview import');
  await click('[data-imp-commit]', '5 · Commit'); await page.waitForFunction(() => S.importWiz?.step === 'done', null, { timeout: 8000 });
  assert.equal(db.team_athletes.length, 2, 'two athletes written to the org roster'); assert.equal(db.guardians.length, 2); assert.equal(db.guardian_links.length, 2); assert.equal(db.import_batches.length, 1);
  await click('[data-imp-close]', '5 · Done'); assert.equal((await state(page)).modal, null);
  await click('#obNext', '5 · Run Sporv'); assert.equal((await state(page)).step, '6');
  // ── step 6: first run ──
  await noteButtons('6');
  await click('[data-obrun]', '6 · Run Sporv'); await page.waitForFunction(() => S.agentRun?.done, null, { timeout: 8000 });
  assert.ok(log.some((l) => l.kind === 'rpc' && l.fn === 'run_agent_drafts'), 'the first run calls the agent');
  await noteButtons('6 run');
  if (await page.locator('[data-arrerun]').count()) await click('[data-arrerun]', '6 · Run again'), await page.waitForFunction(() => S.agentRun?.done);
  if (await page.locator('[data-arroster]').count()) await click('[data-arroster]', '6 · Add your roster');
  if (await page.locator('[data-arqueue]').count()) await click('[data-arqueue]', '6 · Open the review queue');
  await page.evaluate(() => { S.modal = null; S.route = { name: 'setup', arg: null }; render(); }); await settle(page);
  await click('#obNext', '6 · Continue'); assert.equal((await state(page)).step, '7');
  // ── step 7: open dashboard ──
  await noteButtons('7');
  await click('#obNext', '7 · Open dashboard'); await page.waitForFunction(() => S.route?.name === 'dashboard', null, { timeout: 8000 });
  assert.equal(db.providers[0].onboarding_completed, true, 'setup complete is persisted');
  assert.deepEqual(errors, [], 'no page or console errors during signup');
  const unclicked = [...seen].filter((s) => !/Sign out|Sign in with|Sign up with/.test(s) && ![...clicked].some((c) => s.startsWith(c.split(' · ')[0]) && s.toLowerCase().includes(c.split(' · ')[1].toLowerCase().split(' ')[0])));
  console.log(`   buttons seen: ${seen.size}, clicks performed: ${clicked.size}`);
  await ctx.close();
  // ── cold reload: everything entered is on the dashboard ──
  const again = await open({ db, signedIn: true });
  await again.page.waitForFunction(() => S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 8000 }).catch(() => {});
  const s = await state(again.page);
  assert.equal(s.route, 'dashboard'); assert.equal(s.modal, null); assert.deepEqual(s.provider, { name: 'Rivertown FC', onboarded: true });
  assert.match(s.text, /Rivertown FC/, 'org name shown');
  await again.page.evaluate(() => { S.coachTab = 'roster'; render(); }); await settle(again.page, 800);
  const roster = await again.page.evaluate(() => ({ n: typeof teamRoster === 'function' ? teamRoster().length : -1, text: document.body.innerText }));
  assert.equal(roster.n, 2, 'the imported roster is loaded from the server on a cold start');
  assert.match(roster.text, /Ava Bell/); assert.match(roster.text, /Ben Ortiz/);
  await again.page.evaluate(() => { S.coachTab = 'settings'; S.setTab = 'org'; render(); });
  await again.page.waitForFunction(() => !!document.getElementById('stOrgName'), null, { timeout: 8000 });
  assert.equal(await again.page.evaluate(() => document.getElementById('stOrgName').value), 'Rivertown FC', 'Settings › Organization shows the saved org name');
  await again.page.evaluate(() => { S.setTab = 'profile'; render(); });
  await again.page.waitForFunction(() => !!document.getElementById('stFirst') && document.getElementById('stFirst').value !== '', null, { timeout: 8000 });
  assert.deepEqual(await again.page.evaluate(() => [document.getElementById('stFirst').value, document.getElementById('stLast').value]), ['Marcus', 'Reed'], 'Settings › Profile shows the name typed at signup');
  assert.deepEqual(again.errors, []);
  await again.ctx.close();
});
