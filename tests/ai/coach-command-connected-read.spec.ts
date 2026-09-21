// tests/ai/coach-command-connected-read.spec.ts — v37 connected-read completion.
//
// Production bug 2026-09-21: the coach DENIED an Outlook mail/calendar read
// ("no access") and emitted zero tool calls even though the Microsoft
// connector was connected. The system prompt told the model to call
// read_connected, but nothing on the server verified the turn actually
// completed a connected read — unlike drafts (v12/v30), documents (v33),
// lapsed outreach (v34), and research (v34/v35), which all have deterministic
// completions. The fix: isConnectedReadTurn detects the turn,
// resolveConnectedReads maps it to read_connected calls, a refuse-intent
// reconciliation flips the intent (the v35 pattern), and the server runs the
// read through the same org-scoped readConnected executor.
//
// This spec extracts isConnectedReadTurn and resolveConnectedReads VERBATIM
// from supabase/functions/coach-command/index.ts at test time and runs them
// under node's type stripping, so it tests the real shipped source — not a
// copy. Before the fix these functions do not exist and the spec fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const src = readFileSync(new URL('supabase/functions/coach-command/index.ts', root), 'utf8');

// String-aware brace matcher. The extracted functions contain regex literals
// (with '/' chars) but no braces inside strings/regexes, so tracking string
// state is sufficient.
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

// isConnectedReadTurn depends on the document/research detectors.
const FN_NAMES = ['isDocumentTurn', 'isClubResearchTurn', 'isVenueResearchTurn', 'isConnectedReadTurn', 'resolveConnectedReads'];
const modSrc =
  FN_NAMES.map(extractFn).join('\n\n') +
  `\nexport { ${FN_NAMES.join(', ')} };\n`;

const tmpFile = join(tmpdir(), `connected-read-test-${Date.now()}.mts`);
writeFileSync(tmpFile, modSrc);
const fns = await import(pathToFileURL(tmpFile).href) as Record<string, (...a: never[]) => unknown>;
const isConnectedReadTurn = fns.isConnectedReadTurn as (text: string, intent: string) => boolean;
const resolveConnectedReads = fns.resolveConnectedReads as (text: string) => Array<{ kind: string; params: Record<string, unknown> }>;

// ── The production failure ───────────────────────────────────────────────
test('C1: "Read my Outlook mail and calendar." is a connected-read turn', () => {
  assert.equal(isConnectedReadTurn('Read my Outlook mail and calendar.', 'read'), true);
});

test('C2: Outlook mail+calendar resolves to two microsoft365 calls', () => {
  assert.deepEqual(resolveConnectedReads('Read my Outlook mail and calendar.'), [
    { kind: 'microsoft365', params: { section: 'mail' } },
    { kind: 'microsoft365', params: { section: 'calendar', days: 14 } },
  ]);
});

test('C3: Outlook inbox question resolves to mail only', () => {
  assert.equal(isConnectedReadTurn('Check my Outlook inbox for the tournament notice.', 'read'), true);
  assert.deepEqual(resolveConnectedReads('Check my Outlook inbox for the tournament notice.'), [
    { kind: 'microsoft365', params: { section: 'mail' } },
  ]);
});

test('C4: Outlook calendar question resolves to calendar only', () => {
  assert.equal(isConnectedReadTurn("What's on my Outlook calendar this week?", 'read'), true);
  assert.deepEqual(resolveConnectedReads("What's on my Outlook calendar this week?"), [
    { kind: 'microsoft365', params: { section: 'calendar', days: 14 } },
  ]);
});

// ── Other connectors ─────────────────────────────────────────────────────
test('C5: Gmail read resolves to gmail', () => {
  assert.equal(isConnectedReadTurn('Show me my Gmail.', 'read'), true);
  assert.deepEqual(resolveConnectedReads('Show me my Gmail.'), [{ kind: 'gmail', params: {} }]);
});

test('C6: unqualified email read defaults to gmail', () => {
  assert.equal(isConnectedReadTurn('Check my email for the league notice.', 'read'), true);
  assert.deepEqual(resolveConnectedReads('Check my email for the league notice.'), [{ kind: 'gmail', params: {} }]);
});

// ── Negative guards: never hijack other turn types ───────────────────────
test('C7: outbound email request is a draft turn, not a read', () => {
  assert.equal(isConnectedReadTurn('Email the parents about Saturday practice.', 'read'), false);
});

test('C8: bare club-schedule question is not a connected read', () => {
  assert.equal(isConnectedReadTurn('Show me the schedule for next week.', 'read'), false);
});

test('C9: research turns are not connected reads', () => {
  assert.equal(isConnectedReadTurn('Find youth soccer clubs near me.', 'read'), false);
});

test('C10: document turns are not connected reads', () => {
  assert.equal(isConnectedReadTurn('Make a handout for parents about Saturday.', 'read'), false);
});

test('C11: refuse intent never triggers directly (reconciliation passes "read")', () => {
  assert.equal(isConnectedReadTurn('Read my Outlook mail and calendar.', 'refuse'), false);
  assert.equal(isConnectedReadTurn('Read my Outlook mail and calendar.', 'read'), true);
});
