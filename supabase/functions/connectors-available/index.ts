// What this deployment can actually connect, and what this org has connected.
//
// This exists so the connector tiles stop being a hardcoded list. A tile
// showing "Connect" when no OAuth client is configured is a lie the customer
// discovers by clicking it; a tile saying "Not yet" after the owner wires
// Google up is a lie in the other direction. Both are fixed by asking the
// server, which is the only thing that knows.
//
// SELF-CONTAINED ON PURPOSE. `sb.py deploy` uploads only this directory, so
// imports from the parent _shared folder do not resolve at runtime. The
// connector table below is inlined from
// supabase/functions/_shared/connector-registry.mjs — keep the reads/writes
// copy identical there, because the UI renders it verbatim.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/* Inlined deadline (the shared http helper does the same). Bounds
   response time even if a downstream transport ignores cancellation. */
function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('deadline exceeded')), ms);
  return work(controller.signal).finally(() => clearTimeout(timer));
}

/* ── inlined from connector-registry.mjs ─────────────────────────────── */

const PROVIDER_ENV: Record<string, string[]> = {
  google: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  microsoft: ['MS_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_SECRET', 'MS_OAUTH_TENANT'],
  intuit: ['INTUIT_CLIENT_ID', 'INTUIT_CLIENT_SECRET'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  stripe: ['STRIPE_SECRET_KEY'],
  internal: [],
};

interface ConnectorDef {
  kind: string;
  label: string;
  group: string;
  provider: string;
  oauth: boolean;
  write: string;
  reads: string;
  writes: string;
  requiresApproval?: string;
}

const CONNECTORS: ConnectorDef[] = [
  { kind: 'stripe', label: 'Stripe', group: 'Money', provider: 'stripe', oauth: false, write: 'apply',
    reads: 'Charges, refunds, failed payments, card expiry and payouts.',
    writes: 'Charges and invoices you approve. Dues land in your own Stripe account.' },
  { kind: 'website', label: 'Your website', group: 'Where your roster lives', provider: 'internal', oauth: false, write: 'none',
    reads: 'Your programs, prices, schedule and staff from your public pages.',
    writes: 'Nothing.' },
  { kind: 'file_import', label: 'CSV or export file', group: 'Where your roster lives', provider: 'internal', oauth: false, write: 'none',
    reads: 'A roster export from SportsEngine, TeamSnap, LeagueApps, Spond or a plain sheet.',
    writes: 'Nothing. We never ask for your password to those tools.' },
  { kind: 'gmail', label: 'Gmail', group: 'Email and calendar', provider: 'google', oauth: true, write: 'none',
    reads: 'Inbound parent email, tournament PDFs and league notices.',
    writes: 'Nothing. Replies are drafted in your Sporv queue, never in your mailbox.' },
  { kind: 'google_calendar', label: 'Google Calendar', group: 'Email and calendar', provider: 'google', oauth: true, write: 'apply',
    reads: 'Practices, games, conflicts and availability.',
    writes: 'Schedule changes you approve.' },
  { kind: 'google_sheets', label: 'Google Sheets', group: 'Records', provider: 'google', oauth: true, write: 'none',
    reads: 'The spreadsheet your club actually runs on.',
    writes: 'Nothing. Read-only.' },
  { kind: 'google_drive', label: 'Google Drive', group: 'Records', provider: 'google', oauth: true, write: 'none',
    reads: 'Waivers, forms and PDFs you already store.',
    writes: 'Nothing. Read-only.' },
  { kind: 'google_business_profile', label: 'Google Business Profile', group: 'Records', provider: 'google', oauth: true, write: 'draft',
    requiresApproval: 'Google Business Profile API access request',
    reads: 'Your listing accuracy, hours and reviews.',
    writes: 'Corrections you approve.' },
  { kind: 'microsoft365', label: 'Outlook and Microsoft 365', group: 'Email and calendar', provider: 'microsoft', oauth: true, write: 'apply',
    reads: 'Inbound parent email and your calendar.',
    writes: 'Calendar changes you approve. Never mail.' },
  { kind: 'quickbooks', label: 'QuickBooks', group: 'Records', provider: 'intuit', oauth: true, write: 'none',
    reads: 'What your treasurer needs to reconcile.',
    writes: 'Nothing. Read-only.' },
  { kind: 'sms', label: 'Text messages', group: 'Email and calendar', provider: 'twilio', oauth: false, write: 'draft',
    reads: 'What families text your Sporv number.',
    writes: 'Replies drafted for your approval. Never sent automatically.' },
];

/* OAuth start functions that actually exist in this repo, keyed by provider.
   A connector whose provider is configured but whose start flow does not exist
   yet reports state 'available' with an honest note — never a dead button. */
const START_FUNCTION: Record<string, string> = {
  google: 'google-oauth-start',
  microsoft: 'microsoft-oauth-start',
  intuit: 'intuit-oauth-start',
};

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google', microsoft: 'Microsoft', intuit: 'QuickBooks',
  twilio: 'Twilio', stripe: 'Stripe', internal: 'Sporv',
};

