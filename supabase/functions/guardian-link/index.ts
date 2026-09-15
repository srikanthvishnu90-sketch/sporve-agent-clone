// guardian-link — spec 13, slice 1. The page a parent lands on from a magic link.
//   GET  /functions/v1/guardian-link?t=<token>   renders (never consumes)
//   POST /functions/v1/guardian-link             form: t, response[, member, note]
//
// No login, no account, no app. Everything that makes that safe is in the
// database: redeem_guardian_token / guardian_token_rsvp are SECURITY DEFINER
// RPCs that take the token as their only argument and return nothing (or raise)
// for an unknown, expired, revoked or consumed token — so this function never
// reads a table directly and a bug here cannot become a tenant-wide read.
//
// GET never consumes: messaging apps fetch pasted URLs to unfurl them, which
// would spend a single-use link before the parent taps. Redemption is
// rate-limited by client IP; a malformed token is a 404 before any lookup.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TOKEN_RE = /^[0-9a-f]{64}$/;
const HDR = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(title)}</title>
<style>body{margin:0;background:#0B0D0F;color:#EDEFF2;font:16px/1.5 -apple-system,system-ui,sans-serif;padding:24px}main{max-width:480px;margin:0 auto}h1{font-size:20px;margin:0 0 6px}p{color:#B4BBC5;margin:0 0 18px}
form{display:grid;gap:10px}button{height:52px;border:1px solid #2A3037;border-radius:10px;background:#131519;color:#EDEFF2;font:inherit;font-size:17px;cursor:pointer}button.pri{background:#4F6A85;border-color:#4F6A85;color:#fff}small{color:#9BA3AD}
button:focus-visible{outline:3px solid #9DB0CB;outline-offset:3px}@media(prefers-reduced-motion:no-preference){button{transition:background .12s}}</style></head><body><main id="main">${body}</main></body></html>`,
  { status, headers: HDR });
const notFound = () => page('Link not found', '<h1>This link is no longer valid.</h1><p>It may have expired or already been used. Ask your club for a new one.</p>', 404);

function when(iso: unknown, tz: unknown): string {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: String(tz || 'America/Chicago'), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(String(iso))); }
  catch { return String(iso ?? ''); }
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const { data: allowed } = await admin.rpc('consume_edge_rate_limit', { p_actor_key: `ip:${ip}`, p_scope: 'guardian-link', p_limit: 60, p_window_seconds: 3600 });
  if (allowed === false) return page('Slow down', '<h1>Too many attempts.</h1><p>Try again in a little while.</p>', 429);

  if (req.method === 'GET') {
    const t = new URL(req.url).searchParams.get('t') ?? '';
    if (!TOKEN_RE.test(t)) return notFound();
    const { data, error } = await admin.rpc('redeem_guardian_token', { p_token: t });
    if (error) return page('Unavailable', '<h1>Something went wrong.</h1><p>Please try again.</p>', 503);
    const g = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!g) return notFound();
    if (g.scope !== 'rsvp') return page('Not yet', '<h1>This link is for something we do not handle yet.</h1>', 200);
    return page('Are you coming?', `<h1 id="q">${esc(g.subject_label)}</h1><p>${esc(when(g.subject_at, g.subject_tz))}${g.guardian_first_name ? ` · Hi ${esc(g.guardian_first_name)}` : ''}</p>
<form method="post" action="/functions/v1/guardian-link" aria-labelledby="q"><input type="hidden" name="t" value="${esc(t)}">
<button class="pri" name="response" value="yes">Yes, we'll be there</button>
<button name="response" value="no">No, can't make it</button>
<button name="response" value="maybe">Not sure yet</button></form><p><small>One tap. No app, no account.</small></p>`);
  }

  if (req.method === 'POST') {
    let form: FormData; try { form = await req.formData(); } catch { return page('Bad request', '<h1>That did not come through.</h1>', 400); }
    const t = String(form.get('t') ?? ''); const response = String(form.get('response') ?? '');
    if (!TOKEN_RE.test(t)) return notFound();
    if (!['yes', 'no', 'maybe'].includes(response)) return page('Bad request', '<h1>Pick yes, no or not sure.</h1>', 400);
    const member = form.get('member') ? String(form.get('member')) : null;
    const { data, error } = await admin.rpc('guardian_token_rsvp', { p_token: t, p_response: response, p_member: member, p_note: null });
    if (error) {
      // 42501 from the RPC = not valid / wrong scope / no athlete on that team. Same answer for all: nothing to learn.
      if (/42501|not valid|cannot answer|none of your athletes/i.test(error.message ?? '')) return notFound();
      return page('Unavailable', '<h1>Something went wrong.</h1><p>Your answer was not saved. Please try again.</p>', 503);
    }
    const r = (data ?? {}) as Record<string, unknown>;
    const word = response === 'yes' ? 'See you there.' : response === 'no' ? 'Got it — marked as not coming.' : 'Noted — we will check back closer to the day.';
    return page('Thanks', `<h1>${esc(word)}</h1><p>${esc(String(r.response))} recorded for ${esc(String((r.members as unknown[] | undefined)?.length ?? 1))} athlete(s).</p><p><small>You can change this from the same link until the event starts.</small></p>`);
  }
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
});
