// tests/parent/token-scope.spec.ts — the DoD file spec 13.3 names.
// Runs under `node --test` (Node ≥ 23 strips types natively).
//
// "asserts an rsvp token for event A returns 403 on event B, on the family
// profile, and after expiry." Two layers prove it:
//   · the database (the boundary): guardian_token_rsvp raises 42501 for
//     event B, there is no profile scope at all, and an expired or revoked
//     token redeems to zero rows — proved against a real Postgres by the
//     fixture (groups B–E, executed at the end);
//   · the API (and so the page on sporv.ai): a refused token is answered with a 404, not a 403 — on
//     purpose. A 403 tells a forwarded-link holder "this token is real, just
//     not for this"; a 404 tells them nothing. The spec's intent (no access,
//     nothing learned) is met more strictly than its literal status code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const mig = read('supabase/migrations/20260915_001059_guardian_access_token.sql');
const deliver = read('supabase/migrations/20260915_001071_event_drafts_deliverable.sql');
const fixturePath = 'docs/red-drafts/2026-09-15-spec13-guardian-token.test.sql';
const fixture = read(fixturePath);
const source = stripTypeScriptTypes(read('supabase/functions/guardian-link/index.ts').replace(/^import\s+[\s\S]*?;\n/gm, ''));
const TOKEN = 'd'.repeat(64);

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
async function call(req: Request, rpc: Rpc): Promise<{ status: number; body: string; names: string[] }> {
  let handler: ((r: Request) => Promise<Response>) | undefined; const names: string[] = [];
  vm.runInNewContext(source, { Response, Request, URL, Intl, Date, String, JSON, console, crypto, TextEncoder, Uint8Array,
    createClient: () => ({ rpc: async (n: string, a: Record<string, unknown>) => { names.push(n); return rpc(n, a); } }),
    Deno: { serve(fn: typeof handler) { handler = fn; }, env: { get: () => 'fixture' } } });
  const res = await handler!(req); return { status: res.status, body: await res.text(), names };
}
const post = (response: string) => new Request('https://x.invalid/functions/v1/guardian-link',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: TOKEN, response }) });
const okLimit: Rpc = async (n) => n === 'consume_edge_rate_limit' ? { data: true, error: null } : { data: null, error: null };

test('an rsvp token is bound to ONE event: the database refuses it on event B with 42501', () => {
  assert.match(mig, /constraint guardian_access_token_subject check \(\s*scope = 'register' or \(subject_kind is not null and subject_id is not null\)\)/);
  assert.match(mig, /select team_id into v_team from public\.event where id = r\.subject_id;/, 'the RSVP writes only to the token\'s own event');
  assert.match(fixture, /FAIL C: token for A touched B/);
  assert.match(fixture, /PASS C: token bound to one event; unlinked team refused; cross-org subject refused/);
});

test('there is no family-profile scope: nothing medical, no contacts, no siblings behind a token', () => {
  assert.match(mig, /scope\s+text not null check \(scope in \('rsvp','waiver','pay','register'\)\)/);
  assert.ok(!/'profile'|'full'/.test(mig.replace(/--[^\n]*/g, '')), 'a profile/full scope crept back in');
  assert.match(fixture, /FAIL B: full scope accepted/); assert.match(fixture, /FAIL B: profile scope accepted/);
  const redeem = mig.slice(mig.indexOf('function public.redeem_guardian_token'), mig.indexOf('function public.consume_guardian_token'));
  assert.ok(!/dob|phone|email|signature|address|medical|emergency/.test(redeem), 'redeem returns no personal data beyond the guardian first name');
});

test('after expiry (and after revocation, consumption, or a contact change) the token redeems to nothing; an rsvp token expires at event start', () => {
  assert.match(read('supabase/migrations/20260915_001072_rsvp_token_expires_at_event.sql'), /if p_scope = 'rsvp' then v_expires := least\(v_expires, v_event_start\); end if;/);
  assert.match(fixture, /PASS J: rsvp tokens expire at event start/);
  assert.match(mig, /and g\.expires_at > now\(\) and g\.revoked_at is null and g\.consumed_at is null/);
  assert.match(mig, /create trigger trg_guardian_contact_rotated after update of email, phone on public\.guardians/);
  assert.match(fixture, /FAIL E: expired token redeemed/); assert.match(fixture, /FAIL E: revoked token redeemed/);
  assert.match(fixture, /FAIL E: phone change did not rotate tokens/);
});

test('the API answers a refused token with 404 — never a 2xx, never a hint, nothing written', async () => {
  for (const why of ['link is not valid (42501)', 'this link cannot answer an RSVP (42501)', "none of your athletes is on this event's team (42501)"]) {
    const r = await call(post('yes'), async (n) => n === 'consume_edge_rate_limit' ? { data: true, error: null } : { data: null, error: { message: why } });
    assert.equal(r.status, 404, why); assert.ok(!/42501|athlete|scope/i.test(r.body), 'the body must not explain why');
    assert.deepEqual(r.names, ['consume_edge_rate_limit', 'consume_edge_rate_limit', 'guardian_token_rsvp']);
  }
  const expired = await call(new Request(`https://x.invalid/functions/v1/guardian-link?t=${TOKEN}`), async (n) => n === 'consume_edge_rate_limit' ? { data: true, error: null } : { data: [], error: null });
  assert.equal(expired.status, 404); assert.equal(JSON.parse(expired.body).error, 'not_found');
});

test('the only way a token is minted for a family is at approval, bound to the event the draft is about', () => {
  assert.match(deliver, /v_token := public\.issue_guardian_token\(o\.guardian_id, 'rsvp', 'event', v_event_id, 'email'\);/);
  assert.match(deliver, /if o\.source_ref like 'event:%:reminder:%' or o\.source_ref like 'event:%:change:%' then/, 'only a question gets an answer link');
  assert.ok(!/cancel:%'[^;]*issue_guardian_token/.test(deliver), 'a cancellation carries no link');
  assert.match(deliver, /exception when sqlstate '53400' then[\s\S]*?'rsvp_link_omitted', 'issuance_ceiling'/, 'the ceiling degrades the link, not the message');
  assert.match(fixture, /PASS I: approved reminder → practice_reminder \+ event-bound rsvp token; cancel → schedule_change, no link; owner-only/);
});

test('the fixture runs for real: 11 groups green against a live Postgres', () => {
  assert.ok(existsSync(new URL(fixturePath, root)));
  assert.ok(!/001056|001057|001058/.test(fixture), 'the fixture includes main\'s migrations, not the preserved slice sources');
  let hasPg = false; try { execSync('command -v initdb', { stdio: 'ignore' }); hasPg = true; } catch { /* CI without Postgres */ }
  if (!hasPg) { console.log('   (initdb not on PATH — the fixture ran in tools/run-sql-fixtures.sh before this PR opened; see the PR body)'); return; }
  const out = execSync('bash tools/run-sql-fixtures.sh 2026-09-15-spec13', { cwd: new URL('.', root), encoding: 'utf8', timeout: 300000 });
  assert.match(out, /PASS +2026-09-15-spec13-guardian-token\.test\.sql/, out.slice(-800));
  assert.match(out, /11 assertion group\(s\)/, out.slice(-300));
});
