// tests/agent/write-registry.spec.ts — G4/G6 detector (spec path named here;
// spec 15 is unfiled, so this file plus the migration ARE the deliverable).
// Runs under `node --test` (Node >= 23 strips types natively).
//
// What it enforces, statically (no database handle needed):
//  1. The registry migration exists, enables RLS, and exposes an
//     authenticated-select policy (I6: RLS on every public table).
//  2. Every human-verified row is present and contains no UNAUDITED marker.
//     (Tuple slicing ends at the row's closing paren, never at a semicolon:
//     prose fields may contain semicolons.)
//  3. TRIPWIRE: any edge-function directory whose index.ts performs a direct
//     table write (.from(...).(insert|update|upsert|delete) within one call
//     chain) must either have a registry row (write_key starting with
//     "<dirname>.") or sit in EXCLUDED with a stated reason. Adding a writer
//     without registering it fails loudly. RPC-shaped writers (consume_*,
//     ledger RPCs) do not match this pattern and are tracked in NOTED.
//  4. No stale entries: every EXCLUDED dir must still match the write pattern,
//     every NOTED dir must still exist, and every registered key must map to
//     an existing function dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20260915_001100_agent_write_registry.sql');
const FUNCTIONS = join(ROOT, 'supabase', 'functions');

const sql = readFileSync(MIGRATION, 'utf8');

const VERIFIED_KEYS = [
  'lifecycle-approve.approve_send',
  'parent-update-send.route_send',
  'coach-command.save_client_findings',
];

// Dirs whose direct table writes belong to other gates/surfaces, with the
// reason. A dir stays here only while its index.ts still matches WRITE_PATTERN
// (asserted below) — the entry is reviewed, not forgotten.
const EXCLUDED = new Map(Object.entries({
  'stripe-connect-onboarding': 'money surface (G3), Connect account writes',
  'stripe-create-checkout': 'money surface (G3), checkout session writes',
  'coach-invoice-create': 'money surface (G3), invoice writes; header states REVIEW COPY NOT DEPLOYED',
  'staff-cert-webhook': 'compliance surface (spec 16), certification writes',
  'resend-webhook': 'delivery infrastructure (G5), bounce/complaint writes',
  'google-oauth-callback': 'connector auth surface, token vault writes (not agent-driven)',
  'unsubscribe': 'parent preference surface, not agent-driven',
  'backfill-embeddings': 'infra backfill, embedding writes',
  'billing-create-checkout': 'platform subscription billing (I10)',
  'gmail-scan': 'AUDIT PENDING: findings writes unconfirmed; row registered pending',
  'Join-Waitlist': 'public signup surface (header-read: waitlist insert plus SMTP confirmation); not agent-driven',
  'google-oauth-start': 'connector auth surface (header-read: one-time state row insert); not agent-driven',
}));

// Write-adjacent dirs that do NOT match WRITE_PATTERN (RPC-shaped writes,
// review-copy not deployed, or single-purpose surfaces). They must still exist;
// if one gains a direct table write the tripwire above fires and it moves to
// EXCLUDED or the registry. Dropped from an earlier draft: ncsi-webhook and
// rate-limit have no index.ts on this branch; the tripwire catches them if one
// appears.
const NOTED = new Map(Object.entries({
  'stripe-webhook': 'money surface (G3), dues ledger writes via RPC (header-read)',
  'stripe-provider-payouts': 'money surface (G3); header states REVIEW COPY NOT DEPLOYED, moves no money',
  'stripe-refund': 'money surface (G3), refund writes via RPC (header-read)',
  'billing-webhook': 'platform billing (I10); header states not deployed until reviewed RPC installed',
  'billing-portal': 'platform billing (I10), portal session only (header-read)',
  'installment-checkout': 'money surface (G3), checkout writes via RPC (header-read)',
  'club-site-extract': 'extraction worker; header states draft-only, no message/payment APIs',
  'generate-embedding': 'infra worker returning vectors; write behavior unconfirmed',
  'enrich-listing': 'supply enrichment worker; listing writes unconfirmed',
  'ai-match': 'matching engine; match writes via RPC unconfirmed',
  'search-execute': 'discovery orchestrator; query-log writes via RPC unconfirmed',
  'setup-interview': 'onboarding worker; interview writes unconfirmed',
  'ai-feedback': 'row registered pending; feedback storage unconfirmed',
}));

// Proposal-only functions must never appear as writers. coach-command is NOT
// here: find_clients inserts agent_findings rows, so it holds a verified
// registry row instead.
const PROPOSAL_ONLY = ['message-draft', 'provider-onboard-draft', 'ai-chat'];

const WRITE_PATTERN = /\.from\(\s*['"][^'"]+['"]\s*\)[\s\S]{0,300}?\.(insert|update|upsert|delete)\s*\(/;

function functionDirs() {
  return readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared' && d.name !== 'tests')
    .map((d) => d.name)
    .filter((n) => existsSync(join(FUNCTIONS, n, 'index.ts')));
}

function writerDirs() {
  return functionDirs().filter((n) =>
    WRITE_PATTERN.test(readFileSync(join(FUNCTIONS, n, 'index.ts'), 'utf8')));
}

function registeredKeys() {
  const keys = [];
  const re = /\('([a-z0-9-]+\.[a-z_]+)'\s*,\s*'([a-z0-9-]+)'/g;
  let m;
  while ((m = re.exec(sql)) !== null) keys.push({ key: m[1], dir: m[2] });
  return keys;
}

test('registry migration enables RLS with an authenticated-select policy', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /agent_write_registry_select/);
  assert.match(sql, /auth\.role\(\) = 'authenticated'/);
});

test('human-verified rows are present and fully audited', () => {
  for (const key of VERIFIED_KEYS) {
    const at = sql.indexOf(`'${key}'`);
    assert.ok(at !== -1, `${key} missing from migration`);
    const end = sql.indexOf('),', at);
    assert.ok(end !== -1, `${key} tuple is malformed`);
    const tuple = sql.slice(at, end);
    assert.ok(!tuple.includes('UNAUDITED'), `${key} still carries an UNAUDITED marker`);
    assert.ok(tuple.includes("'verified'"), `${key} is not marked verified`);
  }
});

test('every table-writing function is registered or explicitly excluded', () => {
  const keys = registeredKeys();
  const covered = new Set(keys.map((k) => k.dir));
  const missing = writerDirs().filter((d) => !covered.has(d) && !EXCLUDED.has(d));
  assert.deepEqual(missing, [], `writer dirs with no registry row and no exclusion: ${missing.join(', ')}`);
});

test('no stale exclusions and every registered key maps to a real function', () => {
  const writers = new Set(writerDirs());
  const stale = [...EXCLUDED.keys()].filter((d) => !writers.has(d));
  assert.deepEqual(stale, [], `exclusions that match no writer (remove them): ${stale.join(', ')}`);
  const dirs = new Set(functionDirs());
  const gone = [...NOTED.keys()].filter((d) => !dirs.has(d));
  assert.deepEqual(gone, [], `noted dirs that no longer exist (revisit them): ${gone.join(', ')}`);
  const keys = registeredKeys();
  const orphan = keys.filter((k) => !dirs.has(k.dir));
  assert.deepEqual(orphan.map((k) => k.key), [], 'registry keys with no function dir');
});

test('proposal-only functions stay proposal-only', () => {
  const keys = registeredKeys();
  for (const dir of PROPOSAL_ONLY) {
    const rows = keys.filter((k) => k.dir === dir);
    assert.deepEqual(rows.map((k) => k.key), [], `${dir} gained a registry row: it must stay proposal-only or be re-registered deliberately`);
  }
});
