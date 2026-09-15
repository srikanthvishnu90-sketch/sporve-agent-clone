// calendar-feed — spec 12.5. Serves a per-guardian ICS feed at
//   GET /functions/v1/calendar-feed?t=<token>
//
// Reachable WITHOUT login on purpose (parents subscribe from Google/Apple
// Calendar), so the token in the URL is the credential. Everything that makes
// that safe lives in the database, not here:
//   * calendar_feed_events(token) is the ONLY read path (service_role EXECUTE);
//     it returns zero rows for an unknown or revoked token → this answers 404,
//     never stale data.
//   * SUMMARY is team + title. No athlete name reaches any VEVENT field.
//   * UID = event.id (stable), SEQUENCE bumps on change, STATUS:CANCELLED on
//     cancellation — subscribed calendars converge on their next poll.
// No writes except last_used_at, which the RPC stamps itself.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TOKEN_RE = /^[0-9a-f]{64}$/;
const headers = { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function esc(s: unknown): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function dt(iso: string): string { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function fold(line: string): string {          // RFC 5545 §3.1: 75-octet lines, CRLF + space continuation
  const out: string[] = []; let s = line;
  while (new TextEncoder().encode(s).length > 75) { let i = 74; while (new TextEncoder().encode(s.slice(0, i)).length > 75) i--; out.push(s.slice(0, i)); s = ' ' + s.slice(i); }
  out.push(s); return out.join('\r\n');
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!TOKEN_RE.test(token)) return new Response('Not found', { status: 404 });   // no enumeration hints

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc('calendar_feed_events', { p_token: token });
  if (error) return new Response('Feed unavailable', { status: 503 });
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return new Response('Not found', { status: 404 });      // unknown OR revoked: identical

  const cal = String(rows[0].calname ?? 'Sporv');
  const now = dt(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sporv//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(cal)}`, 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const r of rows) {
    lines.push('BEGIN:VEVENT', `UID:${r.uid}@sporv.ai`, `DTSTAMP:${now}`, `SEQUENCE:${Number(r.sequence ?? 0)}`,
      `STATUS:${r.status}`, `DTSTART:${dt(String(r.starts_at))}`, `DTEND:${dt(String(r.ends_at))}`,
      `SUMMARY:${esc(r.summary)}`);
    if (r.location) lines.push(`LOCATION:${esc(r.location)}`);
    if (r.description) lines.push(`DESCRIPTION:${esc(r.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', { status: 200, headers });
});
