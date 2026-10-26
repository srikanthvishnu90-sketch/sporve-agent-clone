// Preview depth — the signed-out coach preview shows the Manage product.
//   1. Each formerly locked tab (Money, roster, Teams, Families, Messages,
//      Organization) renders the disclosed sample club with the
//      "Sample workspace." label, and never the "Sign in to see this" lock.
//   2. A write-shaped button in the sample says it was not saved and sends
//      nothing to the network.
//   3. With a Supabase session present, no tab ever shows the sample club:
//      while auth is still settling the lock stays up, and once signed in the
//      real page renders.
//   4. Home, Schedule and Operations no longer speak marketplace
//      ("listings", "bookings"), checked in source and in the rendered page.
//   5. The preview Schedule carries a practice, a game, a tournament and the
//      Sat 10:00 court conflict the Queue sample drafted a fix for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { mount, freshDb, session } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
const HOST = readFileSync(new URL('../../src/sporve-web.host.html', import.meta.url), 'utf8');
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

const TABS = {
  finances: ['Money', /Jordan Carter/, /\$4,800/],
  roster: ['Clients', /Marcus Bell/, /Northside Flight 16U/],
  teams: ['Teams', /Northside Flight 14U/, /Dana Ruiz/],
  families: ['Families', /Renata Okafor/, /Keisha Bell/],
  inbox: ['Messages', /Is there a form Nia needs/, /16U families/],
  organization: ['Organization', /Lakeview Fieldhouse/, /Marcus Vale/],
};
const SAMPLE_NAMES = /Renata Okafor|Keisha Bell|Jordan Carter|Lakeview Fieldhouse|Sample workspace\./;

async function guestPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = []; const writes = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://aveqjeafghmwafkbbnor.supabase.co/**', (r) => {
    if (r.request().method() !== 'GET') writes.push(r.request().method() + ' ' + r.request().url());
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && typeof render === 'function' && !!window.MOD_PREVIEW);
  await page.evaluate(() => { enterCoachPortal(); render(); });
  return { ctx, page, errors, writes };
}
const show = (page, t) => page.evaluate((t) => { setCoachTab(t); render(); return (document.querySelector('.dash') || document.querySelector('#app') || document.body).innerText; }, t);

test('guest preview: every formerly locked tab renders labelled sample content, not the lock', async () => {
  const { ctx, page, errors, writes } = await guestPage();
  assert.equal(await page.evaluate(() => previewSample()), true);
  for (const [tab, [h1, a, b]] of Object.entries(TABS)) {
    const text = await show(page, tab);
    assert.doesNotMatch(text, /Sign in to see this/, `${tab} is still locked`);
    assert.match(text, /Sample workspace\. These are example .+ so you can see how it works\. Nothing here is saved\./, `${tab} lacks the sample label`);
    assert.match(text, new RegExp(h1, 'i'), `${tab} heading`);
    assert.match(text, a, `${tab} sample content`); assert.match(text, b, `${tab} sample content`);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('guest preview: the sample is one coherent club (money adds up, queue names line up)', async () => {
  const { ctx, page } = await guestPage();
  const s = await page.evaluate(() => {
    const t = MOD_PREVIEW._test, tot = t.totals();
    return { tot, missing: t.roster.filter((a) => !a.waiver).map((a) => a.name), names: t.roster.map((a) => a.name) };
  });
  assert.equal(s.tot.collected + s.tot.overdue + s.tot.upcoming, s.tot.billed);
  assert.deepEqual(s.tot, { billed: 8400, collected: 4800, overdue: 800, upcoming: 2800, overdueFamilies: 3 });
  assert.equal(s.missing.length, 3, 'the queue says three athletes are missing a waiver');
  assert.ok(s.missing.includes('Nia Okafor') && s.missing.includes('Marcus Bell'));
  for (const n of ['Julian Mercer', 'Nia Okafor', 'Ida Nilsen', 'Eli Carter']) assert.ok(s.names.includes(n), `${n} from the existing 14U sample`);
  await ctx.close();
});

test('guest preview: a sample write says it was not saved and sends nothing', async () => {
  const { ctx, page, writes } = await guestPage();
  await show(page, 'finances');
  await page.click('[data-pvsave]');
  assert.match(await page.evaluate(() => S.toast || ''), /Not saved in the sample workspace/);
  await show(page, 'inbox');
  await page.click('[data-pvthread="carter"]');
  assert.match(await page.evaluate(() => document.querySelector('.pv-pane').innerText), /split the remaining \$400/);
  await page.fill('#pvReply', 'See you Thursday');
  await page.click('.pv-compose button[type=submit]');
  assert.match(await page.evaluate(() => S.toast || ''), /Not saved in the sample workspace/);
  await page.waitForTimeout(200);
  assert.deepEqual(writes, []);
  await ctx.close();
});

test('session present but auth not settled: the lock stays, never the sample', async () => {
  const { ctx, page } = await guestPage();
  await page.evaluate(() => { window.SporveAuth.isSignedIn = () => true; });
  assert.equal(await page.evaluate(() => previewSample()), false);
  for (const tab of Object.keys(TABS)) {
    const text = await show(page, tab);
    assert.match(text, /Sign in to see this/, `${tab} must stay locked`);
    assert.doesNotMatch(text, SAMPLE_NAMES, `${tab} leaked sample rows`);
  }
  await ctx.close();
});

test('signed in: no formerly locked tab shows the sample club or the lock', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await mount(page, freshDb({ onboarded: true, name: 'Lakeview College' }));
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => previewSample()), false);
  for (const tab of Object.keys(TABS)) {
    const text = await show(page, tab);
    assert.doesNotMatch(text, SAMPLE_NAMES, `${tab} shows sample rows to a signed-in coach`);
    assert.doesNotMatch(text, /Sign in to see this/, `${tab} locked for a signed-in coach`);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Home, Schedule and Operations drop the marketplace wording (source and render)', async () => {
  const slice = (name) => { const a = HOST.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return HOST.slice(a, HOST.indexOf('\nfunction ', a + 10)); };
  const RETIRED = /Active listings|Paid bookings|Sessions families can book|Sessions across your listings|Based on your listings|clients, sessions, and bookings|published listings/;
  for (const fn of ['coachHomePage', 'coachSchedulePage', 'coachOperationsPage']) assert.doesNotMatch(slice(fn), RETIRED, fn);
  const onboarding = readFileSync(new URL('../../src/mod-coachonboard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(onboarding, /title:"(Build your public profile|Publish your first listing|Pass your background check)"/);
  const { ctx, page } = await guestPage();
  for (const tab of ['dashboard', 'schedule', 'operations']) {
    const text = await show(page, tab);
    assert.doesNotMatch(text, /listing|booking/i, `${tab} still says listing/booking`);
  }
  await ctx.close();
});

test('preview Schedule: a practice, a game, a tournament and the Sat 10:00 conflict', async () => {
  const { ctx, page } = await guestPage();
  const text = await show(page, 'schedule');
  assert.match(text, /14U practice/); assert.match(text, /14U vs\. Westside Hoops/); assert.match(text, /Fall Classic/);
  assert.match(text, /Sat, \w+ \d+\s+10:00 AM\s+16U practice\s*Conflict/);
  assert.match(text, /Sample workspace\./);
  const home = await show(page, 'dashboard');
  assert.match(home, /Dues collected\s+\$4,800/); assert.match(home, /Teams\s+2/);
  await ctx.close();
});
