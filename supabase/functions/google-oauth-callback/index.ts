// Completes a Google connection. Google redirects the customer's BROWSER here,
// so this is a GET that ends in a redirect, not a JSON API.
//
// It is the only unauthenticated function in the connector path, which is why
// the state is doing all the work: the state row was minted by
// google-oauth-start for one signed-in user, it is single-use, and it expires
// in ten minutes. Without a matching state this function does nothing at all —
// it never trusts a code, an org id, or a redirect target from the query string.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import {
  GOOGLE_SCOPES, exchangeCode, googleConfig, grantedScopes, hasRequiredRead, isGoogleKind,
  whoAmI, writeModeFor,
} from '../_shared/google-oauth.ts';

const SITE = Deno.env.get('SPORV_SITE_URL') ?? 'https://sporv.ai';

/** Always lands the customer back in the product, never on a JSON blob. */
function back(status: 'connected' | 'failed', kind: string, reason?: string): Response {
  const u = new URL('/', SITE);
  u.searchParams.set('connector', kind);
  u.searchParams.set('status', status);
  if (reason) u.searchParams.set('reason', reason);
  u.hash = 'settings-connectors';
  return new Response(null, { status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
}

Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('Method not allowed.', { status: 405 });

  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const denied = url.searchParams.get('error');

  const cfg = googleConfig();
  if (!cfg) return back('failed', 'google', 'not_configured');

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Claim first, even when Google reported an error, so a cancelled consent
  // screen cannot leave a live state behind for someone else to replay.
  const { data: claimed, error: claimError } = await admin
    .rpc('connector_claim_oauth_state', { p_state: state });
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (claimError || !row) return back('failed', 'google', 'expired');
  // Narrow through a local: the RPC's row is untyped, and reading .kind twice
  // would leave `kind` as any, which is how a scope lookup silently accepts
  // something that is not a Google connector at all.
  const rawKind: unknown = row.kind;
  if (!isGoogleKind(rawKind)) return back('failed', 'google', 'unknown_connector');
  const kind = rawKind;

  // access_denied is the customer clicking Cancel. Not an error worth a
  // stack trace, and the tile must stay honestly disconnected.
  if (denied || !code) return back('failed', kind, denied === 'access_denied' ? 'cancelled' : 'no_code');

  try {
    const token = await exchangeCode(cfg, code);
    const granted = grantedScopes(token, GOOGLE_SCOPES[kind]);

    // A consent screen lets someone untick a scope. A connector without its
    // read scope would sit there saying Connected and produce nothing, which
    // is worse than refusing.
    if (!hasRequiredRead(kind, granted)) return back('failed', kind, 'missing_scope');

    // No refresh token means the connection dies the moment the access token
    // expires. Refusing here is what stops a tile from going green and then
    // quietly breaking in an hour.
    if (!token.refresh_token) return back('failed', kind, 'no_refresh_token');

    const account = token.access_token ? await whoAmI(token.access_token) : null;

    // gmail drafts, calendar applies an approved change. Neither can send:
    // the database check constraint refuses 'apply' for gmail regardless of
    // what this code asks for, and writeModeFor is unit-tested.
    const writeMode = writeModeFor(kind);

    const { data: connector, error: upsertError } = await admin
      .from('org_connectors')
      .upsert({
        provider_id: row.provider_id, kind, status: 'connected', write_mode: writeMode,
        external_account: account, scopes: granted, connected_by: row.user_id,
        connected_at: new Date().toISOString(), revoked_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_id,kind' })
      .select('id').single();
    if (upsertError || !connector) {
      console.error('google-oauth-callback: could not record the connection');
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
      console.error('google-oauth-callback: could not store the token');
      return back('failed', kind, 'not_stored');
    }

    await admin.from('connector_sync_state').upsert({
      connector_id: connector.id, provider_id: row.provider_id,
      last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'connector_id' });

    return back('connected', kind);
  } catch (_error) {
    // Google's error bodies can echo the request, including the code. Never
    // log or forward one.
    console.error('google-oauth-callback: exchange failed');
    return back('failed', kind, 'exchange_failed');
  }
});
