import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CONNECTORS, FORBIDDEN_SCOPES, PROVIDERS, assertNoSendScope,
  availableKinds, isKnownKind, isOAuthKind, providerOf, scopesFor, writeModeFor,
} from './connector-registry.mjs';

const env = (present) => (name) => (present.includes(name) ? 'set' : undefined);
const GOOGLE = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'];
const MS = ['MS_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_SECRET', 'MS_OAUTH_TENANT'];

test('no connector anywhere requests a send-capable scope', () => {
  for (const [kind, c] of Object.entries(CONNECTORS)) {
    for (const s of c.scopes || []) {
      assert.ok(!FORBIDDEN_SCOPES.includes(s), `${kind} requests ${s}`);
    }
    assert.doesNotThrow(() => scopesFor(kind), `${kind} scopes rejected`);
  }
});

test('the two mail connectors hold read-only mail scopes', () => {
  // Gmail: readonly ONLY. gmail.compose reads like a draft-only scope and is
  // documented by Google as "Manage drafts and send emails".
  assert.deepEqual(CONNECTORS.gmail.scopes, ['https://www.googleapis.com/auth/gmail.readonly']);
  assert.equal(writeModeFor('gmail'), 'none');
  // Microsoft: Mail.Read, never Mail.ReadWrite — ReadWrite covers send.
  assert.ok(CONNECTORS.microsoft365.scopes.includes('Mail.Read'));
  assert.ok(!CONNECTORS.microsoft365.scopes.some((s) => /Mail\.(ReadWrite|Send)/.test(s)));
});

test('no connector may hold a write mode above apply, and none says send', () => {
  for (const [kind, c] of Object.entries(CONNECTORS)) {
    assert.ok(['none', 'draft', 'apply'].includes(c.write), `${kind} write=${c.write}`);
  }
  // Mail capability is tracked separately from `write`, because a connector
  // can legitimately be write:'apply' for calendars while touching no mail.
  // The rule that matters: nothing may ever WRITE mail.
  for (const [kind, c] of Object.entries(CONNECTORS)) {
    if (!('mail' in c)) continue;
    assert.ok(['none', 'read'].includes(c.mail),
      `${kind} claims mail:'${c.mail}' — the only values are none and read`);
  }
  // And every connector that reads mail must actually hold read-only scopes.
  for (const [kind, c] of Object.entries(CONNECTORS)) {
    if (c.mail !== 'read') continue;
    for (const s of c.scopes || []) {
      assert.ok(!/\.send|Mail\.Send|Mail\.ReadWrite|gmail\.(compose|modify|insert)|^https:\/\/mail\.google\.com/.test(s),
        `${kind} holds a mail-writing scope: ${s}`);
    }
  }
});

test('a connector is offered only when its provider is configured', () => {
  const none = availableKinds(env([]));
  assert.ok(none.includes('website') && none.includes('file_import'),
    'connectors needing no credentials are always offered');
  assert.ok(!none.includes('gmail'), 'gmail must not be offered with no Google client');
  assert.ok(!none.includes('microsoft365'));

  const google = availableKinds(env(GOOGLE));
  assert.ok(google.includes('gmail') && google.includes('google_calendar'));
  assert.ok(google.includes('google_sheets') && google.includes('google_drive'),
    'Sheets and Drive share the Google client, so one client offers all four');
  assert.ok(!google.includes('microsoft365'), 'Microsoft needs its own registration');
});

test('a connector needing outside approval is withheld until approval is recorded', () => {
  // Google gates the Business Profile API behind a separate application, so
  // having the OAuth client is not enough to offer it honestly.
  assert.ok(!availableKinds(env(GOOGLE)).includes('google_business_profile'));
  assert.ok(availableKinds(env(GOOGLE), ['google_business_profile'])
    .includes('google_business_profile'));
});

test('microsoft becomes available only with all three of its secrets', () => {
  assert.ok(!availableKinds(env(MS.slice(0, 2))).includes('microsoft365'), 'tenant missing');
  assert.ok(availableKinds(env(MS)).includes('microsoft365'));
});

test('every connector names a real provider, a group, and what it reads', () => {
  for (const [kind, c] of Object.entries(CONNECTORS)) {
    assert.ok(PROVIDERS[c.provider], `${kind} → unknown provider ${c.provider}`);
    assert.ok(c.group && c.label, `${kind} missing group/label`);
    assert.ok(c.reads && c.writes, `${kind} does not say what it reads and writes`);
  }
});

test('only OAuth providers are treated as OAuth', () => {
  for (const k of ['gmail', 'google_sheets', 'microsoft365', 'quickbooks']) {
    assert.ok(isOAuthKind(k), `${k} should authorise via OAuth`);
  }
  for (const k of ['stripe', 'website', 'file_import', 'sms']) {
    assert.ok(!isOAuthKind(k), `${k} does not use an OAuth round trip`);
  }
});

test('unknown kinds are rejected rather than treated as connectors', () => {
  for (const bad of ['', null, undefined, 'GMAIL', 'facebook', '__proto__', 'constructor']) {
    assert.ok(!isKnownKind(bad), `${String(bad)} must not be a known kind`);
  }
  assert.ok(isKnownKind('gmail'));
  // __proto__ / constructor matter: a naive `kind in CONNECTORS` would accept
  // both and hand a prototype object to the scope lookup.
  assert.deepEqual(scopesFor('__proto__'), []);
});

test('asking for a send scope throws, whichever provider it belongs to', () => {
  for (const s of ['https://www.googleapis.com/auth/gmail.send', 'Mail.Send', 'Mail.ReadWrite']) {
    assert.throws(() => assertNoSendScope([s]), /send-capable scope/, `${s} must be refused`);
  }
});

test('no edge function hardcodes a scope instead of using the registry', () => {
  // The registry is worthless if a function writes its own scope string.
  const dir = new URL('../', import.meta.url);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_shared') continue;
    let src;
    try { src = readFileSync(new URL(`${entry.name}/index.ts`, dir), 'utf8'); } catch { continue; }
    for (const forbidden of FORBIDDEN_SCOPES) {
      assert.ok(!src.includes(forbidden), `${entry.name} references ${forbidden}`);
    }
  }
});
