#!/usr/bin/env node
/* The Sporv verification agent.
 *
 *   node tools/verify/run.mjs                 # everything, report to docs/verification/
 *   node tools/verify/run.mjs --law 1         # one law
 *   node tools/verify/run.mjs --only mob.     # ids matching a prefix
 *   node tools/verify/run.mjs --list          # what it would run, and how many
 *   node tools/verify/run.mjs --json out.json # machine-readable too
 *
 * It runs the built page against the in-memory backend double from a local
 * http origin. No live project, no live model, no key, no money — so it can
 * run on every PR and nobody has to decide whether today is worth the spend.
 *
 * The standard is docs/specs/28-QUALITY-BAR.md and 29-FUNCTIONALITY-
 * VERIFICATION.md. Each check names the law it serves, and the report grades
 * law by law, because "212 passed" tells you nothing about whether the thing
 * a real club depends on works.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Harness } from './lib/harness.mjs';
import { plan as laws } from './checks/laws.mjs';
import { plan as failure } from './checks/failure.mjs';
import { plan as performance } from './checks/performance.mjs';
import { plan as adversarial } from './checks/adversarial.mjs';
import { plan as mobile } from './checks/mobile.mjs';
import { plan as integrity } from './checks/integrity.mjs';
import { plan as auth } from './checks/auth.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const LAW = arg('--law'), ONLY = arg('--only'), LIST = argv.includes('--list');
const JSON_OUT = arg('--json'), MD_OUT = arg('--out');

const LAW_NAMES = {
  1: 'Law 1 · nothing renders the server cannot back',
  2: 'Law 2 · permission is proven by zero rows',
  3: 'Law 3 · every write returns a receipt',
  4: 'Law 4 · failure is loud, local and legible',
  5: 'Law 5 · the product works with the agent off',
  perf: 'Performance · doc 29.3, a number for every row',
  adversarial: 'Adversarial · doc 29.5, hostile input and data',
  mobile: 'The field · doc 29.9, a phone in one hand',
  integrity: 'Integrity · doc 29.7 and the excellence checks',
  auth: 'Auth · nobody is ever auto-logged in (owner, standing)',
};

function collect() {
  const all = [...laws(), ...failure(), ...performance(), ...adversarial(), ...mobile(), ...integrity(), ...auth()];
  const seen = new Set();
  for (const c of all) {
    if (seen.has(c.id)) throw new Error(`duplicate check id: ${c.id}`);
    seen.add(c.id);
  }
  return all
    .filter((c) => (LAW ? String(c.law) === String(LAW) : true))
    .filter((c) => (ONLY ? c.id.startsWith(ONLY) : true));
}

const bar = (n, total, w = 24) => { const f = total ? Math.round((n / total) * w) : 0; return '█'.repeat(f) + '·'.repeat(w - f); };

async function main() {
  const checks = collect();
  if (LIST) {
    const by = {};
    for (const c of checks) by[c.law] = (by[c.law] || 0) + 1;
    console.log(`${checks.length} checks\n`);
    for (const [law, n] of Object.entries(by)) console.log(`  ${String(n).padStart(4)}  ${LAW_NAMES[law] || law}`);
    return 0;
  }

  const harness = new Harness();
  await harness.start();
  const t0 = Date.now();
  const results = [];

  /* Shared contexts first: one page per (org · role · width · surface), reused
     by every check that asked for it. Isolated checks get their own page. */
  const shared = checks.filter((c) => !c.isolate && !c.ctx?.mutate);
  const alone = checks.filter((c) => c.isolate || c.ctx?.mutate);
  const groups = new Map();
  for (const c of shared) {
    const k = harness.key(c.ctx || {});
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  let done = 0;
  const total = checks.length;
  const tick = (c, outcome) => {
    done++;
    const mark = outcome.status === 'pass' ? '·' : outcome.status === 'skip' ? 's' : '✖';
    process.stdout.write(mark);
    if (done % 60 === 0) process.stdout.write(` ${done}/${total}\n`);
  };

  const record = (c, status, detail, value) => {
    const r = { id: c.id, law: c.law, severity: c.severity, title: c.title, status, detail: detail || null, value: value ?? null, budget: c.budget || null };
    results.push(r); tick(c, r); return r;
  };

  async function runOne(c, env) {
    try {
      const out = await c.run({ ...env, harness });
      if (out && typeof out === 'object' && 'skip' in out) return record(c, 'skip', out.skip);
      if (out && typeof out === 'object' && ('value' in out || 'fail' in out)) {
        return record(c, out.fail ? 'fail' : 'pass', out.fail, out.value);
      }
      if (typeof out === 'string') return record(c, 'fail', out);
      return record(c, 'pass');
    } catch (e) {
      return record(c, 'fail', `threw: ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  for (const [, list] of groups) {
    let env;
    try { env = await harness.page(list[0].ctx || {}); }
    catch (e) { for (const c of list) record(c, 'fail', `context failed to open: ${String(e?.message || e).slice(0, 160)}`); continue; }
    for (const c of list) await runOne(c, env);
  }
  for (const c of alone) {
    let env;
    try { env = await harness.isolated(c.ctx || {}); }
    catch (e) { record(c, 'fail', `context failed to open: ${String(e?.message || e).slice(0, 160)}`); continue; }
    try { await runOne(c, env); } finally { await env.ctx.close().catch(() => {}); }
  }

  process.stdout.write(`\n`);
  const seconds = ((Date.now() - t0) / 1000).toFixed(0);
  await harness.stop();

  /* ── grade ─────────────────────────────────────────────────────────────── */
  const byLaw = {};
  for (const r of results) {
    const k = String(r.law);
    byLaw[k] ||= { pass: 0, fail: 0, skip: 0, total: 0, fails: [] };
    byLaw[k][r.status]++; byLaw[k].total++;
    if (r.status === 'fail') byLaw[k].fails.push(r);
  }
  const fails = results.filter((r) => r.status === 'fail');
  const p0 = fails.filter((r) => r.severity === 'P0');
  const measured = results.filter((r) => r.value !== null && r.budget);

  const stamp = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# Verification run — ${stamp}`);
  lines.push('');
  lines.push(`\`tools/verify/run.mjs\` · ${results.length} checks in ${seconds}s · built page, in-memory backend, local http origin.`);
  lines.push('');
  lines.push(`**${results.filter((r) => r.status === 'pass').length} passed · ${fails.length} failed · ${results.filter((r) => r.status === 'skip').length} skipped.** ${p0.length ? `**${p0.length} of the failures are P0.**` : 'No P0 failures.'}`);
  lines.push('');
  lines.push('| Standard | Checks | Passed | Failed |');
  lines.push('|---|---|---|---|');
  for (const [law, s] of Object.entries(byLaw)) {
    lines.push(`| ${LAW_NAMES[law] || law} | ${s.total} | ${bar(s.pass, s.total)} ${s.pass} | ${s.fail || '—'} |`);
  }
  lines.push('');
  if (fails.length) {
    lines.push('## What failed');
    lines.push('');
    for (const sev of ['P0', 'P1', 'P2']) {
      const list = fails.filter((r) => r.severity === sev);
      if (!list.length) continue;
      lines.push(`### ${sev}`);
      lines.push('');
      for (const r of list) lines.push(`- **${r.title}** — ${r.detail}  \n  \`${r.id}\``);
      lines.push('');
    }
  }
  if (measured.length) {
    lines.push('## Measured');
    lines.push('');
    lines.push('| Row | Measured | Budget | |');
    lines.push('|---|---|---|---|');
    for (const r of measured) {
      const b = r.budget || {};
      const verdict = b.max == null ? '—' : r.status === 'pass' ? 'PASS' : 'FAIL';
      lines.push(`| ${r.title} | ${r.value}${b.unit ? ' ' + b.unit : ''} | ${b.max == null ? 'not budgeted' : b.max + (b.unit ? ' ' + b.unit : '')} | ${verdict} |`);
    }
    lines.push('');
    lines.push('These are client-side numbers against the in-memory backend: they isolate parse, render and layout from network weather, and they are comparable run to run. They are **not** the live audit\'s numbers and do not replace a run against the deployed app.');
    lines.push('');
  }
  lines.push('## What this run cannot tell you');
  lines.push('');
  lines.push('- Nothing here touches the live project, a real model, Stripe, or email. A pass means the client behaves; it does not mean the production database agrees.');
  lines.push('- RLS is proven by the SQL fixtures in `docs/red-drafts/`, not here. This agent checks that the *screen* treats a refusal as zero rows rather than an error.');
  lines.push('- Delivery latency, cold starts and anything with a real recipient need the live audit (doc 29).');
  lines.push('');

  const md = lines.join('\n');
  const outPath = MD_OUT || join(ROOT, 'docs', 'verification', `${stamp}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ stamp, seconds: Number(seconds), results }, null, 1));

  console.log(`\n${results.filter((r) => r.status === 'pass').length}/${results.length} passed · ${fails.length} failed (${p0.length} P0) · ${seconds}s`);
  for (const [law, s] of Object.entries(byLaw)) console.log(`  ${bar(s.pass, s.total)} ${String(s.pass).padStart(3)}/${String(s.total).padEnd(3)} ${LAW_NAMES[law] || law}`);
  console.log(`\nreport: ${outPath}`);
  if (fails.length) {
    console.log('\nfailures:');
    for (const r of fails.slice(0, 40)) console.log(`  [${r.severity}] ${r.id}\n        ${r.detail}`);
    if (fails.length > 40) console.log(`  … and ${fails.length - 40} more (see the report)`);
  }
  return p0.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
