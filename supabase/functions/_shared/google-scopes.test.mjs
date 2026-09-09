import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORBIDDEN_SCOPES, GOOGLE_SCOPES, assertNoSendScope, authorizeUrl,
  grantedScopes, hasRequiredRead, isGoogleKind, writeModeFor,
} from './google-scopes.mjs';

const cfg = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x.example/cb' };

test('Sporv never asks Google for a scope that can send mail', () => {
  const asked = [...GOOGLE_SCOPES.gmail, ...GOOGLE_SCOPES.google_calendar];
  for (const forbidden of FORBIDDEN_SCOPES) {
    assert.ok(!asked.includes(forbidden), `${forbidden} must never be requested`);
  }
  // gmail.compose creates drafts and carries no send capability. This is
  // invariant I1 enforced by Google rather than only by us, so the exact
  // scope string matters.
  assert.ok(GOOGLE_SCOPES.gmail.includes('https://www.googleapis.com/auth/gmail.compose'));
  assert.ok(!GOOGLE_SCOPES.gmail.some(s => s.endsWith('gmail.send')));
});

test('asking for a send scope is a runtime failure, not a review miss', () => {
  assert.throws(
    () => assertNoSendScope(['https://www.googleapis.com/auth/gmail.send']),
    /send-capable scope/,
  );
  assert.throws(() => assertNoSendScope(['https://mail.google.com/']), /send-capable scope/);
  assert.doesNotThrow(() => assertNoSendScope(GOOGLE_SCOPES.gmail));
});

test('the consent URL cannot be built with a send scope', () => {
  assert.throws(
    () => authorizeUrl(cfg, [...GOOGLE_SCOPES.gmail, 'https://www.googleapis.com/auth/gmail.send'], 'st'),
    /send-capable scope/,
  );
});

test('the consent URL asks for offline access, or no refresh token comes back', () => {
  const u = new URL(authorizeUrl(cfg, GOOGLE_SCOPES.gmail, 'state-123', 'a@b.com'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  // Without prompt=consent Google omits the refresh token on a repeat
  // authorisation and the connection dies when the access token expires.
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('state'), 'state-123');
  assert.equal(u.searchParams.get('redirect_uri'), cfg.redirectUri);
  assert.equal(u.searchParams.get('login_hint'), 'a@b.com');
});

test('only the two Google kinds are accepted', () => {
  assert.ok(isGoogleKind('gmail'));
  assert.ok(isGoogleKind('google_calendar'));
  for (const bad of ['stripe', 'quickbooks', '', null, undefined, 'GMAIL', { kind: 'gmail' }]) {
    assert.ok(!isGoogleKind(bad), `${String(bad)} must not be treated as a Google connector`);
  }
});

test('we store the scopes Google granted, not the ones we asked for', () => {
  const granted = grantedScopes(
    { scope: 'https://www.googleapis.com/auth/gmail.readonly' }, GOOGLE_SCOPES.gmail);
  assert.deepEqual(granted, ['https://www.googleapis.com/auth/gmail.readonly']);
  // An empty scope field means Google told us nothing; fall back to what was
  // asked rather than recording a connector with no capabilities at all.
  assert.deepEqual(grantedScopes({}, GOOGLE_SCOPES.gmail), GOOGLE_SCOPES.gmail);
});

test('a connector without its read scope is not usable', () => {
  assert.ok(hasRequiredRead('gmail', GOOGLE_SCOPES.gmail));
  // The customer unticked read on the consent screen: compose alone is useless.
  assert.ok(!hasRequiredRead('gmail', ['https://www.googleapis.com/auth/gmail.compose']));
  assert.ok(!hasRequiredRead('google_calendar', []));
});

test('gmail can never hold a write mode above draft', () => {
  assert.equal(writeModeFor('gmail'), 'draft');
  assert.equal(writeModeFor('google_calendar'), 'apply');
});

test('no edge function smuggles a send scope past the shared list', () => {
  // A tripwire, not a style check: the rule is worthless if one function
  // hardcodes its own scope string instead of importing GOOGLE_SCOPES.
  for (const f of [
    'supabase/functions/google-oauth-start/index.ts',
    'supabase/functions/google-oauth-callback/index.ts',
    'supabase/functions/_shared/google-oauth.ts',
  ]) {
    const src = readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
    for (const forbidden of FORBIDDEN_SCOPES) {
      assert.ok(!src.includes(forbidden), `${f} references ${forbidden}`);
    }
  }
});
