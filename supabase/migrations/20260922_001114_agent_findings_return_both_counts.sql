-- 2026-09-22: "N things noticed" drift — generate_agent_findings returns both counts.
--
-- Drift: production generate_agent_findings returned count(distinct kind) while
-- the UI's "Read pass · N things noticed" copy sits next to the rendered finding
-- ROWS. With two findings of the same kind the copy under-counted.
-- Fix: the function now RETURNS jsonb {"n_kinds": <distinct kinds>, "n_rows": <rows>};
-- run_agent_read passes the object through and the UI copy uses n_rows so the
-- number matches the findings actually shown. CREATE OR REPLACE cannot change a
-- return type, hence DROP + CREATE (no pg_depend entries on either function).
--
-- NOTE: body below is the production function (verified byte-identical to
-- 20260902_001020_brain_fill.sql) with only the head/declare/tail changed.

drop function if exists public.generate_agent_findings(uuid, boolean);
CREATE OR REPLACE FUNCTION public.generate_agent_findings(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n_kinds integer := 0; n_rows integer := 0; v_run uuid := gen_random_uuid();
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
  get diagnostics n_rows = row_count;

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

  select count(distinct kind) into n_kinds from public.agent_findings where run_id = v_run;
  select count(*) into n_rows from public.agent_findings where run_id = v_run;
  return jsonb_build_object('n_kinds', n_kinds, 'n_rows', n_rows);
end; $function$;


-- original grants from 20260901_001019_company_brain.sql: no direct execute for anyone;
-- only run_agent_read (SECURITY DEFINER) invokes it.
revoke all on function public.generate_agent_findings(uuid, boolean) from public, anon, authenticated;

-- run_agent_read passes the {n_kinds, n_rows} object through to the client.
drop function if exists public.run_agent_read(uuid);
create function public.run_agent_read(p_provider uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to '' as $function$
begin
  if not exists (select 1 from public.providers where id = p_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may run the agent';
  end if;
  return public.generate_agent_findings(p_provider, true);
end; $function$;

revoke all on function public.run_agent_read(uuid) from public, anon;
grant execute on function public.run_agent_read(uuid) to authenticated;
