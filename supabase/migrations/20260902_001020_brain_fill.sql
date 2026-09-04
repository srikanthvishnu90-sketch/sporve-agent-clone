-- 20260902_001020 — THE BRAIN FILL (doc 11): findings + proposals.
-- Originally applied to prod via execute_sql on 2026-09-02 with only a
-- comment file left in git. Backfilled 2026-09-03 (pentest finding 1):
-- every body below is dumped verbatim from prod (pg_get_functiondef /
-- pg_constraint / pg_policies), so a fresh apply reproduces prod exactly.
-- Idempotent: create-if-not-exists / create-or-replace throughout.

create table if not exists public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  kind text not null check (kind in ('schedule_adjustment','staff_assignment','payment_plan')),
  status text not null default 'pending' check (status in ('pending','applied','dismissed')),
  title text not null,
  detail text,
  proposed jsonb not null,
  why_finding_id uuid references public.agent_findings(id) on delete set null,
  applied_by uuid references public.profiles(id) on delete set null,
  applied_at timestamptz,
  run_id uuid,
  created_at timestamptz not null default now()
);

alter table public.agent_proposals enable row level security;
drop policy if exists agent_proposals_owner on public.agent_proposals;
create policy agent_proposals_owner on public.agent_proposals
  for all to authenticated
  using (exists (select 1 from public.providers p
                 where p.id = agent_proposals.provider_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers p
                      where p.id = agent_proposals.provider_id and p.owner_id = auth.uid()));

create unique index if not exists uq_proposal_ref
  on public.agent_proposals (provider_id, kind, ((proposed->>'ref')))
  where status = 'pending';

