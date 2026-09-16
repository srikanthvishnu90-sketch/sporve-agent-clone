// guardian-link — spec 13, slice 1. The API behind the one-tap RSVP page.
//   OPTIONS                                     CORS preflight for sporv.ai
//   GET  /functions/v1/guardian-link?t=<token>  the grant as JSON (never consumes)
//   POST /functions/v1/guardian-link            JSON { t, response[, member] } → records
//
// The PAGE lives at https://sporv.ai/r?t=<token> (rsvp.html): the Supabase
// gateway rewrites any HTML an edge function returns to text/plain under a
// sandboxing CSP, so a parent page cannot be served from this origin.
//
// No login, no account, no app. Everything that makes that safe is in the
// database: redeem_guardian_token / guardian_token_rsvp are SECURITY DEFINER
// RPCs that take the token as their only argument and return nothing (or
// raise) for an unknown, expired, revoked or consumed token — so this
// function never reads a table directly and a bug here cannot become a
// tenant-wide read.
//
// GET never consumes: messaging apps fetch pasted URLs to unfurl them, which
// would spend a single-use link before the parent taps. Redemption is
// rate-limited by client IP; a malformed token is a 404 before any lookup;
// a refused token is the same 404 as an unknown one — nothing to learn.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TOKEN_RE = /^[0-9a-f]{64}$/;
const ORIGIN = Deno.env.get('PARENT_ORIGIN') ?? 'https://sporv.ai';
const HDR = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept', 'Vary': 'Origin' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HDR });
const notFound = () => json({ error: 'not_found' }, 404);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HDR });
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  // A browser POST from any other origin is refused outright; the CORS header
  // only hides the reply, it does not stop a simple request from mutating.
  const origin = req.headers.get('origin');
  if (req.method === 'POST' && origin && origin !== ORIGIN) return json({ error: 'forbidden' }, 403);

  // Rate limit on an IP the gateway vouches for (Cloudflare's cf-connecting-ip,
  // else the LAST x-forwarded-for entry, which the proxy appended), never the
  // left-most entry a client can write. It fails CLOSED: if the limiter cannot
  // answer, nobody gets through.
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get('cf-connecting-ip') ?? xff[xff.length - 1] ?? 'unknown';
  const { data: allowed } = await admin.rpc('consume_edge_rate_limit', { p_actor_key: `ip:${ip}`, p_scope: 'guardian-link', p_limit: 60, p_window_seconds: 3600 });
  if (allowed !== true) return json({ error: 'rate_limited' }, 429);

  if (req.method === 'GET') {
    const t = new URL(req.url).searchParams.get('t') ?? '';
    if (!TOKEN_RE.test(t)) return notFound();
    const { data, error } = await admin.rpc('redeem_guardian_token', { p_token: t });
    if (error) return json({ error: 'unavailable' }, 503);
    const g = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!g) return notFound();
    // only what the page needs to ask the question — never ids, never the guardian's contact details
    return json({ scope: g.scope, subject_label: g.subject_label, subject_at: g.subject_at, subject_tz: g.subject_tz,
      guardian_first_name: g.guardian_first_name, single_use: g.single_use });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const t = String(body.t ?? ''); const response = String(body.response ?? '');
  if (!TOKEN_RE.test(t)) return notFound();
  if (!['yes', 'no', 'maybe'].includes(response)) return json({ error: 'bad_response' }, 400);
  const member = typeof body.member === 'string' && /^[0-9a-f-]{36}$/.test(body.member) ? body.member : null;
  // one link may change its answer, but not 60 times an hour — the key is a hash, the secret never lands in edge_rate_limits
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  const tokKey = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data: tokAllowed } = await admin.rpc('consume_edge_rate_limit', { p_actor_key: `tok:${tokKey}`, p_scope: 'guardian-rsvp', p_limit: 10, p_window_seconds: 3600 });
  if (tokAllowed !== true) return json({ error: 'rate_limited' }, 429);
  const { data, error } = await admin.rpc('guardian_token_rsvp', { p_token: t, p_response: response, p_member: member, p_note: null });
  if (error) {
    // 42501 from the RPC = not valid / wrong scope / no athlete on that team. Same answer for all: nothing to learn.
    if (/42501|not valid|cannot answer|none of your athletes/i.test(error.message ?? '')) return notFound();
    return json({ error: 'unavailable', saved: false }, 503);
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return json({ saved: true, response: r.response, members: r.members });
});
