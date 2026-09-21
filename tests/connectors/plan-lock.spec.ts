// tests/connectors/plan-lock.spec.ts — out-of-plan connector tiles.
//
// Production bug 2026-09-21: a Pro workspace saw an active CONNECT button on
// the Google Sheets, Google Drive, and Microsoft 365 tiles, but those
// connectors are Enterprise-only — the click 402'd at google-oauth-start /
// microsoft-oauth-start (invariant I3). Per CONTEXT.md §6.5 the tiles must
// render a visibly locked state naming the required plan instead of a dead
// Connect button. The fix: connectors-available marks out-of-plan OAuth
// connectors as state 'locked' + required_plan (no connect_url) using the
// same plan_entitlements.connectors array the oauth-start 402 reads, so the
// tile and the gate can never disagree.
//
// This spec extracts lockedPlanByKind VERBATIM from
// supabase/functions/connectors-available/index.ts at test time and runs it
// under node's type stripping, so it tests the real shipped source — not a
// copy. Before the fix this function does not exist and the spec fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const src = readFileSync(new URL('supabase/functions/connectors-available/index.ts', root), 'utf8');

// String-aware brace matcher. The extracted function contains no braces
// inside strings or regexes, so tracking string state is sufficient.
function extractFn(name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`function ${name} not found`);
  let k = src.indexOf('{', i);
  if (k === -1) throw new Error(`no body brace for ${name}`);
  let depth = 0, mode: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  const start = i;
  while (k < src.length) {
    const c = src[k], nx = src[k + 1] ?? '';
    if (mode === 'code') {
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
    } else {
      if (c === '\\') k++;
      else if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    }
    k++;
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const modSrc = extractFn('lockedPlanByKind') + `\nexport { lockedPlanByKind };\n`;
const tmpFile = join(tmpdir(), `plan-lock-test-${Date.now()}.mts`);
writeFileSync(tmpFile, modSrc);
const fns = await import(pathToFileURL(tmpFile).href) as Record<string, (...a: never[]) => unknown>;
const lockedPlanByKind = fns.lockedPlanByKind as (
  oauthKinds: string[], byPlan: Record<string, string[]>, currentPlan: string,
) => Record<string, string>;

// Mirrors the live plan_entitlements rows (verified 2026-09-21).
const BY_PLAN: Record<string, string[]> = {
  free: ['website', 'file_import', 'stripe'],
  pro: ['website', 'file_import', 'stripe', 'gmail', 'google_calendar', 'sms'],
  enterprise: ['website', 'file_import', 'stripe', 'gmail', 'google_calendar', 'sms',
    'microsoft365', 'google_sheets', 'google_drive', 'quickbooks', 'google_business_profile'],
};
// The oauth kinds connectors-available passes in (CONNECTORS.filter(c => c.oauth)).
const OAUTH = ['gmail', 'google_calendar', 'google_sheets', 'google_drive',
  'google_business_profile', 'microsoft365', 'quickbooks'];

// ── The production failure ───────────────────────────────────────────────
test('L1: a Pro org locks Sheets/Drive/M365/QuickBooks/GBP as Enterprise', () => {
  assert.deepEqual(lockedPlanByKind(OAUTH, BY_PLAN, 'pro'), {
    google_sheets: 'Enterprise',
    google_drive: 'Enterprise',
    google_business_profile: 'Enterprise',
    microsoft365: 'Enterprise',
    quickbooks: 'Enterprise',
  });
});

test('L2: an Enterprise org locks nothing', () => {
  assert.deepEqual(lockedPlanByKind(OAUTH, BY_PLAN, 'enterprise'), {});
});

test('L3: a Free org locks Gmail/Calendar as Pro and Sheets as Enterprise', () => {
  const out = lockedPlanByKind(OAUTH, BY_PLAN, 'free');
  assert.equal(out.gmail, 'Pro');
  assert.equal(out.google_calendar, 'Pro');
  assert.equal(out.google_sheets, 'Enterprise');
  assert.equal(out.microsoft365, 'Enterprise');
});

test('L4: in-plan connectors are never locked', () => {
  const out = lockedPlanByKind(['gmail', 'google_calendar'], BY_PLAN, 'pro');
  assert.deepEqual(out, {});
});

test('L5: a connector in no plan is never locked (stays honest, not locked)', () => {
  const out = lockedPlanByKind(['hypothetical_future'], BY_PLAN, 'free');
  assert.deepEqual(out, {});
});

test('L6: unknown plan treats the org as having no entitlements, lowest including plan named', () => {
  const out = lockedPlanByKind(['gmail'], BY_PLAN, 'bogus-plan');
  assert.equal(out.gmail, 'Pro');
});

test('L7: empty entitlements never lock (fail-open tiles; oauth-start still fails closed)', () => {
  const out = lockedPlanByKind(OAUTH, {}, 'pro');
  assert.deepEqual(out, {});
});