-- ── generate_agent_findings (verbatim from prod) ──
CREATE OR REPLACE FUNCTION public.generate_agent_findings(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer := 0; v_run uuid := gen_random_uuid();
begin
  -- (existing 5 kinds preserved) --------------------------------------------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, amount_cents, run_id, evidence, subject_type)
  select p.id, 'money', 'overdue_summary',
    case when sum(i.amount_cents) >= 50000 then 'urgent' else 'warn' end,
    'Outstanding dues: ' || to_char(sum(i.amount_cents)/100.0,'FM$999,999,990.00') || ' across ' || count(distinct i.member_id) || ' member(s)',
    count(*) || ' installment(s) past due. Overdue derived from due date and status.',
    'finding:overdue:' || p.id || ':' || current_date, sum(i.amount_cents), v_run,
    jsonb_build_object('installments', count(*), 'members', count(distinct i.member_id)), 'provider'
  from public.providers p
  join public.fee_schedules fs on fs.provider_id = p.id and fs.status='active'
  join public.installments i on i.fee_schedule_id = fs.id and i.due_date < current_date and i.status not in ('paid','waived')
  where (p_provider is null or p.id=p_provider) and (p_force or public.agent_read_on(p.id))
  group by p.id
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title=excluded.title, detail=excluded.detail, amount_cents=excluded.amount_cents, severity=excluded.severity, evidence=excluded.evidence, run_id=excluded.run_id, updated_at=now();
  get diagnostics n = row_count;

  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, member_id, subject_type, subject_id, run_id)
  select m.provider_id, 'people', 'missing_email', 'info',
    m.first_name || ' ' || coalesce(m.last_name,'') || ' has no guardian email',
    'Dues reminders and waivers can''t reach this family until a guardian email is on file.',
    'finding:missing_email:' || m.id, m.id, 'member', m.id, v_run
  from public.team_athletes m
  where m.status='active' and m.first_name is not null
    and (p_provider is null or m.provider_id=p_provider) and (p_force or public.agent_read_on(m.provider_id))
    and not exists (select 1 from public.guardian_links gl join public.guardians g on g.id=gl.guardian_id where gl.member_id=m.id and g.email is not null and g.email<>'')
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, subject_type, subject_id, run_id)
  select sc.organization_id, 'people', 'credential_expiry',
    case when sc.expires_at <= current_date+7 then 'urgent' when sc.expires_at <= current_date+30 then 'attention' else 'info' end,
    sc.kind || ' expires ' || to_char(sc.expires_at,'Mon DD') || ' (' || (sc.expires_at-current_date) || ' days)',
    'Reference ' || coalesce(sc.reference,'—') || '. A lapsed check blocks assignment at the next event.',
    'finding:cred:' || sc.id || ':' || sc.expires_at, 'staff', sc.member_user_id, v_run
  from public.staff_certifications sc
  where sc.expires_at is not null and sc.expires_at <= current_date+60 and sc.status in ('verified','attested')
    and (p_provider is null or sc.organization_id=p_provider) and (p_force or public.agent_read_on(sc.organization_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, severity=excluded.severity, run_id=excluded.run_id, updated_at=now();

  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id)
  select wd.provider_id, 'documents', 'waivers_unsigned', 'warn',
    count(*) || ' member(s) have not signed a required waiver',
    'Current-version signatures are missing; these members can''t participate until signed.',
    'finding:waivers:' || wd.provider_id || ':' || current_date, v_run
  from public.waiver_documents wd
  join public.team_athletes m on m.provider_id=wd.provider_id and m.status='active'
  where wd.version = (select max(w2.version) from public.waiver_documents w2 where w2.provider_id=wd.provider_id and w2.title=wd.title)
    and not exists (select 1 from public.waiver_signatures ws where ws.waiver_document_id=wd.id and ws.member_id=m.id)
    and (p_provider is null or wd.provider_id=p_provider) and (p_force or public.agent_read_on(wd.provider_id))
  group by wd.provider_id
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id)
  select p.id, 'clients', 'lapsed_members', 'info',
    count(*) || ' member(s) from last season haven''t re-enrolled',
    'First-party win-back candidates. The reactivation draft targets these in Draft mode.',
    'finding:lapsed:' || p.id || ':' || current_date, v_run
  from public.providers p
  join public.team_athletes m on m.provider_id=p.id and m.status='active' and m.first_name is not null
  where (p_provider is null or p.id=p_provider) and (p_force or public.agent_read_on(p.id))
    and exists (select 1 from public.fee_schedules f join public.seasons s on s.id=f.season_id where f.member_id=m.id and s.end_date<current_date)
    and not exists (select 1 from public.fee_schedules f join public.seasons s on s.id=f.season_id where f.member_id=m.id and s.end_date>=current_date and f.status in ('active','complete'))
  group by p.id
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (1) reconciliation_drift: ledger rows with no stripe object id ------------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id, evidence)
  select fs.provider_id, 'money', 'reconciliation_drift', 'attention',
    count(*) || ' ledger row(s) with no Stripe object id',
    'Applied payment events missing a stripe_object_id — reconcile before close.',
    'finding:recon:' || fs.provider_id || ':' || current_date, v_run,
    jsonb_build_object('rows', count(*))
  from public.payment_event_ledger l
  join public.installments i on i.id::text = l.stripe_object_id or l.event_type like '%installment%'
  join public.fee_schedules fs on fs.id = i.fee_schedule_id
  where l.stripe_object_id is null and l.outcome='applied'
    and (p_provider is null or fs.provider_id=p_provider) and (p_force or public.agent_read_on(fs.provider_id))
  group by fs.provider_id
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (2) refund_exposure: members with 2+ failed attempts AND an overdue -------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, member_id, subject_type, subject_id, amount_cents, run_id)
  select fs.provider_id, 'money', 'refund_exposure', 'attention',
    m.first_name || ' ' || coalesce(m.last_name,'') || ' — repeated payment failures with a balance due',
    'This member has 2+ failed attempts and an overdue installment; likely to withdraw.',
    'finding:refundexp:' || m.id, m.id, 'member', m.id,
    (select sum(i2.amount_cents) from public.installments i2 where i2.member_id=m.id and i2.status not in ('paid','waived') and i2.due_date<current_date),
    v_run
  from public.team_athletes m
  join public.fee_schedules fs on fs.member_id=m.id and fs.status='active'
  where m.status='active'
    and (p_provider is null or fs.provider_id=p_provider) and (p_force or public.agent_read_on(fs.provider_id))
    and exists (select 1 from public.installments i where i.member_id=m.id and i.attempt_count>=2)
    and exists (select 1 from public.installments i where i.member_id=m.id and i.status not in ('paid','waived') and i.due_date<current_date)
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, amount_cents=excluded.amount_cents, run_id=excluded.run_id, updated_at=now();

  -- (3) staffing_gap: session in next 14d with no assigned staff --------------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, subject_type, subject_id, run_id)
  select pr.provider_id, 'schedule', 'staffing_gap',
    case when s.start_date <= current_date+3 then 'urgent' else 'attention' end,
    'No staff assigned — ' || coalesce(s.title, pr.title) || ' on ' || to_char(s.start_date,'Mon DD'),
    'A scheduled event in the next 14 days has no assigned staff member.',
    'finding:staffgap:' || s.id, 'session', s.id, v_run
  from public.sessions s
  join public.programs pr on pr.id = s.program_id
  where s.assigned_member_id is null and s.start_date between current_date and current_date+14
    and (p_provider is null or pr.provider_id=p_provider) and (p_force or public.agent_read_on(pr.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, severity=excluded.severity, run_id=excluded.run_id, updated_at=now();

  -- (4) booking_unconfirmed: session next 14d with no facility ----------------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, subject_type, subject_id, run_id)
  select pr.provider_id, 'schedule', 'booking_unconfirmed',
    case when s.start_date <= current_date+3 then 'urgent' else 'attention' end,
    'No location set — ' || coalesce(s.title, pr.title) || ' on ' || to_char(s.start_date,'Mon DD'),
    'A scheduled event in the next 14 days has no facility/address confirmed.',
    'finding:bookunconf:' || s.id, 'session', s.id, v_run
  from public.sessions s
  join public.programs pr on pr.id = s.program_id
  where (s.address is null or s.address='') and s.start_date between current_date and current_date+14
    and (p_provider is null or pr.provider_id=p_provider) and (p_force or public.agent_read_on(pr.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, severity=excluded.severity, run_id=excluded.run_id, updated_at=now();

  -- (5) schedule_conflict: same facility + date + start_time, two sessions ----
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id, evidence)
  select pr.provider_id, 'schedule', 'schedule_conflict', 'urgent',
    'Double-booked: ' || s.address || ' on ' || to_char(s.start_date,'Mon DD') || coalesce(' at '||s.start_time,''),
    'Two events share a facility and slot. Resolve before the date.',
    'finding:conflict:' || pr.provider_id || ':' || md5(s.address||s.start_date::text||coalesce(s.start_time,'')), v_run,
    jsonb_build_object('address', s.address, 'date', s.start_date, 'time', s.start_time)
  from public.sessions s
  join public.programs pr on pr.id=s.program_id
  where s.address is not null and s.start_date>=current_date
    and (p_provider is null or pr.provider_id=p_provider) and (p_force or public.agent_read_on(pr.provider_id))
    and (select count(*) from public.sessions s2 join public.programs pr2 on pr2.id=s2.program_id
         where pr2.provider_id=pr.provider_id and s2.address=s.address and s2.start_date=s.start_date
           and coalesce(s2.start_time,'')=coalesce(s.start_time,'')) > 1
  group by pr.provider_id, s.address, s.start_date, s.start_time
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (6) roster_gap: team below target_size --------------------------------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, subject_type, subject_id, run_id, evidence)
  select t.provider_id, 'people', 'roster_gap', 'info',
    t.name || ' is below its target size (' || (select count(*) from public.team_athletes m where m.team_id=t.id and m.status='active') || ' of ' || t.target_size || ')',
    'This group is under its target headcount — a recruiting or reactivation opportunity.',
    'finding:rostergap:' || t.id, 'team', t.id, v_run,
    jsonb_build_object('target', t.target_size)
  from public.teams t
  where t.target_size is not null
    and (select count(*) from public.team_athletes m where m.team_id=t.id and m.status='active') < t.target_size
    and (p_provider is null or t.provider_id=p_provider) and (p_force or public.agent_read_on(t.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (7) missing_data: no DOB on an active member --------------------------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, member_id, subject_type, subject_id, run_id, evidence)
  select m.provider_id, 'people', 'missing_data', 'info',
    m.first_name || ' ' || coalesce(m.last_name,'') || ' is missing a date of birth',
    'Required for age-group placement and some waivers.',
    'finding:missingdob:' || m.id, m.id, 'member', m.id, v_run,
    jsonb_build_object('missing', jsonb_build_array('dob'))
  from public.team_athletes m
  where m.status='active' and m.first_name is not null and m.dob is null
    and (p_provider is null or m.provider_id=p_provider) and (p_force or public.agent_read_on(m.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (8) waiver_drift: a signature bound to a superseded document version ---
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, member_id, subject_type, subject_id, run_id)
  select wd.provider_id, 'documents', 'waiver_drift', 'attention',
    m.first_name || ' ' || coalesce(m.last_name,'') || ' signed an old version of ' || wd.title,
    'Their signature is bound to a superseded document version; a re-sign may be required.',
    'finding:waiverdrift:' || ws.id, m.id, 'member', m.id, v_run
  from public.waiver_signatures ws
  join public.waiver_documents wd on wd.id = ws.waiver_document_id
  join public.team_athletes m on m.id = ws.member_id
  where ws.document_version < (select max(w2.version) from public.waiver_documents w2 where w2.provider_id=wd.provider_id and w2.title=wd.title)
    and (p_provider is null or wd.provider_id=p_provider) and (p_force or public.agent_read_on(wd.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (9) idle_capacity: program < 70% enrolled with a session <= 14d away ---
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, subject_type, subject_id, run_id, evidence)
  select pr.provider_id, 'clients', 'idle_capacity', 'attention',
    pr.title || ' is ' || round(100.0*pr.enrolled_count/nullif(pr.max_capacity,0)) || '% full with a start in ' || (min(s.start_date)-current_date) || ' days',
    'Under-enrolled with little time left — offer the open spots to existing families first.',
    'finding:idlecap:' || pr.id, 'program', pr.id, v_run,
    jsonb_build_object('enrolled', pr.enrolled_count, 'capacity', pr.max_capacity)
  from public.programs pr
  join public.sessions s on s.program_id = pr.id and s.start_date between current_date and current_date+14
  where pr.max_capacity > 0 and pr.enrolled_count::numeric/pr.max_capacity < 0.7
    and (p_provider is null or pr.provider_id=p_provider) and (p_force or public.agent_read_on(pr.provider_id))
  group by pr.id
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (10) waitlist_match: active program waitlist + another program with room -
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id, evidence)
  select pw.provider_id, 'clients', 'waitlist_match', 'info',
    coalesce(pw.athlete_first_name,'A family') || ' is waitlisted, but you have open capacity elsewhere',
    'Turn a lost inquiry into a booking by offering an open program in the same org.',
    'finding:waitmatch:' || pw.id, v_run,
    jsonb_build_object('waitlist_id', pw.id)
  from public.program_waitlist pw
  where pw.status='waiting'
    and exists (select 1 from public.programs pr where pr.provider_id=pw.provider_id and pr.max_capacity>pr.enrolled_count and pr.status='active')
    and (p_provider is null or pw.provider_id=p_provider) and (p_force or public.agent_read_on(pw.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (11) camp_to_program: a camp fee schedule but no team/current enrollment -
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, member_id, subject_type, subject_id, run_id)
  select fs.provider_id, 'clients', 'camp_to_program', 'info',
    m.first_name || ' ' || coalesce(m.last_name,'') || ' did a camp but never joined a program',
    'A camp attendee with no ongoing enrollment — a warm conversion candidate.',
    'finding:camp2prog:' || m.id, m.id, 'member', m.id, v_run
  from public.team_athletes m
  join public.fee_schedules fs on fs.member_id=m.id
  join public.programs pr on pr.id=fs.program_id and pr.offering_type='camp'
  where m.status='active'
    and (p_provider is null or fs.provider_id=p_provider) and (p_force or public.agent_read_on(fs.provider_id))
    and not exists (select 1 from public.fee_schedules f2 join public.programs p2 on p2.id=f2.program_id
                    where f2.member_id=m.id and p2.offering_type<>'camp' and f2.status in ('active','complete'))
  group by fs.provider_id, m.id, m.first_name, m.last_name
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, run_id=excluded.run_id, updated_at=now();

  -- (12) collection_trend: this period collected/billed vs prior -----------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id, evidence)
  select fs.provider_id, 'money', 'collection_trend',
    case when this_rate < prior_rate - 0.1 then 'attention' else 'info' end,
    'Collection rate ' || round(100*this_rate) || '% this month vs ' || round(100*prior_rate) || '% last',
    'Share of billed dues actually collected, month over month.',
    'finding:trend:' || fs.provider_id || ':' || to_char(current_date,'YYYY-MM'), v_run,
    jsonb_build_object('this', round(100*this_rate), 'prior', round(100*prior_rate))
  from (
    select fs.provider_id,
      coalesce(sum(i.amount_cents) filter (where i.status='paid' and i.due_date >= date_trunc('month',current_date)),0)::numeric
        / nullif(sum(i.amount_cents) filter (where i.due_date >= date_trunc('month',current_date)),0) as this_rate,
      coalesce(sum(i.amount_cents) filter (where i.status='paid' and i.due_date >= date_trunc('month',current_date)-interval '1 month' and i.due_date < date_trunc('month',current_date)),0)::numeric
        / nullif(sum(i.amount_cents) filter (where i.due_date >= date_trunc('month',current_date)-interval '1 month' and i.due_date < date_trunc('month',current_date)),0) as prior_rate
    from public.fee_schedules fs join public.installments i on i.fee_schedule_id=fs.id
    group by fs.provider_id
  ) fs
  where this_rate is not null and prior_rate is not null
    and (p_provider is null or fs.provider_id=p_provider) and (p_force or public.agent_read_on(fs.provider_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, severity=excluded.severity, evidence=excluded.evidence, run_id=excluded.run_id, updated_at=now();

  -- (13) org_structure: weekly snapshot ------------------------------------
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id, evidence)
  select p.id, 'people', 'org_structure', 'info',
    (select count(*) from public.teams t where t.provider_id=p.id) || ' groups · ' ||
    (select count(*) from public.team_athletes m where m.provider_id=p.id and m.status='active') || ' members · ' ||
    (select count(*) from public.organization_members om where om.organization_id=p.id and om.is_active) || ' staff',
    (select count(*) from public.team_athletes m where m.provider_id=p.id and m.status='active' and m.team_id is null) || ' member(s) not yet assigned to a group.',
    'finding:orgstruct:' || p.id || ':' || to_char(current_date,'IYYY-IW'), v_run,
    jsonb_build_object('unassigned', (select count(*) from public.team_athletes m where m.provider_id=p.id and m.status='active' and m.team_id is null))
  from public.providers p
  where (p_provider is null or p.id=p_provider) and (p_force or public.agent_read_on(p.id))
    and exists (select 1 from public.team_athletes m where m.provider_id=p.id)
  on conflict (provider_id, source_ref) where status <> 'dismissed' do update set title=excluded.title, detail=excluded.detail, evidence=excluded.evidence, run_id=excluded.run_id, updated_at=now();

  select count(distinct kind) into n from public.agent_findings where run_id = v_run;
  return n;
end; $function$;

-- ── generate_agent_proposals (verbatim from prod) ──
CREATE OR REPLACE FUNCTION public.generate_agent_proposals(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer := 0; v_run uuid := gen_random_uuid();
begin
  -- staff_assignment: fill a staffing_gap with any active, checked staff member
  insert into public.agent_proposals (provider_id, kind, title, detail, proposed, why_finding_id, run_id)
  select f.provider_id, 'staff_assignment',
    'Assign staff to ' || f.title,
    'A qualified staff member is free for this event.',
    jsonb_build_object('ref','staffassign:'||f.subject_id,'session_id',f.subject_id,
      'assign_member', (select om.member_user_id from public.organization_members om
                        where om.organization_id=f.provider_id and om.is_active limit 1)),
    f.id, v_run
  from public.agent_findings f
  where f.code='staffing_gap' and f.status='open'
    and (p_provider is null or f.provider_id=p_provider) and (p_force or public.agent_read_on(f.provider_id))
    and exists (select 1 from public.organization_members om where om.organization_id=f.provider_id and om.is_active)
  on conflict (provider_id, kind, (proposed->>'ref')) where status='pending' do nothing;
  get diagnostics n = row_count;

  -- payment_plan: for refund_exposure members, propose splitting the overdue
  insert into public.agent_proposals (provider_id, kind, title, detail, proposed, why_finding_id, run_id)
  select f.provider_id, 'payment_plan',
    'Payment plan for ' || f.title,
    'Split the overdue balance into 3 monthly installments instead of another reminder.',
    jsonb_build_object('ref','payplan:'||f.member_id,'member_id',f.member_id,
      'total_cents', f.amount_cents, 'installments', 3,
      'schedule', jsonb_build_array(current_date+7, current_date+37, current_date+67)),
    f.id, v_run
  from public.agent_findings f
  where f.code='refund_exposure' and f.status='open' and f.amount_cents>0
    and (p_provider is null or f.provider_id=p_provider) and (p_force or public.agent_read_on(f.provider_id))
  on conflict (provider_id, kind, (proposed->>'ref')) where status='pending' do nothing;

  select count(*) into n from public.agent_proposals where run_id=v_run;
  return n;
end; $function$;

-- ── apply_agent_proposal (verbatim from prod) ──
CREATE OR REPLACE FUNCTION public.apply_agent_proposal(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr record; v_written int := 0;
begin
  select * into pr from public.agent_proposals where id=p_proposal_id;
  if pr.id is null then raise exception 'no such proposal'; end if;
  if not exists (select 1 from public.providers where id=pr.provider_id and owner_id=auth.uid()) then
    raise exception 'only the org owner may apply'; end if;
  if pr.status<>'pending' then raise exception 'proposal is not pending'; end if;
  if pr.kind='staff_assignment' then
    update public.sessions set assigned_member_id = (pr.proposed->>'assign_member')::uuid
     where id = (pr.proposed->>'session_id')::uuid and assigned_member_id is null;
    get diagnostics v_written = row_count;
  elsif pr.kind='schedule_adjustment' then
    update public.sessions set start_date = (pr.proposed->>'new_date')::date
     where id = (pr.proposed->>'session_id')::uuid;
    get diagnostics v_written = row_count;
  elsif pr.kind='payment_plan' then
    raise exception 'payment_plan changes money and is applied by hand in the Money screen, not the agent';
  else
    raise exception 'unknown proposal kind %', pr.kind;
  end if;
  update public.agent_proposals set status='applied', applied_by=auth.uid(), applied_at=now() where id=p_proposal_id;
  return jsonb_build_object('applied', pr.kind, 'rows_written', v_written);
end; $function$;

-- ── generate_missing_info_requests (verbatim from prod) ──
CREATE OR REPLACE FUNCTION public.generate_missing_info_requests(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_run uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse, guardian_id, member_id, run_id, draft_type)
  select gm.provider_id, 'message', 'draft',
    'Missing details for ' || gm.member_names,
    'Hi ' || coalesce(gm.gfirst,'there') || ' — to finish setting up '
      || gm.member_names || ', we still need: ' || gm.gaps
      || '. You can add these from your ' || public.agent_vocab(gm.provider_id,'member','account') || ' page anytime.',
    'agent', 'missinginfo:' || gm.guardian_id || ':' || current_date,
    jsonb_build_object('action','void'), gm.guardian_id, gm.first_member, v_run, 'missing_info_request'
  from (
    select fs.provider_id, g.id as guardian_id, g.first_name as gfirst,
      string_agg(distinct m.first_name, ', ') as member_names,
      (array_agg(m.id))[1] as first_member,
      string_agg(distinct 'date of birth for '||m.first_name, '; ') as gaps
    from public.guardian_links gl
    join public.guardians g on g.id=gl.guardian_id
    join public.team_athletes m on m.id=gl.member_id and m.status='active' and m.dob is null
    join public.fee_schedules fs on fs.member_id=m.id
    where g.email is not null
    group by fs.provider_id, g.id, g.first_name
  ) gm
  where (p_provider is null or gm.provider_id=p_provider) and (p_force or public.agent_autodraft_on(gm.provider_id))
  on conflict (source_ref) where source_kind='agent' and status<>'void' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $function$;

-- ── generate_idle_capacity_offers (verbatim from prod) ──
CREATE OR REPLACE FUNCTION public.generate_idle_capacity_offers(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_run uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse, guardian_id, member_id, run_id, draft_type, why_finding_id)
  select pr.provider_id, 'message', 'draft',
    'Open spots in ' || pr.title,
    'Hi ' || coalesce(g.first_name,'there') || ' — a few spots just opened in ' || pr.title
      || '. We wanted to offer them to our current families first before opening them up. Reply if you''d like one for '
      || m.first_name || '.',
    'agent', 'capacityoffer:' || pr.id || ':' || m.id, jsonb_build_object('action','void'),
    g.id, m.id, v_run, 'idle_capacity_offer', f.id
  from public.agent_findings f
  join public.programs pr on pr.id = f.subject_id and f.code='idle_capacity' and f.status='open'
  join public.team_athletes m on m.provider_id=pr.provider_id and m.status='active'
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl join public.guardians g2 on g2.id=gl.guardian_id
                     where gl.member_id=m.id and gl.is_payer and g2.email_status='ok' limit 1) g on true
  where g.id is not null
    and (p_provider is null or pr.provider_id=p_provider) and (p_force or public.agent_autodraft_on(pr.provider_id))
  on conflict (source_ref) where source_kind='agent' and status<>'void' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $function$;

