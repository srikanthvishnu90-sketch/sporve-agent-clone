// tests/ai/coach-command-pinning.spec.ts — v21 deterministic pinning regressions.
//
// The narrow draft-writer once wrote "Sunday, 26 September" (26 Sept is a
// Saturday) by combining the coach's weekday with the Saturday session's date
// and time, and stored drafts that omitted exact attendance rates. The server
// now resolves everything deterministically (dowOf / nextWeekdayDate /
// formatSessionHint / pinAttendanceFilter / resolveSessionHint / pinDraftFacts)
// and the writer copies the pinned facts verbatim.
//
// This spec extracts those pure functions VERBATIM from
// supabase/functions/coach-command/index.ts at test time (brace/regex/
// template-aware extraction) and runs them under node's type stripping, so it
// tests the real shipped source — not a copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const src = readFileSync(new URL('supabase/functions/coach-command/index.ts', root), 'utf8');

// ── extraction ─────────────────────────────────────────────────────────────
function skipBalancedBrace(k: number): number {
  // k at '{' -> index just past the matching '}'. String/comment aware.
  let mode = 'code', depth = 0;
  const n = src.length;
  while (k < n) {
    const c = src[k], nx = src[k + 1] ?? '';
    if (mode === 'code') {
      if (c === '/' && nx === '/') { mode = 'line'; k++; }
      else if (c === '/' && nx === '*') { mode = 'block'; k++; }
      else if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return k + 1; }
    } else if (mode === 'line') { if (c === '\n') mode = 'code'; }
    else if (mode === 'block') { if (c === '*' && nx === '/') { mode = 'code'; k++; } }
    else {
      if (c === '\\') k++;
      else if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    }
    k++;
  }
  throw new Error('unbalanced in skipBalancedBrace');
}

function bodyOpen(i: number): number {
  // Match the param parens, then skip an optional return-type annotation
  // (including a braced object type) to find the body's opening brace.
  const p = src.indexOf('(', i);
  let depth = 0, k = p, q = -1;
  const n = src.length;
  while (k < n) {
    const c = src[k];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { q = k; break; } }
    k++;
  }
  if (q === -1) throw new Error('no param close paren');
  k = q + 1;
  while (k < n && ' \t\n'.includes(src[k])) k++;
  if (src[k] === ':') {
    k++;
    while (k < n && ' \t\n'.includes(src[k])) k++;
    if (src[k] === '{') {
      k = skipBalancedBrace(k);
      while (k < n && ' \t\n'.includes(src[k])) k++;
    } else {
      while (k < n && src[k] !== '{') k++; // simple return type: next '{' is the body
    }
  }
  if (src[k] !== '{') throw new Error('expected body brace, found ' + JSON.stringify(src.slice(k, k + 20)));
  return k;
}

function extractFn(name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`function ${name} not found`);
  const j = bodyOpen(i);
  // Brace scan with string/template/regex/comment awareness; template ${}
  // expressions push a frame so nested braces balance correctly.
  let mode = 'code';
  const stack: Array<[string, number]> = [];
  let depth = 0, inClass = false, prev = '';
  let k = j;
  const n = src.length;
  while (k < n) {
    const c = src[k], nx = src[k + 1] ?? '';
    if (mode === 'code') {
      if (c === '/' && nx === '/') { mode = 'line'; k += 2; continue; }
      if (c === '/' && nx === '*') { mode = 'block'; k += 2; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      else if (c === '/' && (!prev || !')]}abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$'.includes(prev))) {
        mode = 'regex'; inClass = false;
      }
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (stack.length && depth < stack[stack.length - 1][1]) { mode = stack.pop()![0]; k++; continue; }
        if (depth === 0 && !stack.length) return src.slice(i, k + 1);
      }
      if (c.trim()) prev = c;
    } else if (mode === 'sq' || mode === 'dq') {
      if (c === '\\') k++;
      else if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"')) mode = 'code';
    } else if (mode === 'tpl') {
      if (c === '\\') k++;
      else if (c === '`') mode = 'code';
      else if (c === '$' && nx === '{') { stack.push(['tpl', depth + 1]); mode = 'code'; depth++; k++; }
    } else if (mode === 'regex') {
      if (c === '\\') k++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) mode = 'code';
    } else if (mode === 'line') { if (c === '\n') mode = 'code'; }
    else if (mode === 'block') { if (c === '*' && nx === '/') { mode = 'code'; k++; } }
    k++;
  }
  throw new Error(`unbalanced braces in ${name}`);
}

