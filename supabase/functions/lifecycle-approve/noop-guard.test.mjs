// supabase/functions/lifecycle-approve/noop-guard.test.mjs — G4 exemplar.
// A write that reports success without changing a row is a CI failure.
// These doubles are faithful to supabase/functions/lifecycle-approve/index.ts
// as read 2026-09-18: the claim is a direct table update guarded by
// .eq("status","drafted"). There is no approve_lifecycle_message_entitled RPC
// anywhere in this repo; any test that invokes one is testing code that does
// not exist. SQL/RLS/races still require the separate disposable-database
// fixture; these doubles cover entrypoint control flow only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { enforceLifecycleDraft } from '../lifecycle-process/policy.ts';

const OWNER = '20000000-0000-4000-8000-000000000001';
const PROVIDER = '30000000-0000-4000-8000-000000000001';
const GUARDIAN = '40000000-0000-4000-8000-000000000001';
const CHILD = '45000000-0000-4000-8000-000000000001';
const MSG = '10000000-0000-4000-8000-000000000001';

const draftedRow = {
  id: MSG, provider_id: PROVIDER, child_id: CHILD, status: 'drafted',
  content: { body: 'Practice moves to 6 PM.', subject: 'Schedule' },
};

const source = stripTypeScriptTypes(
  (await readFile(new URL('./index.ts', import.meta.url), 'utf8')).replace(/^import\s+[\s\S]*?;\n/gm, ''));

async function invoke(options = {}) {
  const state = { notifications: [], pushes: [], claimCalls: 0 };
  let handler;
  const admin = {
    rpc: async (name) => {
      assert.equal(name, 'consume_edge_rate_limit');
      return { data: true, error: null };
    },
    from(table) {
      const q = {
        _update: null,
        select() { return q; },
        eq() { return q; },
        update(patch) { q._update = patch; return q; },
        insert(rows) {
          assert.equal(table, 'notifications');
          state.notifications.push(...rows);
          return options.notifErr ? { error: options.notifErr } : { error: null };
        },
        async maybeSingle() {
          if (table === 'providers') return { data: { id: PROVIDER }, error: null };
          if (table === 'athletes') return { data: options.athlete ?? { parent_id: GUARDIAN, first_name: 'Ava' }, error: null };
          if (table === 'outbound_messages') {
            if (q._update) {
              state.claimCalls += 1;
              return options.claim ?? { data: { id: MSG }, error: null };
            }
            if (state.claimCalls > 0) return { data: options.reread ?? options.row ?? draftedRow, error: null };
            return { data: options.row ?? draftedRow, error: null };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
      return q;
    },
  };
  vm.runInNewContext(source, {
    Response, Request, enforceLifecycleDraft, console: { error() {}, log() {} },
    createClient: (_url, key) => key === 'public-fixture'
      ? { auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) } }
      : admin,
    deliverPush: async (_admin, ...args) => { state.pushes.push(args); },
    Deno: {
      serve: (fn) => { handler = fn; },
      env: { get: (k) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'public-fixture', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' })[k] },
    },
  });
  const response = await handler(new Request('https://fixture.invalid/lifecycle-approve', {
    method: 'POST',
    headers: { Authorization: 'Bearer [REDACTED]', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: MSG }),
  }));
  return { status: response.status, body: await response.json(), state };
}

test('sent replay returns the prior receipt and never delivers twice', async () => {
  const r = await invoke({ row: { ...draftedRow, status: 'sent' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.alreadySent, true);
  assert.deepEqual(r.state.notifications, []);
  assert.deepEqual(r.state.pushes, []);
  assert.equal(r.state.claimCalls, 0);
});

test('drafted child row claims once and delivers exactly once', async () => {
  const r = await invoke();
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'sent');
  assert.equal(r.state.claimCalls, 1);
  assert.equal(r.state.notifications.length, 1);
  assert.equal(r.state.notifications[0].user_id, GUARDIAN);
  assert.equal(r.state.pushes.length, 1);
  assert.equal(r.state.pushes[0][0], GUARDIAN);
});

test('lost race against a non-sent state is a loud 409, never ok:true', async () => {
  const r = await invoke({ claim: { data: null, error: null }, reread: { status: 'approved' } });
  assert.equal(r.status, 409);
  assert.notEqual(r.body.ok, true);
  assert.match(String(r.body.error), /drafted/);
  assert.deepEqual(r.state.notifications, []);
  assert.deepEqual(r.state.pushes, []);
});

test('lost race against sent is an honest alreadySent replay', async () => {
  const r = await invoke({ claim: { data: null, error: null }, reread: { status: 'sent' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.alreadySent, true);
  assert.deepEqual(r.state.notifications, []);
  assert.deepEqual(r.state.pushes, []);
});

test('non-drafted initial state is 409 before any claim is attempted', async () => {
  const r = await invoke({ row: { ...draftedRow, status: 'failed' } });
  assert.equal(r.status, 409);
  assert.equal(r.state.claimCalls, 0);
  assert.deepEqual(r.state.notifications, []);
});
