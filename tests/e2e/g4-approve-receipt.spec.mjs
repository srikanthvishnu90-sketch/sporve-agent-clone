// G4 end-to-end (2026-10-22): the chat review card's Approve goes through the
// action registry in the BUILT page. A rail that silently writes nothing must
// produce an error bubble and reopen the card — never "Note created".
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
async function boot() {
  const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); await mount(page, freshDb({ onboarded: true, name: 'Rivertown FC' }));
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider && S.route?.name === 'dashboard', null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.SporvActions && !!window.MOD_NOTES, null, { timeout: 10000 });
  return { ctx, page };
}
async function proposeNote(page, silentNoop) {
  await page.evaluate((noop) => {
    const M = window.MOD_NOTES;
    M.resolveAthlete = () => ({ athlete: { id: 'a1', name: 'Julian Reyes', programId: null } });
    /* The signed-in fake account has no demo roster, so stand in for the rail:
       a working one stores the row; the broken one is the bug that shipped. */
    M.createFromAI = noop ? () => undefined : (spec) => {
      const n = { id: 'nt_ai_a1_' + Date.now(), athlete: 'Julian Reyes', worked: spec.body };
      (S.sessionNotes = S.sessionNotes || []).push(n); return { note: n, athlete: 'Julian Reyes' };
    };
    S.aiOpen = true; S.aiMax = false; S.aiCollapsed = false;
    S.chat = [{ role: 'coach', text: 'Draft', proposal: { tool: 'create_note', args: { athlete: 'Julian', body: 'Weak-foot passing' }, state: 'open' } }];
    render();
  }, silentNoop);
  await page.locator('[data-approve="0"]').first().click();
  await page.waitForFunction(() => S.chat.length > 1 && S.chat[0].proposal.state !== 'sending', null, { timeout: 5000 });
  return page.evaluate(() => ({ state: S.chat[0].proposal.state, last: S.chat[S.chat.length - 1], notes: (S.sessionNotes || []).filter((n) => n.athlete === 'Julian Reyes').length }));
}

test('approving a note writes it and shows a verified receipt', async () => {
  const { ctx, page } = await boot();
  const r = await proposeNote(page, false);
  assert.equal(r.state, 'done');
  assert.match(r.last.text, /Note created/);
  assert.match(r.last.text, /Receipt: S\.sessionNotes nt_ai_a1_/);
  assert.equal(r.notes, 1);
  await ctx.close();
});

test('a rail that silently writes nothing is a loud failure, not "Note created"', async () => {
  const { ctx, page } = await boot();
  const r = await proposeNote(page, true);
  assert.equal(r.state, 'open', 'the card reopens so the coach can retry');
  assert.equal(r.last.err, true, 'error bubble');
  assert.doesNotMatch(r.last.text, /Note created/);
  assert.match(r.last.text, /no receipt/i);
  assert.equal(r.notes, 0);
  await ctx.close();
});
