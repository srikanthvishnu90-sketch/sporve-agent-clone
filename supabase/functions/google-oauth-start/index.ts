// Begins a Google connection. Returns the consent URL; connects nothing.
//
// The three things this function exists to get right:
//   1. It refuses honestly when no OAuth client is configured (503 with a
//      message the UI can print), instead of sending the user to a Google
//      error page.
//   2. It mints a one-time, expiring state row BEFORE redirecting, so the
//      callback can only ever complete a round trip this function started.
//   3. It asks for read + draft scopes and nothing more. assertNoSendScope
//      makes a send scope a runtime failure, not a review miss.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { HttpInputError, readBoundedJson, withHttpDeadline } from '../_shared/http.ts';
import { GOOGLE_SCOPES, authorizeUrl, googleConfig, isGoogleKind } from '../_shared/google-oauth.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    return await withHttpDeadline(async signal => {
      const authorization = req.headers.get('Authorization');
      if (!authorization) return json({ error: 'Not authenticated.' }, 401);

      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization }, fetch: (i, init) => fetch(i, { ...init, signal }) },
          auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: auth, error: authError } = await userClient.auth.getUser();
      if (authError || !auth?.user) return json({ error: 'Not authenticated.' }, 401);

      const body = await readBoundedJson(req, 4096, signal) as { kind?: unknown; redirect_to?: unknown };
      if (!isGoogleKind(body.kind)) return json({ error: 'Unknown connector.' }, 400);
      const kind = body.kind;

      const cfg = googleConfig();
      if (!cfg) {
        // Honest, not broken. The UI prints this rather than showing a tile
        // that pretends to work.
        return json({ error: 'Google connections are not available yet.', code: 'not_configured' }, 503);
      }

      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { global: { fetch: (i, init) => fetch(i, { ...init, signal }) },
          auth: { persistSession: false, autoRefreshToken: false } },
      );

      const { data: withinLimit, error: rateError } = await admin.rpc('consume_edge_rate_limit', {
        p_actor_key: `user:${auth.user.id}`, p_scope: 'google-oauth-start:minute', p_limit: 10, p_window_seconds: 60,
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
      // I2): the plan is only a key into the entitlements row.
      //
      // FAILS CLOSED ON PURPOSE. plan_entitlements.connectors does not exist
      // in production yet — it arrives with docs/red-drafts/2026-09-08-plan-
      // entitlements.sql. Until it does, this returns 503 rather than handing
      // out mailbox access with no paywall behind it. That is the whole
      // complaint about decorative enforcement, and it would be a strange
      // place to start making it true.
      const { data: ent, error: entError } = await admin
        .from('plan_entitlements').select('connectors').eq('plan', provider.plan ?? 'free').maybeSingle();
      if (entError) {
        console.error('google-oauth-start: entitlements unavailable');
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
      const redirectTo = typeof body.redirect_to === 'string' && body.redirect_to.startsWith('https://')
        ? body.redirect_to : null;
      const { error: sErr } = await admin.from('connector_oauth_state').insert({
        state, provider_id: provider.id, user_id: auth.user.id, kind, redirect_to: redirectTo,
      });
      if (sErr) return json({ error: 'Connections are temporarily unavailable.' }, 503);

      return json({ url: authorizeUrl(cfg, GOOGLE_SCOPES[kind], state, auth.user.email ?? undefined) });
    }, 20000);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    console.error('google-oauth-start: unavailable');
    return json({ error: 'Connections are temporarily unavailable.' }, 503);
  }
});
