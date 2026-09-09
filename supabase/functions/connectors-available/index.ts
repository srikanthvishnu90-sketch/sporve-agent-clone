// What this deployment can actually connect, and what this org has connected.
//
// This exists so the connector tiles stop being a hardcoded list. A tile
// showing "Connect" when no OAuth client is configured is a lie the customer
// discovers by clicking it; a tile showing "Not yet" after the owner wires
// Google up is a lie in the other direction. Both are fixed by asking the
// server, which is the only thing that knows.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { HttpInputError, withHttpDeadline } from '../_shared/http.ts';
import { googleConfig } from '../_shared/google-oauth.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** Kinds this build knows how to connect at all, ignoring configuration. */
const IMPLEMENTED = ['stripe', 'website', 'file_import', 'gmail', 'google_calendar'] as const;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    return await withHttpDeadline(async signal => {
      const google = googleConfig() !== null;
      // Stripe, website extraction and file import need no per-deployment
      // OAuth client; they are available wherever this function runs.
      const available = IMPLEMENTED.filter(k =>
        (k === 'gmail' || k === 'google_calendar') ? google : true);

      const authorization = req.headers.get('Authorization');
      if (!authorization) return json({ available, connected: [] });

      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization }, fetch: (i, init) => fetch(i, { ...init, signal }) },
          auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: auth } = await userClient.auth.getUser();
      if (!auth?.user) return json({ available, connected: [] });

      // Read as the customer, not as service_role: RLS on org_connectors is
      // then doing the org scoping, and a bug here cannot leak another club's
      // connections. The secret never appears in this table anyway.
      const { data: rows, error } = await userClient
        .from('org_connectors')
        .select('kind, status, write_mode, external_account, connected_at')
        .eq('status', 'connected');
      if (error) {
        // The tables may not be applied yet. An honest empty answer beats a
        // 500 that makes the whole settings page look broken.
        return json({ available, connected: [], note: 'connector records unavailable' });
      }
      return json({ available, connected: rows ?? [] });
    }, 10000);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    console.error('connectors-available: unavailable');
    return json({ error: 'Connector status is temporarily unavailable.' }, 503);
  }
});
