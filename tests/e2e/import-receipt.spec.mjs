// Audit 2026-09-17 P0-1: the roster import reports success ONLY from the
// server's own receipt. With the network cut during commit it must say so,
// add nothing locally, leave no batch row behind, and let the same file be
// retried. Chromium against the in-memory Supabase double.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mount, freshDb, session, SUPABASE } from './fake-supabase.mjs';

const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
const csvPath = () => { const p = join(mkdtempSync(join(tmpdir(), 'sporv-')), 'r.csv'); writeFileSync(p, 'Name,Email,DOB\nAva Bell,renata@example.com,2013-04-02\nBen Ortiz,marcus@example.com,2012-09-09\nCara Nguyen,,2011-01-01\n'); return p; };
async function toPreview(db) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const fake = await mount(page, db); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'roster'; S.importWiz = { step: 1, people: [] }; S.modal = { type: 'importclients' }; render(); });
  await page.setInputFiles('#impCsvFile', csvPath()); await page.click('[data-imp-csv]'); await page.waitForFunction(() => S.importWiz?.step === 'map');
  await page.click('[data-imp-mapnext]'); await page.waitForFunction(() => S.importWiz?.step === 'preview');
  return { ctx, page, errors, ...fake };
}
const state = (page) => page.evaluate(() => ({ step: S.importWiz?.step, error: S.importWiz?.error ?? null, local: typeof teamRoster === 'function' ? teamRoster().length : null, modal: document.querySelector('.modal')?.innerText.replace(/\n+/g, ' | ') ?? '' }));

test('happy path: "committed" is worded from the server receipt and matches what the server holds', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); const { ctx, page, errors } = await toPreview(db);
  await page.click('[data-imp-commit]'); await page.waitForFunction(() => S.importWiz?.step === 'done', null, { timeout: 8000 });
  const s = await state(page);
  assert.match(s.modal, /3 athletes saved/i); assert.match(s.modal, /2 families on file/i);
  assert.equal(db.team_athletes.length, 3); assert.equal(db.import_batches.length, 1); assert.equal(db.guardians.length, 2); assert.equal(db.guardian_links.length, 2);
  assert.equal(s.local, 3, 'the local roster holds exactly the rows the server returned');
  assert.deepEqual(errors, []); await ctx.close();
});

test('network cut during commit: says so, adds nothing locally, leaves no batch row, and the retry succeeds', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); const { ctx, page, errors } = await toPreview(db);
  let cut = true; await page.route(`${SUPABASE}/rest/v1/team_athletes**`, (r) => cut && r.request().method() === 'POST' ? r.abort('failed') : r.fallback());
  await page.click('[data-imp-commit]'); await page.waitForFunction(() => S.importWiz?.step === 'failed', null, { timeout: 8000 });
  const s = await state(page);
  assert.match(s.modal, /Import not saved/i); assert.match(s.modal, /roster rows were not saved/i); assert.match(s.modal, /can be imported again/i);
  assert.equal(s.local, 0, 'nothing on the local roster'); assert.equal(db.team_athletes.length, 0); assert.equal(db.import_batches.length, 0, 'the batch row was rolled back so the content hash does not block a retry');
  cut = false; await page.click('[data-imp-retry]'); await page.waitForFunction(() => S.importWiz?.step === 'preview');
  await page.click('[data-imp-commit]');
  try { await page.waitForFunction(() => S.importWiz?.step === 'done', null, { timeout: 8000 }); } catch (e) { console.log('   retry state:', JSON.stringify(await state(page)), 'db batches', db.import_batches.length, 'athletes', db.team_athletes.length); throw e; }
  assert.equal(db.team_athletes.length, 3); assert.equal(db.import_batches.length, 1); assert.equal((await state(page)).local, 3);
  assert.deepEqual(errors, []); await ctx.close();
});

test('partial server write: the server returns fewer rows than sent → not saved, batch rolled back', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); const { ctx, page } = await toPreview(db);
  await page.route(`${SUPABASE}/rest/v1/team_athletes**`, async (r) => { if (r.request().method() !== 'POST') return r.fallback(); const body = r.request().postDataJSON().slice(0, 1).map((x, i) => ({ id: 'only-one', ...x })); return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(body) }); });
  await page.click('[data-imp-commit]'); await page.waitForFunction(() => S.importWiz?.step === 'failed', null, { timeout: 8000 });
  const s = await state(page); assert.match(s.modal, /saved 1 of 3 athletes, so nothing was kept/i); assert.equal(s.local, 0); assert.equal(db.import_batches.length, 0);
  await ctx.close();
});

test('the same file twice: the server-side content hash refuses the second commit and the roster is untouched', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); const { ctx, page } = await toPreview(db);
  await page.click('[data-imp-commit]'); await page.waitForFunction(() => S.importWiz?.step === 'done', null, { timeout: 8000 });
  await page.click('[data-imp-close]'); await page.waitForFunction(() => !S.modal);
  // a second device with an empty local roster imports the identical file: the dry run cannot see the first import, the server hash can
  await page.evaluate(() => { S.teamRoster = []; S.importWiz = { step: 1, people: [] }; S.modal = { type: 'importclients' }; render(); });
  await page.waitForSelector('#impCsvFile', { state: 'attached', timeout: 8000 });
  await page.setInputFiles('#impCsvFile', csvPath()); await page.click('[data-imp-csv]');
  try { await page.waitForFunction(() => S.importWiz?.step === 'map', null, { timeout: 8000 }); } catch (e) { console.log('   state:', JSON.stringify(await state(page)).slice(0, 300)); throw e; }
  await page.click('[data-imp-mapnext]'); await page.waitForFunction(() => S.importWiz?.step === 'preview');
  assert.equal(await page.evaluate(() => S.importWiz.dry.create.length), 3, 'the dry run on a fresh device would create all three');
  await page.click('[data-imp-commit]'); await page.waitForFunction(() => S.importWiz?.step === 'preview' && !S.importWiz.busy, null, { timeout: 8000 });
  assert.equal(db.import_batches.length, 1, 'no second batch'); assert.equal(db.team_athletes.length, 3, 'nothing created twice');
  assert.equal((await state(page)).local, 0, 'nothing pushed locally on a refused duplicate');
  await ctx.close();
});
