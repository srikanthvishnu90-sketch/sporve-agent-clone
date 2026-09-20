// Completes a Microsoft 365 connection. Microsoft redirects the customer's
// BROWSER here, so this is a GET that ends in a redirect, not a JSON API.
//
// SELF-CONTAINED: `sb.py deploy` uploads only this directory, so every helper
// this function needs is inlined below (the scope table from
// supabase/functions/_shared/connector-registry.mjs).
//
// It is the only unauthenticated function in the connector path, which is why
// the state is doing all the work: the state row was minted by
// microsoft-oauth-start for one signed-in user, it is single-use, and it
// expires in ten minutes. Without a matching state this function does nothing
// at all — it never trusts a code, an org id, or a redirect target from the
// query string.

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

/** The single Microsoft connector. Scopes from CONNECTORS.microsoft365. */
export const SCOPES_BY_KIND: Record<string, string[]> = {
  microsoft365: ['offline_access', 'Mail.Read', 'Calendars.ReadWrite', 'User.Read'],
};

/**
 * 'apply' from the registry: we may change a calendar the human approved. We
 * hold Mail.Read only — we never request a send-capable or read-write mail
 * scope and we never use a send endpoint. The org_connectors_no_send check
 * constraint permits 'apply' for microsoft365 (reconciled 2026-09-20):
 * the no-send invariant is enforced at the OAuth layer by
 * assertNoSendScope() below, which rejects any grant containing a
 * send-capable mail scope.
 */
export const WRITE_MODE_BY_KIND: Record<string, string> = {
  microsoft365: 'apply',
};

export function writeModeFor(kind: string): string {
  return WRITE_MODE_BY_KIND[kind] ?? 'none';
}

export function isConnectorKind(v: unknown): v is string {
  return v === 'microsoft365';
}

/**
 * The read scope that justifies the connector. scopes[0] in the registry list
 * is offline_access (a token-refresh scope, not a read), so the meaningful
 * read is Mail.Read — the same position the Google kinds' scopes[0] holds.
 */
export function requiredReadScope(kind: string): string {
  if (kind === 'microsoft365') return 'Mail.Read';
  return '';
}

export function hasRequiredRead(kind: string, granted: string[] | undefined): boolean {
  const required = requiredReadScope(kind);
  return !!required && (granted || []).includes(required);
}

/**
 * Microsoft returns the scopes it actually granted, which can be fewer than
 * the ones asked for. Storing the granted set keeps the product from claiming
 * a capability the token does not have.
 */
export function grantedScopes(
  token: { scope?: string } | null | undefined, requested: string[],
): string[] {
  const granted = String((token && token.scope) || '').split(/\s+/).filter(Boolean);
  return granted.length ? granted : requested;
}

export type MicrosoftConfig = {
  clientId: string; clientSecret: string; redirectUri: string; tenant: string;
};

export function microsoftConfig(): MicrosoftConfig | null {
  const clientId = Deno.env.get('MS_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_OAUTH_CLIENT_SECRET');
  const base = Deno.env.get('SUPABASE_URL');
  if (!clientId || !clientSecret || !base) return null;
  const tenant = Deno.env.get('MS_OAUTH_TENANT') ?? 'common';
  return { clientId, clientSecret, redirectUri: `${base}/functions/v1/microsoft-oauth-callback`, tenant };
}

export function tokenEndpoint(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

export type TokenResponse = {
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeCode(cfg: MicrosoftConfig, code: string): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint(cfg.tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  // Microsoft's error body can echo the request, including the code. Never
  // include it in a thrown message or a log line.
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return await res.json() as TokenResponse;
}

/** Who this Microsoft account is, for the "Connected as" line. */
export async function whoAmI(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const body = await res.json() as { userPrincipalName?: string; mail?: string };
    return body.mail ?? body.userPrincipalName ?? null;
  } catch {
    return null;
  }
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

  const cfg = microsoftConfig();
  if (!cfg) return back('failed', 'microsoft365', 'not_configured');

  // Dynamic import keeps this module importable under node --test (the npm:
  // scheme is Deno-only); Deno caches the module after first load.
  const { createClient } = await import('npm:@supabase/supabase-js@2.112.4');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Claim first, even when Microsoft reported an error, so a cancelled
  // consent screen cannot leave a live state behind for someone else to replay.
  const { data: claimed, error: claimError } = await admin
    .rpc('connector_claim_oauth_state', { p_state: state });
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (claimError || !row) return back('failed', 'microsoft365', 'expired');
  const rawKind: unknown = row.kind;
  if (!isConnectorKind(rawKind)) return back('failed', 'microsoft365', 'unknown_connector');
  const kind = rawKind;

  // access_denied is the customer clicking Cancel. Not an error worth a
  // stack trace, and the tile must stay honestly disconnected.
  if (denied || !code) return back('failed', kind, denied === 'access_denied' ? 'cancelled' : 'no_code');

  try {
    const token = await exchangeCode(cfg, code);
    const granted = grantedScopes(token, SCOPES_BY_KIND[kind]);
    assertNoSendScope(granted);

    // A consent screen lets someone untick a scope. Without Mail.Read the
    // connector would sit there saying Connected and produce nothing, which
    // is worse than refusing.
    if (!hasRequiredRead(kind, granted)) return back('failed', kind, 'missing_scope');

    // No refresh token means the connection dies the moment the access token
    // expires. Refusing here is what stops a tile from going green and then
    // quietly breaking in an hour.
    if (!token.refresh_token) return back('failed', kind, 'no_refresh_token');

    const account = token.access_token ? await whoAmI(token.access_token) : null;

    const { data: connector, error: upsertError } = await admin
      .from('org_connectors')
      .upsert({
        provider_id: row.provider_id, kind, status: 'connected', write_mode: writeModeFor(kind),
        external_account: account, scopes: granted, connected_by: row.user_id,
        connected_at: new Date().toISOString(), revoked_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_id,kind' })
      .select('id').single();
    if (upsertError || !connector) {
      console.error('microsoft-oauth-callback: could not record the connection');
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
      console.error('microsoft-oauth-callback: could not store the token');
      return back('failed', kind, 'not_stored');
    }

    await admin.from('connector_sync_state').upsert({
      connector_id: connector.id, provider_id: row.provider_id,
      last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'connector_id' });

    return back('connected', kind);
  } catch (_error) {
    // Microsoft's error bodies can echo the request, including the code.
    // Never log or forward one.
    console.error('microsoft-oauth-callback: exchange failed');
    return back('failed', kind, 'exchange_failed');
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(handler);
}
