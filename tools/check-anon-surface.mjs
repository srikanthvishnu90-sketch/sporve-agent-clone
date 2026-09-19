#!/usr/bin/env node
// check-anon-surface.mjs — no route returns org, money or athlete data
// without a session (owner rule 2, 2026-09-16). Probes every data table with
// the PUBLISHABLE key and no bearer. Read-only.
//
// What fails (audit 2026-09-15 B14 tightened this):
//   ANON READ  — rows came back: an anonymous read path.
//   GRANT      — a 200 with zero rows: anon holds a table or column grant and
//                RLS is the only barrier. Since 20260915_001068 no data table
//                may carry one; the row count is irrelevant.
//   STALE      — a probed column no longer exists: this file's column list
//                has drifted from the schema, so the probe proved nothing.
// The old probe read `select=*` only. Postgres answers 42501 if ANY column is
// ungranted, so a table with a single granted column looked "denied" — a false
// negative. Now a 42501 on `*` is followed by one probe per known column.
//
// A table may be listed in tools/anon-surface-pending.json only with the
// migration file that closes it, and only while that file is unapplied; the
// entry is deleted the day the migration is applied.
//
//   node tools/check-anon-surface.mjs            # exit 1 on any unexplained GRANT / ANON READ / STALE
import { readFileSync, existsSync } from 'node:fs';

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tseszaprvtvqrkfpditu.supabase.co';
export const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_FFlP7chwxsb3BSPRQDMomQ_TsLfPe8S';

/* Column lists snapshotted from the live schema on 2026-09-16
   (information_schema.columns). A missing column fails as STALE rather than
   passing silently. plan_entitlements is deliberately absent: it is the one
   table an anonymous visitor may read (public pricing). */
