// Completes a QuickBooks (Intuit) connection. Intuit redirects the customer's
// BROWSER here, so this is a GET that ends in a redirect, not a JSON API.
//
// SELF-CONTAINED: `sb.py deploy` uploads only this directory, so every helper
// this function needs is inlined below (the scope table from
// supabase/functions/_shared/connector-registry.mjs).
//
// It is the only unauthenticated function in the connector path, which is why
// the state is doing all the work: the state row was minted by
// intuit-oauth-start for one signed-in user, it is single-use, and it expires
// in ten minutes. Without a matching state this function does nothing at all —
// it never trusts a code, an org id, or a redirect target from the query string.
//
// Intuit appends `realmId` (the QuickBooks company id) to the callback query
// string. It is REQUIRED for every QuickBooks API call and is captured here,
// persisted to org_connectors.external_id (external_account stays the
// "Connected as" display; scopes is a text[]).

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

/** The read scope each kind must still hold after the consent screen. */
export function hasRequiredRead(kind: string, granted: string[] | undefined): boolean {
  const scopes = SCOPES_BY_KIND[kind];
  return !!scopes && (granted || []).includes(scopes[0]);
}

/**
 * Intuit returns the scopes it actually granted. Storing the granted set
 * keeps the product from claiming a capability the token does not have.
 */
export function grantedScopes(
  token: { scope?: string } | null | undefined, requested: string[],
): string[] {
  const granted = String((token && token.scope) || '').split(/\s+/).filter(Boolean);
  return granted.length ? granted : requested;
}

export type IntuitConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function intuitConfig(): IntuitConfig | null {
  const clientId = Deno.env.get('INTUIT_CLIENT_ID');
  const clientSecret = Deno.env.get('INTUIT_CLIENT_SECRET');
  const base = Deno.env.get('SUPABASE_URL');
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/functions/v1/intuit-oauth-callback` };
}

export type TokenResponse = {
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeCode(cfg: IntuitConfig, code: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Intuit authenticates the client with a Basic header, not form fields.
      Authorization: 'Basic ' + btoa(`${cfg.clientId}:${cfg.clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
    }),
  });
  // Intuit's error body can echo the request, including the code. Never
  // include it in a thrown message or a log line.
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return await res.json() as TokenResponse;
}

/** The realmId Intuit sends on the callback; required for every API call. */
export function realmIdFromQuery(url: URL): string | null {
  const r = url.searchParams.get('realmId');
  return r && r.length > 0 ? r : null;
}

function siteUrl(): string {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  return deno?.env.get('SPORV_SITE_URL') ?? 'https://sporv.ai';
}

/** The URL every outcome lands on, so the shape is unit-testable. */
export function connectorRedirectUrl(
  kind: string, status: 'connected' | 'failed', reason?: string,
): string {
  const u = new URL('/', siteUrl());
  u.searchParams.set('connector', kind);
  u.searchParams.set('status', status);
  if (reason) u.searchParams.set('reason', reason);
  u.hash = 'settings-connectors';
  return u.toString();
}

/** Always lands the customer back in the product, never on a JSON blob. */
function back(status: 'connected' | 'failed', kind: string, reason?: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: connectorRedirectUrl(kind, status, reason), 'Cache-Control': 'no-store' },
  });
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed.', { status: 405 });

  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const denied = url.searchParams.get('error');

  const cfg = intuitConfig();
  if (!cfg) return back('failed', 'quickbooks', 'not_configured');

  // Dynamic import keeps this module importable under node --test (the npm:
  // scheme is Deno-only); Deno caches the module after first load.
  const { createClient } = await import('npm:@supabase/supabase-js@2.112.4');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Claim first, even when Intuit reported an error, so a cancelled consent
  // screen cannot leave a live state behind for someone else to replay.
  const { data: claimed, error: claimError } = await admin
    .rpc('connector_claim_oauth_state', { p_state: state });
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (claimError || !row) return back('failed', 'quickbooks', 'expired');
  const rawKind: unknown = row.kind;
  if (!isConnectorKind(rawKind)) return back('failed', 'quickbooks', 'unknown_connector');
  const kind = rawKind;

  if (denied || !code) return back('failed', kind, denied === 'access_denied' ? 'cancelled' : 'no_code');

  // The QuickBooks company id. Without it the token is useless — every QBO
  // API call addresses a company — so its absence is a hard failure, not
  // something to connect around.
  const realmId = realmIdFromQuery(url);
  if (!realmId) return back('failed', kind, 'no_realm');

  try {
    const token = await exchangeCode(cfg, code);
    const granted = grantedScopes(token, SCOPES_BY_KIND[kind]);
    assertNoSendScope(granted);

    if (!hasRequiredRead(kind, granted)) return back('failed', kind, 'missing_scope');

    // No refresh token means the connection dies the moment the access token
    // expires. Refusing here is what stops a tile from going green and then
    // quietly breaking in an hour.
    if (!token.refresh_token) return back('failed', kind, 'no_refresh_token');

    // The realmId is persisted to org_connectors.external_id alongside the
    // upsert — it is required for every QuickBooks API call, and
    // external_account stays the "Connected as" display.

    const { data: connector, error: upsertError } = await admin
      .from('org_connectors')
      .upsert({
        provider_id: row.provider_id, kind, status: 'connected', write_mode: writeModeFor(kind),
        external_account: null, external_id: realmId, scopes: granted, connected_by: row.user_id,
        connected_at: new Date().toISOString(), revoked_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_id,kind' })
      .select('id').single();
    if (upsertError || !connector) {
      console.error('intuit-oauth-callback: could not record the connection');
      return back('failed', kind, 'not_recorded');
    }

    // The refresh token goes to Vault through the service-role-only wrapper.
    // It is never written to org_connectors, never logged, and never returned.
    const { error: secretError } = await admin
      .rpc('connector_store_secret', { p_connector: connector.id, p_secret: token.refresh_token });
    if (secretError) {
      // A connector we cannot read a token for is not connected. Say so
      // rather than leaving a green tile with nothing behind it.
      await admin.from('org_connectors')
        .update({ status: 'error', updated_at: new Date().toISOString() }).eq('id', connector.id);
      console.error('intuit-oauth-callback: could not store the token');
      return back('failed', kind, 'not_stored');
    }

    await admin.from('connector_sync_state').upsert({
      connector_id: connector.id, provider_id: row.provider_id,
      last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'connector_id' });

    return back('connected', kind);
  } catch (_error) {
    // Intuit's error bodies can echo the request, including the code. Never
    // log or forward one.
    console.error('intuit-oauth-callback: exchange failed');
    return back('failed', kind, 'exchange_failed');
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(handler);
}
