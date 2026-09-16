import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { REGISTRY, HUMAN_WRITES, entryFor } from './agent-write-registry.mjs';

// Read every migration, oldest first, and keep the LAST body defined for each
// function — that is what production would hold after applying them in order.
const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const latest = new Map();   // name -> { file, body, returns }
const grantedToAuthenticated = new Set();
const defRe = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([^)]*)\)\s*returns\s+([\w ]+?)\s+language\s+(\w+)[\s\S]*?as\s+(\$\w*\$)([\s\S]*?)\5/gi;
const grantRe = /grant\s+execute\s+on\s+function\s+public\.(\w+)\s*\([^)]*\)\s+to\s+([^;]+);/gi;
for (const f of files) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  for (const m of src.matchAll(defRe)) latest.set(m[1], { file: f, body: m[6], returns: m[3].trim().toLowerCase() });
  for (const m of src.matchAll(grantRe)) if (/\bauthenticated\b/.test(m[2])) grantedToAuthenticated.add(m[1]);
}
const writes = (body) => /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i.test(body);

const GUARD = {
  row_count: (b) => /get\s+diagnostics\s+\w+\s*=\s*row_count[\s\S]*?raise\s+exception/i.test(b),
  not_found: (b) => /if\s+not\s+found\s+then\s+raise/i.test(b),
  count:     (b, def) => def.returns === 'integer' || def.returns === 'jsonb',
};

test('every registry entry names a function that exists in the migrations', () => {
  for (const e of REGISTRY) assert.ok(latest.has(e.rpc), `${e.rpc} (${e.op}) is not defined in any migration`);
});

test('every registry entry declares all five fields and a known guard', () => {
  for (const e of REGISTRY) {
    for (const k of ['op', 'rpc', 'precondition', 'effect', 'inverse', 'receipt']) assert.ok(e[k], `${e.rpc} missing ${k}`);
    assert.ok(GUARD[e.guard], `${e.rpc} guard=${e.guard} is not a known guard`);
  }
});

test('the latest SQL body of every registered write carries the guard it declares', () => {
  for (const e of REGISTRY) {
    const def = latest.get(e.rpc);
    assert.ok(GUARD[e.guard](def.body, def), `${e.rpc} (${def.file}) declares guard=${e.guard} but its body does not prove it`);
  }
});

test('a row_count guard is only satisfied by a raise, never by returning the count', () => {
  // The defect class: `get diagnostics n = row_count; return n;` — zero is
  // reported as success. A registered row_count guard must raise on it.
  for (const e of REGISTRY.filter((x) => x.guard === 'row_count')) {
    const b = latest.get(e.rpc).body;
    const afterDiag = b.slice(b.search(/get\s+diagnostics/i));
    assert.ok(/if\s+[^;]*\b(row_count|written|n)\b[^;]*then\s*raise|raise\s+exception/i.test(afterDiag), `${e.rpc}: rowcount is read but never enforced`);
  }
});

test('every authenticated RPC that writes is either an agent write in the registry or a declared human write', () => {
  const undeclared = [];
  for (const name of grantedToAuthenticated) {
    const def = latest.get(name);
    if (!def || !writes(def.body)) continue;
    if (!entryFor(name) && !HUMAN_WRITES[name]) undeclared.push(`${name} (${def.file})`);
  }
  assert.deepEqual(undeclared, [], `undeclared authenticated writes: ${undeclared.join(', ')}`);
});

test('no registered agent write and no human write is granted to anon', () => {
  const anonGranted = new Set();
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(grantRe)) if (/\banon\b/.test(m[2])) anonGranted.add(m[1]);
  }
  for (const name of [...REGISTRY.map((e) => e.rpc), ...Object.keys(HUMAN_WRITES)]) {
    assert.ok(!anonGranted.has(name), `${name} is granted to anon`);
  }
});

test('the fourth mode is gone: no migration after 001060 may re-admit mode=auto', () => {
  const after = files.filter((f) => f > '20260915_001060' && !f.startsWith('20260915_001060'));
  for (const f of after) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '');
    assert.ok(!/lifecycle_message_prefs[\s\S]{0,400}'auto'/i.test(src), `${f} re-admits mode='auto'`);
    assert.ok(!/auto_approve_agent_drafts/i.test(src), `${f} recreates auto_approve_agent_drafts`);
  }
  // and 001060 itself is the one that removes it
  const m = readFileSync(new URL('20260915_001060_agent_write_safety.sql', dir), 'utf8');
  assert.ok(/check\s*\(mode\s+in\s*\('off',\s*'draft'\)\)/.test(m));
  assert.ok(/drop\s+function\s+if\s+exists\s+public\.auto_approve_agent_drafts\(\)/.test(m));
});
