// Pure validation tests for connector-read (validate.mjs). Runs under plain
// node --test, no Deno runtime needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORBIDDEN_SCOPES,
  READ_KINDS,
  assertNoSendScope,
  gmailHeader,
  inputError,
  isReadKind,
  resolveRealmId,
  trunc,
  validateParams,
} from '../connector-read/validate.mjs';

function throws400or(fn, code) {
  assert.throws(fn, (e) => {
    assert.equal(e.code, code);
    assert.ok(e.status >= 400 && e.status < 500);
    return true;
  });
}

test('forbidden scope list covers the known send scopes', () => {
  assert.ok(FORBIDDEN_SCOPES.includes('https://www.googleapis.com/auth/gmail.send'));
  assert.ok(FORBIDDEN_SCOPES.includes('Mail.Send'));
  assert.ok(FORBIDDEN_SCOPES.includes('Mail.ReadWrite'));
});

test('assertNoSendScope passes on the registry read scopes, refuses send scopes', () => {
  assert.doesNotThrow(() =>
    assertNoSendScope([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/business.manage',
      'offline_access', 'Mail.Read', 'Calendars.ReadWrite', 'User.Read',
      'com.intuit.quickbooks.accounting',
    ]),
  );
  assert.throws(() => assertNoSendScope(['https://www.googleapis.com/auth/gmail.send']), /send-capable/);
  assert.throws(() => assertNoSendScope(['Mail.Send']), /send-capable/);
});

test('all eight read kinds known', () => {
  assert.deepEqual([...READ_KINDS].sort(), [
    'gmail', 'google_business_profile', 'google_calendar', 'google_drive',
    'google_sheets', 'microsoft365', 'quickbooks', 'sms',
  ].sort());
  assert.ok(isReadKind('gmail'));
  assert.ok(!isReadKind('stripe'));
  assert.ok(!isReadKind('send-mail'));
  assert.ok(!isReadKind(''));
});

test('unknown kind is a 400', () => {
  throws400or(() => validateParams('stripe', {}), 'unknown_kind');
  throws400or(() => validateParams('gmailx', {}), 'unknown_kind');
});

test('gmail: defaults and caps', () => {
  assert.deepEqual(validateParams('gmail', {}), { q: undefined, max: 10 });
  assert.deepEqual(validateParams('gmail', { max: 100 }), { q: undefined, max: 25 });
  assert.deepEqual(validateParams('gmail', { q: 'from:x', max: 5 }), { q: 'from:x', max: 5 });
  throws400or(() => validateParams('gmail', { q: 42 }), 'bad_params');
});

test('google_calendar: defaults now/+14d, validates dates', () => {
  const p = validateParams('google_calendar', {});
  assert.ok(Date.parse(p.timeMin) <= Date.now() + 60_000);
  assert.ok(Date.parse(p.timeMax) - Date.parse(p.timeMin) > 13 * 864e5);
  assert.equal(p.max, 50);
  const fixed = validateParams('google_calendar', { timeMin: '2026-01-01T00:00:00Z', max: 999 });
  assert.equal(fixed.timeMin, '2026-01-01T00:00:00Z');
  assert.equal(fixed.max, 50);
  throws400or(() => validateParams('google_calendar', { timeMin: 'not-a-date' }), 'bad_params');
});

test('google_sheets: id and range required, id format checked', () => {
  const p = validateParams('google_sheets', {
    spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    range: 'Sheet1!A1:D10',
  });
  assert.equal(p.range, 'Sheet1!A1:D10');
  throws400or(() => validateParams('google_sheets', { range: 'A1' }), 'bad_params');
  throws400or(() => validateParams('google_sheets', { spreadsheet_id: 'short', range: 'A1' }), 'bad_params');
  throws400or(() => validateParams('google_sheets', { spreadsheet_id: 'x'.repeat(150), range: 'A1' }), 'bad_params');
});

test('google_drive: optional q, capped max', () => {
  assert.deepEqual(validateParams('google_drive', {}), { q: undefined, max: 10 });
  assert.equal(validateParams('google_drive', { max: 50 }).max, 25);
});

test('microsoft365: section required and constrained', () => {
  const mail = validateParams('microsoft365', { section: 'mail' });
  assert.equal(mail.section, 'mail');
  assert.equal(mail.days, 14);
  const cal = validateParams('microsoft365', { section: 'calendar', days: 500 });
  assert.equal(cal.days, 90);
  throws400or(() => validateParams('microsoft365', {}), 'bad_params');
  throws400or(() => validateParams('microsoft365', { section: 'drafts' }), 'bad_params');
});

test('quickbooks: query must be a SELECT', () => {
  const p = validateParams('quickbooks', { query: 'SELECT * FROM Customer MAXRESULTS 10' });
  assert.ok(/^select/i.test(p.query));
  throws400or(() => validateParams('quickbooks', {}), 'bad_params');
  throws400or(() => validateParams('quickbooks', { query: 'DELETE FROM Customer' }), 'bad_params');
  assert.ok(validateParams('quickbooks', { query: '  select * from Invoice' }).query.startsWith('  select'));
});

test('resolveRealmId: explicit param wins, then external_account', () => {
  assert.equal(resolveRealmId('123456789', '999'), '999');
  assert.equal(resolveRealmId('123456789', undefined), '123456789');
  assert.equal(resolveRealmId('{"realmId":"42"}', undefined), '42');
  assert.equal(resolveRealmId('{"realm_id":"43"}', undefined), '43');
  assert.equal(resolveRealmId('someone@example.com', undefined), null);
  assert.equal(resolveRealmId(null, undefined), null);
});

test('sms and gbp: simple shapes', () => {
  assert.deepEqual(validateParams('sms', {}), { max: 10 });
  assert.deepEqual(validateParams('google_business_profile', {}), {});
  assert.equal(validateParams('sms', { max: 1000 }).max, 25);
});

test('gmailHeader is case-insensitive and null-safe', () => {
  const payload = { headers: [{ name: 'From', value: 'a@b.c' }, { name: 'SUBJECT', value: 'Hi' }] };
  assert.equal(gmailHeader(payload, 'from'), 'a@b.c');
  assert.equal(gmailHeader(payload, 'subject'), 'Hi');
  assert.equal(gmailHeader(payload, 'date'), null);
  assert.equal(gmailHeader(null, 'from'), null);
});

test('trunc bounds untrusted text', () => {
  assert.equal(trunc('abc', 500), 'abc');
  assert.equal(trunc('x'.repeat(600), 500).length, 501);
  assert.equal(trunc(null, 10), '');
});

test('inputError carries status and code', () => {
  const e = inputError(429, 'rate_limited', 'Too many requests.');
  assert.equal(e.status, 429);
  assert.equal(e.code, 'rate_limited');
});
