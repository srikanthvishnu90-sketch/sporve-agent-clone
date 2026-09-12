import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { check } from './no-implant-check.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'implant-test-'));
  for (const [p, content] of Object.entries(files)) {
    const full = join(root, p);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
const clean = () => ({
  '.vscode/tasks.json': JSON.stringify({ tasks: [{ label: 'Serve (http://127.0.0.1:8421)', runOptions: { runOn: 'folderOpen' } }] }),
  '.vscode/settings.json': JSON.stringify({ 'task.allowAutomaticTasks': 'off' }),
  'public/fonts/real.woff2': 'wOF2' + '\0'.repeat(20),
});

test('a clean tree passes', () => {
  const r = tree(clean()); try { assert.equal(check(r).length, 0); } finally { rmSync(r, { recursive: true, force: true }); }
});
test('the disguised payload filename goes red', () => {
  const f = clean(); f['public/fonts/fa-solid-400.woff2'] = '        var x=1;';
  const r = tree(f); try { assert.ok(check(r).some(x => /payload filename/.test(x))); } finally { rmSync(r, { recursive: true, force: true }); }
});
test('a .woff2 that is not wOF2 goes red', () => {
  const f = clean(); f['public/fonts/evil.woff2'] = '        alert(1)';
  const r = tree(f); try { assert.ok(check(r).some(x => /do not match .woff2/.test(x))); } finally { rmSync(r, { recursive: true, force: true }); }
});
test('a "tasks" key inside settings.json goes red', () => {
  const f = clean(); f['.vscode/settings.json'] = JSON.stringify({ tasks: { command: 'npm run lint', runOn: 'folderOpen' } });
  const r = tree(f); try {
    const fails = check(r);
    assert.ok(fails.some(x => /non-standard "tasks" key/.test(x)));
    assert.ok(fails.some(x => /"runOn" key inside settings.json/.test(x)));
  } finally { rmSync(r, { recursive: true, force: true }); }
});
test('a non-allowlisted folderOpen task goes red', () => {
  const f = clean(); f['.vscode/tasks.json'] = JSON.stringify({ tasks: [{ label: 'eslint-check', hide: true, presentation: { reveal: 'never' }, runOptions: { runOn: 'folderOpen' } }] });
  const r = tree(f); try {
    const fails = check(r);
    assert.ok(fails.some(x => /runs on folderOpen and is not allowlisted/.test(x)));
    assert.ok(fails.some(x => /reveal="never"/.test(x)));
    assert.ok(fails.some(x => /hide:true/.test(x)));
  } finally { rmSync(r, { recursive: true, force: true }); }
});
test('allowAutomaticTasks true goes red', () => {
  const f = clean(); f['.vscode/settings.json'] = JSON.stringify({ 'task.allowAutomaticTasks': true });
  const r = tree(f); try { assert.ok(check(r).some(x => /allowAutomaticTasks enabled/.test(x))); } finally { rmSync(r, { recursive: true, force: true }); }
});
