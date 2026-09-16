// Spec 16.1 DoD — tests/trust/badge-provenance.spec.ts (the path the spec names).
// Runs under `node --test` (Node ≥ 23 strips types natively). The badge the SPA renders reads the
// server-derived mirror and never a literal. The mirror itself has exactly
// one writer (migration 001064 — asserted by the SQL fixture); this keeps the
// client side honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const host: string = readFileSync(new URL('../../src/sporve-web.host.html', import.meta.url), 'utf8');

test('the live badge is derived from background_check_status AND a completion date, never from status alone', () => {
  assert.match(host, /verified:\s*pv\.background_check_status==="verified"&&!!pv\.background_check_completed_at/);
});
test('no code path fabricates verified:true on a live record', () => {
  const live = host.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/verified\s*:\s*true\b/.test(live), 'a literal verified:true survives outside comments');
});
test('the SPA never writes background_check_status or background_check_completed_at', () => {
  assert.ok(!/body:\s*\{[^}]*background_check_(status|completed_at)/.test(host), 'a client PATCH/POST carries a background-check column');
});
