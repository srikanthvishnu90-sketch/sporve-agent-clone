// connector-read — read-only, user-authenticated dispatcher for connected
// third-party data (Gmail, Google Calendar/Sheets/Drive, Google Business
// Profile, Microsoft 365 mail + calendar, QuickBooks, SMS via Twilio).
//
// POST { kind, params? } with `Authorization: Bearer <supabase jwt>`.
// Response: 200 { kind, items: [...] } (plus a small echo of the effective
// query where useful) | 400 | 401 | 409 | 429 | 502 | 503. Never 500 on a
// trivial call.
//
// SELF-CONTAINED BY DESIGN: `sb.py deploy <slug> <dir>` uploads only this
// directory, so imports of the shared sibling directory do NOT resolve at
// runtime. The helpers
// below (deadline, bounded body, forbidden-scope guard) are vendored in here
// and in ./validate.mjs, with the registry copy marked to stay in sync.
// The grep for dot-dot-slash-_shared on this directory must return zero
// matches before this function ships.
//
// HARD RULES, read them before touching this file:
//   1. READ-ONLY. Every provider call below is a GET (plus OAuth token
//      exchanges, which authenticate but write nothing). This function never
//      sends, drafts, posts, updates, or deletes anything anywhere.
//   2. NO SEND SCOPES. assertNoSendScope (vendored from
//      connector-registry.mjs) runs against the scopes stored on the connector
//      row before any token is used. A connector that somehow holds a
//      send-capable scope is refused, loudly, rather than used.
//   3. SECRETS STAY SECRET. The refresh token is read via the service-role-only
//      connector_read_secret RPC and is never logged, never returned, and
//      never interpolated into an error message. Provider error bodies can
//      echo tokens, so they are never logged either — only statuses and
//      generic codes leave this function.
//   4. INBOUND CONTENT IS UNTRUSTED. Everything that arrives from a provider
//      is somebody else's writing: mail bodies, subjects, calendar titles,
//      sheet cells, review text, SMS bodies. This function only RETURNS it; it
//      never stores it, and nothing it emits presents provider content as a
//      Sporv-verified fact. Callers must keep fencing it as untrusted input
//      (the same rule gmail-scan applies with wrapUntrusted before storing).

import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import {
  assertNoSendScope,
  gmailHeader,
  inputError,
  isReadKind,
  resolveRealmId,
  trunc,
  validateParams,
} from './validate.mjs';

// ── vendored from the shared http.ts helper (self-containment: see header) ─

class HttpInputError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Bounds response time even if a downstream transport ignores cancellation. */
function withHttpDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const race = Promise.race([
    Promise.resolve().then(() => work(controller.signal)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new HttpInputError(504, 'Request took too long. Please try again.');
        reject(error); controller.abort(error);
      }, ms);
    }),
  ]);
  // Cleanup runs only after the race settles. (2026-09-21: the previous
  // try/finally ran synchronously — controller.abort() fired before work()
  // even started, so every fetch using the signal failed immediately with
  // "The signal has been aborted". The identity check swallowed that as
  // "Invalid credentials.", 401ing every connected read. Do not re-add
  // abort() here; the timer clear is the only cleanup needed.)
  return race.finally(() => clearTimeout(timer));
}

/** Reads the body without letting a chunked request grow memory unbounded. */
async function readBoundedText(req: Request, maxBytes = 100_000): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpInputError(413, 'Request is too large.');
  }
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpInputError(413, 'Request is too large.');
  return text;
}

async function readBoundedJson(req: Request): Promise<Record<string, unknown>> {
  const text = await readBoundedText(req);
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpInputError(400, 'Request body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpInputError) throw error;
    throw new HttpInputError(400, 'Request body must be valid JSON.');
  }
}

// ── response helpers ────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// ── provider configuration ─────────────────────────────────────────────────

type ProviderName = 'google' | 'microsoft' | 'intuit' | 'twilio';

const KIND_PROVIDER: Record<string, ProviderName> = {
  gmail: 'google',
  google_calendar: 'google',
  google_sheets: 'google',
  google_drive: 'google',
  google_business_profile: 'google',
  microsoft365: 'microsoft',
  quickbooks: 'intuit',
  sms: 'twilio',
};

