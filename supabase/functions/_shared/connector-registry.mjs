// @ts-self-types="./connector-registry.d.mts"
/**
 * Every connector Sporv knows about, in one table.
 *
 * This replaces a scattering of hardcoded lists. Adding a connector should be a
 * row here plus a reader, not a new pair of edge functions — and where a
 * provider is shared (all five Google connectors use one OAuth client) adding
 * one really is just a row.
 *
 * Three rules this file exists to enforce:
 *
 *   1. NO CONNECTOR MAY HOLD A SEND SCOPE. `write` is the strongest thing a
 *      connector does, and it tops out at 'draft' for anything that can reach a
 *      family. This is invariant I1 expressed as data, so a new connector
 *      cannot quietly acquire send by being written in a different file.
 *   2. A connector is only OFFERED when its provider is configured. A tile that
 *      says Connect with no credentials behind it is a lie the customer finds
 *      by clicking it.
 *   3. What each one READS and WRITES is stated here and rendered verbatim in
 *      the UI, so the product cannot describe itself differently from what the
 *      scopes actually permit.
 */

/** OAuth providers. `env` names the secrets that make a provider configured. */
export const PROVIDERS = {
  google: {
    label: 'Google',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    callback: 'google-oauth-callback',
  },
  microsoft: {
    label: 'Microsoft',
    env: ['MS_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_SECRET', 'MS_OAUTH_TENANT'],
    // `common` lets both work and personal accounts sign in; the tenant is
    // configurable because a club on a school M365 may be single-tenant.
    authorize: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    callback: 'microsoft-oauth-callback',
  },
  intuit: {
    label: 'QuickBooks',
    env: ['INTUIT_CLIENT_ID', 'INTUIT_CLIENT_SECRET'],
    authorize: 'https://appcenter.intuit.com/connect/oauth2',
    token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    callback: 'intuit-oauth-callback',
  },
  // Twilio is not OAuth. A club does not "authorise" Sporv to use Twilio; Sporv
  // owns the number and the club is assigned one. Kept here so the UI can treat
  // it uniformly, with `oauth: false` marking that it takes a different path.
  twilio: {
    label: 'Twilio',
    env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    oauth: false,
    callback: null,
  },
  // Connectors with no third-party authorisation at all.
  internal: { label: 'Sporv', env: [], oauth: false, callback: null },
  stripe: { label: 'Stripe', env: ['STRIPE_SECRET_KEY'], oauth: false, callback: null },
};

/**
 * `write` values, in ascending capability:
 *   none  — read-only. We hold no write scope whatsoever.
 *   draft — we may compose something a human then approves. Never sends.
 *   apply — we may change a record the human approved (a calendar event).
 * There is deliberately no 'send'.
 *
 * `mail` is separate ON PURPOSE, and a test caught why: microsoft365 is
 * write:'apply' because it can change a calendar, which said nothing about
 * whether it can touch mail. Conflating the two is exactly how a mail-send
 * capability sneaks in behind a calendar justification. So:
 *   mail:'none' — this connector does not touch mail at all
 *   mail:'read' — it reads mail and can never write or send any
 * No other value exists. There is no mail:'write'.
 */
