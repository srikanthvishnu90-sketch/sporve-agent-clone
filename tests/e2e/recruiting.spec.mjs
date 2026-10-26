// Source R1 — the Recruiting tab (spec 31 Part II). Four facts, in a real
// browser against the built page:
//   1. The signed-out coach preview shows the board with every stage column
//      and labelled sample recruits, with no sideways scroll at 1440 or 390.
//   2. A stage move in the preview moves the card, and says it was not saved.
//   3. A signed-in coach whose database lacks the recruiting tables sees the
//      honest "not switched on" state, never sample data.
//   4. A signed-in coach with real rows sees them, and a stage move goes
//      through move_recruit_stage (the receipt-returning RPC), not a PATCH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, PID } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
const STAGES = ['Identified', 'Evaluated', 'Contacted', 'Visit', 'Offer', 'Committed', 'Signed', 'Closed / lost'];
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });

async function guestPage(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://aveqjeafghmwafkbbnor.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && typeof render === 'function' && !!window.MOD_RECRUITING);
  await page.evaluate(() => { enterCoachPortal(); S.coachTab = 'recruiting'; render(); });
  await page.waitForSelector('.rc-board');
  return { ctx, page, errors };
}

for (const width of [1440, 390]) {
  test(`guest preview at ${width}px: every stage column, labelled sample recruits, no sideways scroll`, async () => {
    const { ctx, page, errors } = await guestPage(width);
    const s = await page.evaluate(() => ({
      guest: isCoachGuest(),
      heads: [...document.querySelectorAll('.rc-col h2')].map((e) => e.textContent.trim()),
      cards: document.querySelectorAll('.rc-card').length,
      text: document.querySelector('.cui-page').innerText,
      rail: [...document.querySelectorAll('.rail button[data-ctab="recruiting"]')].length,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    }));
    assert.equal(s.guest, true);
    assert.deepEqual(s.heads, STAGES);
    assert.equal(s.cards, 10, 'ten sample recruits, one card each');
    assert.match(s.text, /Sample workspace\./);
    assert.match(s.text, /Maya Torres/);
    assert.equal(s.rail, 1, 'Recruiting sits in the rail');
    assert.ok(s.sw <= s.cw, `page is ${s.sw}px wide in a ${s.cw}px viewport`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('guest preview: moving a card forward moves it to that column and says it was not saved', async () => {
  const { ctx, page } = await guestPage(1440);
  await page.selectOption('[data-rc-move="sp04"]', 'evaluated');   // Lena Brooks: Identified -> Evaluated
  await page.waitForFunction(() => document.querySelector('#rc-col-evaluated')?.closest('.rc-col').innerText.includes('Lena Brooks'));
  const col = await page.evaluate(() => document.querySelector('#rc-col-identified').closest('.rc-col').innerText);
  assert.doesNotMatch(col, /Lena Brooks/);
  assert.match(await page.evaluate(() => S.toast || ''), /not saved/);
  await ctx.close();
});

test('guest preview: closing needs a reason, so the card opens the stage form instead of moving', async () => {
  const { ctx, page } = await guestPage(1440);
  await page.selectOption('[data-rc-move="sp02"]', 'closed');
  await page.waitForSelector('#rcStageForm');
  const s = await page.evaluate(() => ({ stage: MOD_RECRUITING._test.state().pipelines.find((p) => p.id === 'sp02').stage,
    reasonShown: !document.querySelector('[data-rc-reason]').hidden }));
  assert.equal(s.stage, 'contacted', 'nothing moved yet');
  assert.equal(s.reasonShown, true);
  await page.click('#rcStageForm button[type=submit]');
  assert.match(await page.textContent('#rcStageErr'), /Choose why this recruit is closed/);
  await ctx.close();
});

test('guest preview: CSV import previews ready, duplicate and bad rows, then imports only the ready ones', async () => {
  const { ctx, page } = await guestPage(1440);
  await page.click('[data-cui-tab="import"]');
  await page.fill('#rcCsvForm textarea', [
    'First Name,Last Name,Grad Year,Sport,Position,Film URL',
    'Kai,Nguyen,2028,Basketball,C,https://example.com/film/kai',
    'Maya,Torres,2027,Basketball,PG,',              // already on the sample board
    'Bad,Year,27,Basketball,SF,',                    // grad year not four digits
    '"Lee, Jr.",Park,2028,Basketball,SG,http://insecure.example.com', // quoted comma; http film rejected
  ].join('\n'));
  await page.click('#rcCsvForm button[type=submit]');
  const text = await page.evaluate(() => document.querySelector('.cui-page').innerText);
  assert.match(text, /1\s+ready, 1\s+skipped, 2\s+with errors/);
  assert.match(text, /already on the board/);
  assert.match(text, /grad year must be four digits/);
  assert.match(text, /film links must start with https/);
  await page.click('[data-rc-import]');
  await page.waitForFunction(() => document.querySelector('#rc-col-identified')?.closest('.rc-col').innerText.includes('Kai Nguyen'));
  assert.equal(await page.locator('.rc-card').count(), 11);
  await ctx.close();
});

async function signedIn(db, override) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const fake = await mount(page, db);
  if (override) await page.route((url) => url.pathname === '/rest/v1/recruits', override);   // registered last, so it wins
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'recruiting'; render(); });
  return { ctx, page, errors, fake };
}

test('signed in, recruiting tables not applied: the honest not-enabled state, and no sample data', async () => {
  const { ctx, page, errors } = await signedIn(freshDb({ onboarded: true, name: 'Lakeview College' }),
    (route) => route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.recruits' in the schema cache" }) }));
  await page.waitForFunction(() => /switched on/.test(document.querySelector('.cui-page')?.innerText || ''), null, { timeout: 8000 });
  const text = await page.evaluate(() => document.querySelector('.cui-page').innerText);
  assert.match(text, /Recruiting isn.t switched on for this workspace yet\./);
  assert.match(text, /The database change is drafted and waiting to be applied\./);
  assert.doesNotMatch(text, /Sample workspace|Maya Torres/);
  assert.equal(await page.locator('.rc-board, [data-rc-add]').count(), 0, 'no board and no Add button over a missing table');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a truncated recruit list: adding someone already saved reuses their id (server identity lookup), no second recruit row', async () => {
  const db = freshDb({ onboarded: true, name: 'Lakeview College' });
  db.recruits = [{ id: 'r1', provider_id: PID, first_name: 'Priya', last_name: 'Shah', grad_year: 2027, is_minor: true, status: 'active', dedupe_key: 'shah|priya|2027' }];
  db.recruit_pipelines = [];
  const { ctx, page, errors, fake } = await signedIn(db);
  await page.waitForFunction(() => window.MOD_RECRUITING?._test.state().phase === 'ready', null, { timeout: 8000 });
  const out = await page.evaluate(async () => {
    const t = window.MOD_RECRUITING._test, st = t.state();
    st.recruits = [];                                 // as if Priya fell past the 1000-row read limit
    st.truncated = ['recruits (first 1000)'];
    await t.addRecruit({ first_name: ' Priya ', last_name: 'SHAH', grad_year: 2027, sport: 'Volleyball' });
    return { key: t.identityKey(' Priya ', 'SHAH', 2027) };
  });
  assert.equal(out.key, 'shah|priya|2027', 'client identity matches the dedupe_key column');
  assert.equal(fake.log.filter((l) => l.kind === 'insert' && l.table === 'recruits').length, 0, 'no second recruit row');
  const pipes = fake.log.filter((l) => l.kind === 'insert' && l.table === 'recruit_pipelines');
  assert.equal(pipes.length, 1); assert.equal(pipes[0].rows[0].recruit_id, 'r1');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('signed in with real rows: the board shows them, and a stage move goes through move_recruit_stage', async () => {
  const db = freshDb({ onboarded: true, name: 'Lakeview College' });
  db.recruits = [{ id: 'r1', provider_id: PID, first_name: 'Priya', last_name: 'Shah', grad_year: 2027, is_minor: true, current_school: 'Oak Park HS', status: 'active' }];
  db.recruit_pipelines = [{ id: 'p1', provider_id: PID, recruit_id: 'r1', sport: 'Volleyball', stage: 'identified', position_primary: 'OH', positions: ['OH'], film_links: [], last_contact_at: null }];
  const { ctx, page, errors, fake } = await signedIn(db);
  await page.waitForSelector('.rc-card');
  const s = await page.evaluate(() => ({ text: document.querySelector('.cui-page').innerText, cards: document.querySelectorAll('.rc-card').length }));
  assert.equal(s.cards, 1);
  assert.match(s.text, /Priya Shah/);
  assert.doesNotMatch(s.text, /Sample workspace|Maya Torres/);
  await page.selectOption('[data-rc-move="p1"]', 'contacted');
  const isMove = (l) => l.kind === 'rpc' && l.fn === 'move_recruit_stage';
  for (let i = 0; i < 50 && !fake.log.some(isMove); i++) await page.waitForTimeout(50);   // bounded: at most 2.5s
  const rpc = fake.log.filter(isMove);
  assert.equal(rpc.length, 1);
  assert.deepEqual(rpc[0].args, { p_pipeline: 'p1', p_to: 'contacted', p_note: null, p_closed_reason: null });
  assert.equal(fake.log.filter((l) => l.kind === 'update' && l.table === 'recruit_pipelines').length, 0, 'stage is never PATCHed directly');
  // the minor's contact details were never part of the board read
  const reads = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/rest/v1/recruits?')));
  assert.ok(reads.length >= 1 && reads.every((n) => !/date_of_birth|email|phone|select=\*/.test(decodeURIComponent(n))), 'board read asks only for non-sensitive columns');
  assert.deepEqual(errors, []);
  await ctx.close();
});
