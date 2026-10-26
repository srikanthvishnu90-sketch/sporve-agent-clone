// G4 guard registry (GATES.md G4, 2026-10-22): every AI/approval write goes
// through src/mod-actions.js (window.SporvActions). These tests load the REAL
// module into a vm sandbox — no browser, no network — and assert:
//   1. a write whose run() writes nothing is reported as FAILURE, never success
//      (the create_note bug that shipped: approved, wrote nothing, said done);
//   2. an unknown action throws, console.errors, and raises a visible message;
//   3. a failing precondition blocks run() and surfaces its reason;
//   4. every action proposed anywhere in the codebase is in the registry
//      (static enumeration from api/ai.js, coach-command, the host's card
//      tables, the demo proposer, and every execute() call site).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const REGISTRY_SRC = read('src/mod-actions.js');

/* Fresh registry per test, with whatever host globals the case needs. */
function load(globals = {}) {
  const errors = [], shown = [];
  const sandbox = {
    console: { ...console, error: (...a) => errors.push(a.join(' ')) },
    toast: (m) => shown.push(m),
    Promise, Date, JSON, Object, Array, String, Number, Error, encodeURIComponent, isFinite,
    ...globals,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(REGISTRY_SRC, sandbox, { filename: 'mod-actions.js' });
  return { A: sandbox.SporvActions, errors, shown, sandbox };
}

const rejectsWith = async (p, code) => {
  let ok = false, err = null;
  try { await p; ok = true; } catch (e) { err = e; }
  assert.equal(ok, false, 'must NOT resolve as success');
  assert.equal(err && err.code, code, `expected ${code}, got ${err && err.code}: ${err && err.message}`);
  return err;
};

// ── 1. silent no-op fails loudly ────────────────────────────────────────────
test('a registered action whose run writes nothing is reported as failure, not success', async () => {
  const { A, errors, shown } = load();
  let ran = 0;
  A.define('test_noop', {
    receiptStore: 'nowhere', precondition: () => ({ ok: true }),
    run: () => { ran++; return {}; },             // wrote nothing, no receipt
    verify: () => true,
    inverse: { irreversible: true, why: 'test' },
  });
  const err = await rejectsWith(A.execute('test_noop', {}), 'no_receipt');
  assert.equal(ran, 1);
  assert.match(err.message, /no receipt/i);
  assert.ok(errors.some((e) => /no_receipt/.test(e)), 'console.error fired');
  assert.ok(shown.some((m) => /no receipt/i.test(m)), 'a visible message was raised');
  assert.equal(A.receipts().length, 0, 'no receipt was recorded');
});

test('a receipt whose read-back finds nothing written is a failure', async () => {
  const { A } = load();
  A.define('test_phantom', {
    receiptStore: 'store', precondition: () => ({ ok: true }),
    run: () => ({ receipt: { id: 'row-1' } }),     // claims a row...
    verify: () => ({ ok: false, reason: 'row-1 not found' }), // ...that is not there
    inverse: { irreversible: true, why: 'test' },
  });
  const err = await rejectsWith(A.execute('test_phantom', {}), 'verify_failed');
  assert.match(err.message, /row-1 not found/);
  assert.equal(A.receipts().length, 0);
});

test('the real create_note rail that returns nothing (the shipped bug) fails loudly', async () => {
  const S = { sessionNotes: [] };
  const { A } = load({
    S,
    PROP_DISPATCH: { create_note: { run: () => undefined } },   // the historical silent no-op
    noteAthlete: (p) => p.args.athlete,
    MOD_NOTES: { resolveAthlete: () => ({ athlete: { id: 'a1', name: 'Julian Reyes' } }) },
  });
  await rejectsWith(A.execute('create_note', { proposal: { tool: 'create_note', args: { athlete: 'Julian' } }, text: 'Weak foot' }), 'no_receipt');
  assert.equal(S.sessionNotes.length, 0);
});

test('create_note that returns an id but never stored the row fails the read-back', async () => {
  const S = { sessionNotes: [] };
  const { A } = load({
    S,
    PROP_DISPATCH: { create_note: { run: () => ({ note: { id: 'nt_ghost' }, athlete: 'Julian Reyes' }) } },
    noteAthlete: (p) => p.args.athlete,
    MOD_NOTES: { resolveAthlete: () => ({ athlete: { id: 'a1', name: 'Julian Reyes' } }) },
  });
  await rejectsWith(A.execute('create_note', { proposal: { tool: 'create_note', args: { athlete: 'Julian' } }, text: 'x' }), 'verify_failed');
});

test('create_note success returns a verified receipt, and the inverse removes the row', async () => {
  const S = { sessionNotes: [] };
  const { A } = load({
    S,
    PROP_DISPATCH: { create_note: { run: (p, t) => { const n = { id: 'nt_1', worked: t }; S.sessionNotes.push(n); return { note: n, athlete: 'Julian Reyes' }; } } },
    noteAthlete: (p) => p.args.athlete,
    MOD_NOTES: { resolveAthlete: () => ({ athlete: { id: 'a1', name: 'Julian Reyes' } }) },
  });
  const out = await A.execute('create_note', { proposal: { tool: 'create_note', args: { athlete: 'Julian' } }, text: 'Weak foot' });
  assert.equal(out.ok, true);
  assert.equal(out.receipt.id, 'nt_1');
  assert.equal(A.receipts()[0].receipt.id, 'nt_1');
  assert.equal(A.receipts()[0].durable, false, 'no durable table in this sandbox — says so');
  assert.match(A.receiptLine(out), /nt_1/);
  await A.invert('create_note', {}, out.receipt);
  assert.equal(S.sessionNotes.length, 0);
});

test('queue_approve: a 200 with no status is no receipt; a drafted read-back is a failure', async () => {
  let decideResult = { ok: true };
  let readBack = [{ id: 'm1', status: 'drafted' }];
  const { A } = load({
    SporveCoach: { decide: async () => decideResult },
    SporveAPI: { from: async () => readBack, isSignedIn: () => false },
  });
  await rejectsWith(A.execute('queue_approve', { id: 'm1' }), 'no_receipt');
  decideResult = { ok: true, status: 'sent' };
  await rejectsWith(A.execute('queue_approve', { id: 'm1' }), 'verify_failed');
  readBack = [{ id: 'm1', status: 'sent' }];
  const out = await A.execute('queue_approve', { id: 'm1' });
  assert.equal(out.receipt.id, 'm1');
});

test('draft_bio: save() that matched zero rows (cached provider returned) fails the read-back', async () => {
  const prov = { id: 'p1', bio: 'old' };
  const { A } = load({
    SporveCoach: { save: async () => prov, current: () => prov },   // save masks a 0-row PATCH
    SporveAPI: { from: async () => [{ id: 'p1', bio: 'old' }], isSignedIn: () => false },
    PROP_DISPATCH: { draft_bio: { run: (p, t) => Promise.resolve(prov) } },
  });
  await rejectsWith(A.execute('draft_bio', { proposal: { tool: 'draft_bio', args: {} }, text: 'New bio' }), 'verify_failed');
});

test('finding_dismiss: an empty PATCH representation is a failure, not "Dismissed"', async () => {
  const { A } = load({ SporveAPI: { from: async () => [], isSignedIn: () => false } });
  await rejectsWith(A.execute('finding_dismiss', { id: 'f1' }), 'no_receipt');
});

// ── 2. unknown action is loud ───────────────────────────────────────────────
test('an unknown action throws visibly, console.errors, and runs nothing', () => {
  const { A, errors, shown } = load();
  assert.throws(() => A.execute('wire_money_now', {}), (e) => e.code === 'unknown_action' && /Unknown action/.test(e.message));
  assert.ok(errors.some((e) => /unknown_action/.test(e)), 'console.error fired');
  assert.ok(shown.some((m) => /wire_money_now/.test(m)), 'visible message raised');
});

test('a link-only action (payout) refuses to execute, loudly', () => {
  const { A, shown } = load();
  assert.throws(() => A.execute('payout', {}), (e) => e.code === 'not_executable' && /money never moves/i.test(e.message));
  assert.ok(shown.length > 0);
});

// ── 3. precondition blocks execution ────────────────────────────────────────
test('a failing precondition blocks run and surfaces the reason', () => {
  const { A } = load();
  let ran = 0;
  A.define('test_guarded', {
    receiptStore: 's', precondition: () => ({ ok: false, reason: 'No athlete named Zed on your roster.' }),
    run: () => { ran++; return { receipt: { id: 'x' } }; }, verify: () => true,
    inverse: { irreversible: true, why: 't' },
  });
  assert.throws(() => A.execute('test_guarded', {}), (e) => e.code === 'precondition_failed' && /Zed/.test(e.message));
  assert.equal(ran, 0, 'run() must never be called when the precondition fails');
  assert.equal(A.check('test_guarded', {}).ok, false);
});

test('real precondition: draft_message without a booking never runs the rail', () => {
  let sent = 0;
  const { A } = load({
    SporveCoach: { sendParentMessage: () => { sent++; } },
    PROP_DISPATCH: { draft_message: { run: () => { sent++; } } },
  });
  assert.throws(() => A.execute('draft_message', { proposal: { args: {} }, text: 'Hi' }), (e) => e.code === 'precondition_failed');
  assert.equal(sent, 0);
});

test('define() refuses a write without precondition, read-back, inverse or receipt store', () => {
  const { A } = load();
  const base = { receiptStore: 's', precondition: () => ({ ok: true }), run: () => ({}), verify: () => true, inverse: { irreversible: true, why: 'w' } };
  for (const k of ['precondition', 'run', 'verify', 'inverse', 'receiptStore']) {
    const spec = { ...base }; delete spec[k];
    assert.throws(() => A.define('bad_' + k, spec), new RegExp(k));
  }
  assert.throws(() => A.define('bad_inv', { ...base, inverse: { irreversible: true } }), /inverse/);
});

// ── 4. static coverage: everything proposable is registered ────────────────
function enumerateProposedActions() {
  const names = new Map(); // name -> where
  const add = (n, where) => { if (n && n !== 'unknown') names.set(n, (names.get(n) || []).concat(where)); };

  const ai = read('api/ai.js');
  const enumBlock = ai.slice(ai.indexOf('enum: ['), ai.indexOf('],', ai.indexOf('enum: [')));
  for (const m of enumBlock.matchAll(/"([a-z_]+)"/g)) add(m[1], 'api/ai.js ACTION_SCHEMA');

  const cc = read('supabase/functions/coach-command/index.ts');
  const wt = cc.slice(cc.indexOf('const WRITE_TOOLS = ['), cc.indexOf('] as const;', cc.indexOf('const WRITE_TOOLS = [')));
  for (const m of wt.matchAll(/"([a-z_]+)"/g)) add(m[1], 'coach-command WRITE_TOOLS');

  const host = read('src/sporve-web.host.html');
  const meta = host.slice(host.indexOf('const PROP_META={'), host.indexOf('};', host.indexOf('const PROP_META={')));
  for (const m of meta.matchAll(/^\s*([a-z_]+)\s*:\s*\{label/gm)) add(m[1], 'host PROP_META');
  const disp = host.slice(host.indexOf('const PROP_DISPATCH={'), host.indexOf('PROP_DISPATCH.create_document='));
  for (const m of disp.matchAll(/^  ([a-z_]+):\{/gm)) add(m[1], 'host PROP_DISPATCH');
  for (const m of host.matchAll(/PROP_DISPATCH\.([a-z_]+)=/g)) add(m[1], 'host PROP_DISPATCH alias');
  const demo = host.slice(host.indexOf('function coachDemoProposal('), host.indexOf('function sendRecapToParentDemo('));
  for (const m of demo.matchAll(/tool:"([a-z_]+)"/g)) add(m[1], 'host coachDemoProposal');
  const appl = host.slice(host.indexOf('function applyAction('), host.indexOf('function confirmPending('));
  for (const m of appl.matchAll(/a\.action==="([a-z_]+)"/g)) add(m[1], 'host applyAction');

  for (const f of ['src/sporve-web.host.html', 'src/mod-personalize-ui.js']) {
    for (const m of read(f).matchAll(/SporvActions\.execute\("([a-z_]+)"/g)) add(m[1], f + ' execute()');
  }
  // the queue decide maps decision -> action name
  const qd = host.slice(host.indexOf('$("[data-qdecide]")'), host.indexOf('$("[data-railmenu]")'));
  for (const m of qd.matchAll(/:"(queue_[a-z_]+)"/g)) add(m[1], 'host qdecide map');
  return names;
}

test('every action proposed or executed anywhere in the codebase is in the registry', () => {
  const { A } = load();
  const proposed = enumerateProposedActions();
  assert.ok(proposed.size >= 25, `enumeration looks broken: only ${proposed.size} names`);
  const missing = [...proposed.keys()].filter((n) => !A.has(n));
  assert.deepEqual(missing, [], 'unregistered actions: ' + missing.map((n) => `${n} (${proposed.get(n).join(', ')})`).join('; '));
});

test('every execute() call site names a WRITE action (never a link/nav entry)', () => {
  const { A } = load();
  for (const f of ['src/sporve-web.host.html', 'src/mod-personalize-ui.js']) {
    for (const m of read(f).matchAll(/SporvActions\.execute\("([a-z_]+)"/g)) {
      assert.equal(A.get(m[1])?.kind, 'write', `${f} executes ${m[1]}, which is not a write action`);
    }
  }
});

test('every live chat rail (PROP_DISPATCH) is an executable write in the registry', () => {
  const { A } = load();
  const host = read('src/sporve-web.host.html');
  const disp = host.slice(host.indexOf('const PROP_DISPATCH={'), host.indexOf('PROP_DISPATCH.create_document='));
  const rails = [...disp.matchAll(/^  ([a-z_]+):\{/gm)].map((m) => m[1]).concat(['create_document']);
  assert.ok(rails.length >= 7);
  for (const r of rails) assert.equal(A.get(r)?.kind, 'write', `${r} has a rail but no guarded write entry`);
  assert.equal(A.get('payout')?.kind, 'link', 'payout must never become executable (RED)');
});

test('approveProposal dispatches only through the registry, never the raw rail', () => {
  const host = read('src/sporve-web.host.html');
  const i = host.indexOf('function approveProposal(');
  const fn = host.slice(i, host.indexOf('function dismissProposal(', i));
  assert.match(fn, /SporvActions\.execute\(p\.tool/);
  assert.ok(!/disp\.run\(/.test(fn), 'approveProposal must not call disp.run directly');
});

test('server write tools declare guards: coach-command WRITE_GUARDS and lifecycle-approve APPROVE_GUARD', () => {
  const cc = read('supabase/functions/coach-command/index.ts');
  const guards = cc.slice(cc.indexOf('export const WRITE_GUARDS = ['), cc.indexOf('] as const;', cc.indexOf('export const WRITE_GUARDS = [')));
  for (const t of ['remember_fact', 'forget_fact', 'draft_lapsed_outreach', 'draft_message', 'draft_bulk_message', 'create_document', 'find_facilities', 'find_clients']) {
    assert.match(guards, new RegExp(`tool: "${t}"`), `${t} writes server-side and must be in WRITE_GUARDS`);
  }
  const la = read('supabase/functions/lifecycle-approve/index.ts');
  const g = la.slice(la.indexOf('export const APPROVE_GUARD'), la.indexOf('} as const;', la.indexOf('export const APPROVE_GUARD')));
  for (const k of ['writes', 'precondition', 'inverse', 'receipt']) assert.match(g, new RegExp(`${k}: "`), `APPROVE_GUARD.${k}`);
});

// ── lifecycle-approve: a delivery insert that returns no row is not a delivery ─
async function loadLifecycleApprove() {
  let src = read('supabase/functions/lifecycle-approve/index.ts');
  src = src
    .replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'const createClient = () => { throw new Error("stubbed"); };')
    .replace('import { enforceLifecycleDraft } from "../lifecycle-process/policy.ts";', 'const enforceLifecycleDraft = (b) => ({ body: b, removed: [] });')
    .replace('import { deliverPush } from "../_shared/push.ts";', 'const deliverPush = async () => {};');
  const dir = mkdtempSync(join(tmpdir(), 'sporv-g4-la-'));
  const file = join(dir, 'lifecycle-approve.testable.ts');
  writeFileSync(file, src);
  globalThis.Deno = { env: { get: () => 'x' }, serve: () => {} };
  return import(pathToFileURL(file).href);
}
function notifClient(result) {
  return { from: () => ({ insert: () => ({ select: () => ({ single: async () => result }) }) }) };
}

test('lifecycle-approve: a notifications insert that returns no row reports no delivery', async () => {
  const mod = await loadLifecycleApprove();
  const row = { id: 'n-0', user_id: 'g1', title: 't', message: 'm' };
  const silent = await mod.insertDeliveryReceipt(notifClient({ data: null, error: null }), row);
  assert.equal(silent.notification_id, null, 'a silent no-op insert must not yield a receipt');
  assert.match(silent.error ?? '', /no row/);
  const failed = await mod.insertDeliveryReceipt(notifClient({ data: null, error: { message: 'rls' } }), row);
  assert.equal(failed.notification_id, null);
  const ok = await mod.insertDeliveryReceipt(notifClient({ data: { id: 'n-1' }, error: null }), row);
  assert.equal(ok.notification_id, 'n-1');
});

test('lifecycle-approve: only a coded database refusal is definite; network/no-row outcomes are uncertain', async () => {
  const mod = await loadLifecycleApprove();
  const row = { id: 'n-0', user_id: 'g1', title: 't', message: 'm' };
  assert.equal((await mod.insertDeliveryReceipt(notifClient({ data: null, error: { message: 'denied', code: '42501' } }), row)).definite, true);
  assert.equal((await mod.insertDeliveryReceipt(notifClient({ data: null, error: { message: 'fk', code: '23503' } }), row)).definite, true);
  assert.equal((await mod.insertDeliveryReceipt(notifClient({ data: null, error: { message: 'TypeError: fetch failed', code: '' } }), row)).definite, false);
  assert.equal((await mod.insertDeliveryReceipt(notifClient({ data: null, error: null }), row)).definite, false, 'no row and no error is not proof of nothing');
  const thrown = { from: () => ({ insert: () => ({ select: () => ({ single: async () => { throw new Error('timeout'); } }) }) }) };
  assert.equal((await mod.insertDeliveryReceipt(thrown, row)).definite, false);
  const src = read('supabase/functions/lifecycle-approve/index.ts');
  assert.match(src, /if \(!notificationId && !delivered\.definite\) \{[\s\S]*?findDeliveredNotification\([\s\S]*?released: false, delivery: "unconfirmed"/,
    'an uncertain insert is reconciled and, if unconfirmed, stays claimed');
});

test('lifecycle-approve: reconcile finds the notification, proves absence, or stays undetermined', async () => {
  const mod = await loadLifecycleApprove();
  const filters = [];
  const q = (result) => { const chain = { eq: (k, v) => { filters.push([k, v]); return chain; }, limit: async () => result };
    return { from: () => ({ select: () => chain }) }; };
  assert.equal(await mod.findDeliveredNotification(q({ data: [{ id: 'n-9' }], error: null }), 'n-9'), 'n-9');
  assert.deepEqual(filters, [['id', 'n-9']], 'reconciles by the exact pre-generated id, nothing else');
  assert.equal(await mod.findDeliveredNotification(q({ data: [], error: null }), 'n-9'), null);
  assert.equal(await mod.findDeliveredNotification(q({ data: null, error: { message: 'x' } }), 'n-9'), undefined);
  const src = read('supabase/functions/lifecycle-approve/index.ts');
  assert.match(src, /const note = \{ id: crypto\.randomUUID\(\), user_id: guardianId,/, 'the id is generated before the insert');
  assert.match(src, /findDeliveredNotification\(admin, note\.id\)/);
});
