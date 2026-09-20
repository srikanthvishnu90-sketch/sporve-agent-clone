// OAuth connector guard tests (node).
//
// The single most important rule in the connector path — Sporv never requests
// a scope that can send mail — lives in each function's inlined copy of
// assertNoSendScope + the registry scope tables. These tests hold every
// function to it without a Deno runtime.
//
// Run: node --experimental-strip-types --test supabase/functions/tests/oauth-connector-guards.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as googleStart from '../google-oauth-start/index.ts';
import * as googleCb from '../google-oauth-callback/index.ts';
import * as msStart from '../microsoft-oauth-start/index.ts';
import * as msCb from '../microsoft-oauth-callback/index.ts';
import * as qbStart from '../intuit-oauth-start/index.ts';
import * as qbCb from '../intuit-oauth-callback/index.ts';

const allModules = [googleStart, googleCb, msStart, msCb, qbStart, qbCb] as const;

test('every forbidden scope is refused by every function copy of assertNoSendScope', () => {
  for (const m of allModules) {
    for (const scope of m.FORBIDDEN_SCOPES) {
      assert.throws(() => m.assertNoSendScope([scope]), /send-capable scope/, `module accepted ${scope}`);
    }
    assert.doesNotThrow(() => m.assertNoSendScope([]));
    assert.doesNotThrow(() => m.assertNoSendScope(undefined));
  }
});

test('no requested scope list anywhere contains a forbidden scope', () => {
  for (const m of allModules) {
    const forbidden = new Set(m.FORBIDDEN_SCOPES);
    for (const [kind, scopes] of Object.entries(m.SCOPES_BY_KIND)) {
      assert.doesNotThrow(() => m.assertNoSendScope(scopes), `${kind} scopes must pass the guard`);
      for (const s of scopes) assert.ok(!forbidden.has(s), `${kind} requests forbidden scope ${s}`);
    }
  }
});

test('gmail is read-only: exactly gmail.readonly, write mode none', () => {
  assert.deepEqual(googleStart.SCOPES_BY_KIND.gmail, ['https://www.googleapis.com/auth/gmail.readonly']);
  assert.equal(googleStart.writeModeFor('gmail'), 'none');
  assert.equal(googleCb.writeModeFor('gmail'), 'none');
});

test('google calendar holds a write scope (apply) but nothing send-capable', () => {
  const scopes = googleStart.SCOPES_BY_KIND.google_calendar;
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.ok(!scopes.some((s) => /send|compose|modify/i.test(s)));
  assert.equal(googleStart.writeModeFor('google_calendar'), 'apply');
});

test('microsoft365 holds Mail.Read only — never Mail.Send or Mail.ReadWrite', () => {
  const scopes = msStart.SCOPES_BY_KIND.microsoft365;
  assert.ok(scopes.includes('Mail.Read'));
  assert.ok(scopes.includes('offline_access'));
  assert.ok(scopes.includes('Calendars.ReadWrite'));
  assert.ok(!scopes.includes('Mail.Send'));
  assert.ok(!scopes.includes('Mail.ReadWrite'));
  assert.equal(msCb.requiredReadScope('microsoft365'), 'Mail.Read');
  assert.ok(msCb.hasRequiredRead('microsoft365', ['offline_access', 'Mail.Read', 'User.Read']));
  assert.ok(!msCb.hasRequiredRead('microsoft365', ['offline_access', 'User.Read']));
});

test('quickbooks is read-only accounting scope, write mode none', () => {
  assert.deepEqual(qbStart.SCOPES_BY_KIND.quickbooks, ['com.intuit.quickbooks.accounting']);
  assert.equal(qbStart.writeModeFor('quickbooks'), 'none');
  assert.equal(qbCb.writeModeFor('quickbooks'), 'none');
});

test('write modes match the registry: none tops read-only, draft tops family-facing writes', () => {
  const expected: Record<string, string> = {
    gmail: 'none',
    google_calendar: 'apply',
    google_sheets: 'none',
    google_drive: 'none',
    google_business_profile: 'draft',
  };
  for (const [kind, mode] of Object.entries(expected)) {
    assert.equal(googleStart.writeModeFor(kind), mode, `start ${kind}`);
    assert.equal(googleCb.writeModeFor(kind), mode, `callback ${kind}`);
  }
  assert.equal(msStart.writeModeFor('microsoft365'), 'apply');
  assert.ok(!Object.values(expected).concat(['apply']).includes('send'), 'no send write mode exists');
});

