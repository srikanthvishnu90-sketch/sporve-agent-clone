// An in-memory stand-in for the Supabase project, mounted on a Playwright page
// with page.route(). It answers auth, PostgREST, RPC and function calls the
// SPA makes during signup, setup and a cold start — just enough shape for the
// app to believe it, and every write is recorded so a test can assert what
// the product actually persisted. Nothing here talks to the network.
export const UID = 'a0000000-0000-4000-8000-00000000000a';
export const PID = '0a000000-0000-4000-8000-000000000001';
export const SUPABASE = 'https://aveqjeafghmwafkbbnor.supabase.co';

export function freshDb({ onboarded = false, name = 'Your organization' } = {}) {
  return {
    profiles: [{ id: UID, role: 'provider', email: 'coach@example.com', first_name: null, last_name: null, phone_number: null, created_at: '2026-09-01T00:00:00Z' }],
    providers: [{ id: PID, owner_id: UID, business_name: name, bio: null, sports: [], location: null, provider_type: null, status: 'pending',
      verification_status: 'unverified', background_check_status: 'none', background_check_completed_at: null, onboarding_completed: onboarded,
      stripe_onboarding_started: false, stripe_charges_enabled: false, plan: 'free', plan_status: 'active', plan_period_end: null,
      coach_years_coaching: null, coach_years_played: null, credentials: null, avatar_url: null, logo_url: null }],
    provider_settings: [], team_athletes: [], guardians: [], guardian_links: [], org_connectors: [], import_batches: [],
    obligations: [], installments: [], fee_schedules: [], agent_findings: [], lifecycle_message_prefs: [], outbound_messages: [], teams: [], programs: [], sessions: [],
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
      if (op === 'gte' || op === 'lte' || op === 'gt' || op === 'lt') {   // ISO timestamps and numbers compare the same way PostgREST orders them
        const a = typeof x === 'number' ? x : String(x ?? ''), b = typeof x === 'number' ? Number(raw) : raw;
        return op === 'gte' ? a >= b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a < b;
      }
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
      if (fn === 'my_workspace') {
        // the resolver of migration 001075: own org unless it is the untouched default and a membership exists
        const own = (db.providers || []).find((p) => p.owner_id === UID);
        const mem = (db.organization_members || []).find((m) => m.member_user_id === UID && m.is_active !== false);
        const untouched = own && !own.onboarding_completed && ['Your organization', 'My Academy', 'My coaching business'].includes(own.business_name)
          && !(db.teams || []).some((t) => t.provider_id === own.id) && !(db.team_athletes || []).some((a) => a.provider_id === own.id);
        const shape = (p, role, member_id) => [{ provider_id: p.id, role, member_id, ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'id' && k !== 'owner_id')) }];
        if (own && (!mem || !untouched)) return json(shape(own, 'owner', mem ? mem.id : null));
        if (mem) { const emp = (db.providers || []).find((p) => p.id === mem.organization_id); if (emp) return json(shape(emp, mem.role === 'admin' ? 'director' : mem.role === 'owner' ? 'owner' : 'coach', mem.id)); }
        return json([]);
      }
      // ── schedule screen doubles (audit P1-2): the real functions' shapes, refusals and receipts ──
      if (fn === 'event_conflicts_in_range') {
        if (db.__conflictsError) return json({ message: db.__conflictsError, code: '42501' }, 403);
        const rows = []; (db.event || []).filter((e) => e.provider_id === body?.p_provider && e.status !== 'cancelled').forEach((e) => (e.__conflicts || []).forEach((c) => rows.push({ event_id: e.id, ...c })));
        return json(rows);
      }
      if (fn === 'cancel_event') {
        if (db.__cancelError) return json({ message: db.__cancelError, code: '42501' }, 403);
        const e = (db.event || []).find((x) => x.id === body?.p_event); if (!e) return json({ message: 'event not found', code: '23503' }, 404);
        if (body.p_expected_sequence != null && body.p_expected_sequence !== (e.sequence || 0)) return json({ message: 'this event changed since you loaded it — reload the schedule and look again', code: 'PT409' }, 409);
        if (e.status === 'cancelled') return json({ event_id: e.id, status: 'cancelled', already_cancelled: true, drafted_notices: 0, sequence: e.sequence || 0, venue_released: false });
        e.status = 'cancelled'; e.cancellation_reason = (body.p_reason || '').trim().slice(0, 300) || null; e.sequence = (e.sequence || 0) + 1;
        const families = (db.team_athletes || []).filter((a) => a.team_id === e.team_id && a.status !== 'inactive').length;
        for (let i = 0; i < families; i++) db.obligations.push({ id: uuid(), provider_id: e.provider_id, kind: 'schedule', status: 'draft', source_kind: 'agent', draft_type: 'schedule_cancellation', source_ref: 'event:' + e.id + ':cancel:' + i, title: 'Cancelled: ' + e.title });
        log.push({ kind: 'cancel_event', id: e.id, reason: body.p_reason, notify: body.p_notify });
        return json({ event_id: e.id, status: 'cancelled', already_cancelled: false, drafted_notices: families, sequence: e.sequence, venue_released: !!e.venue_id });
      }
      if (fn === 'mark_attendance') {
        if (db.__attendanceError) return json({ message: db.__attendanceError, code: '42501' }, 403);
        const e = (db.event || []).find((x) => x.id === body?.p_event); if (!e) return json({ message: 'event not found', code: '23503' }, 404);
        db.attendance_record = db.attendance_record || [];
        const dup = db.attendance_record.find((r) => r.client_id === body.p_client_id); if (dup) return json(dup);
        const row = { id: uuid(), provider_id: e.provider_id, event_id: e.id, member_id: body.p_member, state: body.p_state, marked_by: UID, client_id: body.p_client_id, marked_at: new Date().toISOString() };
        db.attendance_record.push(row); log.push({ kind: 'mark_attendance', client_id: row.client_id, member_id: row.member_id, state: row.state });
        return json(row);
      }
      if (fn === 'money_aged_balances') {   // audit P1-3: the real function's shape — zero rows below treasurer, never an error
        if (db.__moneyError) return json({ message: db.__moneyError }, 503);
        const role = callerRole(db); const pid = body?.p_provider;
        const empty = { role, totals: null, families: [], items: [], items_truncated: false, failed: [], collected: [], collected_90d_cents: 0 };
        if (!role || role === 'coach' || role === 'registrar') return json(empty);
        const now = Date.now(); const nm = (g) => g ? [g.first_name, g.last_name].filter(Boolean).join(' ') || null : null;
        const open = (db.obligations || []).filter((o) => o.provider_id === pid && o.kind === 'fee' && ['draft', 'approved'].includes(o.status) && (o.amount_cents || 0) > 0)
          .map((o) => ({ ...o, days_overdue: !o.due_at || Date.parse(o.due_at) > now ? 0 : Math.floor((now - Date.parse(o.due_at)) / 86400e3) }));
        const sum = (rows, f = () => true) => rows.filter(f).reduce((a, o) => a + Number(o.amount_cents || 0), 0);
        const fams = new Map(); open.forEach((o) => { const k = o.guardian_id || null; if (!fams.has(k)) fams.set(k, []); fams.get(k).push(o); });
        const families = [...fams.entries()].map(([gid, rows]) => ({ guardian_id: gid, family: nm((db.guardians || []).find((g) => g.id === gid)), balance_cents: sum(rows), overdue_cents: sum(rows, (o) => o.days_overdue > 0), open_count: rows.length,
          oldest_due_at: rows.map((o) => o.due_at).filter(Boolean).sort()[0] || null, days_overdue: Math.max(0, ...rows.map((o) => o.days_overdue)),
          athletes: [...new Set(rows.map((o) => nm((db.team_athletes || []).find((a) => a.id === o.member_id))).filter(Boolean))].sort().join(', ') || null }))
          .sort((a, b) => b.overdue_cents - a.overdue_cents || b.days_overdue - a.days_overdue || b.balance_cents - a.balance_cents);
        const items = [...open].sort((a, b) => String(a.due_at || '9').localeCompare(String(b.due_at || '9')) || b.amount_cents - a.amount_cents).slice(0, 2000)
          .map((o) => ({ id: o.id, guardian_id: o.guardian_id || null, member_id: o.member_id || null, title: o.title, amount_cents: o.amount_cents, due_at: o.due_at || null, days_overdue: o.days_overdue, status: o.status, source_kind: o.source_kind || 'manual', source_ref: o.source_ref || null, created_at: o.created_at || null }));
        const failed = (db.installments || []).filter((i) => i.status === 'failed' && (db.fee_schedules || []).some((f) => f.id === i.fee_schedule_id && f.provider_id === pid))
          .map((i) => ({ id: i.id, member_id: i.member_id, athlete: nm((db.team_athletes || []).find((a) => a.id === i.member_id)), amount_cents: i.amount_cents, due_date: i.due_date, attempt_count: i.attempt_count || 0, last_attempt_at: i.last_attempt_at || null }));
        const done = (db.obligations || []).filter((o) => o.provider_id === pid && o.kind === 'fee' && o.status === 'done' && (o.amount_cents || 0) > 0).sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')));
        const buckets = { current: sum(open, (o) => o.days_overdue <= 0), d1_30: sum(open, (o) => o.days_overdue >= 1 && o.days_overdue <= 30), d31_60: sum(open, (o) => o.days_overdue >= 31 && o.days_overdue <= 60), d61_90: sum(open, (o) => o.days_overdue >= 61 && o.days_overdue <= 90), d90_plus: sum(open, (o) => o.days_overdue > 90) };
        return json({ role, totals: { outstanding_cents: sum(open), open_count: open.length, overdue_cents: sum(open, (o) => o.days_overdue > 0), overdue_count: open.filter((o) => o.days_overdue > 0).length, families_count: fams.size, buckets },
          families, items, items_truncated: open.length > 2000, failed, collected: done.slice(0, 50).map((o) => ({ id: o.id, title: o.title, amount_cents: o.amount_cents, done_at: o.done_at || null, family: nm((db.guardians || []).find((g) => g.id === o.guardian_id)) })),
          collected_90d_cents: sum(done, (o) => o.done_at && Date.parse(o.done_at) >= now - 90 * 86400e3) });
      }
      if (fn === 'dashboard_home') {
        if (db.__homeError) return json({ message: db.__homeError }, 503);
        return json(typeof db.__home === 'function' ? db.__home(body, db) : dashboardHome(db, body?.p_provider));
      }
      const answers = { consume_edge_rate_limit: true, run_agent_read: 0, run_agent_drafts: { total: 0, dues: 0, waivers: 0, practice: 0, reactivation: 0, eligibility: 0 },
        create_member_fee_schedule: null, approve_obligation_and_queue: null, agent_autodraft_on: true, reject_unintended_signup: null };
      return json(fn in answers ? answers[fn] : null);
    }
    // ── functions ──
    if (path.startsWith('/functions/v1/')) {
      const fn = path.split('/')[3]; log.push({ kind: 'fn', fn, body });
      /* connectors-available: mirror the real edge function's shape — the
         tiles the client renders, with connect_url for the OAuth kinds, so
         the [data-cxconnect] flow under test starts a real OAuth start. */
      if (fn === 'connectors-available') {
        const googleKinds = ['gmail', 'google_calendar', 'google_sheets', 'google_drive'];
        const labels = { gmail: 'Gmail', google_calendar: 'Google Calendar', google_sheets: 'Google Sheets', google_drive: 'Google Drive',
          stripe: 'Stripe', website: 'Your website', file_import: 'CSV or export file', microsoft365: 'Outlook and Microsoft 365',
          quickbooks: 'QuickBooks', sms: 'Text messages', google_business_profile: 'Google Business Profile' };
        const connectors = Object.keys(labels).map((kind) => {
          const tile = { kind, label: labels[kind], group: 'Test', provider: 'google', oauth: googleKinds.includes(kind),
            write_mode: 'none', state: 'available' };
          if (googleKinds.includes(kind)) tile.connect_url = 'https://fake.supabase.co/functions/v1/google-oauth-start?kind=' + kind;
          return tile;
        });
        return json({ available: Object.keys(labels), connected: [], connectors });
      }
      return json(fn === 'google-oauth-start' ? { url: 'javascript:void(0)' /* a real URL would navigate the test page away; the SPA hands off to it exactly as it would to Google */ } : {});
    }
    // ── rest ──
    if (path.startsWith('/rest/v1/')) {
      const table = path.split('/')[3]; const params = url.searchParams; const prefer = req.headers()['prefer'] || '';
      if (table === 'attendance_current' && method === 'GET') {   // the view: newest record per (event, member)
        const latest = new Map(); [...(db.attendance_record || [])].sort((a, b) => String(a.marked_at).localeCompare(String(b.marked_at))).forEach((r) => latest.set(r.event_id + '|' + r.member_id, r));
        return json(filterRows([...latest.values()], params));
      }
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


/* The caller's role in the org the double serves, the way my_workspace() and
   dashboard_caller() resolve it: owner of the provider row, else the active
   membership's role mapped admin→director, trainer→coach, else null. */
export function callerRole(db) {
  const own = (db.providers || []).find((p) => p.owner_id === UID);
  const mem = (db.organization_members || []).find((m) => m.member_user_id === UID && m.is_active !== false);
  if (own && (!mem || own.onboarding_completed || !['Your organization', 'My Academy', 'My coaching business'].includes(own.business_name))) return 'owner';
  if (mem) return mem.role === 'owner' ? 'owner' : mem.role === 'admin' ? 'director' : 'coach';
  return own ? 'owner' : null;
}

/* A faithful double of dashboard_home() (migration 001073) for the OWNER of
   the org: role default → flags → permission filter, rows from the double's
   own tables. Tests may override with db.__home = (args, db) => {...} or
   force a whole-call failure with db.__homeError = 'message'. */
export const BLOCKS = {
  'money.overdue':   { title: 'Outstanding balances', description: 'Families with a balance past due, aged, largest and oldest first.', min_role: 'treasurer', requires: ['collects_dues'], empty: 'Nobody owes anything right now.', error: 'Could not load balances.', drill_to: 'finances' },
  'schedule.today':  { title: 'Today and tomorrow', description: 'Events in the next 48 hours with any unresolved conflict flagged on the event.', min_role: 'coach', requires: [], empty: 'Nothing scheduled in the next two days.', error: 'Could not load the schedule.', drill_to: 'schedule' },
  'agent.attention': { title: 'Needs you', description: 'Findings not dismissed and drafts awaiting your approval, newest first.', min_role: 'coach', requires: [], empty: 'The agent is watching your inbox and your schedule. Nothing needs you.', error: "Could not load the agent's queue.", drill_to: 'queue' },
  'roster.gaps':     { title: 'Roster gaps', description: 'Athletes missing a required waiver, and staff whose background check or certification expires soon.', min_role: 'registrar', requires: [], empty: 'Every athlete and every staff member is current.', error: 'Could not load roster gaps.', drill_to: 'roster' },
  'people.recent':   { title: 'Roster changes', description: 'Registrations, withdrawals and waitlist movement in the last 14 days.', min_role: 'registrar', requires: ['runs_registration'], empty: 'No roster changes in the last two weeks.', error: 'Could not load recent changes.', drill_to: 'roster' },
};
export const ROLE_DEFAULT = { owner: ['agent.attention', 'money.overdue', 'schedule.today', 'roster.gaps', 'people.recent'], director: ['agent.attention', 'schedule.today', 'roster.gaps', 'people.recent'],
  treasurer: ['money.overdue', 'agent.attention'], registrar: ['roster.gaps', 'people.recent', 'agent.attention'], coach: ['schedule.today', 'agent.attention'] };
export function dashboardFlags(db, pid) {
  return { has_staff: (db.organization_members || []).filter((m) => m.organization_id === pid && m.is_active !== false).length > 1, rents_facilities: false,
    collects_dues: (db.obligations || []).some((o) => o.provider_id === pid && o.kind === 'fee'), runs_registration: false,
    multi_team: (db.teams || []).filter((t) => t.provider_id === pid).length > 1,
    has_connected_inbox: (db.org_connectors || []).some((c) => c.provider_id === pid && c.kind === 'gmail' && ['connected', 'active'].includes(c.status)) };
}
export function dashboardHome(db, pid) {
  const prov = (db.providers || []).find((p) => p.id === pid);
  if (!prov || prov.owner_id !== UID) return { role: null, flags: {}, blocks: [] };
  const flags = dashboardFlags(db, pid); const now = Date.now();
  const blocks = ROLE_DEFAULT.owner.filter((k) => BLOCKS[k].requires.every((r) => flags[r])).map((k) => {
    const b = BLOCKS[k]; let rows = [];
    if (k === 'money.overdue') rows = (db.obligations || []).filter((o) => o.provider_id === pid && o.kind === 'fee' && ['draft', 'approved'].includes(o.status) && o.amount_cents > 0 && o.due_at && Date.parse(o.due_at) < now)
      .map((o) => ({ id: o.id, title: o.title, amount_cents: o.amount_cents, due_at: o.due_at, days_overdue: Math.floor((now - Date.parse(o.due_at)) / 86400000), family: (() => { const g = (db.guardians || []).find((x) => x.id === o.guardian_id); return g ? [g.first_name, g.last_name].filter(Boolean).join(' ') || null : null; })() }));
    if (k === 'schedule.today') rows = (db.event || []).filter((e) => e.provider_id === pid && e.status !== 'cancelled' && Date.parse(e.starts_at) >= now - 3600e3 && Date.parse(e.starts_at) < now + 48 * 3600e3)
      .map((e) => ({ id: e.id, title: e.title, kind: e.kind, starts_at: e.starts_at, ends_at: e.ends_at, timezone: e.timezone, team: ((db.teams || []).find((t) => t.id === e.team_id) || {}).name || null, venue: e.location_text || null, conflicts: e.__conflicts || [] }));
    if (k === 'agent.attention') rows = [...(db.agent_findings || []).filter((f) => f.provider_id === pid && f.status === 'open').map((f) => ({ kind: 'finding', id: f.id, title: f.title, detail: f.detail, severity: f.severity, created_at: f.created_at })),
      ...(db.obligations || []).filter((o) => o.provider_id === pid && o.status === 'draft' && o.source_kind === 'agent').map((o) => ({ kind: 'draft', id: o.id, title: o.title, detail: o.detail, draft_type: o.draft_type, created_at: o.created_at }))];
    if (k === 'roster.gaps') rows = (db.waiver_documents || []).some((d) => d.provider_id === pid) ? (db.team_athletes || []).filter((a) => a.provider_id === pid && a.status === 'active' && !(db.waiver_signatures || []).some((s) => s.member_id === a.id)).map((a) => ({ kind: 'waiver', id: a.id, name: [a.first_name, a.last_name].filter(Boolean).join(' '), detail: 'no signed waiver on file' })) : [];
    return { key: k, title: b.title, description: b.description, params: {}, empty: b.empty, error: b.error, drill_to: b.drill_to, rows, failed: false };
  });
  return { role: 'owner', flags, blocks };
}