function providerConfigured(provider: string): boolean {
  const names = PROVIDER_ENV[provider] ?? [];
  return names.every(n => {
    const v = Deno.env.get(n);
    return typeof v === 'string' && v.length > 0;
  });
}

/* A connector is only OFFERED when its provider is configured — registry rule
   2. A connector needing outside approval is never offered until that
   approval is recorded; there is no approval store yet, so
   google_business_profile is never in this list. */
function offeredKinds(): string[] {
  return CONNECTORS
    .filter(c => !c.requiresApproval && providerConfigured(c.provider))
    .map(c => c.kind);
}

/* Pure plan-lock rule (CONTEXT.md §6.5; unit-tested verbatim in
   tests/connectors/plan-lock.spec.ts). Given the OAuth connector kinds this
   deployment can offer, the plan→connectors map from plan_entitlements, and
   the org's current plan, returns kind → required-plan label for every
   connector outside the plan. The lock and the oauth-start 402 read the same
   table, so the tile and the gate can never disagree. */
function lockedPlanByKind(
  oauthKinds: string[],
  byPlan: Record<string, string[]>,
  currentPlan: string,
): Record<string, string> {
  const allowed = new Set(byPlan[currentPlan] ?? []);
  const PLAN_ORDER = ['free', 'pro', 'enterprise'];
  const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
  const out: Record<string, string> = {};
  for (const kind of oauthKinds) {
    if (allowed.has(kind)) continue;
    const need = PLAN_ORDER.find(p => (byPlan[p] ?? []).includes(kind));
    if (need) out[kind] = PLAN_LABEL[need] ?? need;
  }
  return out;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    return await withDeadline(async signal => {
      const available = offeredKinds();
      const availableSet = new Set(available);
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://aveqjeafghmwafkbbnor.supabase.co';

      /* Config-based tiles: the states for an unauthenticated caller, and the
         baseline every authenticated caller starts from. */
      const baseTiles = CONNECTORS.map(c => {
        const configured = availableSet.has(c.kind);
        const tile: Record<string, unknown> = {
          kind: c.kind, label: c.label, group: c.group, provider: c.provider,
          oauth: c.oauth, write_mode: c.write,
          reads: c.reads, writes: c.writes,
          state: configured ? 'available' : 'not_configured',
        };
        if (c.requiresApproval) {
          tile.requires_approval = c.requiresApproval;
          tile.reason = 'needs_google_approval';
        }
        const startFn = START_FUNCTION[c.provider];
        if (c.oauth && startFn && configured) {
          tile.connect_url = `${supabaseUrl}/functions/v1/${startFn}?kind=${c.kind}`;
        }
        if (c.kind === 'sms') {
          const numberSet = (Deno.env.get('TWILIO_PHONE_NUMBER') ?? '').length > 0;
          if (configured) {
            tile.note = numberSet
              ? 'Texts use your club\u2019s Sporv number.'
              : 'Twilio is wired up; your club\u2019s Sporv number is not set on this deployment yet.';
          } else {
            tile.note = 'Twilio is not switched on for this deployment yet.';
          }
        }
        if ((c.kind === 'microsoft365' || c.kind === 'quickbooks') && configured && !startFn) {
          tile.note = `${PROVIDER_LABEL[c.provider]} is wired up, but the connect flow is not deployed yet — this tile will offer Connect once it lands.`;
        }
        if (!configured && !c.requiresApproval && c.kind !== 'sms') {
          tile.note = `${PROVIDER_LABEL[c.provider]} is not switched on for this deployment yet.`;
        }
        return tile;
      });

      const authorization = req.headers.get('Authorization');
      if (!authorization) return json({ available, connected: [], connectors: baseTiles });

      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization }, fetch: (i, init) => fetch(i, { ...init, signal }) },
          auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: auth } = await userClient.auth.getUser();
      if (!auth?.user) return json({ available, connected: [], connectors: baseTiles });

      /* Read as the customer, not as service_role: RLS on org_connectors is
         then doing the org scoping, and a bug here cannot leak another club's
         connections. Fetch every row (not just connected) so error rows can
         be reported with their dated failure. */
      const { data: rows, error } = await userClient
        .from('org_connectors')
        .select('id, kind, status, write_mode, external_account, connected_at');
      if (error) {
        /* The tables may not be applied yet. An honest not_configured
           answer beats a 500 that makes the whole settings page look broken. */
        return json({
          available, connected: [],
          connectors: baseTiles.map(t => ({ ...t, state: 'not_configured' })),
          note: 'connector records unavailable',
        });
      }

      const connected = (rows ?? [])
        .filter(r => r.status === 'connected')
        .map(r => ({
          kind: r.kind, status: r.status, write_mode: r.write_mode,
          external_account: r.external_account, connected_at: r.connected_at,
        }));

      /* Dated failures: last_error / last_error_at live in
         connector_sync_state, keyed by the connector row. */
      const errorRows = (rows ?? []).filter(r => r.status === 'error');
      const syncByConnector: Record<string, { last_error: unknown; last_error_at: unknown }> = {};
      if (errorRows.length > 0) {
        try {
          const { data: syncRows, error: syncError } = await userClient
            .from('connector_sync_state')
            .select('connector_id, last_error, last_error_at')
            .in('connector_id', errorRows.map(r => r.id));
          if (!syncError) {
            for (const s of syncRows ?? []) {
              syncByConnector[s.connector_id] = { last_error: s.last_error, last_error_at: s.last_error_at };
            }
          }
        } catch { /* a missing sync table must not break the whole answer */ }
      }

      const rowByKind: Record<string, typeof rows[number]> = {};
      for (const r of rows ?? []) rowByKind[r.kind] = r;

      /* Plan lock (CONTEXT.md §6.5): a tile must never offer a Connect
         button that google-oauth-start / microsoft-oauth-start would 402
         (invariant I3). RLS: providers has an owner SELECT policy and
         plan_entitlements is public-read, so the user client suffices; no
         service_role here. Connected and error states are untouched — a live
         row is real, whatever the plan says. */
      const locked: Record<string, string> = {};
      try {
        const { data: prov } = await userClient
          .from('providers').select('plan').eq('owner_id', auth.user.id).maybeSingle();
        const { data: entRows } = await userClient
          .from('plan_entitlements').select('plan, connectors');
        const byPlan: Record<string, string[]> = {};
        for (const e of (entRows ?? []) as Array<{ plan: string; connectors: unknown }>) {
          if (typeof e.plan === 'string' && Array.isArray(e.connectors)) {
            byPlan[e.plan] = (e.connectors as unknown[]).filter(x => typeof x === 'string') as string[];
          }
        }
        const currentPlan = (prov as { plan?: string } | null)?.plan ?? 'free';
        Object.assign(locked, lockedPlanByKind(
          CONNECTORS.filter(c => c.oauth).map(c => c.kind), byPlan, currentPlan));
      } catch {
        /* Entitlements unreadable: keep today's tiles. The oauth-start
           functions still fail closed, so nothing unauthorized connects. */
      }

      const withStatus = baseTiles.map(t => {
        const r = rowByKind[String(t.kind)];
        if (!r) return t;
        if (r.status === 'connected') {
          return {
            ...t, state: 'connected', write_mode: r.write_mode,
            connected_at: r.connected_at, external_account: r.external_account,
          };
        }
        if (r.status === 'error') {
          const s = syncByConnector[r.id] ?? {};
          return {
            ...t, state: 'error',
            last_error: s.last_error ?? null, last_error_at: s.last_error_at ?? null,
          };
        }
        /* revoked / expired / disconnected: no live row, so fall back to the
           config-based state — the tile can offer a reconnect. */
        return t;
      });

      /* Apply the plan lock last: only tiles that would otherwise offer a
         real Connect button become locked, and the button is removed so
         there is no dead control to click. */
      const connectors = withStatus.map(t => {
        const kind = String(t.kind);
        const requiredPlan = locked[kind];
        if (requiredPlan && (t as Record<string, unknown>).connect_url
            && t.state !== 'connected' && t.state !== 'error') {
          const locked = { ...(t as Record<string, unknown>) };
          delete locked.connect_url;
          locked.state = 'locked';
          locked.required_plan = requiredPlan;
          return locked;
        }
        return t;
      });

      return json({ available, connected, connectors });
    }, 10000);
  } catch (error) {
    console.error('connectors-available: unavailable');
    return json({ error: 'Connector status is temporarily unavailable.' }, 503);
  }
});
