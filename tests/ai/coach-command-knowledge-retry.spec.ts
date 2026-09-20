// tests/ai/coach-command-knowledge-retry.spec.ts — v36 coaching-knowledge retry.
//
// Production bug (2026-09-20): on the A2 benchmark turn ("Give me a 60-minute
// U14 practice plan…") the model returned intent='clarify' with a question
// instead of delivering the plan — even though the v31 prompt-level
// age-mismatch rule was deployed. Coaching-knowledge turns (practice plans,
// drills, rules explainers) must DELIVER; the server now detects them and
// retries once with a deliver-now directive instead of passing the question
// through to the coach.
//
// This spec extracts isCoachingKnowledgeTurn VERBATIM from
// supabase/functions/coach-command/index.ts at test time and runs it under
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

// isCoachingKnowledgeTurn calls the two research predicates internally.
const FN_NAMES = ['isCoachingKnowledgeTurn', 'isClubResearchTurn', 'isVenueResearchTurn'];
const modSrc =
  FN_NAMES.map(extractFn).join('\n\n') +
  `\nexport { ${FN_NAMES.join(', ')} };\n`;

const tmpFile = join(tmpdir(), `knowledge-retry-test-${Date.now()}.mts`);
writeFileSync(tmpFile, modSrc);
const fns = await import(pathToFileURL(tmpFile).href) as Record<string, (...a: never[]) => unknown>;
const isCoachingKnowledgeTurn = fns.isCoachingKnowledgeTurn as (text: string, intent: string) => boolean;

// ── Benchmark turns: must be detected ────────────────────────────────────
test('K1: A2 benchmark U14 practice-plan prompt is a knowledge turn', () => {
  assert.equal(
    isCoachingKnowledgeTurn('Give me a 60-minute U14 practice plan with warm-up, 2 drills, scrimmage, cool-down, timings and coaching points.', 'read'),
    true);
});

test('K2: A1 drills prompt is a knowledge turn', () => {
  assert.equal(
    isCoachingKnowledgeTurn('Give me 3 U12 soccer drills for improving first touch.', 'read'),
    true);
});

test('K3: A3 offside explainer is a knowledge turn', () => {
  assert.equal(
    isCoachingKnowledgeTurn('Explain offside for U10 parents, no jargon.', 'read'),
    true);
});

test('K4: technique/rules questions are knowledge turns', () => {
  assert.equal(
    isCoachingKnowledgeTurn('What are the offside rules for U10?', 'read'),
    true);
  assert.equal(
    isCoachingKnowledgeTurn('How should I coach defensive shape for U14s?', 'read'),
    true);
});

// ── Must NOT hijack other turn types ───────────────────────────────────────
test('K5: message drafts stay with the draft path', () => {
  assert.equal(
    isCoachingKnowledgeTurn('Draft a message to parents about Saturday practice.', 'read'),
    false);
  assert.equal(
    isCoachingKnowledgeTurn('Remind the coaches about the schedule change.', 'read'),
    false);
});

test('K6: documents stay with the document path', () => {
  assert.equal(
    isCoachingKnowledgeTurn('Create a handout for the U14 practice plan.', 'read'),
    false);
});

test('K7: research turns stay with the research path', () => {
  assert.equal(
    isCoachingKnowledgeTurn('Find soccer clubs in Chicago for my U14 team to scrimmage.', 'read'),
    false);
  assert.equal(
    isCoachingKnowledgeTurn('Find a gym to rent near Lake Zurich for winter training.', 'read'),
    false);
});

test('K8: refuse intent never triggers the retry', () => {
  assert.equal(
    isCoachingKnowledgeTurn('Give me a U14 practice plan.', 'refuse'),
    false);
});

test('K9: bare noun-phrase plan request still delivers ("plan" is a request verb)', () => {
  assert.equal(
    isCoachingKnowledgeTurn('U14 practice plan', 'read'),
    true);
});