export const COLUMNS = {
  providers: ['id','owner_id','business_name','bio','sports','location','latitude','longitude','status','onboarding_completed','verification_status','stripe_account_id','created_at','stripe_charges_enabled','background_check_status','account_status','coach_years_coaching','coach_years_played','credentials','provider_type','background_check_completed_at','public_latitude','public_longitude','cancellation_policy','what_to_bring','travel_radius','session_notes','faq','buffer_minutes','vacation_until','verified_at','payout_enabled_at','first_booking_at','last_active_at','instant_book_enabled','avatar_url','logo_url','stripe_customer_id','plan','plan_status','plan_period_end','founding_coach','refund_policy','refund_deposit_cents','stripe_onboarding_started'],
  programs: ['id','provider_id','title','description','sport_type','skill_level','age_group','language','cover_image','gallery','whats_included','price','currency','pricing_model','max_capacity','enrolled_count','latitude','longitude','address_line1','city','state','zip','country','cancellation_policy','minimum_age','maximum_age','is_featured','status','average_rating','total_reviews','created_at','embedding','embedding_updated_at','embedding_source_hash','intensity_tier','typical_client','session_types','program_type','assigned_member_id','offering_type','public_latitude','public_longitude'],
  sessions: ['id','program_id','title','start_date','end_date','start_time','end_time','timezone','address','capacity','created_at','assigned_member_id'],
  teams: ['id','provider_id','name','sport','created_at','season_id','target_size'],
  team_athletes: ['id','team_id','athlete_id','jersey_number','is_available','is_paid','created_at','import_batch_id','season_id','provider_id','first_name','last_name','dob','external_ref','status','source_connector_id'],
  guardians: ['id','provider_id','user_id','first_name','last_name','email','phone','created_at','email_bounced_at','email_status'],
  guardian_links: ['id','guardian_id','member_id','is_payer','relationship','created_at','provider_id'],
  obligations: ['id','provider_id','kind','status','title','detail','amount_cents','currency','due_at','athlete_id','team_id','source_kind','source_ref','inverse','import_batch_id','created_by','approved_by','approved_at','done_at','created_at','updated_at','guardian_id','member_id','run_id','why_finding_id','draft_type'],
  installments: ['id','fee_schedule_id','member_id','due_date','amount_cents','status','stripe_payment_intent_id','attempt_count','last_attempt_at','created_at'],
  fee_schedules: ['id','provider_id','program_id','member_id','season_id','total_cents','installment_count','created_at','refund_policy','refund_deposit_cents','status'],
  outbound_messages: ['id','provider_id','child_id','booking_id','event_type','status','scheduled_for','content','approved_by','approved_at','sent_at','created_at','obligation_id','provider_message_id','delivery_error','send_after','attempt_count','last_error','provider'],
  organization_members: ['id','organization_id','trainer_profile','member_user_id','role','background_check_status','is_active','created_at','updated_at','commission_type','commission_value','background_check_completed_at','background_check_reference'],
  coach_invites: ['id','provider_id','inviter_owner_id','invited_email','invited_phone','token','status','redeemed_by','redeemed_at','fee_waived','expires_at','created_at','updated_at'],
  import_batches: ['id','provider_id','created_by','source_filename','row_count','undone_at','created_at','content_hash','source_connector_id'],
  waiver_documents: ['id','provider_id','title','body_md','version','content_hash','created_at'],
  waiver_signatures: ['id','waiver_document_id','document_version','content_hash','member_id','guardian_id','season_id','signature_image','signed_at','signer_ip','rendered_pdf_path'],
  staff_certifications: ['id','organization_id','member_user_id','kind','status','issued_at','expires_at','reference','created_at','updated_at','evidence_source','attested_by','attested_at'],
  bookings: ['id','searcher_id','session_id','athlete_id','program_id','athlete_first_name','athlete_age_band','selected_tier','original_price','final_price','currency','status','payment_status','created_at','stripe_checkout_session_id','assigned_member_id','plan_proposal_id','cancelled_at','cancelled_by','cancellation_reason','cancellation_policy_snapshot','refund_amount','refunded_at','stripe_payment_intent_id','provider_responded_at','platform_fee','platform_fee_bps','provider_payout','fee_recorded_at'],
  profiles: ['id','role','first_name','last_name','email','phone_number','preferred_sports','profile_image','created_at'],
  agent_findings: ['id','provider_id','kind','code','severity','title','detail','source_ref','member_id','amount_cents','status','run_id','created_at','updated_at','subject_type','subject_id','evidence','dismissed_at'],
  agent_proposals: ['id','provider_id','kind','title','detail','proposed','why_finding_id','status','applied_by','applied_at','run_id','created_at','receipt'],
  provider_settings: ['provider_id','key','value','updated_at','updated_by'],
  org_connectors: ['id','provider_id','kind','status','write_mode','external_account','scopes','vault_secret_id','connected_by','connected_at','revoked_at','created_at','updated_at'],
  payment_event_ledger: ['id','stripe_event_id','event_type','booking_id','stripe_object_id','amount_minor','currency','payload_sha256','outcome','occurred_at','processed_at','reverses_entry_id'],
  background_check: ['id','provider_id','member_id','subject_kind','vendor','vendor_reference','package','status','ordered_at','completed_at','expires_at','adjudicated_by','adjudication_note','created_at','updated_at'],
  event: ['id','provider_id','series_id','series_local_date','team_id','program_id','kind','title','starts_at','ends_at','timezone','venue_id','location_text','status','cancellation_reason','is_exception','opponent','home_away','arrival_offset_minutes','notes','assigned_member_id','capacity','published_at','sequence','source_session_id','source_fixture_id','created_at','updated_at'],
  event_series: ['id','provider_id','team_id','program_id','kind','title','timezone','local_start_time','duration_minutes','rrule','series_start_date','series_end_date','venue_id','location_text','assigned_member_id','capacity','created_by','created_at'],
  event_response: ['id','provider_id','event_id','member_id','response','responded_by','source','note','responded_at'],
  attendance_record: ['id','provider_id','event_id','member_id','state','marked_by','client_id','marked_at'],
  venue: ['id','provider_id','name','address','timezone','capacity','created_at'],
  migration_quarantine: ['id','provider_id','source_table','source_id','reason','payload','created_at'],
  billing_subscriptions: ['id','provider_id','stripe_subscription_id','stripe_price_id','status','current_period_start','current_period_end','cancel_at_period_end','coupon','created_at','updated_at'],
  /* not live yet (spec 13) — probed so the day they land they are covered */
  guardian_access_token: ['id'],
  import_row: ['id'],
};
export const TABLES = Object.keys(COLUMNS);

