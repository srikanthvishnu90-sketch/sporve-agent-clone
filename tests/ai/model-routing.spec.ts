// tests/ai/model-routing.spec.ts — owner ruling 2026-09-18: the dock is pinned
// to Haiku. The audit measured 13.8s cold because the coach turn asked the
// gateway for task "reason", which routes to Sonnet, while the client sent a
// model id that was not a model id at all. Both halves are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const gw = read('supabase/functions/ai-gateway/index.ts');
const cmd = read('supabase/functions/coach-command/index.ts');
const host = read('src/sporve-web.host.html');

test('the gateway routes a structured agentic turn to Haiku, and still never lets a client pick', () => {
  assert.match(gw, /const HAIKU_TASKS = new Set\(\["parse", "classify", "extract", "agent_turn"\]\);/);
  assert.ok(!/SONNET_TASKS = new Set\(\[[^\]]*agent_turn/.test(gw), 'agent_turn is not also a sonnet task');
  // the security property the ruling must not break: only a service caller may force a model
  assert.match(gw, /if \(modelOverride && isService && ALLOWED_MODELS\.has\(modelOverride\)\) return modelOverride;/);
  assert.match(gw, /return MODELS\.sonnet; \/\/ safe default for unknown tasks \(never Opus implicitly\)/);
});
test('the coach turn asks for that task', () => {
  assert.match(cmd, /task: "agent_turn",\s*\n\s*feature: "coach_command",/);
  assert.ok(!/task: "reason"/.test(cmd), 'no reason task left in coach-command');
});
test('the client sends no model at all: the picker and the label-shaped default are gone', () => {
  assert.ok(!/aiModel:"Sporv AI"/.test(host), 'the label-as-model-id default is gone');
  assert.ok(!/S\.aiModel\|\|/.test(host), 'nothing falls back through S.aiModel any more');
  assert.ok(!/data-aimodel/.test(host), 'the picker that could not work is gone');
  assert.match(host, /API\.fn\("coach-command",\{text,history\}\)/);
  assert.match(host, /API\.fn\("ai-chat",\{messages:history\}\)/);
});
