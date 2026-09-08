// Draft-only public-site extraction. No message/payment APIs or service key.
// Deploy ONLY after consume_club_extract_rate_limit() in the reviewed launch
// security SQL: missing quota infrastructure fails closed with 503.
import { createClient } from "npm:@supabase/supabase-js@2";
import { boundedText, extractClubDraft, ExtractionError, LIMITS, withDeadline } from './safety.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    ...(status === 429 ? {'Retry-After': '60'} : {})},
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(auth)) return json({error: 'Sign in to read a website.'}, 401);
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_ANON_KEY');
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!url || !key || !apiKey) return json({error: 'Extraction unavailable right now.'}, 503);
    const client = createClient(url, key, {global: {headers: {Authorization: auth}},
      auth: {persistSession: false, autoRefreshToken: false}});
    const {data, error} = await withDeadline(() => client.auth.getUser(), 8000);
    if (error || !data.user) return json({error: 'Not authenticated.'}, 401);

    let input: Record<string, unknown>;
    const raw = await withDeadline(signal => boundedText(req, LIMITS.requestBytes, signal), 5000);
    try {
      input = JSON.parse(raw);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('not an object');
    } catch { return json({error: 'Send a JSON object containing a URL or pasted text.'}, 400); }

    // Fixed actor and limits live in a narrow RPC, not in caller-supplied arguments.
    const quota = await withDeadline(async () => await client.rpc('consume_club_extract_rate_limit'), 5000);
    if (quota.error || typeof quota.data !== 'boolean') return json({error: 'Extraction limit service unavailable. Try again later.'}, 503);
    if (!quota.data) return json({error: 'Too many extractions. Wait a minute and try again.'}, 429);

    return json(await extractClubDraft(input, {fetch, apiKey,
      // JS renderer for app-shell pages: Jina Reader fetches the (already
      // screened, public) URL with a real browser and returns plain text.
      // Optional JINA_API_KEY raises its rate limit; without it the free tier is used.
      render: async (pageUrl, signal) => {
        const jinaKey = Deno.env.get('JINA_API_KEY');
        const r = await fetch('https://r.jina.ai/' + pageUrl, {redirect: 'error', credentials: 'omit', signal,
          headers: {'Accept': 'text/plain', 'X-Return-Format': 'text', 'X-Timeout': '8',
            ...(jinaKey ? {Authorization: 'Bearer ' + jinaKey} : {})}});
        if (!r.ok) { void r.body?.cancel().catch(() => {}); return null; }
        return await boundedText(r, LIMITS.pageBytes, signal);
      },
      resolveHost: async hostname => {
        const results = await Promise.allSettled([
          Deno.resolveDns(hostname, 'A'), Deno.resolveDns(hostname, 'AAAA'),
        ]);
        for (const result of results) {
          if (result.status === 'rejected' && !(result.reason instanceof Deno.errors.NotFound)) {
            throw new ExtractionError(422, 'Could not resolve the website safely. Try again or paste its text.');
          }
        }
        return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      },
    }));
  } catch (error) {
    // Never log pasted source, auth headers, model output or credentials.
    if (error instanceof ExtractionError) return json({error: error.message}, error.status);
    console.error('club-site-extract failed', error instanceof Error ? error.name : 'unknown');
    return json({error: 'Could not read that site. Try again or paste its text.'}, 502);
  }
});