async function get(table, select, fetchImpl) {
  const r = await fetchImpl(`${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`,
    { headers: { apikey: ANON_KEY }, signal: AbortSignal.timeout(15000) });
  const text = await r.text(); let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  const rows = Array.isArray(body) ? body : [];
  return { status: r.status, rows: rows.length, code: (body && !Array.isArray(body) && body.code) || null,
    columns: rows[0] ? Object.keys(rows[0]) : [] };
}

/* One table → { table, state, granted[], columns[] }.
   state ∈ absent | denied | GRANT | ANON READ | STALE */
export async function probe(table, fetchImpl = fetch) {
  const star = await get(table, '*', fetchImpl);
  if (star.status === 404 || star.code === 'PGRST205') return { table, state: 'absent', granted: [], columns: [] };
  if (star.rows > 0) return { table, state: 'ANON READ', granted: ['*'], columns: star.columns };
  if (star.status >= 200 && star.status < 300) return { table, state: 'GRANT', granted: ['*'], columns: [] };
  if (star.code !== '42501' && star.status !== 401) return { table, state: `unexpected (${star.status}${star.code ? ' ' + star.code : ''})`, granted: [], columns: [] };
  /* `*` was refused. That proves nothing about individual columns. */
  const granted = [], stale = []; let read = false, cols = [];
  for (const c of COLUMNS[table] || []) {
    const r = await get(table, c, fetchImpl);
    if (r.code === '42703') { stale.push(c); continue; }
    if (r.status >= 200 && r.status < 300) { granted.push(c); if (r.rows > 0) { read = true; cols = r.columns; } }
  }
  if (read) return { table, state: 'ANON READ', granted, columns: cols };
  if (granted.length) return { table, state: 'GRANT', granted, columns: [] };
  if (stale.length) return { table, state: 'STALE', granted: [], columns: stale };
  return { table, state: 'denied', granted: [], columns: [] };
}

export const fails = (p) => p.state === 'ANON READ' || p.state === 'GRANT' || p.state === 'STALE' || p.state.startsWith('unexpected');

export function pendingOk(pending, migDirUrl) {
  const bad = [];
  for (const [table, file] of Object.entries(pending)) {
    if (table === '_') continue;
    const url = new URL(file, migDirUrl);
    if (!existsSync(url)) { bad.push(`${table}: ${file} does not exist`); continue; }
    const src = readFileSync(url, 'utf8').toLowerCase();
    if (!src.includes(`from anon`) || !src.includes(table)) bad.push(`${table}: ${file} does not revoke anon on it`);
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pendingUrl = new URL('./anon-surface-pending.json', import.meta.url);
  const pending = existsSync(pendingUrl) ? JSON.parse(readFileSync(pendingUrl, 'utf8')) : {};
  const bad = pendingOk(pending, new URL('../supabase/migrations/', import.meta.url));
  if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
  let fail = 0;
  for (const t of TABLES) {
    const p = await probe(t);
    const excused = fails(p) && p.state !== 'STALE' && pending[t] ? ` — pending ${pending[t]}` : '';
    if (fails(p) && !excused) fail++;
    const detail = p.state === 'GRANT' || p.state === 'ANON READ' ? `  granted: ${p.granted.slice(0, 8).join(',')}${p.granted.length > 8 ? ',…' : ''}` : p.state === 'STALE' ? `  missing: ${p.columns.join(',')}` : '';
    console.log(`${t.padEnd(24)} ${p.state}${excused}${detail}${p.columns.length && p.state === 'ANON READ' ? '  cols: ' + p.columns.slice(0, 8).join(',') : ''}`);
  }
  console.log(`\n${fail ? `${fail} table(s) reachable by anon (grant or read) or unprovable` : 'no anonymous grant or read path'}`);
  process.exit(fail ? 1 : 0);
}
