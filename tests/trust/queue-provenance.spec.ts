// Audit 2026-09-15 C4 (owner order #4) — tests/trust/queue-provenance.spec.ts
// The Queue a signed-in account sees is server-backed or empty. It never
// renders the guest demo seed, a failed read is rendered as a failure, and
// Approve / Mark done / Dismiss move a row only after the server confirms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const host: string = readFileSync(new URL('../../src/sporve-web.host.html', import.meta.url), 'utf8');

/* lift a top-level `function name(){...}` out of the host by brace matching */
function lift(name: string): string {
  const i = host.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' not found in host');
  let depth = 0, j = host.indexOf('{', i);
  for (; j < host.length; j++) {
    if (host[j] === '{') depth++;
    else if (host[j] === '}' && --depth === 0) return host.slice(i, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
type Ctx = { S: any; signedIn: boolean; isReal: boolean };
function queueOf(c: Ctx): any[] {
  const ctx: any = {
    S: c.S,
    window: { SporveAPI: { isSignedIn: () => c.signedIn } },
    coachState: () => ({ isReal: c.isReal }),
    SEED: {},
  };
  vm.createContext(ctx);
  vm.runInContext(lift('queueIsLive') + '\n' + lift('obligationQueue') + '\n__r=obligationQueue();', ctx);
  return ctx.__r;
}

test('a signed-in account with no provider row yet gets an EMPTY queue, never the seed', () => {
  const S: any = {};
  assert.equal(queueOf({ S, signedIn: true, isReal: false }).length, 0);
  assert.equal(S.obligations, undefined, 'the seed was written into state for a signed-in account');
});
test('a real account drops any non-server row that reached state (guest seed carried over, demo parse)', () => {
  const S: any = { obligations: [
    { id: 'ob_1', status: 'draft', title: 'seed' },
    { id: 'ob_x', status: 'draft', title: 'pasted', sourceKind: 'manual' },
    { id: 'uuid-1', status: 'draft', title: 'server', live: true },
  ] };
  const q = queueOf({ S, signedIn: true, isReal: true });
  assert.deepEqual(q.map((o: any) => o.id), ['uuid-1']);
});
test('the disclosed guest preview still gets the seed, and none of it is marked live', () => {
  const S: any = {};
  const q = queueOf({ S, signedIn: false, isReal: false });
  assert.ok(q.length >= 1);
  assert.ok(q.every((o: any) => o.live !== true));
});
test('a failed obligations read is rendered as a failure, not swallowed', () => {
  const fn = lift('loadLiveObligations');
  assert.ok(!/\.catch\(\(\)=>\{\/\*/.test(fn), 'the swallowing catch is back');
  assert.match(fn, /\.catch\(e=>\{[\s\S]*S\.obligError=/);
  assert.match(host, /data-oblig-retry="1"/);
  assert.match(host, /Couldn't load your queue/);
});
test('Approve, Mark done and Dismiss flip a live row only after the server confirms the new status', () => {
  const patch = host.slice(host.indexOf('const obligPatch='), host.indexOf('const obligSet='));
  assert.match(patch, /Prefer:"return=representation"/);
  assert.match(patch, /rows\[0\]\.status===status/);
  // no handler sets status before the approve RPC resolves
  assert.ok(!/o\.status="approved";render\(\);\s*window\.SporveAPI\.rpc\("approve_obligation_and_queue"/.test(host), 'single Approve flips before the RPC');
  assert.ok(!/o\.status="approved";(render\(\);)?\s*const msgId=await window\.SporveAPI\.rpc/.test(host), 'bulk Approve flips before the RPC');
  assert.ok(!/o\.status="done";obligPatch\(/.test(host), 'Mark done flips before the PATCH');
  assert.ok(!/o\.status="void";obligPatch\(/.test(host), 'Dismiss flips before the PATCH');
});
test('the demo "Turn into drafts" parser is not offered to a live queue', () => {
  assert.match(host, /\$\("\[data-oblig-parse\]"\)\.forEach\(b=>b\.onclick=\(\)=>\{\s*if\(queueIsLive\(\)\)\{toast/);
});
test('Approvals drafts and the demo roster gate on the signed-in state too, not on a provider row that may not have loaded', () => {
  assert.ok(!/coachState\(\)\.isReal\?\[\]:approvalDrafts\(\)/.test(host), 'Approvals still seeds on isReal');
  assert.ok(!/coachState\(\)\.isReal\?\[\]:JSON\.parse\(JSON\.stringify\(SEED\.teams/.test(host), 'roster still seeds on isReal');
  assert.match(host, /queueIsLive\(\)\?\[\]:approvalDrafts\(\)/);
});
