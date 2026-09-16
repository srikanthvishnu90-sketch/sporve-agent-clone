import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync as readFileSyncFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drift, migrationFunctions } from './check-migration-drift.mjs';

test('a live function with no migration is MISSING; an allowed one is listed with its reason; unapplied is informational', () => {
  const migrated = new Set(['ops_alerts', 'approve_obligation_and_queue']);
  const live = [{ name: 'ops_alerts', args: '' }, { name: 'ghost_fn', args: 'uuid' }, { name: 'legacy_fn', args: '' }];
  const d = drift(live, migrated, { legacy_fn: 'known debt' });
  assert.deepEqual(d.missing, ['ghost_fn']);
  assert.deepEqual(d.allowed, ['legacy_fn']);
  assert.deepEqual(d.unapplied, ['approve_obligation_and_queue']);
});

test('migration parsing finds create function in every spelling and ignores comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  writeFileSync(join(dir, '0001_a.sql'), 'CREATE OR REPLACE FUNCTION public.alpha(uuid) returns void language sql as $$ select 1 $$;\n-- create function public.commented() \ncreate function "beta"() returns void language sql as $$ select 1 $$;');
  const names = migrationFunctions(pathToFileURL(dir + '/'));
  assert.ok(names.has('alpha') && names.has('beta'));
  assert.ok(!names.has('commented'));
});

test('the repo allow-list is small and every entry carries a reason', () => {
  const allow = JSON.parse(readFileSyncFs(new URL('./migration-drift-allow.json', import.meta.url), 'utf8'));
  const entries = Object.entries(allow).filter(([k]) => k !== '_');
  assert.ok(entries.length <= 5, `${entries.length} allowed drift entries — snapshot or drop them`);
  for (const [k, v] of entries) assert.ok(typeof v === 'string' && v.length > 20, `${k} needs a reason`);
});