test('kind validators admit only their own provider kinds', () => {
  const googleKinds = ['gmail', 'google_calendar', 'google_sheets', 'google_drive', 'google_business_profile'];
  for (const k of googleKinds) {
    assert.ok(googleStart.isConnectorKind(k), `google start rejects ${k}`);
    assert.ok(googleCb.isConnectorKind(k), `google callback rejects ${k}`);
  }
  assert.ok(!googleStart.isConnectorKind('microsoft365'));
  assert.ok(!googleStart.isConnectorKind('quickbooks'));
  assert.ok(!googleStart.isConnectorKind('gmail '));
  assert.ok(!googleStart.isConnectorKind(undefined));

  assert.ok(msStart.isConnectorKind('microsoft365'));
  assert.ok(msCb.isConnectorKind('microsoft365'));
  assert.ok(!msStart.isConnectorKind('gmail'));

  assert.ok(qbStart.isConnectorKind('quickbooks'));
  assert.ok(qbCb.isConnectorKind('quickbooks'));
  assert.ok(!qbStart.isConnectorKind('gmail'));
});

test('grantedScopes parses the provider response and falls back to requested', () => {
  const requested = ['a', 'b'];
  assert.deepEqual(googleCb.grantedScopes({ scope: 'a b c' }, requested), ['a', 'b', 'c']);
  assert.deepEqual(googleCb.grantedScopes({ scope: '' }, requested), requested);
  assert.deepEqual(googleCb.grantedScopes(null, requested), requested);
  assert.deepEqual(msCb.grantedScopes({ scope: 'offline_access Mail.Read' }, requested),
    ['offline_access', 'Mail.Read']);
});

test('hasRequiredRead needs the kind read scope for google kinds', () => {
  for (const [kind, scopes] of Object.entries(googleCb.SCOPES_BY_KIND)) {
    assert.ok(googleCb.hasRequiredRead(kind, scopes), `${kind} should pass with its own scopes`);
    assert.ok(!googleCb.hasRequiredRead(kind, ['something.else']), `${kind} should fail without read scope`);
  }
  assert.ok(!googleCb.hasRequiredRead('nope', ['x']));
});

test('google authorize URL forces offline consent and carries no send scope', () => {
  const cfg = { clientId: 'id', clientSecret: 's', redirectUri: 'https://x/cb' };
  const url = new URL(googleStart.buildAuthorizeUrl(cfg, googleStart.SCOPES_BY_KIND.gmail, 'st', 'u@x.com'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('login_hint'), 'u@x.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://x/cb');
  const scopeParam = url.searchParams.get('scope') ?? '';
  assert.ok(!googleStart.FORBIDDEN_SCOPES.some((f) => scopeParam.split(' ').includes(f)));
  assert.throws(() => googleStart.buildAuthorizeUrl(cfg, ['Mail.Send'], 'st'));
});

test('microsoft authorize URL templates the tenant', () => {
  const cfg = { clientId: 'id', clientSecret: 's', redirectUri: 'https://x/cb', tenant: 'common' };
  const url = new URL(msStart.buildAuthorizeUrl(cfg, msStart.SCOPES_BY_KIND.microsoft365, 'st'));
  assert.equal(url.origin + url.pathname,
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('response_mode'), 'query');
  assert.equal(msStart.tokenEndpoint('my-tenant'),
    'https://login.microsoftonline.com/my-tenant/oauth2/v2.0/token');
  assert.throws(() => msStart.buildAuthorizeUrl(cfg, ['Mail.ReadWrite'], 'st'));
});

test('intuit authorize URL targets appcenter and refuses send scopes', () => {
  const cfg = { clientId: 'id', clientSecret: 's', redirectUri: 'https://x/cb' };
  const url = new URL(qbStart.buildAuthorizeUrl(cfg, qbStart.SCOPES_BY_KIND.quickbooks, 'st'));
  assert.equal(url.origin + url.pathname, 'https://appcenter.intuit.com/connect/oauth2');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  assert.throws(() => qbStart.buildAuthorizeUrl(cfg, ['Mail.Send'], 'st'));
});

test('callback redirect lands back in the product with the settings anchor', () => {
  const url = new URL(googleCb.connectorRedirectUrl('gmail', 'connected'));
  assert.equal(url.origin, 'https://sporv.ai');
  assert.equal(url.searchParams.get('connector'), 'gmail');
  assert.equal(url.searchParams.get('status'), 'connected');
  assert.equal(url.hash, '#settings-connectors');

  const failed = new URL(msCb.connectorRedirectUrl('microsoft365', 'failed', 'no_refresh_token'));
  assert.equal(failed.searchParams.get('connector'), 'microsoft365');
  assert.equal(failed.searchParams.get('status'), 'failed');
  assert.equal(failed.searchParams.get('reason'), 'no_refresh_token');
  assert.equal(failed.hash, '#settings-connectors');

  const qb = new URL(qbCb.connectorRedirectUrl('quickbooks', 'failed', 'no_realm'));
  assert.equal(qb.searchParams.get('reason'), 'no_realm');
});

test('realmId is captured from the intuit callback query params', () => {
  const withRealm = new URL('https://x/?code=c&state=s&realmId=12345');
  assert.equal(qbCb.realmIdFromQuery(withRealm), '12345');
  const without = new URL('https://x/?code=c&state=s');
  assert.equal(qbCb.realmIdFromQuery(without), null);
});
