// An in-memory stand-in for the Supabase project, mounted on a Playwright page
// with page.route(). It answers auth, PostgREST, RPC and function calls the
// SPA makes during signup, setup and a cold start — just enough shape for the
// app to believe it, and every write is recorded so a test can assert what
// the product actually persisted. Nothing here talks to the network.
export const UID = 'a0000000-0000-4000-8000-00000000000a';
export const PID = '0a000000-0000-4000-8000-000000000001';
export const SUPABASE = 'https://tseszaprvtvqrkfpditu.supabase.co';

export function freshDb({ onboarded = false, name = 'Your organization' } = {}) {
  return {
    profiles: [{ id: UID, role: 'provider', email: 'coach@example.com', first_name: null, last_name: null, phone_number: null, created_at: '2026-09-01T00:00:00Z' }],
    providers: [{ id: PID, owner_id: UID, business_name: name, bio: null, sports: [], location: null, provider_type: null, status: 'pending',
      verification_status: 'unverified', background_check_status: 'none', background_check_completed_at: null, onboarding_completed: onboarded,
      stripe_onboarding_started: false, stripe_charges_enabled: false, plan: 'free', plan_status: 'active', plan_period_end: null,
      coach_years_coaching: null, coach_years_played: null, credentials: null, avatar_url: null, logo_url: null }],
    provider_settings: [], team_athletes: [], guardians: [], guardian_links: [], org_connectors: [], import_batches: [],
    obligations: [], agent_findings: [], lifecycle_message_prefs: [], outbound_messages: [], teams: [], programs: [], sessions: [],
    bookings: [], athletes: [], reviews: [], staff_certifications: [], organization_members: [], plan_entitlements: [{ plan: 'free' }, { plan: 'pro' }],
    event: [], event_series: [], venue: [], seasons: [], notifications: [], coach_agent_turns: [], installments: [], fee_schedules: [],
  };
}

export function session() {
  return { access_token: 'tok.' + 'a'.repeat(40), refresh_token: 'ref.' + 'b'.repeat(20), expires_at: Date.now() + 3600_000, user: { id: UID, email: 'coach@example.com' } };
}

let seq = 0;
const uuid = () => `${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-${Date.now().toString(16).slice(-12).padStart(12, '0')}`;

function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'limit', 'order', 'on_conflict', 'offset'].includes(k)) continue;
    const m = /^(eq|neq|is|in|gte|lte|gt|lt|like|ilike|not\.is)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    out = out.filter((r) => {
      const x = r[k];
      if (op === 'eq') return String(x) === raw;
      if (op === 'neq') return String(x) !== raw;
      if (op === 'is') return raw === 'null' ? x == null : String(x) === raw;
      if (op === 'not.is') return raw === 'null' ? x != null : String(x) !== raw;
      if (op === 'in') return raw.replace(/^\(|\)$/g, '').split(',').includes(String(x));
      if (op === 'like' || op === 'ilike') return new RegExp('^' + raw.replace(/%/g, '.*') + '$', op === 'ilike' ? 'i' : '').test(String(x ?? ''));
      return true;
    });
  }
  const lim = params.get('limit'); if (lim) out = out.slice(0, Number(lim));
  return out;
}

/* Mount on a page. Returns { db, log } — log is every write, in order. */
export async function mount(page, db) {
  const log = [];
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname; const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    // ── auth ──
    if (path.startsWith('/auth/v1/')) {
      if (path.endsWith('/settings')) return json({ external: { google: true, apple: true, email: true } });
      if (path.endsWith('/otp')) { log.push({ kind: 'otp', email: body?.email }); return json({}); }
      if (path.endsWith('/verify')) { log.push({ kind: 'verify', token: body?.token }); return body?.token === '123456' ? json({ access_token: 'tok.' + 'a'.repeat(40), refresh_token: 'ref.' + 'b'.repeat(20), expires_in: 3600, user: { id: UID, email: 'coach@example.com' } }) : json({ msg: 'Token has expired or is invalid' }, 403); }
      if (path.endsWith('/token')) return json({ access_token: 'tok.' + 'c'.repeat(40), refresh_token: 'ref.' + 'd'.repeat(20), expires_in: 3600, user: { id: UID, email: 'coach@example.com' } });
      if (path.endsWith('/logout')) return json({});
      return json({}, 404);
    }
    // ── rpc ──
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(); log.push({ kind: 'rpc', fn, args: body });
      const answers = { consume_edge_rate_limit: true, run_agent_read: 0, run_agent_drafts: { total: 0, dues: 0, waivers: 0, practice: 0, reactivation: 0, eligibility: 0 },
        create_member_fee_schedule: null, approve_obligation_and_queue: null, agent_autodraft_on: true, reject_unintended_signup: null };
      return json(fn in answers ? answers[fn] : null);
    }
    // ── functions ──
    if (path.startsWith('/functions/v1/')) { const fn = path.split('/')[3]; log.push({ kind: 'fn', fn, body }); return json(fn === 'google-oauth-start' ? { url: 'javascript:void(0)' /* a real URL would navigate the test page away; the SPA hands off to it exactly as it would to Google */ } : {}); }
    // ── rest ──
    if (path.startsWith('/rest/v1/')) {
      const table = path.split('/')[3]; const params = url.searchParams; const prefer = req.headers()['prefer'] || '';
      if (!(table in db)) { db[table] = []; }
      const rows = db[table];
      if (method === 'GET') return json(filterRows(rows, params));
      if (method === 'POST') {
        const items = Array.isArray(body) ? body : [body];
        const out = [];
        for (const it of items) {
          // column defaults the live schema applies (the SPA relies on them)
          const defaults = table === 'team_athletes' ? { status: 'active' } : table === 'guardians' ? { email_status: 'ok' } : {};
          const row = { id: uuid(), created_at: new Date().toISOString(), ...defaults, ...it };
          const conflictKeys = (params.get('on_conflict') || (table === 'provider_settings' ? 'provider_id,key' : '')).split(',').filter(Boolean);
          if (conflictKeys.length && /merge-duplicates|ignore-duplicates/.test(prefer)) {
            const i = rows.findIndex((r) => conflictKeys.every((k) => String(r[k]) === String(it[k])));
            if (i >= 0) { if (/merge-duplicates/.test(prefer)) rows[i] = { ...rows[i], ...it }; out.push(rows[i]); continue; }
          }
          rows.push(row); out.push(row);
        }
        log.push({ kind: 'insert', table, rows: out });
        return json(/return=representation/.test(prefer) ? out : null, 201);
      }
      if (method === 'PATCH') {
        const hit = filterRows(rows, params); hit.forEach((r) => Object.assign(r, body));
        log.push({ kind: 'update', table, patch: body, n: hit.length });
        return /return=representation/.test(prefer) ? json(hit) : route.fulfill({ status: 204 });
      }
      if (method === 'DELETE') { const hit = filterRows(rows, params); db[table] = rows.filter((r) => !hit.includes(r)); log.push({ kind: 'delete', table, n: hit.length }); return route.fulfill({ status: 204 }); }
    }
    return json({ message: 'unhandled ' + method + ' ' + path }, 404);
  });
  // the OAuth / Google endpoints must never be reached for real
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>oauth-stub</title>' }));
  return { db, log };
}
