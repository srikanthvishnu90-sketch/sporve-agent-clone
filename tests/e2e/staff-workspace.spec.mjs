// Audit 2026-09-17 P1-1 in the browser: a trainer whose own org is the untouched
// signup default lands in the org that employs them, as a coach, on the
// dashboard — not in their empty org and not in the employer's setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mount, freshDb, session, UID, PID } from './fake-supabase.mjs';
const INDEX = 'file://' + new URL('../../index.html', import.meta.url).pathname;
let browser; test.before(async () => { browser = await chromium.launch(); }); test.after(async () => { await browser?.close(); });
async function boot(db) { const ctx = await browser.newContext(); await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); await mount(page, db); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 15000 }); await page.waitForTimeout(600);
  const s = await page.evaluate(() => ({ route: S.route?.name, org: S.coachProvider?.business_name, role: typeof coachRole === 'function' ? coachRole() : null, gate: typeof coachGateActive === 'function' ? coachGateActive() : null, text: document.body.innerText.slice(0, 300) }));
  await ctx.close(); return { ...s, errors }; }
test('a trainer lands in the employer org as a coach, on the dashboard, with no setup gate', async () => {
  const db = freshDb();  // the signed-in user's own org: 'Your organization', not onboarded, empty
  db.providers.push({ id: 'emp-org', owner_id: 'someone-else', business_name: 'Rivertown FC', onboarding_completed: true, provider_type: 'organization', sports: ['Soccer'], plan: 'free' });
  db.organization_members.push({ id: 'm1', organization_id: 'emp-org', member_user_id: UID, role: 'trainer', is_active: true });
  const s = await boot(db);
  assert.equal(s.org, 'Rivertown FC'); assert.equal(s.role, 'coach'); assert.equal(s.route, 'dashboard'); assert.equal(s.gate, false); assert.match(s.text, /Rivertown FC/); assert.deepEqual(s.errors, []);
});
test('an owner with an onboarded org of their own keeps it, even with a membership elsewhere', async () => {
  const db = freshDb({ onboarded: true, name: 'My Own Club' });
  db.providers.push({ id: 'emp-org', owner_id: 'someone-else', business_name: 'Rivertown FC', onboarding_completed: true, provider_type: 'organization' });
  db.organization_members.push({ id: 'm1', organization_id: 'emp-org', member_user_id: UID, role: 'trainer', is_active: true });
  const s = await boot(db); assert.equal(s.org, 'My Own Club'); assert.equal(s.role, 'owner');
});
test('a brand-new signup with no membership still goes to its own setup', async () => {
  const s = await boot(freshDb()); assert.equal(s.route, 'setup'); assert.equal(s.role, 'owner'); assert.equal(s.gate, true);
});
