// tests/e2e/oauth-popup.spec.mjs — regression: the OAuth consent popup must
// open SYNCHRONOUSLY inside the click gesture. PR #81 made popup-blocked and
// 401 failures loud, but it still called window.open() after the async
// OAuth-start API resolved — so the browser could silently eat the consent
// window for lack of a user gesture. src/mod-oauth.js opens a blank popup
// first and navigates it once the server mints the URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function loadModule() {
  /* The module is browser code: the sandbox must provide the timer globals
     it now relies on (request timeout + popup-navigate verification). */
  const sandbox = { window: { location: { href: 'https://sporv.ai/' } }, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/mod-oauth.js'), sandbox, { filename: 'mod-oauth.js' });
  assert.ok(sandbox.window.SporvOAuth, 'module exposes window.SporvOAuth');
  return { SporvOAuth: sandbox.window.SporvOAuth, sandbox };
}

function fakeWin() {
  return { href: null, closed: 0, close() { this.closed++; } };
}
function depsFor(win, request) {
  const calls = [];
  return {
    calls,
    deps: {
      open: () => { calls.push('open'); return win; },
      navigate: (w, u) => { calls.push('navigate'); w.href = u; },
      close: (w) => { calls.push('close'); w.close(); },
      request: () => { calls.push('request'); return request; },
    },
  };
}

test('window.open runs synchronously in the click, before the async OAuth-start resolves', async () => {
  const { SporvOAuth } = loadModule();
  const win = fakeWin();
  let resolveRequest;
  const gate = new Promise((res) => { resolveRequest = res; });
  const { calls, deps } = depsFor(win, gate);
  const p = SporvOAuth.startPopup(deps);
  // The crux: synchronously after startPopup returns — no await, no resolved
  // promise — open() must already have run. The old code opened inside .then,
  // so calls would have been ['request'] here.
  assert.deepEqual(calls, ['open', 'request'],
    'window.open must run before the OAuth-start promise resolves');
  resolveRequest({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' });
  const res = await p;
  assert.equal(res.ok, true);
  assert.deepEqual(calls, ['open', 'request', 'navigate']);
  assert.equal(win.href, 'https://accounts.google.com/o/oauth2/auth?x=1');
  assert.equal(win.closed, 0, 'popup stays open on success');
});

test('blocked popup: no OAuth-start request is issued, reason is blocked', async () => {
  const { SporvOAuth } = loadModule();
  const { calls, deps } = depsFor(null, Promise.resolve({ url: 'https://x' }));
  const res = await SporvOAuth.startPopup(deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'blocked');
  assert.deepEqual(calls, ['open'], 'must not waste an OAuth-start call when blocked');
  const msg = SporvOAuth.errorMessage(res.reason);
  assert.match(msg, /blocked/i, 'blocked failure is visible');
  assert.match(msg, /popup/i, 'message names the popup blocker as the cause');
});

test('401 from OAuth-start: popup closed, reason expired, session message visible', async () => {
  const { SporvOAuth } = loadModule();
  const win = fakeWin();
  const err = new Error('unauthorized'); err.status = 401;
  const { calls, deps } = depsFor(win, Promise.reject(err));
  const res = await SporvOAuth.startPopup(deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'expired');
  assert.deepEqual(calls, ['open', 'request', 'close'], 'blank popup is closed on failure');
  assert.equal(win.closed, 1);
  const msg = SporvOAuth.errorMessage(res.reason);
  assert.match(msg, /sign-in expired/i, 'expired-session failure is visible');
  assert.match(msg, /sign back in/i, 'message tells the user what to do');
});

test('non-401 failure: popup closed, reason error', async () => {
  const { SporvOAuth } = loadModule();
  const win = fakeWin();
  const err = new Error('boom'); err.status = 500;
  const { deps } = depsFor(win, Promise.reject(err));
  const res = await SporvOAuth.startPopup(deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'error');
  assert.equal(win.closed, 1, 'blank popup is closed on failure');
});

test('missing consent URL: popup closed, reason no-url', async () => {
  const { SporvOAuth } = loadModule();
  const win = fakeWin();
  const { deps } = depsFor(win, Promise.resolve({}));
  const res = await SporvOAuth.startPopup(deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-url');
  assert.equal(win.closed, 1, 'blank popup is closed when the server gives no URL');
});

test('host handler uses the synchronous popup path, not open-after-resolve', () => {
  const host = read('src/sporve-web.host.html');
  assert.ok(host.includes('window.SporvOAuth.startPopup'),
    'data-cxconnect handler routes through SporvOAuth.startPopup');
  assert.ok(!host.includes('window.open(r.url'),
    'the old open-after-resolve pattern must not come back');
  assert.ok(host.includes('window.open("","_blank","noopener")'),
    'the blank popup opens synchronously inside the click');
});

test('hung OAuth-start request: popup closes after the timeout with a timeout message', async () => {
  const { SporvOAuth } = loadModule();
  const win = fakeWin();
  const never = new Promise(() => {});
  const { calls, deps } = depsFor(win, never);
  const res = await SporvOAuth.startPopup(deps, { timeoutMs: 30 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'error');
  assert.match(res.err.message, /timed out/i, 'the user gets a timeout message, not silence');
  assert.equal(win.closed, 1, 'the stranded blank popup is closed');
  assert.deepEqual(calls, ['open', 'request', 'close']);
});

test('popup that never navigates: same-tab fallback instead of a permanent blank tab', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  /* Simulates the observed iOS failure: window.open returns a tab, the
     OAuth-start call succeeds, but the tab never leaves about:blank. */
  const win = { closed: 0, close() { this.closed++; }, location: { href: 'about:blank' } };
  const calls = [];
  const deps = {
    open: () => { calls.push('open'); return win; },
    navigate: () => { calls.push('navigate'); /* silently fails: location stays about:blank */ },
    close: (w) => { calls.push('close'); w.close(); },
    request: () => Promise.resolve({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' }),
  };
  const res = await SporvOAuth.startPopup(deps, { verifyMs: 10 });
  assert.equal(res.ok, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(win.closed, 1, 'the dead blank popup is closed');
  assert.equal(sandbox.window.location.href, 'https://accounts.google.com/o/oauth2/auth?x=1',
    'the current tab navigates to the consent URL instead');
});

test('popup that navigates normally: no same-tab fallback', async () => {
  const { SporvOAuth, sandbox } = loadModule();
  /* navigate() points the popup at the consent page; reading a cross-origin
     location throws, which the module treats as the success signal. */
  const win = { closed: 0, close() { this.closed++; }, location: { href: 'about:blank' } };
  const deps = {
    open: () => win,
    navigate: (w, u) => {
      w.location = { get href() { throw new Error('cross-origin'); } };
    },
    close: (w) => { w.close(); },
    request: () => Promise.resolve({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' }),
  };
  const before = sandbox.window.location.href;
  const res = await SporvOAuth.startPopup(deps, { verifyMs: 10 });
  assert.equal(res.ok, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(win.closed, 0, 'a working popup is left alone');
  assert.equal(sandbox.window.location.href, before, 'the current tab does not navigate');
});