export const CONNECTORS = {
  // ── already working ────────────────────────────────────────────────────
  stripe: {
    provider: 'stripe', group: 'Money', label: 'Stripe', write: 'apply',
    reads: 'Charges, refunds, failed payments, card expiry and payouts.',
    writes: 'Charges and invoices you approve. Dues land in your own Stripe account.',
  },
  website: {
    provider: 'internal', group: 'Where your roster lives', label: 'Your website', write: 'none',
    reads: 'Your programs, prices, schedule and staff from your public pages.',
    writes: 'Nothing.',
  },
  file_import: {
    provider: 'internal', group: 'Where your roster lives', label: 'CSV or export file', write: 'none',
    reads: 'A roster export from SportsEngine, TeamSnap, LeagueApps, Spond or a plain sheet.',
    writes: 'Nothing. We never ask for your password to those tools.',
  },

  // ── Google family: one OAuth client, five connectors ───────────────────
  gmail: {
    provider: 'google', group: 'Email and calendar', label: 'Gmail', write: 'none', mail: 'read',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    reads: 'Inbound parent email, tournament PDFs and league notices.',
    writes: 'Nothing. Replies are drafted in your Sporv queue, never in your mailbox.',
  },
  google_calendar: {
    provider: 'google', group: 'Email and calendar', label: 'Google Calendar', write: 'apply',
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    reads: 'Practices, games, conflicts and availability.',
    writes: 'Schedule changes you approve.',
  },
  google_sheets: {
    provider: 'google', group: 'Records', label: 'Google Sheets', write: 'none',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    reads: 'The spreadsheet your club actually runs on.',
    writes: 'Nothing. Read-only.',
  },
  google_drive: {
    provider: 'google', group: 'Records', label: 'Google Drive', write: 'none',
    // drive.readonly is broad. drive.file would be narrower but only sees files
    // the user picks through Google's own picker, which cannot find waivers
    // already sitting in their Drive — the entire point. Stated so the
    // trade-off is a decision on the record rather than an accident.
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    reads: 'Waivers, forms and PDFs you already store.',
    writes: 'Nothing. Read-only.',
  },
  google_business_profile: {
    provider: 'google', group: 'Records', label: 'Google Business Profile', write: 'draft',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    // Google gates this API behind a separate application, so configuring the
    // OAuth client is not sufficient. `requiresApproval` keeps the tile honest
    // until that approval exists.
    requiresApproval: 'Google Business Profile API access request',
    reads: 'Your listing accuracy, hours and reviews.',
    writes: 'Corrections you approve.',
  },

  // ── other providers ────────────────────────────────────────────────────
  microsoft365: {
    provider: 'microsoft', group: 'Email and calendar', label: 'Outlook and Microsoft 365', write: 'apply', mail: 'read',
    // Mail.Read, not Mail.ReadWrite: same reasoning as Gmail. Microsoft's
    // Mail.ReadWrite includes creating drafts AND sending them.
    scopes: ['offline_access', 'Mail.Read', 'Calendars.ReadWrite', 'User.Read'],
    reads: 'Inbound parent email and your calendar.',
    writes: 'Calendar changes you approve. Never mail.',
  },
  quickbooks: {
    provider: 'intuit', group: 'Records', label: 'QuickBooks', write: 'none',
    scopes: ['com.intuit.quickbooks.accounting'],
    reads: 'What your treasurer needs to reconcile.',
    writes: 'Nothing. Read-only.',
  },
  sms: {
    provider: 'twilio', group: 'Email and calendar', label: 'Text messages', write: 'draft', mail: 'read',
    reads: 'What families text your Sporv number.',
    writes: 'Replies drafted for your approval. Never sent automatically.',
  },
};

/** Scopes no connector may ever request, whatever provider it belongs to. */
export const FORBIDDEN_SCOPES = [
  // Google
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://mail.google.com/',
  // Microsoft — ReadWrite covers createReply and send
  'Mail.ReadWrite',
  'Mail.Send',
  'Mail.ReadWrite.Shared',
  'Mail.Send.Shared',
];

export function assertNoSendScope(scopes) {
  const bad = (scopes || []).filter((s) => FORBIDDEN_SCOPES.includes(s));
  if (bad.length) throw new Error(`refusing to request a send-capable scope: ${bad.join(', ')}`);
}

export function isKnownKind(v) {
  return typeof v === 'string' && Object.hasOwn(CONNECTORS, v);
}

export function scopesFor(kind) {
  const c = CONNECTORS[kind];
  const s = (c && c.scopes) || [];
  assertNoSendScope(s);
  return s;
}

export function providerOf(kind) {
  const c = CONNECTORS[kind];
  return c ? PROVIDERS[c.provider] : null;
}

/** gmail is 'none' because we hold no Gmail write scope at all. */
export function writeModeFor(kind) {
  const c = CONNECTORS[kind];
  return c ? c.write : 'none';
}

/**
 * Which kinds this deployment can actually offer.
 *
 * `env` is a lookup the caller supplies (Deno.env.get), so this stays pure and
 * testable. A connector needing outside approval is never offered until that
 * approval is recorded in `approved`.
 */
export function availableKinds(env, approved = []) {
  return Object.entries(CONNECTORS)
    .filter(([kind, c]) => {
      const p = PROVIDERS[c.provider];
      if (!p) return false;
      if (c.requiresApproval && !approved.includes(kind)) return false;
      return (p.env || []).every((name) => {
        const v = env(name);
        return typeof v === 'string' && v.length > 0;
      });
    })
    .map(([kind]) => kind);
}

/** Kinds that authorise through an OAuth round trip. */
export function isOAuthKind(kind) {
  const p = providerOf(kind);
  return !!p && p.oauth !== false;
}
