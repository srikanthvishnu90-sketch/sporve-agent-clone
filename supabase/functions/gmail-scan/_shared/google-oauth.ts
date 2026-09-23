/**
 * Google OAuth — the parts that talk to the network. The rules about scopes
 * and the consent URL live in google-scopes.mjs so `node --test` can hold
 * them to account in CI without a Deno runtime.
 */
export {
  assertNoSendScope,
  authorizeUrl,
  FORBIDDEN_SCOPES,
  GOOGLE_SCOPES,
  grantedScopes,
  hasRequiredRead,
  isGoogleKind,
  writeModeFor,
} from './google-scopes.mjs';
export type { GoogleKind } from './google-scopes.mjs';
export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * Reads the client from the environment. Returns null rather than throwing so
 * every caller can answer "not configured" honestly instead of 500-ing — the
 * difference between a tile that says "Not yet" and a tile that says "Connect"
 * and then breaks when someone clicks it.
 */
export function googleConfig(): GoogleConfig | null {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  const base = Deno.env.get('SUPABASE_URL');
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/functions/v1/google-oauth-callback` };
}

export type TokenResponse = {
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal,
  });
  // Google's error body can echo the request, including the code. Never
  // include it in a thrown message or a log line.
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return await res.json() as TokenResponse;
}

/** Which mailbox or calendar this actually is, for the "Connected as" line. */
export async function whoAmI(accessToken: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!res.ok) return null;
    const body = await res.json() as { email?: string };
    return body.email ?? null;
  } catch {
    return null;
  }
}
