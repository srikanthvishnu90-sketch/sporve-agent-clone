// @ts-self-types="./google-scopes.d.mts"
/**
 * The pure half of the Google connector: scopes, the consent URL, and the
 * rules about what may never be requested.
 *
 * It is plain .mjs on purpose. Deno imports it directly, and `node --test` can
 * exercise it in CI without a Deno runtime — which matters because the single
 * most important rule in the connector path lives here: Sporv never requests a
 * scope that can send mail.
 */

/** compose = create a draft. It carries no send capability at all. */
export const GOOGLE_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
  ],
  google_calendar: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
};

/**
 * Scopes that would make the draft-only promise false. Checked at runtime
 * rather than trusted to review, because this list is exactly the thing a
 * future "just make it send" change would edit.
 */
export const FORBIDDEN_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://mail.google.com/',
];

export function assertNoSendScope(scopes) {
  const bad = (scopes || []).filter(s => FORBIDDEN_SCOPES.includes(s));
  if (bad.length) throw new Error(`refusing to request a send-capable scope: ${bad.join(', ')}`);
}

export function isGoogleKind(v) {
  return v === 'gmail' || v === 'google_calendar';
}

export function authorizeUrl(cfg, scopes, state, loginHint) {
  assertNoSendScope(scopes);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('state', state);
  // offline + consent is what actually returns a refresh token. Without
  // prompt=consent Google omits it on a repeat authorisation and the
  // connection silently stops working when the access token expires.
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

/**
 * Google returns the scopes it actually granted, which can be fewer than the
 * ones asked for — a customer can untick one on the consent screen. Storing
 * the granted set, not the requested set, is what keeps the product from
 * claiming a capability the token does not have.
 */
export function grantedScopes(token, requested) {
  const granted = String((token && token.scope) || '').split(/\s+/).filter(Boolean);
  return granted.length ? granted : requested;
}

/** A connector is only useful if the read scope survived the consent screen. */
export function hasRequiredRead(kind, granted) {
  return (granted || []).includes(GOOGLE_SCOPES[kind][0]);
}

/** The write mode a kind may hold. gmail can never exceed 'draft' (I1). */
export function writeModeFor(kind) {
  return kind === 'gmail' ? 'draft' : 'apply';
}
