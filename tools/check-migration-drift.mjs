#!/usr/bin/env node
// check-migration-drift.mjs — every function in production must exist in a
// migration. Second occurrence of this drift class (after #414): on
// 2026-09-15 three public functions were live and in no file. A guard, not
// another fix.
//
//   node tools/check-migration-drift.mjs --inventory live.json     # from ops-health?view=functions
//   OPS_HEALTH_URL=… OPS_HEALTH_TOKEN=… node tools/check-migration-drift.mjs
//
// Exit 1 when a live function has no `create function public.<name>(` in
// supabase/migrations (names only — argument lists drift legitimately).
// Functions that exist in migrations but not live are reported, not failed:
// D5 says migrations are files until applied. tools/migration-drift-allow.json
// lists names accepted with a reason (each entry is a debt, not a pass).
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };
const migDir = new URL(arg('migrations') ? arg('migrations').replace(/\/?$/, '/') : '../supabase/migrations/', import.meta.url);
const allowPath = arg('allow') || new URL('./migration-drift-allow.json', import.meta.url);

export function migrationFunctions(dir = migDir) {
  const names = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '');
    for (const m of src.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) names.add(m[1].toLowerCase());
  }
  return names;
}

export function drift(live, migrated, allow = {}) {
  const liveNames = [...new Set(live.map((f) => String(f.name).toLowerCase()))].sort();
  const missing = liveNames.filter((n) => !migrated.has(n) && !(n in allow));
  const allowed = liveNames.filter((n) => !migrated.has(n) && n in allow);
  const unapplied = [...migrated].filter((n) => !liveNames.includes(n)).sort();
  return { missing, allowed, unapplied };
}

async function inventory() {
  const file = arg('inventory');
  if (file) return JSON.parse(readFileSync(file, 'utf8')).functions;
  const url = process.env.OPS_HEALTH_URL, token = process.env.OPS_HEALTH_TOKEN;
  if (!url || !token) throw new Error('pass --inventory <json> or set OPS_HEALTH_URL and OPS_HEALTH_TOKEN');
  const r = await fetch(`${url}?view=functions`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`ops-health ${r.status}`);
  return (await r.json()).functions;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
  const live = await inventory();
  const d = drift(live, migrationFunctions(), allow);
  for (const n of d.missing) console.log(`MISSING  ${n}  — live in production, defined in no migration`);
  for (const n of d.allowed) console.log(`allowed  ${n}  — ${allow[n]}`);
  console.log(`\n${d.missing.length} undeclared · ${d.allowed.length} allowed with reason · ${d.unapplied.length} in migrations not yet applied (D5)`);
  process.exit(d.missing.length ? 1 : 0);
}
