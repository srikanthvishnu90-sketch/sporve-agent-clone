// tests/ai/coach-command-research-render.spec.ts — D2 single-render regressions.
//
// D2 lost its design point because research results rendered TWICE: the
// assistant prose listed every finding AND the frontend rendered the same
// findings as structured cards. The contract now:
//
//   1. The find_clients prompt rule forbids repeating results in prose — the
//      shortlist renders ONCE as a structured card below the reply.
//   2. The server-side club-research completion never builds a prose bullet
//      list of leads; it emits a short count line and lets the card carry
//      the findings plus the honest save receipt.
//   3. leadsCardHTML renders every contact field the tool returns (name,
//      address, website, phone) exactly once, with an honest saved vs
//      already-queued receipt.
//
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const backend = readFileSync(new URL('supabase/functions/coach-command/index.ts', root), 'utf8');
const frontend = readFileSync(new URL('src/sporve-web.host.html', root), 'utf8');

// ── 1. Prompt rule: no prose repetition ────────────────────────────────────
test('D2-1: find_clients prompt forbids repeating results in prose', () => {
  const i = backend.indexOf('"- find_clients (RESEARCH):');
  assert.ok(i !== -1, 'find_clients prompt rule exists');
  const rule = backend.slice(i, i + 1200);
  assert.match(rule, /Do NOT repeat the results in prose/i);
  assert.match(rule, /renders once as a structured card/i);
});

// ── 2. Server completion: no prose bullet list ─────────────────────────────
test('D2-2: club-research completion emits a count line, not a lead list', () => {
  assert.ok(
    backend.includes('Found ${leads.length} club${leads.length === 1 ? "" : "s"}'),
    'single-render count line present',
  );
  assert.ok(
    !backend.includes('Here are ${leads.length} clubs I found'),
    'old prose bullet-list builder is gone',
  );
  // The completion block must not map leads into dash-lines anymore.
  const start = backend.indexOf('C1/D2 club-research completion');
  const end = backend.indexOf('C2 venue-research completion');
  const block = backend.slice(start, end);
  assert.ok(!block.includes('const lines = leads'), 'no prose lines built from leads');
});

// ── 3. leadsCardHTML: single structured rendering ──────────────────────────
function extractFn(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`function ${name} not found`);
  let k = src.indexOf('{', i);
  let depth = 0, mode: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  const start = i;
  while (k < src.length) {
    const c = src[k];
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

const escStub = `function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}\n`;
const cardSrc = escStub + extractFn(frontend, 'leadsCardHTML') + '\nexport { leadsCardHTML };\n';
const tmpFile = join(tmpdir(), `research-render-test-${Date.now()}.mjs`);
writeFileSync(tmpFile, cardSrc);
const { leadsCardHTML } = await import(pathToFileURL(tmpFile).href) as {
  leadsCardHTML: (list: unknown[], saved: number) => string;
};

const sample = [
  { name: 'Northside SC', address: '1 Main St', website: 'https://northside.example', phone: '+1 312-555-0100', rating: 4.5 },
  { name: 'Riverside FC', address: '2 River Rd', website: null, phone: null, rating: null },
];

test('D2-3: card renders every contact field exactly once', () => {
  const html = leadsCardHTML(sample, 2);
  for (const needle of ['Northside SC', '1 Main St', 'northside.example', '312-555-0100', 'Riverside FC']) {
    const count = html.split(needle).length - 1;
    assert.equal(count, 1, `expected exactly one rendering of ${needle}`);
  }
});

test('D2-4: card carries the honest save receipt', () => {
  assert.match(leadsCardHTML(sample, 2), /Saved 2 new prospects to your review queue/);
  assert.match(leadsCardHTML(sample, 0), /Already in your review queue — nothing new to save/);
});

test('D2-5: empty list renders nothing (no phantom card)', () => {
  assert.equal(leadsCardHTML([], 0), '');
});

// ── 6. Count agreement (production 2026-09-20: prose said "Found 10", card
//      showed 8) ──────────────────────────────────────────────────────────
test('D2-6: card notes truncation when more than 8 leads', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `Club ${i + 1}` }));
  const html = leadsCardHTML(many, 3);
  assert.match(html, /Showing 8 of 10 here/);
  // exactly 8 rows rendered
  assert.equal(html.split('class="facrow"').length - 1, 8);
});

test('D2-7: card omits the scope note when 8 or fewer leads', () => {
  assert.ok(!leadsCardHTML(sample, 2).includes('Showing'));
});

test('D2-8: server count line agrees with the 8-row card cap', () => {
  const start = backend.indexOf('C1/D2 club-research completion');
  const end = backend.indexOf('C2 venue-research completion');
  const block = backend.slice(start, end);
  assert.ok(block.includes('shownCount = Math.min(leads.length, 8)'), 'cap of 8 present');
  assert.ok(block.includes('the top ${shownCount} are in the card below'), 'truncated count line present');
  assert.ok(block.includes('the rest are in your review queue'), 'overflow points at queue');
});
