// tests/ai/coach-command-lapsed-draft.spec.ts — v30 draft-completion regressions.
//
// Two production bugs, both "the model said done but nothing was queued":
//   F1: the model called find_lapsed_families, narrated "ready to queue", and
//       never called draft_lapsed_outreach. The server must detect a
//       lapsed-OUTREACH turn (not a bare shortlist question) and complete it.
//   D1-run2: the model emitted draft_bulk_message with an empty body; the
//       tool returned queued: 0 and the model's "ready" claim stood. A
//       failed draft tool must trigger the deterministic draft-writer.
//
// This spec extracts isLapsedOutreachTurn and isDraftToolFailed VERBATIM from
// supabase/functions/coach-command/index.ts at test time and runs them under
// node's type stripping, so it tests the real shipped source — not a copy.
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

const FN_NAMES = ['isLapsedOutreachTurn', 'isDraftToolFailed', 'isDocumentTurn', 'isClubResearchTurn', 'isVenueResearchTurn'];
const modSrc =
  FN_NAMES.map(extractFn).join('\n\n') +
  `\nexport { ${FN_NAMES.join(', ')} };\n`;

const tmpFile = join(tmpdir(), `lapsed-draft-test-${Date.now()}.mts`);
writeFileSync(tmpFile, modSrc);
const fns = await import(pathToFileURL(tmpFile).href) as Record<string, (...a: never[]) => unknown>;
const isLapsedOutreachTurn = fns.isLapsedOutreachTurn as (text: string, intent: string) => boolean;
const isDraftToolFailed = fns.isDraftToolFailed as (cleaned: unknown[]) => boolean;
const isDocumentTurn = fns.isDocumentTurn as (text: string, intent: string) => boolean;
const isClubResearchTurn = fns.isClubResearchTurn as (text: string, intent: string) => boolean;
const isVenueResearchTurn = fns.isVenueResearchTurn as (text: string, intent: string) => boolean;

// ── F1: lapsed-outreach detection ──────────────────────────────────────────
test('L1: benchmark F1 prompt is a lapsed-outreach turn', () => {
  assert.equal(
    isLapsedOutreachTurn('Find lapsed families, shortlist, draft one reactivation note per family, queue for approval.', 'read'),
    true);
});

test('L2: bare shortlist question is NOT an outreach turn (no auto-draft)', () => {
  assert.equal(isLapsedOutreachTurn('Who are my lapsed families?', 'read'), false);
  assert.equal(isLapsedOutreachTurn('Show me inactive members from last season.', 'read'), false);
});

test('L3: refuse intent never triggers outreach', () => {
  assert.equal(
    isLapsedOutreachTurn('Find lapsed families and draft them a note.', 'refuse'),
    false);
});

test('L4: outreach synonyms match (win back / re-engage / nudge)', () => {
  assert.equal(isLapsedOutreachTurn('Win back the families we have not seen in 60 days — send them a nudge.', 'read'), true);
  assert.equal(isLapsedOutreachTurn('Re-engage inactive athletes with a text.', 'read'), true);
});

// ── D1-run2: failed draft-tool detection ───────────────────────────────────
test('D1: empty-body draft_bulk_message with queued 0 counts as failed', () => {
  assert.equal(
    isDraftToolFailed([{ tool: 'draft_bulk_message', args: { to: 'U12 Thunderbolts', body: '' }, kind: 'read', result: { queued: 0, error: 'The message body is empty.' } }]),
    true);
});

test('D2: successful draft tool does NOT count as failed', () => {
  assert.equal(
    isDraftToolFailed([{ tool: 'draft_bulk_message', args: {}, kind: 'read', result: { queued: 10 } }]),
    false);
});

test('D3: unrelated read tools never count as failed', () => {
  assert.equal(isDraftToolFailed([{ tool: 'find_lapsed_families', kind: 'read', result: { families: [] } }]), false);
  assert.equal(isDraftToolFailed([]), false);
});

// ── F2: document-turn detection ────────────────────────────────────────────
test('F2-1: benchmark F2 prompt is a document turn', () => {
  assert.equal(
    isDocumentTurn("Make a parent handout for Saturday's practice plan", 'read'),
    true);
});

test('F2-2: document synonyms match (generate a PDF / create a letter)', () => {
  assert.equal(isDocumentTurn('Generate a PDF with the team rules.', 'read'), true);
  assert.equal(isDocumentTurn('Create a welcome letter for new families.', 'read'), true);
});

test('F2-3: message drafts are NOT document turns', () => {
  assert.equal(isDocumentTurn('Draft a parent note about Saturday practice.', 'read'), false);
  assert.equal(isDocumentTurn('Send a message to all parents.', 'read'), false);
});

test('F2-4: past-tense / lookup questions are NOT document turns', () => {
  assert.equal(isDocumentTurn('Did you create the handout?', 'read'), false);
  assert.equal(isDocumentTurn('Show me the permission slip document.', 'read'), false);
});

test('F2-5: refuse intent never triggers document creation', () => {
  assert.equal(isDocumentTurn('Make a handout with the kids home addresses.', 'refuse'), false);
});

// ── v34: research-turn detection ─────────────────────────────────────────
test('R1: C1/D2 club prompts are research turns', () => {
  assert.equal(isClubResearchTurn('Find 10 youth soccer clubs in Chicago with contact info', 'read'), true);
  assert.equal(isClubResearchTurn('Find 10 youth soccer clubs in Chicago and save them to my queue', 'read'), true);
});

test('R2: own-team reads are NOT research turns', () => {
  assert.equal(isClubResearchTurn('List my teams.', 'read'), false);
  assert.equal(isClubResearchTurn('Who is on my roster?', 'read'), false);
});

test('R3: refuse intent never triggers research', () => {
  assert.equal(isClubResearchTurn('Find clubs and message the kids directly.', 'refuse'), false);
  assert.equal(isVenueResearchTurn('Find a gym to rent near me and text the owner.', 'refuse'), false);
});

test('R4: C2 venue prompt is a research turn; plain field booking is not', () => {
  assert.equal(isVenueResearchTurn('Find a gym to rent for my team near Lake Zurich, Illinois, get their email, draft a personalized booking email', 'read'), true);
  assert.equal(isVenueResearchTurn('Book a field for Saturday practice', 'read'), false);
});