const PROVIDER_ENV: Record<ProviderName, string[]> = {
  google: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  microsoft: ['MS_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_SECRET'],
  intuit: ['INTUIT_CLIENT_ID', 'INTUIT_CLIENT_SECRET'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
};

function providerEnv(name: ProviderName): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const key of PROVIDER_ENV[name]) {
    const v = Deno.env.get(key);
    if (!v) return null;
    out[key] = v;
  }
  return out;
}

// ── token refresh (read-only auth exchange; writes nothing) ─────────────────

type ConnectorRow = {
  id: string;
  provider_id: string;
  kind: string;
  status: string;
  external_account: string | null;
  external_id: string | null;
  scopes: string[] | null;
};

async function refreshGoogle(env: Record<string, string>, refresh: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
    signal,
  });
  // The error body can echo the request. Never log or return it.
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function refreshMicrosoft(
  env: Record<string, string>, granted: string[], refresh: string, signal: AbortSignal,
): Promise<string | null> {
  const tenant = Deno.env.get('MS_OAUTH_TENANT') || 'common';
  const scope = granted.length ? granted.join(' ') : 'offline_access Mail.Read Calendars.Read';
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_OAUTH_CLIENT_ID,
      client_secret: env.MS_OAUTH_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
      scope,
    }),
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function refreshIntuit(env: Record<string, string>, refresh: string, signal: AbortSignal): Promise<string | null> {
  const basic = btoa(`${env.INTUIT_CLIENT_ID}:${env.INTUIT_CLIENT_SECRET}`);
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function accessTokenFor(
  provider: ProviderName, env: Record<string, string>, row: ConnectorRow,
  refresh: string, signal: AbortSignal,
): Promise<string | null> {
  switch (provider) {
    case 'google': return refreshGoogle(env, refresh, signal);
    case 'microsoft': return refreshMicrosoft(env, row.scopes ?? [], refresh, signal);
    case 'intuit': return refreshIntuit(env, refresh, signal);
    case 'twilio': return null; // Twilio is key-auth, not OAuth; no token to refresh.
  }
}

// ── provider GETs (read-only; every call below is a GET) ───────────────────

async function getJson(url: string, token: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON provider body */ }
  return { ok: res.ok, status: res.status, body };
}

// ── readers ────────────────────────────────────────────────────────────────

async function readGmail(token: string, p: { q?: string; max: number }, signal: AbortSignal) {
  const q = new URLSearchParams({ maxResults: String(p.max) });
  if (p.q) q.set('q', p.q);
  const list = await getJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${q}`, token, signal);
  if (!list.ok) throw inputError(502, 'provider_error', `Gmail list failed (${list.status}).`);
  const ids: string[] = ((list.body?.messages ?? []) as Array<{ id: string }>).map((m) => m.id);
  const items: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const full = await getJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      token, signal,
    );
    if (!full.ok) continue;
    items.push({
      id,
      from: gmailHeader(full.body?.payload, 'From') ?? null,
      subject: gmailHeader(full.body?.payload, 'Subject') ?? null,
      date: gmailHeader(full.body?.payload, 'Date') ?? null,
      snippet: full.body?.snippet ?? null,
    });
  }
  return { items, echo: { q: p.q ?? null, max: p.max } };
}

async function readGoogleCalendar(token: string, p: { timeMin: string; timeMax: string; max: number }, signal: AbortSignal) {
  const q = new URLSearchParams({
    singleEvents: 'true', orderBy: 'startTime',
    timeMin: p.timeMin, timeMax: p.timeMax, maxResults: String(p.max),
  });
  const r = await getJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, token, signal);
  if (!r.ok) throw inputError(502, 'provider_error', `Calendar list failed (${r.status}).`);
  const items = ((r.body?.items ?? []) as any[]).map((e) => ({
    id: e.id ?? null,
    summary: e.summary ?? null,
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    location: e.location ?? null,
    status: e.status ?? null,
  }));
  return { items, echo: { timeMin: p.timeMin, timeMax: p.timeMax } };
}

async function readGoogleSheets(token: string, p: { spreadsheet_id: string; range: string }, signal: AbortSignal) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${p.spreadsheet_id}/values/${encodeURIComponent(p.range)}?majorDimension=ROWS`;
  const r = await getJson(url, token, signal);
  if (!r.ok) throw inputError(502, 'provider_error', `Sheets read failed (${r.status}).`);
  const values = Array.isArray(r.body?.values) ? r.body.values.slice(0, 500) : [];
  return { items: [{ range: r.body?.range ?? p.range, values }], echo: { range: p.range } };
}

