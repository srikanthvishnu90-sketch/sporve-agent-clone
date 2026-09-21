// tests/e2e/oauth-redirect.spec.mjs — regression: the OAuth connect flow must
// not strand the user on a blank popup. The popup-first pattern was removed
// 2026-09-21 after six consecutive production failures: once the popup takes
// focus, some browsers suspend the opener tab's JavaScript, so the blank
// popup was never navigated, never closed, and no error ever surfaced.
// src/mod-oauth.js now fetches the consent URL (bounded by a timeout) and
// navigates the CURRENT tab to it; the OAuth callback returns to the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function loadModule() {
  /* The module is browser code: the sandbox must provide the timer globals
     it relies on (request timeout) and window.location for the redirect. */
  const sandbox = { window: { location: { href: 'https://sporv.ai/' } }, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/mod-oauth.js'), sandbox, { filename: 'mod-oauth.js' });
  assert.ok(sandbox.window.SporvOAuth, 'module exposes window.SporvOAuth');
  return { SporvOAuth: sandbox.window.SporvOAuth, sandbox };
}

test('success: the current tab navigates to the consent URL, no popup involved', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  const res = await SporvOAuth.startRedirect({
    request: () => Promise.resolve({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' }),
  });
  assert.equal(res.ok, true);
  assert.equal(sandbox.window.location.href, 'https://accounts.google.com/o/oauth2/auth?x=1');
});

test('401 from OAuth-start: reason expired, session message visible, no navigation', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  const err = new Error('unauthorized'); err.status = 401;
  const res = await SporvOAuth.startRedirect({ request: () => Promise.reject(err) });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'expired');
  assert.equal(sandbox.window.location.href, 'https://sporv.ai/', 'must not navigate on failure');
  const msg = SporvOAuth.errorMessage(res.reason);
  assert.match(msg, /sign-in expired/i, 'expired-session failure is visible');
  assert.match(msg, /sign back in/i, 'message tells the user what to do');
});

test('non-401 failure: reason error, no navigation', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  const err = new Error('boom'); err.status = 500;
  const res = await SporvOAuth.startRedirect({ request: () => Promise.reject(err) });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'error');
  assert.equal(sandbox.window.location.href, 'https://sporv.ai/');
});

test('missing consent URL: reason no-url, no navigation', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  const res = await SporvOAuth.startRedirect({ request: () => Promise.resolve({}) });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-url');
  assert.equal(sandbox.window.location.href, 'https://sporv.ai/');
});

test('hung OAuth-start request: settles after the timeout with a timeout message', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  const never = new Promise(() => {});
  const res = await SporvOAuth.startRedirect({ request: () => never }, { timeoutMs: 30 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'error');
  assert.match(res.err.message, /timed out/i, 'the user gets a timeout message, not silence');
  assert.equal(sandbox.window.location.href, 'https://sporv.ai/');
});

test('synchronously-throwing request: still settles with reason error, never hangs', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  const res = await SporvOAuth.startRedirect({
    request: () => { throw new Error('sync boom'); },
  }, { timeoutMs: 30 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'error');
  assert.equal(sandbox.window.location.href, 'https://sporv.ai/');
});

test('host handler uses the redirect path, not the popup path', () => {
  const host = read('src/sporve-web.host.html');
  assert.ok(host.includes('window.SporvOAuth.startRedirect'),
    'data-cxconnect handler routes through SporvOAuth.startRedirect');
  assert.ok(!host.includes('window.SporvOAuth.startPopup'),
    'the popup-first pattern must not come back');
  assert.ok(!host.includes('window.open("","_blank","noopener")'),
    'no blank popup is opened for the OAuth flow');
});

test('no popup API remains on the module', () => {
  const { SporvOAuth } = loadModule();
  assert.equal(typeof SporvOAuth.startRedirect, 'function');
  assert.equal(SporvOAuth.startPopup, undefined, 'startPopup was removed with the popup flow');
});
