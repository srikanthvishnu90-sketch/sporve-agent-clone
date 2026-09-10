// Reads connected mailboxes and writes findings. Sends nothing, drafts nothing.
//
// This is the half the connector was missing. Until now, connecting Gmail
// stored a refresh token in Vault and produced exactly nothing — a door with no
// room behind it.
//
// What it does NOT do, on purpose:
//   * It never writes a draft. A finding is the output; turning findings into
//     drafts is a separate step with its own review, because that is where
//     model-written prose enters the product.
//   * It never sends. Sporv holds `gmail.readonly` and nothing else, so this is
//     a property of the token, not of this code's restraint.
//   * It never obeys message content. Inbound mail is the most hostile input in
//     the product; everything it produces is fenced by `wrapUntrusted` before
//     it is stored, and a finding only exists when the SENDER is already a
//     guardian of that organisation — so a stranger cannot manufacture work.
//
// Auth: service_role only. It is invoked by the cron runner, not by a browser.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { withHttpDeadline, HttpInputError } from '../_shared/http.ts';
import { googleConfig } from '../_shared/google-oauth.ts';
import {
  actionable, findingFor, listQuery, summarise,
} from '../_shared/gmail-read.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** Bounded so one busy mailbox cannot monopolise a run. */
const MAX_MESSAGES = 25;

type Cfg = { clientId: string; clientSecret: string };

/** Exchange the stored refresh token for a short-lived access token. */
async function accessToken(cfg: Cfg, refresh: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId, client_secret: cfg.clientSecret,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
    signal,
  });
  // Google's error body can echo the token. Never log or return it.
  if (!res.ok) return null;
  const body = await res.json() as { access_token?: string };
  return body.access_token ?? null;
}

async function gmail(path: string, token: string, signal: AbortSignal): Promise<any | null> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal,
  });
  if (!res.ok) return null;
  return await res.json();
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  // service_role only. A customer's browser has no business running this.
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth.replace(/^Bearer\s+/i, '') !== serviceKey) {
    return json({ error: 'Not authorised.' }, 401);
  }

  const cfg = googleConfig();
  if (!cfg) return json({ error: 'Google is not configured.', code: 'not_configured' }, 503);

  try {
    return await withHttpDeadline(async signal => {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
        global: { fetch: (i, init) => fetch(i, { ...init, signal }) },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: connectors, error: cErr } = await admin
        .from('org_connectors')
        .select('id, provider_id, external_account')
        .eq('kind', 'gmail').eq('status', 'connected');
      if (cErr) return json({ error: 'Could not list connectors.' }, 503);

      const report: Array<Record<string, unknown>> = [];

      for (const c of connectors ?? []) {
        const started = new Date().toISOString();
        // One connector's failure must never abort the run (scale floor).
        try {
          const { data: state } = await admin.from('connector_sync_state')
            .select('cursor').eq('connector_id', c.id).maybeSingle();

          const { data: refresh } = await admin
            .rpc('connector_read_secret', { p_connector: c.id });
          if (!refresh) {
            await note(admin, c, started, 'no stored token — reconnect required');
            report.push({ connector: c.id, error: 'no_token' });
            continue;
          }

          const token = await accessToken(cfg, refresh as string, signal);
          if (!token) {
            // Almost always a revoked grant. Say so with a date rather than
            // failing silently — a connector that broke on Tuesday and says
            // nothing is worse than no connector at all.
            await admin.from('org_connectors')
              .update({ status: 'expired', updated_at: started }).eq('id', c.id);
            await note(admin, c, started, 'Google refused the stored token — reconnect required');
            report.push({ connector: c.id, error: 'token_refused' });
            continue;
          }

          const since = state?.cursor ? Number(state.cursor) : null;
          const list = await gmail(
            `messages?maxResults=${MAX_MESSAGES}&q=${encodeURIComponent(listQuery(since))}`,
            token, signal);
          const ids: string[] = (list?.messages ?? []).map((m: { id: string }) => m.id);

          // The club's own guardians, which is what makes a message actionable.
          const { data: guardians } = await admin.from('guardians')
            .select('id, first_name, email').eq('provider_id', c.provider_id);
          const byEmail = new Map<string, Record<string, unknown>>();
          for (const g of guardians ?? []) {
            if (g.email) byEmail.set(String(g.email).toLowerCase(), g);
          }

          let newest = since ?? 0;
          const rows: Array<Record<string, unknown>> = [];
          for (const id of ids) {
            const full = await gmail(
              `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
              token, signal);
            const s = summarise(full);
            if (!s) continue;
            if (full?.internalDate) {
              newest = Math.max(newest, Math.floor(Number(full.internalDate) / 1000));
            }
            const match = actionable(s, byEmail);
            if (match) rows.push(findingFor(c.provider_id, c.id, match));
          }

          // Idempotence, done explicitly rather than with upsert.
          //
          // uq_finding_ref is a PARTIAL unique index (WHERE status <>
          // 'dismissed'), and ON CONFLICT cannot infer a partial index without
          // being handed its predicate — which PostgREST's onConflict gives no
          // way to express. Checked against pg_indexes rather than assumed.
          //
          // So: read what already exists for these refs and insert only the
          // rest. Re-scanning a message produces nothing, and a finding the
          // director dismissed is NOT resurrected, because the dismissed row
          // still matches here even though the partial index ignores it.
          let written = 0;
          if (rows.length) {
            const refs = rows.map(r => r.source_ref as string);
            const { data: seen, error: sErr } = await admin.from('agent_findings')
              .select('source_ref').eq('provider_id', c.provider_id).in('source_ref', refs);
            if (sErr) throw new Error('finding lookup failed');
            const known = new Set((seen ?? []).map((r: { source_ref: string }) => r.source_ref));
            const fresh = rows.filter(r => !known.has(r.source_ref as string));
            if (fresh.length) {
              const { error: fErr } = await admin.from('agent_findings').insert(fresh);
              if (fErr) throw new Error('finding write failed');
            }
            written = fresh.length;
          }

          await admin.from('connector_sync_state').upsert({
            connector_id: c.id, provider_id: c.provider_id,
            cursor: newest ? String(newest) : null,
            last_success_at: new Date().toISOString(),
            last_attempt_at: started,
            last_error: null, last_error_at: null,
            items_seen: ids.length,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'connector_id' });

          report.push({ connector: c.id, scanned: ids.length, findings: written });
        } catch (_e) {
          await note(admin, c, started, 'scan failed');
          report.push({ connector: c.id, error: 'scan_failed' });
        }
      }

      return json({ connectors: (connectors ?? []).length, report });
    }, 55000);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    console.error('gmail-scan: unavailable');
    return json({ error: 'Scan is temporarily unavailable.' }, 503);
  }
});

/** A dated failure, which is the only kind worth recording. */
async function note(admin: any, c: { id: string; provider_id: string }, started: string, why: string) {
  await admin.from('connector_sync_state').upsert({
    connector_id: c.id, provider_id: c.provider_id,
    last_attempt_at: started, last_error: why,
    last_error_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'connector_id' }).catch?.(() => {});
}