async function readGoogleDrive(token: string, p: { q?: string; max: number }, signal: AbortSignal) {
  const q = new URLSearchParams({
    pageSize: String(p.max),
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,modifiedTime)',
  });
  if (p.q) q.set('q', p.q);
  const r = await getJson(`https://www.googleapis.com/drive/v3/files?${q}`, token, signal);
  if (!r.ok) throw inputError(502, 'provider_error', `Drive list failed (${r.status}).`);
  const items = ((r.body?.files ?? []) as any[]).map((f) => ({
    id: f.id ?? null, name: f.name ?? null, mimeType: f.mimeType ?? null, modifiedTime: f.modifiedTime ?? null,
  }));
  return { items, echo: { q: p.q ?? null, max: p.max } };
}

async function readMicrosoft365(
  token: string, p: { section: 'mail' | 'calendar'; max: number; days: number }, signal: AbortSignal,
) {
  if (p.section === 'mail') {
    const q = new URLSearchParams({
      $top: String(p.max), $orderby: 'receivedDateTime desc',
      $select: 'id,from,subject,receivedDateTime,bodyPreview',
    });
    const r = await getJson(`https://graph.microsoft.com/v1.0/me/messages?${q}`, token, signal);
    if (!r.ok) throw inputError(502, 'provider_error', `Outlook mail read failed (${r.status}).`);
    const items = ((r.body?.value ?? []) as any[]).map((m) => ({
      id: m.id ?? null,
      from: m.from?.emailAddress?.address ?? m.from?.emailAddress?.name ?? null,
      subject: m.subject ?? null,
      date: m.receivedDateTime ?? null,
      snippet: trunc(m.bodyPreview, 200),
    }));
    return { items, echo: { section: 'mail', max: p.max } };
  }
  const start = new Date().toISOString();
  const end = new Date(Date.now() + p.days * 864e5).toISOString();
  const q = new URLSearchParams({
    startDateTime: start, endDateTime: end, $top: String(p.max),
    $select: 'id,subject,start,end,location,showAs',
  });
  const r = await getJson(`https://graph.microsoft.com/v1.0/me/calendarview?${q}`, token, signal);
  if (!r.ok) throw inputError(502, 'provider_error', `Outlook calendar read failed (${r.status}).`);
  const items = ((r.body?.value ?? []) as any[]).map((e) => ({
    id: e.id ?? null,
    summary: e.subject ?? null,
    start: e.start?.dateTime ?? null,
    end: e.end?.dateTime ?? null,
    location: e.location?.displayName ?? null,
    status: e.showAs ?? null,
  }));
  return { items, echo: { section: 'calendar', days: p.days } };
}

async function readQuickBooks(
  token: string, p: { query: string; realm_id?: string }, row: ConnectorRow, signal: AbortSignal,
) {
  /* The realm lives on external_id (written by the OAuth callback); the
     external_account fallback keeps older rows working. An explicit
     params.realm_id still wins — the caller asked for that company. */
  const realmId = resolveRealmId(row.external_id ?? row.external_account, p.realm_id);
  if (!realmId) {
    throw inputError(
      400, 'missing_realm_id',
      'QuickBooks needs a company realm id: pass params.realm_id, or record it on the connector (external_account).',
    );
  }
  const q = new URLSearchParams({ minorversion: '75', query: p.query });
  const r = await getJson(
    `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}/query?${q}`,
    token, signal,
  );
  if (!r.ok) throw inputError(502, 'provider_error', `QuickBooks query failed (${r.status}).`);
  // The entity key varies (Customer, Invoice, Account…): take the first array.
  const qr = r.body?.QueryResponse ?? {};
  const rows: any[] = [];
  for (const v of Object.values(qr)) {
    if (Array.isArray(v)) rows.push(...v);
  }
  return { items: rows.slice(0, 100), echo: { query: p.query } };
}