function extractConst(name: string): string {
  const m = new RegExp(`const ${name} = [^;]+;`).exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

const FN_NAMES = ['fmtTime', 'dowOf', 'nextWeekdayDate', 'longDate', 'formatSessionHint', 'pinAttendanceFilter', 'resolveSessionHint', 'pinDraftFacts'];
const modSrc =
  extractConst('WEEKDAYS') + '\n' +
  extractConst('WEEKDAY_NAMES') + '\n' +
  extractConst('MONTHS') + '\n' +
  FN_NAMES.map(extractFn).join('\n\n') +
  `\nexport { ${FN_NAMES.join(', ')} };\n`;

const tmpFile = join(tmpdir(), `pin-test-${Date.now()}.mts`);
writeFileSync(tmpFile, modSrc);
const pin = await import(pathToFileURL(tmpFile).href) as Record<string, (...a: never[]) => unknown>;

// ── fixture-shaped inputs ──────────────────────────────────────────────────
const SAT = [{ title: 'U12 Saturday Practice', start_date: '2026-09-26', start_time: '10:00', end_time: '11:30' }];
const ATT = [
  '- Ava Novak: 9/16 (56%)',
  '- Lucas Meyer: 12/16 (75%)',
  '- Mia Rossi: 7/16 (44%)',
  '- Sofia Marino: 11/16 (69%)',
];
const ROSTER = [{ first_name: 'Mia' }, { first_name: 'Ava' }];

// ── the five regressions ───────────────────────────────────────────────────
test('R1: "Sunday" with no Sunday session pins the next Sunday after today, with no time set', () => {
  assert.equal(
    pin.resolveSessionHint("Message the parents of players with attendance below 60% about an extra training session on Sunday.", SAT, '2026-09-20'),
    'Extra training session — Sunday, 27 September 2026 (no time set)');
});

test('R2: "Saturday" pins the Saturday session by its date, never the title', () => {
  assert.equal(
    pin.resolveSessionHint("Message Mia's parent about Saturday.", SAT, '2026-09-20'),
    'U12 Saturday Practice — Saturday, 26 September 2026 10:00 AM–11:30 AM');
});

test('R3: no weekday named pins the next upcoming session unchanged', () => {
  assert.equal(
    pin.resolveSessionHint('Practice moved to 10am, same field — draft a parent note.', SAT, '2026-09-20'),
    'U12 Saturday Practice — Saturday, 26 September 2026 10:00 AM–11:30 AM');
});

test('R4: below-60% resolves to Mia Rossi and Ava Novak only, with exact server-computed rates', () => {
  const f = pin.pinAttendanceFilter('players with attendance below 60%', ATT) as { to: string; rates: string[]; finding: string };
  assert.equal(f.to, 'Ava Novak and Mia Rossi');
  assert.deepEqual(f.rates, ['Ava Novak 9/16 (56%)', 'Mia Rossi 7/16 (44%)']);
  assert.equal(f.finding, 'Ava Novak 9/16 (56%) and Mia Rossi 7/16 (44%) are below 60% attendance');
  assert.ok(!f.to.includes('Sofia') && !f.to.includes('Lucas'), 'Sofia Marino and Lucas Meyer stay excluded');
});

test('R5: pinDraftFacts returns recipients, rates, session hint, and the Why finding together', () => {
  const p = pin.pinDraftFacts(
    'Message the parents of players with attendance below 60% about an extra training session on Sunday.',
    ATT, ROSTER, SAT, '2026-09-20') as {
      to: string; rates: string[]; finding: string; sessionHint: string; whyFinding: string;
    };
  assert.equal(p.to, 'Ava Novak and Mia Rossi');
  assert.deepEqual(p.rates, ['Ava Novak 9/16 (56%)', 'Mia Rossi 7/16 (44%)']);
  assert.equal(p.sessionHint, 'Extra training session — Sunday, 27 September 2026 (no time set)');
  assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(p.sessionHint),
    'the pinned session never carries an ISO date — the writer copies it verbatim');
  assert.ok(!(p.sessionHint.includes('2026-09-26') || p.sessionHint.includes('10:00')),
    'the pinned session never mixes in the Saturday session facts');
  assert.equal(p.whyFinding, 'Ava Novak 9/16 (56%) and Mia Rossi 7/16 (44%) are below 60% attendance');
});

test('R6: pinned session dates render in long form, weekday computed from the date', () => {
  assert.equal(pin.longDate('2026-09-27'), 'Sunday, 27 September 2026');
  assert.equal(pin.longDate('2026-09-26'), 'Saturday, 26 September 2026');
  assert.equal(pin.longDate('2026-12-25'), 'Friday, 25 December 2026');
  assert.equal(
    pin.formatSessionHint('Extra training session', '2026-09-27', '', ''),
    'Extra training session — Sunday, 27 September 2026 (no time set)');
  assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(pin.formatSessionHint('Extra training session', '2026-09-27', '', '')),
    'formatSessionHint never emits an ISO date');
});

test('pinning is present in the source call path (facts pinned before the first writer call)', () => {
  assert.match(src, /const pinned = pinDraftFacts\(text, attLines, rosterFull, sessions as Record<string, unknown>\[\], todayStr\);/);
  assert.match(src, /PINNED SESSION — final:/);
  assert.match(src, /PINNED RECIPIENTS — final, use EXACTLY as the to field/);
  assert.match(src, /if \(whyFinding && !\/\^why:\/im\.test\(dbody\)\)/);
});
