// Pure validation for connector-read. No network, no Deno, no secrets — so
// `node --test` can hold it to account in CI without a Deno runtime.
//
// SECURITY NOTE: the FORBIDDEN_SCOPES list below is vendored from
// supabase/functions/_shared/connector-registry.mjs and MUST be kept in sync
// with it. connector-read cannot import the shared sibling directory at
// runtime (sb.py deploy
// uploads only the function dir), so this copy exists here deliberately.
// If the registry gains a send-capable scope, this file gains it too.

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
  if (bad.length) throw inputError(503, 'forbidden_scope', `Refusing to use a send-capable scope: ${bad.join(', ')}`);
}

/** Read kinds this function dispatches. No send, no write — reads only. */
export const READ_KINDS = [
  'gmail',
  'google_calendar',
  'google_sheets',
  'google_drive',
  'microsoft365',
  'quickbooks',
  'google_business_profile',
  'sms',
];

export function isReadKind(v) {
  return typeof v === 'string' && READ_KINDS.includes(v);
}

/** Throw with an HTTP status + machine-readable code attached. */
export function inputError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function asInt(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function clampInt(v, fallback, cap) {
  return Math.min(asInt(v, fallback), cap);
}

function optStr(v) {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function reqStr(v, name, maxLen = 256) {
  if (typeof v !== 'string' || v.length === 0) {
    throw inputError(400, 'bad_params', `params.${name} is required.`);
  }
  if (v.length > maxLen) {
    throw inputError(400, 'bad_params', `params.${name} is too long (max ${maxLen} chars).`);
  }
  return v;
}

/**
 * QuickBooks needs a company realm id. There is no dedicated column in the
 * schema, so the callback that creates the connector is expected to record it
 * in external_account — either as the bare realm id or inside JSON
 * ({realmId} or {realm_id}). The caller may also pass params.realm_id
 * explicitly; explicit wins.
 */
export function resolveRealmId(externalAccount, paramsRealmId) {
  const fromParams = optStr(paramsRealmId);
  if (fromParams) return fromParams;
  const raw = optStr(externalAccount);
  if (!raw) return null;
  if (/^\d{1,20}$/.test(raw.trim())) return raw.trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const v = parsed.realmId ?? parsed.realm_id ?? parsed.realmid;
      if (typeof v === 'string' && v.length > 0) return v;
      if (typeof v === 'number') return String(v);
    }
  } catch { /* not JSON — no realm id there */ }
  return null;
}

function isoOr(v, fallback, name) {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    throw inputError(400, 'bad_params', `params.${name} must be an ISO date-time string.`);
  }
  return v;
}

/**
 * Validate and normalise params for a read kind. Returns the normalised
 * params the reader uses. Throws inputError (with .status / .code) on any
 * caller mistake — a 400, never a 500.
 */
export function validateParams(kind, params) {
  if (!isReadKind(kind)) {
    throw inputError(400, 'unknown_kind', `Unknown connector kind: ${String(kind).slice(0, 60)}.`);
  }
  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};

  switch (kind) {
    case 'gmail': {
      const q = p.q === undefined || p.q === null ? undefined : reqStr(p.q, 'q', 256);
      return { q, max: clampInt(p.max, 10, 25) };
    }
    case 'google_calendar': {
      const now = new Date().toISOString();
      const timeMin = isoOr(p.timeMin, now, 'timeMin');
      const timeMax = isoOr(p.timeMax, new Date(Date.now() + 14 * 864e5).toISOString(), 'timeMax');
      return { timeMin, timeMax, max: clampInt(p.max, 50, 50) };
    }
    case 'google_sheets': {
      const spreadsheet_id = reqStr(p.spreadsheet_id, 'spreadsheet_id', 200);
      if (!/^[A-Za-z0-9-_]{20,128}$/.test(spreadsheet_id)) {
        throw inputError(400, 'bad_params', 'params.spreadsheet_id does not look like a Google spreadsheet id.');
      }
      const range = reqStr(p.range, 'range', 256);
      return { spreadsheet_id, range };
    }
    case 'google_drive': {
      const q = p.q === undefined || p.q === null ? undefined : reqStr(p.q, 'q', 512);
      return { q, max: clampInt(p.max, 10, 25) };
    }
    case 'microsoft365': {
      const section = reqStr(p.section, 'section', 16);
      if (section !== 'mail' && section !== 'calendar') {
        throw inputError(400, 'bad_params', "params.section must be 'mail' or 'calendar'.");
      }
      const days = clampInt(p.days, 14, 90);
      return { section, max: clampInt(p.max, 10, 25), days };
    }
    case 'quickbooks': {
      const query = reqStr(p.query, 'query', 2000);
      if (!/^\s*select\s/i.test(query)) {
        throw inputError(400, 'bad_params', 'params.query must be a SELECT query.');
      }
      const realm_id = optStr(p.realm_id);
      return { query, realm_id };
    }
    case 'google_business_profile': {
      return {};
    }
    case 'sms': {
      return { max: clampInt(p.max, 10, 25) };
    }
    default:
      throw inputError(400, 'unknown_kind', `Unknown connector kind: ${kind}.`);
  }
}

/** Pull a header value out of Gmail's metadata payload_headers list. */
export function gmailHeader(payload, name) {
  const hs = payload?.headers;
  if (!Array.isArray(hs)) return null;
  const found = hs.find((h) => String(h?.name ?? '').toLowerCase() === name.toLowerCase());
  return found ? String(found.value ?? '') : null;
}

export function trunc(s, n) {
  const v = String(s ?? '');
  return v.length > n ? v.slice(0, n) + '…' : v;
}
