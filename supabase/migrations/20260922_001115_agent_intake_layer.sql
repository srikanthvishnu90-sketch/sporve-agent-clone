-- 20260922_001115_agent_intake_layer.sql — Sporv AI intake layer, Phase 1 (backend).
--
-- Additive only. Ships the deterministic half of the intake design
-- (~/workspace/sporv-ai-intake-design.md): intake tables, the owner-gated
-- proposal decision RPC with a whitelisted SECURITY DEFINER applier, four new
-- deterministic findings, the intake draft generator, and run_agent_read
-- returning the TOTAL finding count across generators.
--
-- Phase 2 (edge function agent-intake, AI extract, gmail-scan event writes)
-- builds on these tables/RPCs; the Queue UI already renders them
-- (loadIntakeProposals / decideIntakeProposal in src/sporve-web.host.html).
--
-- Codex migration block 20260915_001100-001149: this file is 001115.
-- Never edit generated index.html (this migration needs no frontend change).

-- §A — pg_trgm (fuzzy entity resolution for the Phase 2 edge-function worker).
-- Supabase-allowlisted extension; installs into the extensions schema.
create extension if not exists pg_trgm with schema extensions;

-- §B — intake_events: raw inbound artifacts (email, form, api) awaiting processing.
create table if not exists public.intake_events (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  source        text not null,                       -- 'gmail' | 'form' | 'api' | ...
  source_ref    text not null unique,                -- connector-side dedupe key
  payload       jsonb not null default '{}'::jsonb,  -- raw inbound content
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  status        text not null default 'new'
                  -- 'error': written by the agent-intake edge function when an
                  -- event throws unexpectedly (contract §1.7); never blocks the queue.
                  check (status in ('new','processed','failed','error','skipped')),
  created_at    timestamptz not null default now()
);
comment on table public.intake_events is
  'Inbound artifacts for the intake pass (Phase 2 agent-intake edge function). Connectors write one row per artifact; the intake run marks it processed. Nothing here auto-mutates club data.';
create index if not exists idx_intake_events_queue
  on public.intake_events (provider_id, status, received_at);

-- §C — intake_proposals: staged, approval-gated changes. Drafts sit in the
-- Approvals queue until the owner decides via decide_intake_proposal.
create table if not exists public.intake_proposals (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid references public.intake_events(id) on delete set null,
  kind          text not null check (kind in ('data_change','message_draft')),
  target_table  text,                                -- data_change: whitelisted table
  target_row_id uuid,                                -- null for INSERT proposals
  patch         jsonb not null default '{}'::jsonb,  -- {column: value}
  confidence    numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status        text not null default 'draft'
                  check (status in ('draft','approved','applied','void')),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  why_finding_id uuid references public.agent_findings(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.intake_proposals is
  'Approval-gated intake proposals. data_change patches apply to a whitelisted target table ONLY through decide_intake_proposal; message_draft proposals stage copy for lifecycle-approve (the sole sender). Nothing auto-mutates.';
-- Idempotency: one live proposal per (provider, event, target table, target row).
create unique index if not exists uq_intake_proposal_idem
  on public.intake_proposals (provider_id, event_id, target_table, target_row_id)
  where status <> 'void';
create index if not exists idx_intake_proposals_queue
  on public.intake_proposals (provider_id, status, confidence desc nulls last);

-- §D — intake_audit: the decision trail for every decided proposal.
create table if not exists public.intake_audit (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null,
  proposal_id   uuid references public.intake_proposals(id) on delete set null,
  event_id      uuid,
  decision      text not null,                       -- 'applied' | 'void'
  decided_by    uuid,
  decided_at    timestamptz not null default now(),
  target_table  text,
  target_row_id uuid,
  patch         jsonb,
  error         text,
  created_at    timestamptz not null default now()
);
comment on table public.intake_audit is
  'Decision trail for intake proposals: who decided what, when, and which patch was applied.';

-- §E — RLS + grants (mirror the obligations pattern: owner-only via providers).
alter table public.intake_events    enable row level security;
alter table public.intake_proposals enable row level security;
alter table public.intake_audit     enable row level security;

drop policy if exists intake_events_owner_all on public.intake_events;
create policy intake_events_owner_all on public.intake_events
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = intake_events.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = intake_events.provider_id and pv.owner_id = auth.uid()));

drop policy if exists intake_proposals_owner_all on public.intake_proposals;
create policy intake_proposals_owner_all on public.intake_proposals
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = intake_proposals.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = intake_proposals.provider_id and pv.owner_id = auth.uid()));

drop policy if exists intake_audit_owner_read on public.intake_audit;
create policy intake_audit_owner_read on public.intake_audit
  for select to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = intake_audit.provider_id and pv.owner_id = auth.uid()));

revoke all on public.intake_events, public.intake_proposals from public;
grant select, insert, update, delete on public.intake_events, public.intake_proposals to authenticated;
revoke all on public.intake_audit from public;
grant select on public.intake_audit to authenticated;

-- §F — apply_intake_patch: the ONLY writer of intake data_change patches.
-- SECURITY DEFINER, never granted to any role; reachable only through
-- decide_intake_proposal. Rejects anything outside the whitelist, rejects
-- unknown/immutable columns, and applies each patch key with a proper cast
-- derived from the real column type. UPDATE when target_row_id is set,
-- INSERT (patch columns only, so real column defaults apply) when null.
create or replace function public.apply_intake_patch(
  p_target_table text, p_target_row_id uuid, p_patch jsonb)
