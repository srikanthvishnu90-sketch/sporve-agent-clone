// Begins a QuickBooks (Intuit) connection. Returns the consent URL; connects
// nothing.
//
// SELF-CONTAINED: `sb.py deploy` uploads only this directory, so every helper
// this function needs is inlined below (copies of
// supabase/functions/_shared/http.ts and the scope table from
// supabase/functions/_shared/connector-registry.mjs). The registry stays the
// source of truth; the tables here mirror it verbatim.
//
// The connector is read-only: the only scope is
// com.intuit.quickbooks.accounting, which grants read access to the company's
// accounting data and no write or send capability.

// ── registry mirror (supabase/functions/_shared/connector-registry.mjs) ──
export const FORBIDDEN_SCOPES: string[] = [
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

export function assertNoSendScope(scopes: string[] | undefined): void {
  const bad = (scopes || []).filter((s) => FORBIDDEN_SCOPES.includes(s));
  if (bad.length) throw new Error(`refusing to request a send-capable scope: ${bad.join(', ')}`);
}

/** The single QuickBooks connector. Scope from CONNECTORS.quickbooks. */
export const SCOPES_BY_KIND: Record<string, string[]> = {
  quickbooks: ['com.intuit.quickbooks.accounting'],
};

/** 'none' from the registry: read-only, nothing is ever written back. */
export const WRITE_MODE_BY_KIND: Record<string, string> = {
  quickbooks: 'none',
};

export function writeModeFor(kind: string): string {
  return WRITE_MODE_BY_KIND[kind] ?? 'none';
}

export function isConnectorKind(v: unknown): v is string {
  return v === 'quickbooks';
}

export type IntuitConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function intuitConfig(): IntuitConfig | null {
  const clientId = Deno.env.get('INTUIT_CLIENT_ID');
  const clientSecret = Deno.env.get('INTUIT_CLIENT_SECRET');
  const base = Deno.env.get('SUPABASE_URL');
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/functions/v1/intuit-oauth-callback` };
}

export function buildAuthorizeUrl(cfg: IntuitConfig, scopes: string[], state: string): string {
  assertNoSendScope(scopes);
  const u = new URL('https://appcenter.intuit.com/connect/oauth2');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

// ── http helpers (copy of supabase/functions/_shared/http.ts) ──
export class HttpInputError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Bounds response time even if a downstream transport ignores cancellation. */
export async function withHttpDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new HttpInputError(504, 'Request took too long. Please try again.');
          reject(error); controller.abort(error);
        }, ms);
      }),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Reads raw text without allowing a chunked request to grow memory without bound. */
export async function readBoundedText(
  req: Request | Response,
  maxBytes = 100_000,
  signal?: AbortSignal,
): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    void req.body?.cancel().catch(() => {});
    throw new HttpInputError(413, 'Request is too large.');
  }
  if (!req.body) return '';

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new HttpInputError(413, 'Request is too large.');
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel); cancel(); reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** JSON consumers share the same byte, stream and cancellation limits. */
export async function readBoundedJson(
  req: Request | Response,
  maxBytes = 100_000,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const text = await readBoundedText(req, maxBytes, signal);
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

// ── handler ──
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    return await withHttpDeadline(async signal => {
      const authorization = req.headers.get('Authorization');
      if (!authorization) return json({ error: 'Not authenticated.' }, 401);

      // Dynamic import keeps this module importable under node --test (the
      // npm: scheme is Deno-only); Deno caches the module after first load.
      const { createClient } = await import('npm:@supabase/supabase-js@2.112.4');
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization }, fetch: (i, init) => fetch(i, { ...init, signal }) },
          auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: auth, error: authError } = await userClient.auth.getUser();
      if (authError || !auth?.user) return json({ error: 'Not authenticated.' }, 401);

      // kind comes from ?kind= or the JSON body; the query param wins.
      const reqUrl = new URL(req.url);
      const qKind = reqUrl.searchParams.get('kind');
      let kind: unknown;
      let redirectToRaw: unknown;
      if (qKind !== null) {
        kind = qKind;
      } else {
        const body = await readBoundedJson(req, 4096, signal) as { kind?: unknown; redirect_to?: unknown };
        kind = body.kind;
        redirectToRaw = body.redirect_to;
      }
      if (!isConnectorKind(kind)) return json({ error: 'Unknown connector.' }, 400);

      const cfg = intuitConfig();
      if (!cfg) {
        return json({ error: 'QuickBooks connections are not available yet.', code: 'not_configured' }, 503);
      }

      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { global: { fetch: (i, init) => fetch(i, { ...init, signal }) },
          auth: { persistSession: false, autoRefreshToken: false } },
      );

      const { data: withinLimit, error: rateError } = await admin.rpc('consume_edge_rate_limit', {
        p_actor_key: `user:${auth.user.id}`, p_scope: 'intuit-oauth-start:minute', p_limit: 10, p_window_seconds: 60,
      });
      if (rateError) return json({ error: 'Connections are temporarily unavailable.' }, 503);
      if (withinLimit !== true) return json({ error: 'Too many attempts. Try again in a minute.' }, 429);

      // The org is resolved from the signed-in user, never taken from the
      // request body — otherwise anyone could start a connection against
      // someone else's club.
      const { data: provider, error: pErr } = await admin
        .from('providers').select('id, plan').eq('owner_id', auth.user.id).maybeSingle();
      if (pErr) return json({ error: 'Connections are temporarily unavailable.' }, 503);
      if (!provider) return json({ error: 'Set up your organization first.' }, 409);

      // Entitlements decide, never a plan name compared in code (invariant
      // I2). FAILS CLOSED: without a deployed plan_entitlements row this is a
      // 503, never accounting access with no paywall behind it.
      const { data: ent, error: entError } = await admin
        .from('plan_entitlements').select('connectors').eq('plan', provider.plan ?? 'free').maybeSingle();
      if (entError) {
        console.error('intuit-oauth-start: entitlements unavailable');
        return json({ error: 'Connections are not available yet.', code: 'entitlements_not_deployed' }, 503);
      }
      const allowed: string[] = Array.isArray(ent?.connectors) ? ent!.connectors : [];
      if (!allowed.includes(kind)) {
        // Invariant I3: a limit is a 402 with this exact payload, never a
        // silent no-op and never a 500.
        return json({
          error: 'Your plan does not include this connector.',
          reason: 'connector_not_in_plan',
          current_plan: provider.plan ?? 'free',
          upgrade_to: 'solo',
          limit: allowed.length,
          current: allowed.length,
        }, 402);
      }

      const state = crypto.randomUUID() + '.' + crypto.randomUUID();
      const redirectTo = typeof redirectToRaw === 'string' && redirectToRaw.startsWith('https://')
        ? redirectToRaw : null;
      const { error: sErr } = await admin.from('connector_oauth_state').insert({
        state, provider_id: provider.id, user_id: auth.user.id, kind, redirect_to: redirectTo,
      });
      if (sErr) return json({ error: 'Connections are temporarily unavailable.' }, 503);

      return json({ url: buildAuthorizeUrl(cfg, SCOPES_BY_KIND[kind], state) });
    }, 20000);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    console.error('intuit-oauth-start: unavailable');
    return json({ error: 'Connections are temporarily unavailable.' }, 503);
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(handler);
}
