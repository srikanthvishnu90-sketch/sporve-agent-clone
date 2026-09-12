#!/usr/bin/env node
// no-implant-check.mjs — refuse the folderOpen RCE removed 2026-09-12, and its
// relocations. Two forms have appeared: a hidden "eslint-check" task in
// tasks.json running `node public/fonts/fa-solid-400.woff2` (a 32KB space-
// padded JS blob), and a non-standard "tasks" key inside settings.json with the
// same runOn:folderOpen shape. This gate fails CI on either, on any disguised
// binary, and on the known payload hash.
//
// Exported as check(root) so a unit test can drive it against a synthetic tree.
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';

const IMPLANT_SHA = '9e286f7a54f071e5a4e9f09de84abca872d8347cbb7059c966c7db54a7e4dcba';
const SKIP = new Set(['.git', 'node_modules', 'strix_runs', '.vercel']);
// The only folderOpen task label the repo legitimately ships.
const ALLOW_FOLDEROPEN = new Set(['Serve (http://127.0.0.1:8421)']);

// First bytes → the extensions they are valid for.
const MAGIC = [
  { ext: '.woff2', ok: b => b.slice(0,4).toString('latin1') === 'wOF2' },
  { ext: '.woff',  ok: b => b.slice(0,4).toString('latin1') === 'wOFF' },
  { ext: '.ttf',   ok: b => b.slice(0,4).equals(Buffer.from([0,1,0,0])) || ['true','ttcf','OTTO'].includes(b.slice(0,4).toString('latin1')) },
  { ext: '.otf',   ok: b => b.slice(0,4).toString('latin1') === 'OTTO' || b.slice(0,4).equals(Buffer.from([0,1,0,0])) },
  { ext: '.png',   ok: b => b.slice(0,4).equals(Buffer.from([0x89,0x50,0x4e,0x47])) },
  { ext: '.jpg',   ok: b => b[0]===0xff && b[1]===0xd8 },
  { ext: '.jpeg',  ok: b => b[0]===0xff && b[1]===0xd8 },
  { ext: '.gif',   ok: b => b.slice(0,3).toString('latin1') === 'GIF' },
  // svg legitimately begins with optional BOM/whitespace then "<"
  { ext: '.svg',   ok: b => /^﻿?\s*</.test(b.slice(0,64).toString('utf8')) },
  // eot has no fixed magic; only require it is not a run of whitespace/JS text
  { ext: '.eot',   ok: b => b[0] !== 0x20 && b[0] !== 0x09 && b[0] !== 0x0a },
];

function parseJsonc(text) {
  // tolerant: strip // and /* */ comments and trailing commas
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1'));
}

export function check(root) {
  const fails = [];
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  })(root);

  for (const p of files) {
    const rel = relative(root, p);
    const name = p.split('/').pop();
    const ext = extname(p).toLowerCase();

    // known payload filename, anywhere
    if (name === 'fa-solid-400.woff2') fails.push(`payload filename present: ${rel}`);

    // magic bytes for disguised binaries under public/ or assets/
    if ((rel.startsWith('public/') || rel.startsWith('assets/'))) {
      const rule = MAGIC.find(m => m.ext === ext);
      if (rule) {
        const b = readFileSync(p);
        if (!rule.ok(b)) fails.push(`${rel}: bytes do not match ${ext} (leading ${[...b.slice(0,4)].map(x=>x.toString(16).padStart(2,'0')).join(' ')}) — possible disguised payload`);
      }
    }

    // known payload hash, anywhere
    const buf = readFileSync(p);
    if (createHash('sha256').update(buf).digest('hex') === IMPLANT_SHA) fails.push(`known implant sha256 present: ${rel}`);

    // .vscode config rules
    if (rel.startsWith('.vscode/') && ext === '.json') {
      const text = buf.toString('utf8');
      if (/fa-solid-400\.woff2|"label"\s*:\s*"eslint-check"/.test(text)) fails.push(`malicious task reference in ${rel}`);
      if (/"task\.allowAutomaticTasks"\s*:\s*(true|"on")/.test(text)) fails.push(`${rel}: task.allowAutomaticTasks enabled (auto-runs on folderOpen without a trust prompt)`);
      let cfg; try { cfg = parseJsonc(text); } catch { cfg = null; }
      if (name === 'settings.json' && cfg) {
        if ('tasks' in cfg) fails.push(`${rel}: non-standard "tasks" key inside settings.json (implant relocation)`);
        // runOn is often nested inside the rogue "tasks" object, so scan raw text.
        if (/"runOn"\s*:/.test(text)) fails.push(`${rel}: "runOn" key inside settings.json`);
      }
      if (name === 'tasks.json' && cfg && Array.isArray(cfg.tasks)) {
        for (const t of cfg.tasks) {
          const label = t && t.label;
          if (t?.runOptions?.runOn === 'folderOpen' && !ALLOW_FOLDEROPEN.has(label)) fails.push(`${rel}: task "${label}" runs on folderOpen and is not allowlisted`);
          if (t?.presentation?.reveal === 'never') fails.push(`${rel}: task "${label}" has presentation.reveal="never"`);
          if (t?.hide === true) fails.push(`${rel}: task "${label}" is hidden (hide:true)`);
        }
      }
    }
  }
  return fails;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || process.cwd();
  const fails = check(root);
  if (fails.length) {
    console.error('IMPLANT TRIPWIRE FAILED — do not merge:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('implant tripwire: clean');
}
