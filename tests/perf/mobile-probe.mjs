// tests/perf/mobile-probe.mjs — the audit's 29.3 mobile rows, reproducible:
// Pixel-5-class viewport, 4× CPU throttle, ~4G (150ms RTT, 1.6 Mbps), page
// served from a real http origin (production is https). Prints FCP, session
// restore → org loaded, home blocks rendered, document bytes on the wire, and
// the backend round trips on boot. Usage: node tests/perf/mobile-probe.mjs [url]
import { chromium, devices } from 'playwright';
import { mount, freshDb, session, SUPABASE } from '../e2e/fake-supabase.mjs';
import { serve } from '../e2e/serve.mjs';
const target = process.argv[2] || null;   // a live URL skips the fake backend and needs a real session in localStorage
const site = target ? null : await serve(); const INDEX = target || site.index;
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['Pixel 5'] });
if (!target) await ctx.addInitScript((s) => localStorage.setItem('sporve:session:v1', JSON.stringify(s)), session());
const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
if (!target) await mount(page, freshDb({ onboarded: true, name: 'Rivertown FC' }));
const seen = []; page.on('request', (r) => { if (r.url().startsWith(SUPABASE)) seen.push(r.method() + ' ' + r.url().slice(SUPABASE.length).split('?')[0]); });
let docBytes = 0; page.on('response', async (r) => { if (r.url() === INDEX || r.url() === INDEX.replace('/index.html', '/')) { try { docBytes = Number(r.headers()['content-length'] || 0) || (await r.body()).length; } catch {} } });
const t0 = Date.now(); await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof S === 'object' && S.auth?.status === 'verified' && !!S.coachProvider, null, { timeout: 60000 }); const tOrg = Date.now() - t0;
await page.waitForFunction(() => S.dashHome && !S.dashHome.loading && S.dashHome.data && document.querySelectorAll('.cui-block').length > 0, null, { timeout: 60000 }); const tHome = Date.now() - t0;
await page.waitForTimeout(1500);
const paint = await page.evaluate(() => { const p = performance.getEntriesByType('paint').find((x) => x.name === 'first-contentful-paint'); return p ? Math.round(p.startTime) : null; });
console.log(JSON.stringify({ fcp_ms: paint, org_loaded_ms: tOrg, home_blocks_ms: tHome, boot_requests: seen.length, doc_bytes: docBytes, requests: seen }, null, 1));
await browser.close(); if (site) await site.close();