returns uuid
language plpgsql
security definer
set search_path to '' as $function$
declare
  v_allowed  text[] := array['team_athletes','sessions','event',
                            'staff_certifications','organization_members',
                            'guardians','programs','prospects'];
  v_key      text;
  v_type     text;
  v_expr     text;
  v_cols     text[] := '{}';
  v_exprs    text[] := '{}';
  v_sets     text[] := '{}';
  v_sql      text;
  v_affected int;
  v_new_id   uuid;
begin
  if p_target_table is null or not (p_target_table = any (v_allowed)) then
    raise exception 'intake applier: target table % is not whitelisted', p_target_table;
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'intake applier: patch must be a JSON object';
  end if;

  -- Validate every patch key against the real table definition and build a
  -- properly-cast value expression. (->>) extracts scalars as text so
  -- text/uuid/numeric/boolean/date/timestamptz casts behave; (->) keeps
  -- json/jsonb values whole. JSON null and missing keys both yield SQL NULL.
  for v_key in select jsonb_object_keys(p_patch) loop
    select pg_catalog.format_type(a.atttypid, a.atttypmod) into v_type
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
     where c.relname = p_target_table
       and c.relnamespace = 'public'::regnamespace
       and a.attname = v_key and a.attnum > 0 and not a.attisdropped;
    if v_type is null then
      raise exception 'intake applier: column % does not exist on %', v_key, p_target_table;
    end if;
    if v_key in ('id','created_at','provider_id','organization_id') and p_target_row_id is not null then
      raise exception 'intake applier: column % is immutable on update', v_key;
    end if;
    if v_type like '%[]' then
      raise exception 'intake applier: array column % is not patchable', v_key;
    end if;
    if v_type in ('json','jsonb') then
      v_expr := pg_catalog.format('($1 -> %L)', v_key);
    else
      v_expr := pg_catalog.format('($1 ->> %L)::%s', v_key, v_type);
    end if;
    v_cols  := v_cols || v_key;
    v_exprs := v_exprs || v_expr;
    v_sets  := v_sets || pg_catalog.format('%I = %s', v_key, v_expr);
  end loop;
  if coalesce(array_length(v_cols, 1), 0) = 0 then
    raise exception 'intake applier: empty patch';
  end if;

  if p_target_row_id is null then
    v_sql := pg_catalog.format(
      'insert into public.%I (%s) select %s returning id',
      p_target_table,
      (select string_agg(pg_catalog.format('%I', c), ', ') from unnest(v_cols) c),
      (select string_agg(e, ', ') from unnest(v_exprs) e));
    execute v_sql using p_patch into v_new_id;
    return v_new_id;
  end if;

  -- updated_at is stamped only where the column exists (not all tables have it).
  if exists (select 1 from pg_catalog.pg_attribute a
              join pg_catalog.pg_class c on c.oid = a.attrelid
             where c.relname = p_target_table and c.relnamespace = 'public'::regnamespace
               and a.attname = 'updated_at' and not a.attisdropped) then
    v_sets := v_sets || array['updated_at = now()'];
  end if;
  v_sql := pg_catalog.format('update public.%I set %s where id = $2',
                             p_target_table, array_to_string(v_sets, ', '));
  execute v_sql using p_patch, p_target_row_id;
  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    raise exception 'intake applier: target row % not found in %', p_target_row_id, p_target_table;
  end if;
  return p_target_row_id;
end; $function$;

revoke all on function public.apply_intake_patch(text, uuid, jsonb) from public, anon, authenticated;