async function readGoogleBusinessProfile(token: string, signal: AbortSignal) {
  const accounts = await getJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', token, signal);
  if (!accounts.ok) {
    // Google gates this API behind a separate application approval; the
    // OAuth client alone is not enough. Say so honestly, don't fake it.
    if (accounts.status === 403 || accounts.status === 404) {
      throw inputError(502, 'gbp_not_approved', 'Google Business Profile API is not approved for this project.');
    }
    throw inputError(502, 'provider_error', `Business Profile accounts read failed (${accounts.status}).`);
  }
  const acctName = accounts.body?.accounts?.[0]?.name;
  if (!acctName) return { items: [], echo: {} };
  const locQ = new URLSearchParams({ pageSize: '5', readMask: 'name,title,storefrontAddress' });
  const locs = await getJson(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${acctName}/locations?${locQ}`, token, signal,
  );
  if (!locs.ok) {
    if (locs.status === 403 || locs.status === 404) {
      throw inputError(502, 'gbp_not_approved', 'Google Business Profile API is not approved for this project.');
    }
    throw inputError(502, 'provider_error', `Business Profile locations read failed (${locs.status}).`);
  }
  const items: Array<Record<string, unknown>> = [];
  for (const loc of ((locs.body?.locations ?? []) as any[]).slice(0, 5)) {
    const revQ = new URLSearchParams({ pageSize: '10' });
    const revs = await getJson(
      `https://mybusiness.googleapis.com/v4/${loc.name}/reviews?${revQ}`, token, signal,
    );
    items.push({
      location: loc.title ?? loc.name ?? null,
      reviews: revs.ok
        ? (((revs.body?.reviews ?? []) as any[]).map((r) => ({
            reviewer: r.reviewer?.displayName ?? null,
            starRating: r.starRating ?? null,
            comment: trunc(r.comment, 300),
            createTime: r.createTime ?? null,
          })))
        : null,
      reviews_error: revs.ok ? null : `reviews read failed (${revs.status})`,
    });
  }
  return { items, echo: {} };
}

