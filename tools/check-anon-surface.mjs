#!/usr/bin/env node
// check-anon-surface.mjs — no route returns org, money or athlete data
// without a session (owner rule 2, 2026-09-16). Probes every data table with
// the PUBLISHABLE key and no bearer: a 200/206 with rows is an anonymous read
// path. Read-only. A table may be listed in tools/anon-surface-pending.json
// only with the migration file that closes it, and only while that file is
// unapplied; the entry is deleted the day the migration is applied.
//
//   node tools/check-anon-surface.mjs            # exit 1 on any unexplained anon read
import { readFileSync, existsSync } from 'node:fs';

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tseszaprvtvqrkfpditu.supabase.co';
export const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_CLawpS61QZDONSyy8ZdhTQ_rjCBLYBW';
export const TABLES = ['providers', 'programs', 'sessions', 'teams', 'team_athletes', 'guardians', 'guardian_links', 'obligations', 'installments',
  'fee_schedules', 'outbound_messages', 'organization_members', 'coach_invites', 'import_batches', 'import_row', 'waiver_documents', 'waiver_signatures',
  'staff_certifications', 'bookings', 'profiles', 'agent_findings', 'agent_proposals', 'provider_settings', 'org_connectors', 'payment_event_ledger',
  'background_check', 'event', 'event_response', 'guardian_access_token', 'billing_subscriptions'];

export async function probe(table) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: ANON_KEY }, signal: AbortSignal.timeout(15000) });
  const text = await r.text(); let rows = [];
  try { rows = JSON.parse(text); } catch { rows = []; }
  let code = null; try { code = JSON.parse(text).code || null; } catch { /* not an error body */ }
  return { table, status: r.status, rows: Array.isArray(rows) ? rows.length : 0, code, columns: Array.isArray(rows) && rows[0] ? Object.keys(rows[0]) : [] };
}

export function pendingOk(pending, migDirUrl) {
  const bad = [];
  for (const [table, file] of Object.entries(pending)) {
    if (table === '_') continue;
    const url = new URL(file, migDirUrl);
    if (!existsSync(url)) { bad.push(`${table}: ${file} does not exist`); continue; }
    const src = readFileSync(url, 'utf8').toLowerCase();
    if (!src.includes(`from anon`) || !src.includes(table)) bad.push(`${table}: ${file} does not revoke anon on it`);
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pendingUrl = new URL('./anon-surface-pending.json', import.meta.url);
  const pending = existsSync(pendingUrl) ? JSON.parse(readFileSync(pendingUrl, 'utf8')) : {};
  const bad = pendingOk(pending, new URL('../supabase/migrations/', import.meta.url));
  if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
  let fail = 0;
  for (const t of TABLES) {
    const p = await probe(t);
    const state = p.status === 404 || p.code === 'PGRST205' ? 'absent' : p.rows > 0 ? 'ANON READ' : p.status === 401 || p.code === '42501' ? 'denied' : `empty (${p.status})`;
    const excused = p.rows > 0 && pending[t] ? ` — pending ${pending[t]}` : '';
    if (p.rows > 0 && !pending[t]) fail++;
    console.log(`${t.padEnd(24)} ${state}${excused}${p.columns.length ? '  cols: ' + p.columns.slice(0, 8).join(',') : ''}`);
  }
  console.log(`\n${fail ? `${fail} table(s) readable without a session` : 'no anonymous read path'}`);
  process.exit(fail ? 1 : 0);
}
