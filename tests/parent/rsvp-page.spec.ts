// tests/parent/rsvp-page.spec.ts — the one-tap RSVP page on sporv.ai (spec 13
// slice 1). rsvp.js runs in a vm against a minimal DOM double and a fetch
// double; the page markup is checked for the CSP and accessibility basics a
// parent phone needs. The function contract is proved in link.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const html = read('rsvp.html'); const js = read('rsvp.js'); const vercel = JSON.parse(read('vercel.json'));
const TOKEN = 'e'.repeat(64);

type El = { hidden: boolean; textContent: string; disabled: boolean; value?: string; name?: string; onsubmit: ((ev: unknown) => unknown) | null; querySelector: (s: string) => El | null; querySelectorAll: (s: string) => El[] };
function dom(): { doc: { getElementById: (id: string) => El }; els: Record<string, El> } {
  const mk = (extra: Partial<El> = {}): El => ({ hidden: false, textContent: '', disabled: false, onsubmit: null, querySelector: () => null, querySelectorAll: () => [], ...extra });
  const buttons = ['yes', 'no', 'maybe'].map((v) => mk({ value: v, name: 'response' }));
  const els: Record<string, El> = {};
  for (const id of ['loading', 'ask', 'done', 'invalid', 'error', 'q', 'when', 'doneH', 'doneP', 'retry']) els[id] = mk();
  els.f = mk({ querySelector: () => buttons[0], querySelectorAll: () => buttons });
  return { doc: { getElementById: (id) => els[id] }, els };
}
function boot(search: string, fetchImpl: (u: string, i?: RequestInit) => Promise<Response>) {
  const { doc, els } = dom(); const ctx: any = { window: { __SPORV_RSVP_NOBOOT: true }, Intl, Date, JSON, String, RegExp, decodeURIComponent, Array, Promise, console };
  vm.createContext(ctx); vm.runInContext(js, ctx);
  const api = ctx.window.SporvRsvp;
  return { api, els, run: () => api.run(doc, fetchImpl, search) as Promise<string> };
}
const shown = (els: Record<string, El>) => ['loading', 'ask', 'done', 'invalid', 'error'].filter((s) => !els[s].hidden);
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('page: served at /r, script from self (CSP hash-free), no inline handlers, a11y basics', () => {
  assert.deepEqual(vercel.rewrites, [{ source: '/r', destination: '/rsvp.html' }]);
  assert.match(html, /<script src="\/rsvp\.js"><\/script>/); assert.ok(!/<script>/.test(html), 'no inline script — the CSP only allows hashed inline scripts in index.html');
  assert.ok(!/\bon[a-z]+=/.test(html), 'no inline event handlers');
  assert.match(html, /<html lang="en">/); assert.match(html, /name="viewport" content="width=device-width,initial-scale=1"/); assert.ok(!/user-scalable=no/.test(html));
  assert.match(html, /<main id="main">/); assert.match(html, /<form id="f" aria-labelledby="q">/); assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /button:focus-visible\{outline:3px solid/);
  const csp = vercel.headers.find((h: any) => h.source === '/(.*)').headers.find((x: any) => x.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src 'self' https:\/\/hzbhjkcqwawgqtspueuw\.supabase\.co/, 'the page may fetch the function');
  assert.match(csp, /script-src 'self'/, 'rsvp.js is same-origin');
});

test('a missing or malformed token shows the invalid state and never fetches', async () => {
  for (const s of ['', '?t=abc', `?t=${'E'.repeat(64)}`, '?x=1']) {
    let fetched = 0; const { els, run } = boot(s, async () => { fetched++; return res(200, {}); });
    assert.equal(await run(), 'invalid'); assert.deepEqual(shown(els), ['invalid']); assert.equal(fetched, 0);
  }
});

test('a live token renders the question from the function and posts the tap as JSON, then shows the confirmation', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const { els, run } = boot(`?t=${TOKEN}`, async (url, init) => { calls.push({ url, init });
    if (!init || !init.method) return res(200, { scope: 'rsvp', subject_label: '14U Flight — Tue practice', subject_at: '2026-11-03T00:00:00Z', subject_tz: 'America/Chicago', guardian_first_name: 'Maria' });
    return res(200, { saved: true, response: 'yes', members: ['m1', 'm2'] }); });
  assert.equal(await run(), 'ask'); assert.deepEqual(shown(els), ['ask']);
  assert.equal(els.q.textContent, '14U Flight — Tue practice'); assert.match(els.when.textContent, /Hi Maria/);
  assert.equal(calls[0].url, `https://hzbhjkcqwawgqtspueuw.supabase.co/functions/v1/guardian-link?t=${TOKEN}`);
  const btn = els.f.querySelectorAll('button')[0];
  const out = await els.f.onsubmit!({ preventDefault() {}, submitter: btn });
  assert.equal(out, 'done'); assert.deepEqual(shown(els), ['done']);
  assert.equal(calls[1].init!.method, 'POST'); assert.deepEqual(JSON.parse(String(calls[1].init!.body)), { t: TOKEN, response: 'yes' });
  assert.equal(els.doneH.textContent, 'See you there.'); assert.equal(els.doneP.textContent, 'yes recorded for 2 athletes.');
});

test('404 from the function is the invalid state; 5xx and network failure are the error state with a retry', async () => {
  let r = boot(`?t=${TOKEN}`, async () => res(404, { error: 'not_found' })); assert.equal(await r.run(), 'invalid');
  r = boot(`?t=${TOKEN}`, async () => res(503, { error: 'unavailable' })); assert.equal(await r.run(), 'error'); assert.deepEqual(shown(r.els), ['error']);
  r = boot(`?t=${TOKEN}`, async () => { throw new Error('offline'); }); assert.equal(await r.run(), 'error');
  // a POST that fails must not claim the answer was saved
  const r2 = boot(`?t=${TOKEN}`, async (_u, init) => init?.method ? res(503, { saved: false }) : res(200, { scope: 'rsvp', subject_label: 'x', subject_at: '2026-11-03T00:00:00Z' }));
  await r2.run(); assert.equal(await r2.els.f.onsubmit!({ preventDefault() {}, submitter: r2.els.f.querySelectorAll('button')[1] }), 'error');
  assert.deepEqual(shown(r2.els), ['error']);
});

test('a non-rsvp scope never renders the form', async () => {
  const r = boot(`?t=${TOKEN}`, async () => res(200, { scope: 'pay', subject_label: 'Dues' })); assert.equal(await r.run(), 'invalid');
});
