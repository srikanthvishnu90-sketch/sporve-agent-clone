#!/usr/bin/env node
// no-implant-check.mjs — refuse to merge the folderOpen RCE removed on 2026-09-12.
//
// The implant (SHA-256 9e286f7a…, a .woff2 that is actually padded JS run by a
// hidden VS Code task) sat on main from 2026-08-26 and rode ~150 branches.
// Cleaning main is not enough: every open PR branched off the infected base, so
// any merge could re-introduce it. This is the tripwire that makes the removal
// durable — it fails CI if the payload or its launcher reappears in the tree.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FAILS = [];
const SKIP = new Set(['.git', 'node_modules', 'strix_runs', '.vercel']);

// 1. the payload filename, anywhere
// 2. any .woff2 whose bytes are not the WOFF2 magic 'wOF2' (0x774F4632)
// 3. the malicious task launcher / auto-run enabler in any VS Code config
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (e.name === 'fa-solid-400.woff2') FAILS.push(`payload filename present: ${p}`);
    if (e.name.endsWith('.woff2')) {
      const b = readFileSync(p);
      if (!(b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32)) {
        FAILS.push(`${p}: not a real WOFF2 (magic ${[...b.slice(0,4)].map(x=>x.toString(16).padStart(2,'0')).join('')}), possible disguised payload`);
      }
    }
    if (p.includes('.vscode') && (e.name.endsWith('.json'))) {
      const t = readFileSync(p, 'utf8');
      if (/fa-solid-400\.woff2|"label"\s*:\s*"eslint-check"/.test(t)) FAILS.push(`malicious VS Code task reference in ${p}`);
      if (/"task\.allowAutomaticTasks"\s*:\s*(true|"on")/.test(t)) FAILS.push(`${p}: task.allowAutomaticTasks is enabled — auto-runs tasks on folderOpen without a trust prompt`);
    }
  }
}
walk(process.cwd());

if (FAILS.length) {
  console.error('IMPLANT TRIPWIRE FAILED — do not merge:');
  for (const f of FAILS) console.error('  - ' + f);
  process.exit(1);
}
console.log('implant tripwire: clean (no disguised payload, no auto-run task launcher)');