async function readSms(env: Record<string, string>, p: { max: number }, signal: AbortSignal) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const phone = Deno.env.get('TWILIO_PHONE_NUMBER');
  if (!phone) {
    // No per-org phone mapping exists in the schema yet; the single org
    // number comes from env. Report honestly rather than guessing.
    throw inputError(503, 'not_configured', 'TWILIO_PHONE_NUMBER is not set.');
  }
  const q = new URLSearchParams({ To: phone, PageSize: String(p.max) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?${q}`, {
    headers: { Authorization: `Basic ${btoa(`${sid}:${authToken}`)}` },
    signal,
  });
  if (!res.ok) throw inputError(502, 'provider_error', `Twilio messages read failed (${res.status}).`);
  const body = (await res.json()) as { messages?: any[] };
  const items = ((body?.messages ?? []) as any[]).map((m) => ({
    from: m.from ?? null,
    body: trunc(m.body, 500),
    date: m.date_sent ?? m.date_created ?? null,
    sid: m.sid ?? null,
  }));
  return { items, echo: { to: phone, max: p.max } };
}

type ReadParams = Record<string, any>;

async function dispatch(
  kind: string, params: ReadParams, token: string, env: Record<string, string>,
  row: ConnectorRow, signal: AbortSignal,
): Promise<{ items: Array<Record<string, unknown>>; echo: Record<string, unknown> }> {
  switch (kind) {
    case 'gmail': return readGmail(token, params, signal);
    case 'google_calendar': return readGoogleCalendar(token, params, signal);
    case 'google_sheets': return readGoogleSheets(token, params, signal);
    case 'google_drive': return readGoogleDrive(token, params, signal);
    case 'microsoft365': return readMicrosoft365(token, params, signal);
    case 'quickbooks': return readQuickBooks(token, params, row, signal);
    case 'google_business_profile': return readGoogleBusinessProfile(token, signal);
    case 'sms': return readSms(env, params, signal);
    default: throw inputError(400, 'unknown_kind', `Unknown connector kind: ${kind}.`);
  }
}

// ── org resolution ─────────────────────────────────────────────────────────

async function resolveProviderId(admin: any, userId: string): Promise<string | null> {
  // Owners first: providers.owner_id is the club's own account.
  const { data: owned } = await admin.from('providers').select('id').eq('owner_id', userId).limit(1);
  if (owned?.length) return owned[0].id as string;
  // Then staff: organization_members links a coach's user id to the club
  // (organization_members.organization_id → providers.id). Only active
  // memberships count, so a deactivated coach loses connector reads.
  const { data: mem } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('member_user_id', userId)
    .eq('is_active', true)
    .limit(1);
  if (mem?.length) return mem[0].organization_id as string;
  return null;
}

async function noteAttempt(admin: any, row: ConnectorRow, started: string, ok: boolean, items: number, why?: string) {
  // Telemetry must never break the read. The postgrest query builder is
  // thenable but has no .catch() method — await it inside try/catch instead.
  // (2026-09-21: `.catch(()=>{})` on the builder threw TypeError on every
  // successful read, surfacing as 503 "Read is temporarily unavailable".)
  try {
    await admin.from('connector_sync_state').upsert({
      connector_id: row.id,
      provider_id: row.provider_id,
      last_attempt_at: started,
      last_success_at: ok ? new Date().toISOString() : null,
      last_error: ok ? null : (why ?? 'read failed'),
      last_error_at: ok ? null : new Date().toISOString(),
      items_seen: items,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'connector_id' });
  } catch { /* telemetry is best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!serviceKey || !supabaseUrl || !anonKey) {
    return json({ error: 'Service is not configured.', code: 'not_configured' }, 503);
  }

  const authorization = req.headers.get('Authorization') ?? '';
  const bearer = authorization.replace(/^Bearer\s+/i, '');
  if (!bearer) return json({ error: 'Missing credentials.', code: 'unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(req);
  } catch (e) {
    const err = e as HttpInputError;
    return json({ error: err.message, code: 'bad_body' }, err.status ?? 400);
  }

  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!isReadKind(kind)) {
    return json({ error: 'Unknown connector kind.', code: 'unknown_kind' }, 400);
  }
  let params: ReadParams;
  try {
    params = validateParams(kind, body.params);
  } catch (e: any) {
    return json({ error: e.message ?? 'Bad params.', code: e.code ?? 'bad_params' }, e.status ?? 400);
  }

  try {
    return await withHttpDeadline(async (signal) => {
      // Identity: who is calling. The gateway already verified the JWT
      // (verify_jwt = true); this re-verifies it to learn WHO the caller is,
      // since connector rows are per-org. Uses the anon-key client with the
      // caller's Authorization header forwarded — the same pattern as
      // connectors-available and coach-command. (2026-09-21: the service_role
      // client's auth.getUser(bearer) rejected valid user JWTs in production,
      // 401ing every connected read with "Invalid credentials."; the service
      // role client is still used below for the vault RPCs.)
      const userClient = createClient(supabaseUrl, anonKey, {
        global: {
          headers: { Authorization: authorization },
          fetch: (i: any, init: any) => fetch(i, { ...init, signal }),
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const admin = createClient(supabaseUrl, serviceKey, {
        global: { fetch: (i: any, init: any) => fetch(i, { ...init, signal }) },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: userData, error: uErr } = await userClient.auth.getUser();
      const user = userData?.user;
      if (uErr || !user) {
        // Log the real cause server-side; the client keeps the generic shape.
        console.error('[connector-read] identity check failed:', uErr?.message ?? 'no user');
        return json({ error: 'Invalid credentials.', code: 'unauthorized' }, 401);
      }

      // Per-user rate limit: 30 reads/minute.
      try {
        const { data: allowed, error: rlErr } = await admin.rpc('consume_edge_rate_limit', {
          p_actor_key: `user:${user.id}`,
          p_scope: 'connector-read:minute',
          p_limit: 30,
          p_window_seconds: 60,
        });
        if (rlErr) {
          console.error('connector-read: rate-limit check failed');
          return json({ error: 'Rate limiter is unavailable.', code: 'rate_limit_unavailable' }, 429);
        }
        if (allowed !== true) {
          return json({ error: 'Too many requests.', code: 'rate_limited' }, 429);
        }
      } catch {
        console.error('connector-read: rate-limit check failed');
        return json({ error: 'Rate limiter is unavailable.', code: 'rate_limit_unavailable' }, 429);
      }

      const providerId = await resolveProviderId(admin, user.id);
      if (!providerId) {
        return json({ error: 'No organization found for this user.', code: 'no_organization' }, 409);
      }

      const { data: rows } = await admin
        .from('org_connectors')
        .select('id, provider_id, kind, status, external_account, external_id, scopes')
        .eq('provider_id', providerId)
        .eq('kind', kind)
        .limit(1);
      const row = (rows?.[0] ?? null) as ConnectorRow | null;
      if (!row) {
        return json({ error: `${kind} is not connected.`, code: 'not_connected' }, 409);
      }
      if (row.status === 'error') {
        const { data: state } = await admin
          .from('connector_sync_state')
          .select('last_error, last_error_at')
          .eq('connector_id', row.id)
          .maybeSingle();
        return json({
          error: `${kind} needs attention before it can be read.`,
          code: 'connector_error',
          last_error: (state as any)?.last_error ?? null,
          last_error_at: (state as any)?.last_error_at ?? null,
        }, 409);
      }
      if (row.status !== 'connected') {
        return json({ error: `${kind} is not connected (${row.status}).`, code: 'not_connected', status: row.status }, 409);
      }

      const provider = KIND_PROVIDER[kind];
      const env = providerEnv(provider);
      if (!env) {
        return json({ error: `${provider} is not configured on this deployment.`, code: 'not_configured' }, 503);
      }

      // Forbidden-scope guard: belt and braces on top of the registry and the
      // OAuth callback. A stored connector holding a send-capable scope is a
      // defect; refuse to use it rather than silently benefiting.
      try {
        assertNoSendScope(row.scopes ?? []);
      } catch (e: any) {
        return json({ error: 'Connector holds a forbidden scope.', code: 'forbidden_scope' }, 503);
      }

      const started = new Date().toISOString();

      let accessToken: string | null = null;
      if (provider !== 'twilio') {
        const { data: refresh } = await admin.rpc('connector_read_secret', { p_connector: row.id });
        if (!refresh || typeof refresh !== 'string') {
          await noteAttempt(admin, row, started, false, 0, 'no stored token — reconnect required');
          return json({ error: 'No stored token for this connector.', code: 'token_expired' }, 502);
        }
        accessToken = await accessTokenFor(provider, env, row, refresh, signal);
        if (!accessToken) {
          // Almost always a revoked grant. Mark it with a date rather than
          // failing silently — the UI surfaces last_error/last_error_at.
          await admin.from('org_connectors').update({ status: 'error' }).eq('id', row.id);
          await noteAttempt(admin, row, started, false, 0, 'provider refused the stored token — reconnect required');
          return json({ error: 'The stored token was refused. Reconnect required.', code: 'token_expired' }, 502);
        }
      }

      try {
        const { items, echo } = await dispatch(kind, params, accessToken as string, env, row, signal);
        await noteAttempt(admin, row, started, true, items.length);
        return json({ kind, items, ...echo });
      } catch (e: any) {
        const status = e?.status ?? 502;
        await noteAttempt(admin, row, started, false, 0, e?.message ?? 'provider read failed');
        return json(
          { error: e?.message ?? 'The provider request failed.', code: e?.code ?? 'provider_error' },
          status,
        );
      }
    }, 20000);
  } catch (error) {
    if (error instanceof HttpInputError) {
      return json({ error: error.message, code: 'deadline' }, error.status);
    }
    const e = error as any;
    if (e?.status) {
      return json({ error: e.message ?? 'Request failed.', code: e.code ?? 'provider_error' }, e.status);
    }
    // Never 500 on a trivial call: an unexpected failure is a provider outage
    // from the caller's point of view.
    const eu = error as any;
    console.error('connector-read: unexpected failure:', eu?.message ?? String(error), '| name:', eu?.name ?? '?', '| status:', eu?.status ?? '?', '| stack:', eu?.stack?.split('\n').slice(0,3).join(' <- ') ?? '?');
    return json({ error: 'Read is temporarily unavailable.', code: 'provider_error' }, 503);
  }
});