-- §G — decide_intake_proposal: owner-gated decision RPC (the UI's twin buttons
-- call this with 'approve' / 'void'; the contract doc also allows 'approved').
-- approve(d): data_change → applier writes the patch, status='applied';
--             message_draft → staged only, status='applied', no send path here.
-- void:    status='void', nothing changes. Every decision writes intake_audit.
create or replace function public.decide_intake_proposal(p_proposal uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to '' as $function$
declare
  v_pr       public.intake_proposals%rowtype;
  v_new_id   uuid;
  v_patch    jsonb;
  v_has_col  boolean;
begin
  -- Validate the decision before anything else.
  if p_decision not in ('approve', 'approved', 'void') then
    raise exception 'decision must be approve/approved or void';
  end if;
  select * into v_pr from public.intake_proposals where id = p_proposal;
  if not found then
    raise exception 'intake proposal not found';
  end if;
  if not exists (select 1 from public.providers
                  where id = v_pr.provider_id and owner_id = auth.uid()) then
    raise exception 'only the org owner may decide intake proposals';
  end if;
  if v_pr.status <> 'draft' then
    raise exception 'intake proposal is already %', v_pr.status;
  end if;

  if p_decision = 'void' then
    update public.intake_proposals
       set status = 'void', decided_by = auth.uid(), decided_at = now(), updated_at = now()
     where id = p_proposal;
    insert into public.intake_audit
      (provider_id, proposal_id, event_id, decision, decided_by,
       target_table, target_row_id, patch)
    values
      (v_pr.provider_id, p_proposal, v_pr.event_id, 'void', auth.uid(),
       v_pr.target_table, v_pr.target_row_id, v_pr.patch);
    return jsonb_build_object('status', 'void', 'id', p_proposal);

  elsif p_decision in ('approve', 'approved') then
    v_patch := v_pr.patch;
    if v_pr.kind = 'data_change' then
      if v_pr.target_row_id is null then
        -- INSERT proposals: the patch carries row values; org scoping comes
        -- from the proposal itself when the patch omits it (proposals table
        -- always carries provider_id; targets scope via provider_id or
        -- organization_id).
        select exists (select 1
                         from pg_catalog.pg_attribute a
                         join pg_catalog.pg_class c on c.oid = a.attrelid
                        where c.relname = v_pr.target_table
                          and c.relnamespace = 'public'::regnamespace
                          and a.attname = 'provider_id' and not a.attisdropped)
          into v_has_col;
        if v_has_col and not (v_patch ? 'provider_id') then
          v_patch := v_patch || jsonb_build_object('provider_id', v_pr.provider_id);
        end if;
        select exists (select 1
                         from pg_catalog.pg_attribute a
                         join pg_catalog.pg_class c on c.oid = a.attrelid
                        where c.relname = v_pr.target_table
                          and c.relnamespace = 'public'::regnamespace
                          and a.attname = 'organization_id' and not a.attisdropped)
          into v_has_col;
        if v_has_col and not (v_patch ? 'organization_id') then
          v_patch := v_patch || jsonb_build_object('organization_id', v_pr.provider_id);
        end if;
      end if;
      v_new_id := public.apply_intake_patch(v_pr.target_table, v_pr.target_row_id, v_patch);
      v_pr.target_row_id := coalesce(v_pr.target_row_id, v_new_id);
    end if;
    -- message_draft: approved into the queue; lifecycle-approve stays the sole sender.
    update public.intake_proposals
       set status = 'applied', decided_by = auth.uid(), decided_at = now(),
           updated_at = now(), target_row_id = v_pr.target_row_id
     where id = p_proposal;
    insert into public.intake_audit
      (provider_id, proposal_id, event_id, decision, decided_by,
       target_table, target_row_id, patch)
    values
      (v_pr.provider_id, p_proposal, v_pr.event_id, 'applied', auth.uid(),
       v_pr.target_table, v_pr.target_row_id, v_patch);
    return jsonb_build_object('status', 'applied', 'id', p_proposal,
                              'target_row_id', v_pr.target_row_id);
  end if;
end; $function$;

revoke all on function public.decide_intake_proposal(uuid, text) from public, anon;
grant execute on function public.decide_intake_proposal(uuid, text) to authenticated;
comment on function public.decide_intake_proposal(uuid, text) is
  'Owner-gated intake decision. approve: whitelisted applier writes a data_change patch (or stages a message_draft); void: nothing changes. Audit row always written.';

-- §H — generate_agent_findings: expose run_id in the returned jsonb so
-- run_agent_read can merge counts across generators. Surgical and
-- body-preserving: the DO block reads the ACTUAL production definition,
-- replaces exactly one return site, and re-executes it. It raises unless the
-- pattern occurs exactly once, so any drift fails loudly instead of silently.
do $do$
declare
  v_def text;
  v_old text := $$return jsonb_build_object('n_kinds', n_kinds, 'n_rows', n_rows);$$;
  v_new text := $$return jsonb_build_object('n_kinds', n_kinds, 'n_rows', n_rows, 'run_id', v_run);$$;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'generate_agent_findings';
  if v_def is null then
    raise exception 'intake migration: generate_agent_findings not found';
  end if;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_hits = 0 then
    -- Already applied (or a newer body): verify the new return site exists.
    if position(v_new in v_def) = 0 then
      raise exception 'intake migration: generate_agent_findings return site not recognized';
    end if;
    return;
  end if;
  if v_hits <> 1 then
    raise exception 'intake migration: expected 1 return site in generate_agent_findings, found %', v_hits;
  end if;
  execute replace(v_def, v_old, v_new);
end $do$;

-- §I — generate_intake_findings: deterministic intake findings (zero AI).
-- Codes per the intake design §3 acceptance spec. Called by run_agent_read so
-- they land in the Queue with the same run semantics as the base findings.
create or replace function public.generate_intake_findings(
  p_provider uuid default null, p_force boolean default false, p_run uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to '' as $function$
declare
  n_kinds integer := 0; n_rows integer := 0;
  v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  -- (i1) staff double-booking on the event table: same assigned_member_id
  -- with overlapping [starts_at, ends_at) windows, future, not cancelled.
  insert into public.agent_findings
    (provider_id, kind, code, severity, title, detail, source_ref,
     subject_type, subject_id, run_id, evidence)
  select e1.provider_id, 'schedule', 'intake_staff_unavailable', 'urgent',
    'Double-booked staff: ' || coalesce(e1.title, 'event') || ' × ' || coalesce(e2.title, 'event'),
    'The same staff member is assigned to two overlapping events: '
      || coalesce(e1.title, 'event') || ' (' || to_char(e1.starts_at, 'Mon DD HH24:MI') || ') and '
      || coalesce(e2.title, 'event') || ' (' || to_char(e2.starts_at, 'Mon DD HH24:MI') || '). '
      || 'Reassign one before the date — nothing was reassigned automatically.',
    'finding:staffdbl:event:' || least(e1.id, e2.id)::text || ':' || greatest(e1.id, e2.id)::text,
    'staff', e1.assigned_member_id, v_run,
    jsonb_build_object('event_a', e1.id, 'event_b', e2.id,
                       'staff', e1.assigned_member_id,
                       'a_starts_at', e1.starts_at, 'b_starts_at', e2.starts_at)
  from public.event e1
  join public.event e2
    on e2.provider_id = e1.provider_id
   and e2.assigned_member_id = e1.assigned_member_id
   and e2.id > e1.id
   and tstzrange(e2.starts_at, e2.ends_at) && tstzrange(e1.starts_at, e1.ends_at)
  where e1.assigned_member_id is not null
    and e1.starts_at >= now() and e1.status <> 'cancelled'
    and e2.status <> 'cancelled'
    and (p_provider is null or e1.provider_id = p_provider)
    and (p_force or public.agent_read_on(e1.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, detail = excluded.detail,
                evidence = excluded.evidence, run_id = excluded.run_id,
                updated_at = now();

  -- (i2) staff double-booking on the legacy sessions table: same
  -- assigned_member_id, overlapping date ranges AND overlapping time-of-day
  -- windows. sessions has no provider_id — scope via programs. Malformed/missing
  -- times degrade to a full-day window (overlap then means "same day"),
  -- never to a silent skip.
  with sw as (
    select s.id, pr.provider_id, s.assigned_member_id, s.title, s.start_date,
           coalesce(s.end_date, s.start_date) as end_date,
           (case when s.start_time ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$'
                 then s.start_time::time end) as t_start,
           (case when s.end_time ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$'
                 then s.end_time::time end) as t_end
      from public.sessions s
      join public.programs pr on pr.id = s.program_id
     where s.assigned_member_id is not null and s.start_date is not null
  )
  insert into public.agent_findings
    (provider_id, kind, code, severity, title, detail, source_ref,
     subject_type, subject_id, run_id, evidence)
  select s1.provider_id, 'schedule', 'intake_staff_unavailable', 'urgent',
    'Double-booked staff: ' || coalesce(s1.title, 'session') || ' × ' || coalesce(s2.title, 'session'),
    'The same staff member is assigned to two overlapping sessions on '
      || to_char(s1.start_date, 'Mon DD') || ': '
      || coalesce(s1.title, 'session') || ' and ' || coalesce(s2.title, 'session') || '. '
      || 'Reassign one before the date — nothing was reassigned automatically.',
    'finding:staffdbl:session:' || least(s1.id, s2.id)::text || ':' || greatest(s1.id, s2.id)::text,
    'staff', s1.assigned_member_id, v_run,
    jsonb_build_object('session_a', s1.id, 'session_b', s2.id,
                       'staff', s1.assigned_member_id, 'date', s1.start_date)
  from sw s1
  join sw s2
    on s2.provider_id = s1.provider_id
   and s2.assigned_member_id = s1.assigned_member_id
   and s2.id > s1.id
   and s1.start_date <= s2.end_date
   and s2.start_date <= s1.end_date
   and coalesce(s1.t_start, time '00:00') < coalesce(s2.t_end, time '23:59')
   and coalesce(s2.t_start, time '00:00') < coalesce(s1.t_end, time '23:59')
  where s1.start_date >= current_date
    and (p_provider is null or s1.provider_id = p_provider)
    and (p_force or public.agent_read_on(s1.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, detail = excluded.detail,
                evidence = excluded.evidence, run_id = excluded.run_id,
                updated_at = now();

  -- (i3) attendance drop: >= 4 absent of the last 6 recorded events
  -- (attendance_current = latest state per event+member; absent only —
  -- late/excused do not count).
  insert into public.agent_findings
    (provider_id, kind, code, severity, title, detail, source_ref,
     member_id, subject_type, subject_id, run_id, evidence)
  select d.provider_id, 'people', 'intake_engagement_risk', 'attention',
    m.first_name || ' ' || coalesce(m.last_name, '') || ' missed '
      || d.n_absent || ' of the last ' || d.n_events || ' sessions',
    'Attendance has dropped — check in with the family before this becomes a withdrawal. '
      || 'Counts absences only (late/excused excluded) over the last '
      || d.n_events || ' sessions with recorded attendance.',
    'finding:engagerisk:' || m.id,
    m.id, 'member', m.id, v_run,
    jsonb_build_object('absent', d.n_absent, 'of', d.n_events)
  from (
    select ac.provider_id, ac.member_id,
           count(*) as n_events,
           count(*) filter (where ac.state = 'absent') as n_absent
      from (
        select ac.provider_id, ac.member_id, ac.state,
               row_number() over (partition by ac.member_id order by e.starts_at desc) as rn
          from public.attendance_current ac
          join public.event e on e.id = ac.event_id
         where e.starts_at < now()
      ) ac
     where ac.rn <= 6
     group by ac.provider_id, ac.member_id
    having count(*) filter (where ac.state = 'absent') >= 4
  ) d
  join public.team_athletes m on m.id = d.member_id and m.status = 'active'
  where m.first_name is not null
    and (p_provider is null or d.provider_id = p_provider)
    and (p_force or public.agent_read_on(d.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, detail = excluded.detail,
                evidence = excluded.evidence, run_id = excluded.run_id,
                updated_at = now();

  -- (i4) REMOVED 2026-09-23: a NULL-role staff rule cannot fire —
  -- organization_members.role is NOT NULL with CHECK in
  -- ('owner','admin','trainer'). New-hire detection stays a finding-only path
  -- (the edge function stages no proposal for it); the coach adds staff
  -- through the normal UI where role is required. Never invent a role.

  -- (i5) season ended 7–60 days ago with outstanding balances.
  insert into public.agent_findings
    (provider_id, kind, code, severity, title, detail, source_ref,
     amount_cents, run_id, evidence)
  select s.provider_id, 'money', 'season_wrap_due', 'info',
    'Season ended: ' || s.name || ' — '
      || to_char(sum(i.amount_cents) / 100.0, 'FM$999,999,990.00') || ' still outstanding',
    count(distinct i.member_id) || ' member(s) have unpaid installments from the season '
      || 'that ended ' || to_char(s.end_date, 'Mon DD')
      || '. Review balances before closing the books — nothing is voided automatically.',
    'finding:seasonwrap:' || s.id,
    sum(i.amount_cents)::int, v_run,
    jsonb_build_object('season_id', s.id, 'season', s.name,
                       'ended', s.end_date, 'members', count(distinct i.member_id))
  from public.seasons s
  join public.fee_schedules fs on fs.season_id = s.id
  join public.installments i
    on i.fee_schedule_id = fs.id and i.status not in ('paid', 'waived')
  where s.end_date between current_date - 60 and current_date - 7
    and (p_provider is null or s.provider_id = p_provider)
    and (p_force or public.agent_read_on(s.provider_id))
  group by s.provider_id, s.id, s.name, s.end_date
  having sum(i.amount_cents) > 0
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, detail = excluded.detail,
                amount_cents = excluded.amount_cents, evidence = excluded.evidence,
                run_id = excluded.run_id, updated_at = now();

  select count(distinct kind) into n_kinds from public.agent_findings where run_id = v_run;
  select count(*) into n_rows from public.agent_findings where run_id = v_run;
  return jsonb_build_object('n_kinds', n_kinds, 'n_rows', n_rows, 'run_id', v_run);
end; $function$;

-- Only run_agent_read invokes it (mirrors generate_agent_findings).
revoke all on function public.generate_intake_findings(uuid, boolean, uuid)
  from public, anon, authenticated;
comment on function public.generate_intake_findings(uuid, boolean, uuid) is
  'Deterministic intake findings: staff double-booking, attendance drop, gmail intake events, season wrap (ended 7-60d ago) with balances. Zero AI.';

-- §J — run_agent_read: the read pass now runs the base findings AND the
-- deterministic intake findings, and returns the TOTAL finding count across
-- generators (not the last generator's count). n_kinds/n_rows keys are
-- preserved for the Queue copy ("Read pass · N things noticed" = n_rows);
-- intake_n and run_id are additive.
drop function if exists public.run_agent_read(uuid);
create function public.run_agent_read(p_provider uuid)
returns jsonb
language plpgsql
security definer
set search_path to '' as $function$
declare
  v_base  jsonb;
  v_in    jsonb;
  v_kinds int;
begin
  if not exists (select 1 from public.providers
                  where id = p_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may run the agent';
  end if;
  v_base := public.generate_agent_findings(p_provider, true);
  v_in   := public.generate_intake_findings(p_provider, true, null);
  select count(distinct kind) into v_kinds
    from public.agent_findings
   where run_id = (v_base ->> 'run_id')::uuid
      or run_id = (v_in ->> 'run_id')::uuid;
  return jsonb_build_object(
    'n_kinds', v_kinds,
    'n_rows', coalesce((v_base ->> 'n_rows')::int, 0)
            + coalesce((v_in ->> 'n_rows')::int, 0),
    'intake_n', coalesce((v_in ->> 'n_rows')::int, 0),
    'run_id', (v_in ->> 'run_id'));
end; $function$;

revoke all on function public.run_agent_read(uuid) from public, anon;
grant execute on function public.run_agent_read(uuid) to authenticated;

-- §M — Decision 1 (cancellation proposals): the agent-intake edge function
-- stages cancellation as {target_table:'sessions', patch:{cancelled:true}}.
-- sessions had no cancelled column, so the applier would have rejected it.
-- Chose option (a): real columns on sessions. NOTE: the Schedule UI reads the
-- `event` table (event.status='cancelled'), so a sessions-level cancellation
-- does not by itself move the UI — Phase 2 may additionally propose the
-- linked event row(s) via source_session_id when that mapping is wanted.
alter table public.sessions
  add column if not exists cancelled boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;
comment on column public.sessions.cancelled is
  'Set true only via an approved intake_proposals data_change patch (decide_intake_proposal). No auto-cancel path exists.';

-- §N — Decision 2 (trial/enrollment proposals): there is no prospects table
-- and program_waitlist is program-scoped with no contact columns, so
-- shoehorning email into note would corrupt its semantics. Chose option (c):
-- a minimal prospects table. Phase 2 patch contract (assert against this):
--   trial_request:      {target_table:'prospects', target_row_id:null,
--                        patch:{name:'', email:<sender>, source:'intake_trial_request',
--                               status:'trial'}}
--   enrollment_request: {target_table:'prospects', target_row_id:null,
--                        patch:{name:'', email:<sender>, source:'intake_enrollment_request',
--                               status:'inquiry'}}
-- Name is never guessed from the email text; the coach fills it at approval.
-- provider_id is injected from the proposal row by decide_intake_proposal when
-- the patch omits it. Statuses: trial|inquiry — never 'enrolled' (no
-- auto-enroll; enrollment stays a manual/coach step).
create table if not exists public.prospects (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid references public.intake_events(id) on delete set null,
  name          text not null default '',
  email         text,
  phone         text,
  source        text not null default 'intake',
  status        text not null default 'inquiry'
                  check (status in ('trial','inquiry','enrolled','dropped')),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.prospects is
  'Intake prospects (trial/enrollment inquiries). Rows are created ONLY via approved intake_proposals data_change patches — never auto-enrolled, never auto-contacted.';
create index if not exists idx_prospects_provider
  on public.prospects (provider_id, status, created_at desc);

alter table public.prospects enable row level security;
drop policy if exists prospects_owner_all on public.prospects;
create policy prospects_owner_all on public.prospects
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = prospects.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = prospects.provider_id and pv.owner_id = auth.uid()));
revoke all on public.prospects from public;
grant select, insert, update, delete on public.prospects to authenticated;

-- §K — generate_intake_followups: obligation drafts from intake findings.
-- Maps intake finding codes → drafts per design §3's D-column. DRAFTS ONLY:
-- lifecycle-approve stays the sole sender; every must-NOT in §3 is honored in
-- the draft copy (no auto-flip/waive/reschedule/enroll/send, no invented
-- programs/prices/roles, no money movement). Registered as v8 in
-- run_agent_drafts below. Idempotent via uq_oblig_agent_source_ref.
create or replace function public.generate_intake_followups(
  p_provider uuid default null, p_force boolean default false, p_run uuid default null)
returns integer
language plpgsql
security definer
set search_path to '' as $function$
declare
  inserted integer := 0;
  v_n integer;
  v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  -- (d1) intake_unavailability → message/availability_ack (to the guardian).
  -- Must-NOT: no auto-flip — the roster is untouched by this draft.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     guardian_id, member_id, run_id, why_finding_id, draft_type)
  select f.provider_id, 'message', 'draft',
    'Availability note — reply to ' || coalesce(g.first_name, 'the family'),
    'Hi ' || coalesce(g.first_name, 'there') || ' — thanks for letting us know '
      || coalesce(m.first_name, 'your athlete') || ' is unavailable. We have noted it; '
      || 'nothing on the roster changes until you approve. (Draft — review before sending.)',
    'agent', 'intake:availack:' || f.id, jsonb_build_object('action', 'void'),
    gl.guardian_id, f.member_id, v_run, f.id, 'availability_ack'
  from public.agent_findings f
  join public.team_athletes m on m.id = f.member_id
  join lateral (
    select gl2.guardian_id
      from public.guardian_links gl2
      join public.guardians g2 on g2.id = gl2.guardian_id
     where gl2.member_id = f.member_id and g2.email is not null and g2.email <> ''
     order by gl2.created_at limit 1
  ) gl on true
  join public.guardians g on g.id = gl.guardian_id
  where f.code = 'intake_unavailability' and f.status = 'open' and f.member_id is not null
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d2) intake_payment_hardship / intake_payment_issue → fee/payment_plan_offer.
  -- Must-NOT: no auto-waive, no installment mutation, no dunning pause.
  insert into public.obligations
    (provider_id, kind, status, title, detail, amount_cents, source_kind, source_ref, inverse,
     guardian_id, member_id, run_id, why_finding_id, draft_type)
  select f.provider_id, 'fee', 'draft',
    'Payment plan offer — ' || coalesce(m.first_name || ' ' || coalesce(m.last_name, ''), 'family'),
    'Hi ' || coalesce(g.first_name, 'there') || ' — we understand times are tight. '
      || 'We can split what is due into smaller payments; reply and we will set it up. '
      || 'Nothing is waived or paused by this draft — that needs your explicit approval.',
    f.amount_cents,
    'agent', 'intake:payplan:' || f.id, jsonb_build_object('action', 'void'),
    gl.guardian_id, f.member_id, v_run, f.id, 'payment_plan_offer'
  from public.agent_findings f
  left join public.team_athletes m on m.id = f.member_id
  left join lateral (
    select gl2.guardian_id
      from public.guardian_links gl2
      join public.guardians g2 on g2.id = gl2.guardian_id
     where gl2.member_id = f.member_id and g2.email is not null and g2.email <> ''
     order by gl2.created_at limit 1
  ) gl on true
  left join public.guardians g on g.id = gl.guardian_id
  where f.code in ('intake_payment_hardship', 'intake_payment_issue') and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d3) intake_schedule_change → schedule/schedule_change_notice.
  -- Must-NOT: no silent reschedule, no send without approval.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     run_id, why_finding_id, draft_type)
  select f.provider_id, 'schedule', 'draft',
    'Schedule change notice — review recipients',
    coalesce(f.title, 'A schedule change') || '. Draft family notice is ready below; '
      || 'review the recipient list before approving. Nothing is sent automatically — '
      || 'lifecycle-approve is the sole sender.',
    'agent', 'intake:schednotice:' || f.id, jsonb_build_object('action', 'void'),
    v_run, f.id, 'schedule_change_notice'
  from public.agent_findings f
  where f.code = 'intake_schedule_change' and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d4) intake_cancellation → schedule/cancellation_notice.
  -- Must-NOT: no mass send without approval.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     run_id, why_finding_id, draft_type)
  select f.provider_id, 'schedule', 'draft',
    'Cancellation notice — review recipients',
    coalesce(f.title, 'A cancellation') || '. Draft notice to affected families is ready; '
      || 'approve to queue it via lifecycle-approve. No mass send happens from this draft.',
    'agent', 'intake:cancelnotice:' || f.id, jsonb_build_object('action', 'void'),
    v_run, f.id, 'cancellation_notice'
  from public.agent_findings f
  where f.code = 'intake_cancellation' and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d5) intake_trial_request → message/trial_invite (director draft).
  -- Must-NOT: no auto-enroll as a full member — trial status only.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     run_id, why_finding_id, draft_type)
  select f.provider_id, 'message', 'draft',
    'Trial invite — draft for the inquiry',
    'A family asked about a trial. Draft invite below; fill in the session details '
      || 'before approving. Trial status only — never enroll as a full member from this draft.',
    'agent', 'intake:trialinvite:' || f.id, jsonb_build_object('action', 'void'),
    v_run, f.id, 'trial_invite'
  from public.agent_findings f
  where f.code = 'intake_trial_request' and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d6) intake_enrollment_request → message/welcome.
  -- Must-NOT: no auto-enroll — the welcome is a draft; enrollment stays manual.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     guardian_id, member_id, run_id, why_finding_id, draft_type)
  select f.provider_id, 'message', 'draft',
    'Welcome draft — ' || coalesce(m.first_name || ' ' || coalesce(m.last_name, ''), 'new family'),
    'Hi ' || coalesce(g.first_name, 'there') || ' — we would love to have '
      || coalesce(m.first_name, 'your athlete') || ' join us. Draft welcome below with next steps. '
      || 'Enrollment is NOT created by this draft; that stays a manual step.',
    'agent', 'intake:welcome:' || f.id, jsonb_build_object('action', 'void'),
    gl.guardian_id, f.member_id, v_run, f.id, 'welcome'
  from public.agent_findings f
  left join public.team_athletes m on m.id = f.member_id
  left join lateral (
    select gl2.guardian_id
      from public.guardian_links gl2
      join public.guardians g2 on g2.id = gl2.guardian_id
     where gl2.member_id = f.member_id and g2.email is not null and g2.email <> ''
     order by gl2.created_at limit 1
  ) gl on true
  left join public.guardians g on g.id = gl.guardian_id
  where f.code = 'intake_enrollment_request' and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d7) intake_engagement_risk → message/check_in (to the guardian).
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     guardian_id, member_id, run_id, why_finding_id, draft_type)
  select f.provider_id, 'message', 'draft',
    'Check-in — ' || coalesce(m.first_name || ' ' || coalesce(m.last_name, ''), 'family'),
    'Hi ' || coalesce(g.first_name, 'there') || ' — we have missed '
      || coalesce(m.first_name, 'your athlete') || ' at the last few sessions and wanted to check in. '
      || 'Draft below; personalize before approving.',
    'agent', 'intake:checkin:' || f.id, jsonb_build_object('action', 'void'),
    gl.guardian_id, f.member_id, v_run, f.id, 'check_in'
  from public.agent_findings f
  join public.team_athletes m on m.id = f.member_id
  join lateral (
    select gl2.guardian_id
      from public.guardian_links gl2
      join public.guardians g2 on g2.id = gl2.guardian_id
     where gl2.member_id = f.member_id and g2.email is not null and g2.email <> ''
     order by gl2.created_at limit 1
  ) gl on true
  join public.guardians g on g.id = gl.guardian_id
  where f.code = 'intake_engagement_risk' and f.status = 'open' and f.member_id is not null
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d8) intake_program_inquiry → message/program_match (director draft).
  -- Must-NOT: no invented programs/prices — slots come from the DB.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     run_id, why_finding_id, draft_type)
  select f.provider_id, 'message', 'draft',
    'Program match — draft reply to the inquiry',
    'A family asked about programs. Open slots right now (from your live roster, not a brochure): '
      || (select coalesce(
            string_agg(pr.title || ' (' || (pr.max_capacity - pr.enrolled_count) || ' open)', '; '
                       order by pr.title), 'no programs with open capacity right now')
          from public.programs pr
          where pr.provider_id = f.provider_id and pr.status = 'published'
            and pr.max_capacity > pr.enrolled_count)
      || '. Draft reply below — verify details before approving.',
    'agent', 'intake:progmatch:' || f.id, jsonb_build_object('action', 'void'),
    v_run, f.id, 'program_match'
  from public.agent_findings f
  where f.code = 'intake_program_inquiry' and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d9) intake_staff_unavailable → schedule/coverage_request (director-only).
  -- Must-NOT: no auto-reassign — coverage needs the owner's approval.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     run_id, why_finding_id, draft_type)
  select f.provider_id, 'schedule', 'draft',
    'Coverage needed — ' || coalesce(f.title, 'double-booked staff'),
    coalesce(f.detail, 'A staff member cannot cover an assignment.')
      || ' Find cover before the date; reassignment needs your approval — '
      || 'nothing was reassigned automatically. (Director-only draft.)',
    'agent', 'intake:coverage:' || f.id, jsonb_build_object('action', 'void'),
    v_run, f.id, 'coverage_request'
  from public.agent_findings f
  where f.code = 'intake_staff_unavailable' and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d10) REMOVED 2026-09-23: intake_staff_onboarding findings cannot exist
  -- (organization_members.role is NOT NULL), so no role_assignment draft block.

  -- (d11) season_wrap_due → deadline/season_wrap (director-only summary).
  -- Must-NOT: no auto-void of balances — review only.
  insert into public.obligations
    (provider_id, kind, status, title, detail, amount_cents, due_at,
     source_kind, source_ref, inverse, run_id, why_finding_id, draft_type)
  select f.provider_id, 'deadline', 'draft',
    'Season wrap — review outstanding balances',
    coalesce(f.title, 'A season ended') || '. '
      || coalesce(f.detail, 'Balances remain outstanding.')
      || ' Review within two weeks — nothing is voided automatically. (Director-only.)',
    f.amount_cents, now() + interval '14 days',
    'agent', 'intake:seasonwrap:' || f.id, jsonb_build_object('action', 'void'),
    v_run, f.id, 'season_wrap'
  from public.agent_findings f
  where f.code = 'season_wrap_due' and f.status = 'open'
    and (p_provider is null or f.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(f.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  -- (d12) month-end commission payout summary — message/payout_summary,
  -- director-only. Terms come from organization_members; NO revenue figures
  -- are invented and NO money moves (no payout records created).
  -- Fires in the last 3 days of the month; the monthly source_ref dedupes.
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     run_id, draft_type)
  select p.id, 'message', 'draft',
    'Month-end commission summary — ' || to_char(current_date, 'Mon YYYY'),
    'Commission TERMS on file (review in your payroll provider — this draft moves '
      || 'no money and creates no payout records): '
      || string_agg(
           coalesce(nullif(om.trainer_profile ->> 'name', ''), 'staff ' || left(om.id::text, 8))
           || ': ' || coalesce(om.commission_type, 'unspecified terms')
           || case when om.commission_value is not null
                   then ' ' || om.commission_value::text else '' end,
           '; ' order by coalesce(nullif(om.trainer_profile ->> 'name', ''), om.id::text))
      || '. (Director-only draft.)',
    'agent', 'intake:payout:' || p.id || ':' || to_char(current_date, 'YYYY-MM'),
    jsonb_build_object('action', 'void'),
    v_run, 'payout_summary'
  from public.providers p
  join public.organization_members om
    on om.organization_id = p.id and om.is_active
   and (om.commission_type is not null or om.commission_value is not null)
  where current_date >= (date_trunc('month', current_date) + interval '1 month'
                         - interval '3 days')::date
    and (p_provider is null or p.id = p_provider)
    and (p_force or public.agent_autodraft_on(p.id))
  group by p.id
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics v_n = row_count;
  inserted := inserted + v_n;

  return inserted;
end; $function$;

comment on function public.generate_intake_followups(uuid, boolean, uuid) is
  'Draft-only followups for intake findings (design §3 D-column) + monthly commission payout summary. Never sends, never mutates, never invents figures.';

-- §L — run_agent_drafts: register the intake generator as v8. The UI iterates
-- a fixed key map, so the additive ''intake'' key is ignored by the run
-- screen; ''total'' includes it.
create or replace function public.run_agent_drafts(p_provider uuid)
returns jsonb
language plpgsql
security definer
set search_path to '' as $function$
declare v1 int; v2 int; v3 int; v4 int; v5 int; v6 int; v7 int; v8 int;
        v_run uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.providers where id=p_provider and owner_id=auth.uid()) then
    raise exception 'only the org owner may run the agent'; end if;
  v1 := public.generate_installment_followups(p_provider, true, v_run);
  v2 := public.generate_waiver_followups(p_provider, true, v_run);
  v3 := public.generate_practice_reminders(p_provider, true, v_run);
  v4 := public.generate_reactivation_drafts(p_provider, true, v_run);
  v5 := public.generate_eligibility_report(p_provider, true, v_run);
  v6 := public.generate_missing_info_requests(p_provider, true, v_run);
  v7 := public.generate_idle_capacity_offers(p_provider, true, v_run);
  v8 := public.generate_intake_followups(p_provider, true, v_run);
  return jsonb_build_object('dues',v1,'waivers',v2,'practice',v3,'reactivation',v4,
    'eligibility',v5,'missing_info',v6,'capacity_offer',v7,'intake',v8,
    'total',v1+v2+v3+v4+v5+v6+v7+v8,'run_id',v_run);
end; $function$;
