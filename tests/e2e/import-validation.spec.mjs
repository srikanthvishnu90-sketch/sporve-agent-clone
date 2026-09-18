// tests/e2e/import-validation.spec.mjs — audit 2026-09-17 P2-1 and P2-2. A
// broken file is quarantined row by row with the reason, in the browser: an
// unclosed quote, a non-name, a birthdate in the future or before 1920. None
// of them becomes an athlete; every good row still does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mount, freshDb, session } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
const FILE = ['Name,Email,DOB',
  'Ava Bell,renata@example.com,2013-04-02',
  '"Unterminated,quote,x,y,z',            // the audit's row: an opening quote that never closes
  'Ben Ortiz,marcus@example.com,2012-09-09',
  '%%%%,,2012-01-01',                      // no letters
  `Cara Nguyen,,${tomorrow}`,              // born tomorrow
  'Dev Patel,,1899-01-01',                 // before 1920
  'Eli Stone,,2011-02-30',                 // not a real calendar date
  'Fay Woods,,2010-06-15'].join('\n');
async function toPreview(db) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); await mount(page, db);
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 });
  await page.evaluate(() => { S.coachTab = 'roster'; S.importWiz = { step: 1, people: [] }; S.modal = { type: 'importclients' }; render(); });
  const p = join(mkdtempSync(join(tmpdir(), 'sporv-')), 'broken.csv'); writeFileSync(p, FILE);
  await page.setInputFiles('#impCsvFile', p); await page.click('[data-imp-csv]'); await page.waitForFunction(() => S.importWiz?.step === 'map');
  await page.click('[data-imp-mapnext]'); await page.waitForFunction(() => S.importWiz?.step === 'preview');
  return { ctx, page, errors };
}
test('the dry run quarantines every broken row with its reason and keeps the good ones', async () => {
  const db = freshDb({ onboarded: true, name: 'Rivertown FC' }); const { ctx, page, errors } = await toPreview(db);
  const d = await page.evaluate(() => S.importWiz.dry);
  assert.deepEqual(d.create.map((x) => x.name).sort(), ['Ava Bell', 'Ben Ortiz', 'Fay Woods']);
  const why = Object.fromEntries(d.rejected.map((r) => [r.name.replace(/…$/, ''), r.why]));
  assert.match(why['Unterminated,quote,x,y,z'] || '', /malformed row \(unclosed quote\)/);
  assert.match(why['%%%%'] || '', /no letters in the name/);
  assert.match(why['Cara Nguyen'] || '', /impossible date of birth/); assert.match(why['Dev Patel'] || '', /impossible date of birth/); assert.match(why['Eli Stone'] || '', /impossible date of birth/);
  const t = await page.evaluate(() => document.querySelector('.modal')?.innerText || ''); assert.match(t, /unclosed quote/); assert.match(t, /after 1920/);
  await page.click('[data-imp-commit]'); await page.waitForFunction(() => S.importWiz?.step === 'done', null, { timeout: 8000 });
  assert.equal(db.team_athletes.length, 3); assert.ok(!db.team_athletes.some((a) => /Unterminated|%%%%/.test(a.first_name + ' ' + a.last_name)));
  assert.deepEqual(errors, []); await ctx.close();
});
test('parseDob: the rule, directly', async () => {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await mount(page, freshDb()); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof parseDob === 'function');
  const r = await page.evaluate((tm) => ({ ok: parseDob('04/02/2013', 'MDY'), iso: parseDob('2013-04-02', 'ISO'), dmy: parseDob('02/04/2013', 'DMY'), future: parseDob(tm, 'ISO'), old: parseDob('1899-01-01', 'ISO'), feb30: parseDob('2011-02-30', 'ISO'), y1925: parseDob('1925-05-05', 'ISO') }), tomorrow);
  assert.deepEqual(r, { ok: '2013-04-02', iso: '2013-04-02', dmy: '2013-04-02', future: null, old: null, feb30: null, y1925: '1925-05-05' }); await ctx.close();
});
