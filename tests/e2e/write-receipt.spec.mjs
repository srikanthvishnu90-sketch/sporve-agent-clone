// G4 loud-failure test (2026-09-19): a write that silently no-ops must fail
// loudly — it may never be reported as success. Exercises the REAL tool
// functions from supabase/functions/coach-command/index.ts (exported for
// testability) against a fake RLS-scoped client. No browser, no network: the
// Deno edge runtime is stubbed and Node's native type-stripping runs the .ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = new URL('../../supabase/functions/coach-command/index.ts', import.meta.url);

async function loadModule() {
  let src = await readFile(SRC, 'utf8');
  // Stub the Deno-only npm: import — the tested functions never touch it
  // (they receive their RLS-scoped client as a parameter).
  src = src.replace(
    'import { createClient } from "npm:@supabase/supabase-js@2";',
    'const createClient = () => { throw new Error("supabase-js is stubbed in this unit test"); };'
  );
  // Parameter properties are not erasable type syntax — desugar for Node's
  // native type stripping (behavior-identical).
  src = src.replace(
    'constructor(public status: number, message: string) {\n    super(message);\n  }',
    'constructor(status, message) {\n    super(message);\n    this.status = status;\n  }'
  );
  const dir = await mkdtemp(join(tmpdir(), 'sporv-g4-'));
  const file = join(dir, 'coach-command.testable.ts');
  await writeFile(file, src);
  globalThis.Deno = { env: { get: () => undefined }, serve: () => {} };
  return import(pathToFileURL(file).href);
}

// Minimal thenable query builder: records the chain, resolves via handler.
function makeClient(handler) {
  const query = (table) => {
    const q = {
      _table: table, _op: null, _payload: null, _single: false,
      select() { return q; },
      insert(rows) { q._op = 'insert'; q._payload = rows; return q; },
      delete() { q._op = 'delete'; return q; },
      eq() { return q; },
      neq() { return q; },
      in() { return q; },
      limit() { return q; },
      single() { q._single = true; return q; },
      then(res, rej) {
        Promise.resolve()
          .then(() => handler({ table: q._table, op: q._op || 'select', payload: q._payload, single: q._single }))
          .then(res, rej);
      },
    };
    return q;
  };
  return { from: (t) => query(t) };
}

const ORG = 'org-123';
const UID = 'user-456';
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

let mod;
test.before(async () => { mod = await loadModule(); });

test('WRITE_GUARDS declares precondition, inverse, and receipt for every deterministic write tool', () => {
  for (const t of ['remember_fact', 'forget_fact', 'draft_lapsed_outreach', 'create_document', 'find_facilities']) {
    const g = mod.WRITE_GUARDS.find((g) => g.tool === t);
    assert.ok(g, `${t} has a guard declaration`);
    for (const k of ['writes', 'precondition', 'inverse', 'receipt']) {
      assert.match(String(g[k] ?? ''), /\S/, `${t}.${k} is declared`);
    }
  }
});

test('remember_fact: a no-op insert reports saved:false — never saved:true', async () => {
  const client = makeClient(({ op }) =>
    op === 'insert' ? { data: null, error: { message: 'connection reset' } } : { data: [] });
  const r = await mod.rememberFact('Maya prefers morning sessions', client, ORG, UID);
  assert.equal(r.saved, false, 'a write with no receipt must not claim success');
  assert.ok(r.memory_id == null, 'no receipt id on failure');
  assert.match(r.error ?? '', /\S/, 'the failure is loud');
});

test('remember_fact: success returns the memory_id receipt', async () => {
  const client = makeClient(({ op }) =>
    op === 'insert' ? { data: { id: 'mem-1' }, error: null } : { data: [] });
  const r = await mod.rememberFact('Maya prefers morning sessions', client, ORG, UID);
  assert.equal(r.saved, true);
  assert.equal(r.memory_id, 'mem-1');
});

test('forget_fact: unknown id deletes nothing and says so', async () => {
  const client = makeClient(() => { throw new Error('must not reach the db for an unowned id'); });
  const r = await mod.forgetFact('nope', client, ORG, new Set());
  assert.equal(r.deleted, 0);
  assert.match(r.error ?? '', /\S/);
});

test('forget_fact: delete returning rows reports the deleted count', async () => {
  const client = makeClient(() => ({ data: [{ id: 'mem-1' }], error: null }));
  const r = await mod.forgetFact('mem-1', client, ORG, new Set(['mem-1']));
  assert.equal(r.deleted, 1);
});

test('create_document: a no-op insert reports created:false — never created:true', async () => {
  const client = makeClient(() => ({ data: null, error: { message: 'db down' } }));
  const r = await mod.createDocument({ title: 'T', body: 'B' }, client, ORG);
  assert.equal(r.created, false, 'a write with no receipt must not claim success');
  assert.ok(r.document_id == null, 'no receipt id on failure');
});

test('create_document: success returns the document_id receipt', async () => {
  const client = makeClient(() => ({ data: { id: 'doc-9' }, error: null }));
  const r = await mod.createDocument({ title: 'T', body: 'B' }, client, ORG);
  assert.equal(r.created, true);
  assert.equal(r.document_id, 'doc-9');
});

// One lapsed athlete (60d ago), reachable guardian — the F1 shortlist shape.
function lapsedClient(insertResult) {
  return makeClient(({ table, op }) => {
    if (table === 'bookings') {
      return { data: [{ id: 'b1', athlete_first_name: 'Maya', assigned_member_id: 'ath-1', status: 'booked', sessions: { start_date: ago(60), programs: { provider_id: ORG } } }] };
    }
    if (table === 'guardian_links') return { data: [{ member_id: 'ath-1', guardian_id: 'g-1' }] };
    if (table === 'guardians') return { data: [{ id: 'g-1', first_name: 'Priya', email: 'priya@example.com' }] };
    if (table === 'outbound_messages' && op === 'insert') return insertResult;
    return { data: [] };
  });
}
const TEMPLATE = 'Hi {guardian}, {child} — {days} days. — {business}';

test('draft_lapsed_outreach: a no-op insert queues nothing and fails loudly', async () => {
  const r = await mod.draftLapsedOutreach(
    { template: TEMPLATE }, lapsedClient({ data: null, error: { message: 'db down' } }), ORG, 'Rivertown FC');
  assert.equal(r.queued, 0, 'a write with no receipt must not claim drafts queued');
  assert.ok(!r.draft_ids || r.draft_ids.length === 0, 'no receipt ids on failure');
  assert.match(r.error ?? '', /\S/, 'the failure is loud');
});

test('draft_lapsed_outreach: success returns one draft id per family — the inverse handle', async () => {
  const r = await mod.draftLapsedOutreach(
    { template: TEMPLATE }, lapsedClient({ data: [{ id: 'msg-1' }], error: null }), ORG, 'Rivertown FC');
  assert.equal(r.queued, 1);
  assert.deepEqual(r.draft_ids, ['msg-1'], 'every drafted row is addressable for the inverse (discard)');
});
