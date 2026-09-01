-- ============================================================================
-- Doc 06 · AGENT v2 — enforced idempotency, run provenance, and the three
-- missing T1 jobs: B2 weekend eligibility, C2 schedule-change broadcast,
-- D1 reactivation. Plus the clo-found defects: B1 season-blindness, the
-- approve mapping catch-all, and card declines (payment_intent.payment_failed)
-- never reaching the ledger. Applied to prod 2026-09-01 as spec06_agent_v2.
--
-- Premise rulings (rule 9): D1's "unconverted inquiries" leg REFUSED — no
-- inquiries table exists; lapsed members + camp non-rebookers are the same
-- derived query and both ship. B2's per-team grouping keys off the team
-- program (teams and programs are 1:1 by construction; no FK links them).
-- ============================================================================

-- A ── idempotency becomes structural: one live agent row per source_ref
alter table public.obligations add column if not exists run_id uuid;
create unique index if not exists uq_oblig_agent_source_ref
  on public.obligations (source_ref)
  where source_kind = 'agent' and status <> 'void';

-- B ── B1 season fix: a signature only counts for a CURRENT/FUTURE season
-- (or an unscoped one). Last season's ink no longer suppresses this season.
create or replace function public.generate_waiver_followups(
  p_provider uuid default null, p_force boolean default false,
  p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     member_id, guardian_id, run_id)
  select wd.provider_id, 'waiver', 'draft',
    '“' || wd.title || '” unsigned — ' || m.first_name || ' ' || coalesce(m.last_name,''),
    'Hi ' || coalesce(g.first_name,'there') || ' — the ' || wd.title
      || ' still needs a signature for ' || m.first_name
      || ' before they can participate. It takes about a minute from your Sporv account.',
    'agent', 'waiver:' || wd.id || ':member:' || m.id,
    jsonb_build_object('action','void','reason','undo waiver follow-up'),
    m.id, g.id, v_run
  from public.waiver_documents wd
  join public.team_athletes m on m.provider_id = wd.provider_id and m.status = 'active'
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = m.id and gl.is_payer limit 1) g on true
  where wd.version = (select max(w2.version) from public.waiver_documents w2
                      where w2.provider_id = wd.provider_id and w2.title = wd.title)
    and m.first_name is not null
    and not exists (select 1 from public.waiver_signatures ws
                    where ws.waiver_document_id = wd.id and ws.member_id = m.id
                      and (ws.season_id is null or ws.season_id in
                           (select s.id from public.seasons s
                            where s.provider_id = wd.provider_id
                              and s.end_date >= current_date)))
    and (p_provider is null or wd.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(wd.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.generate_waiver_followups(uuid, boolean, uuid) from public, anon, authenticated;
drop function if exists public.generate_waiver_followups(uuid, boolean);

-- C ── C2: schedule-change broadcast. Trigger on the director's own edit —
-- one drafted notice per payer guardian of members on an active plan for the
-- affected program only. Same-day re-edits REWRITE the existing draft's text
-- (key session:<id>:change:<date>:member:<id>), never flood. SECURITY DEFINER
-- because enforcement triggers refuse client-context writes (see 001014).
-- Deliberately ignores the autodraft toggle: the trigger IS the director
-- acting, not the agent waking up on its own.
create or replace function public.draft_schedule_change_notices()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_run uuid := gen_random_uuid();
begin
  if new.start_date < current_date then return new; end if;
  insert into public.obligations
    (provider_id, kind, status, title, detail, due_at, source_kind, source_ref,
     inverse, member_id, guardian_id, run_id)
  select pr.provider_id, 'schedule', 'draft',
    'Schedule change — ' || coalesce(new.title, pr.title),
    'Hi ' || coalesce(g.first_name,'there') || ' — ' || coalesce(new.title, pr.title)
      || ' has changed: now ' || to_char(new.start_date,'Dy Mon DD')
      || coalesce(' at ' || new.start_time, '')
      || coalesce(', ' || new.address, '') || '. Sorry for the shuffle — see the updated schedule in Sporv.',
    new.start_date::timestamptz, 'agent',
    'session:' || new.id || ':change:' || current_date || ':member:' || fs2.member_id,
    jsonb_build_object('action','void','reason','undo schedule-change notice'),
    fs2.member_id, g.id, v_run
  from public.programs pr
  join (select distinct member_id, program_id from public.fee_schedules
        where status = 'active') fs2 on fs2.program_id = pr.id
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = fs2.member_id and gl.is_payer limit 1) g on true
  where pr.id = new.program_id and pr.offering_type = 'team'
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do update set title = excluded.title, detail = excluded.detail,
                run_id = excluded.run_id, updated_at = now()
  where obligations.status = 'draft';
  return new;
end; $$;
revoke all on function public.draft_schedule_change_notices() from public, anon, authenticated;
drop trigger if exists trg_schedule_change_notices on public.sessions;
create trigger trg_schedule_change_notices after update on public.sessions
  for each row when ((new.start_date, new.start_time, new.end_time, new.address, new.timezone)
                     is distinct from
                     (old.start_date, old.start_time, old.end_time, old.address, old.timezone))
  execute function public.draft_schedule_change_notices();

-- D ── D1: reactivation of lapsed members. First-party only: members whose
-- every fee schedule sits in an ENDED season and who have none in a current/
-- future one. Key = once per member per target season, structurally.
create or replace function public.generate_reactivation_drafts(
  p_provider uuid default null, p_force boolean default false,
  p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     member_id, guardian_id, run_id)
  select m.provider_id, 'message', 'draft',
    'Invite ' || m.first_name || ' back for ' || ts.name,
    'Hi ' || coalesce(g.first_name,'there') || ' — ' || m.first_name
      || ' was with us last season and we''d love to have them back for ' || ts.name
      || ' (starts ' || to_char(ts.start_date,'Mon DD') || '). Spots are filling — reply here or enroll from your Sporv account.',
    'agent', 'reactivation:' || m.id || ':' || ts.id,
    jsonb_build_object('action','void','reason','undo reactivation invite'),
    m.id, g.id, v_run
  from public.team_athletes m
  join lateral (select s.id, s.name, s.start_date from public.seasons s
                where s.provider_id = m.provider_id and s.end_date >= current_date
                order by s.start_date limit 1) ts on true
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = m.id and gl.is_payer limit 1) g on true
  where m.status = 'active' and m.first_name is not null
    and exists (select 1 from public.fee_schedules f
                join public.seasons s2 on s2.id = f.season_id
                where f.member_id = m.id and s2.end_date < current_date)
    and not exists (select 1 from public.fee_schedules f
                    join public.seasons s2 on s2.id = f.season_id
                    where f.member_id = m.id and s2.end_date >= current_date
                      and f.status in ('active','complete'))
    and (p_provider is null or m.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(m.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.generate_reactivation_drafts(uuid, boolean, uuid) from public, anon, authenticated;

-- E ── B2: the weekend eligibility report. Thursday cron; ONE director-facing
-- draft per org (no recipient — it is a report, not a message) listing, per
-- team program: unpaid-overdue members, unsigned-waiver members; plus staff
-- checks expired or expiring before Sunday. Drafted only when something blocks
-- someone — silent when clean.
create or replace function public.generate_eligibility_report(
  p_provider uuid default null, p_force boolean default false,
  p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
        v_saturday date := current_date + ((6 - extract(dow from current_date)::int) % 7);
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse, run_id)
  select p.id, 'deadline', 'draft',
    'Who can''t play Saturday (' || to_char(v_saturday,'Mon DD') || ')',
    coalesce((
      select string_agg(line, E'\n' order by line) from (
        select pr.title || ': ' ||
          concat_ws('; ',
            nullif('unpaid — ' || (
              select string_agg(distinct m.first_name || ' ' || coalesce(m.last_name,''), ', ')
              from public.installments i
              join public.fee_schedules f on f.id = i.fee_schedule_id and f.program_id = pr.id and f.status = 'active'
              join public.team_athletes m on m.id = i.member_id
              where i.due_date < current_date and i.status not in ('paid','waived')), 'unpaid — '),
            nullif('waiver unsigned — ' || (
              select string_agg(distinct m.first_name || ' ' || coalesce(m.last_name,''), ', ')
              from public.fee_schedules f
              join public.team_athletes m on m.id = f.member_id and m.status = 'active'
              where f.program_id = pr.id and f.status = 'active'
                and exists (select 1 from public.waiver_documents wd
                            where wd.provider_id = pr.provider_id
                              and wd.version = (select max(w2.version) from public.waiver_documents w2
                                                where w2.provider_id = wd.provider_id and w2.title = wd.title)
                              and not exists (select 1 from public.waiver_signatures ws
                                              where ws.waiver_document_id = wd.id and ws.member_id = m.id
                                                and (ws.season_id is null or ws.season_id in
                                                     (select s.id from public.seasons s
                                                      where s.provider_id = pr.provider_id
                                                        and s.end_date >= current_date))))), 'waiver unsigned — ')
          ) as line
        from public.programs pr
        where pr.provider_id = p.id and pr.offering_type = 'team'
      ) t where line is not null and line not like '%: '), '')
    || coalesce((
      select E'\nStaff: ' || string_agg(sc.kind || ' (' || coalesce(sc.reference,'no ref') || ') '
               || case when sc.expires_at < current_date then 'EXPIRED ' else 'expires ' end
               || to_char(sc.expires_at,'Mon DD'), '; ')
      from public.staff_certifications sc
      where sc.organization_id = p.id and sc.expires_at is not null
        and sc.expires_at <= v_saturday + 1), ''),
    'agent', 'eligibility:' || p.id || ':' || v_saturday,
    jsonb_build_object('action','void','reason','undo eligibility report'), v_run
  from public.providers p
  where (p_provider is null or p.id = p_provider)
    and (p_force or public.agent_autodraft_on(p.id))
    and exists (select 1 from public.programs pr where pr.provider_id = p.id and pr.offering_type = 'team')
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do update set detail = excluded.detail, run_id = excluded.run_id, updated_at = now()
  where obligations.status = 'draft';
  -- silent when clean: drop the drafts whose body came out empty
  delete from public.obligations o
   where o.run_id = v_run and o.source_ref like 'eligibility:%'
     and o.status = 'draft' and coalesce(o.detail,'') = '';
  select count(*) into inserted from public.obligations
   where run_id = v_run and source_ref like 'eligibility:%';
  return inserted;
end; $$;
revoke all on function public.generate_eligibility_report(uuid, boolean, uuid) from public, anon, authenticated;

-- F ── A2 completes: card declines route too. installment-checkout stamps
-- payment_intent_data.metadata.installment_id, so the PI event carries it.
create or replace function public.apply_installment_event(
  p_event_id text, p_event_type text, p_installment_id uuid,
  p_stripe_object_id text, p_amount_minor bigint, p_currency text,
  p_payload_sha256 text, p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path to '' as $$
declare v_rows integer;
begin
  insert into public.payment_event_ledger
    (stripe_event_id, event_type, stripe_object_id, amount_minor, currency,
     payload_sha256, outcome, occurred_at)
  values (p_event_id, p_event_type, p_stripe_object_id, p_amount_minor,
          p_currency, p_payload_sha256, 'applied', p_occurred_at)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    update public.installments
       set status = 'paid', stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_stripe_object_id)
     where id = p_installment_id and status <> 'paid';
    update public.fee_schedules fs set status = 'complete'
     where fs.id = (select fee_schedule_id from public.installments where id = p_installment_id)
       and not exists (select 1 from public.installments i
                       where i.fee_schedule_id = fs.id and i.status not in ('paid','waived'));
  elsif p_event_type in ('checkout.session.async_payment_failed','payment_intent.payment_failed') then
    update public.installments set status = 'failed'
     where id = p_installment_id and status <> 'paid';
    insert into public.obligations
      (provider_id, kind, status, title, detail, amount_cents, currency,
       due_at, source_kind, source_ref, inverse, member_id, guardian_id, run_id)
    select fs.provider_id, 'fee', 'draft',
      'Payment failed — ' || to_char(i.amount_cents/100.0,'FM$999,990.00') || ' installment',
      'Hi ' || coalesce(g.first_name,'there') || ' — the ' || to_char(i.due_date,'Mon DD')
        || ' payment of ' || to_char(i.amount_cents/100.0,'FM$999,990.00')
        || ' didn''t go through. No charge was made. You can retry from your original link, or reply if a different plan would help.',
      i.amount_cents, 'USD', now(), 'agent',
      'installment:' || i.id || ':attempt:' || (i.attempt_count + 1),
      jsonb_build_object('action','void','reason','undo failed-charge follow-up'),
      i.member_id, g.id, gen_random_uuid()
    from public.installments i
    join public.fee_schedules fs on fs.id = i.fee_schedule_id
    left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                       join public.guardians g2 on g2.id = gl.guardian_id
                       where gl.member_id = i.member_id and gl.is_payer limit 1) g on true
    where i.id = p_installment_id and i.status <> 'paid'
      and i.attempt_count < 3
      and public.agent_autodraft_on(fs.provider_id)
    on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
    do nothing;
  end if;
  return true;
end; $$;
revoke all on function public.apply_installment_event(text,text,uuid,text,bigint,text,text,timestamptz) from public, anon, authenticated;

-- G ── vocabulary + honest mapping (kill the catch-all)
alter table public.outbound_messages drop constraint if exists outbound_messages_event_type_check;
alter table public.outbound_messages add constraint outbound_messages_event_type_check
  check (event_type in ('booking_confirmed','reminder_24h','post_session','no_show_followup',
                        'rebook_nudge','dues_reminder','waiver_reminder','practice_reminder',
                        'schedule_change','reactivation'));

create or replace function public.approve_obligation_and_queue(p_obligation_id uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare o record; v_msg uuid; v_event text;
begin
  select ob.*, g.email as g_email into o
    from public.obligations ob
    left join public.guardians g on g.id = ob.guardian_id
   where ob.id = p_obligation_id;
  if o.id is null then raise exception 'no such obligation'; end if;
  if not exists (select 1 from public.providers
                 where id = o.provider_id and owner_id = auth.uid()) then
    raise exception 'only the org owner may approve';
  end if;
  if o.status <> 'draft' then raise exception 'only a draft can be approved'; end if;
  update public.obligations set status = 'approved' where id = p_obligation_id;
  if o.guardian_id is null then return null; end if;
  v_event := case
    when o.source_ref like 'installment:%'      then 'dues_reminder'
    when o.source_ref like 'waiver:%'           then 'waiver_reminder'
    when o.source_ref like 'session:%:change:%' then 'schedule_change'
    when o.source_ref like 'session:%'          then 'practice_reminder'
    when o.source_ref like 'reactivation:%'     then 'reactivation'
    when o.kind = 'fee'    then 'dues_reminder'
    when o.kind = 'waiver' then 'waiver_reminder'
    when o.kind = 'schedule' then 'practice_reminder'
    else null end;
  if v_event is null then return null; end if;  -- unmapped kinds stay unsent, never mislabeled
  insert into public.outbound_messages
    (provider_id, event_type, status, scheduled_for, obligation_id, content)
  values (o.provider_id, v_event, 'drafted', now(), o.id,
          jsonb_build_object('subject', o.title, 'body', o.detail,
                             'guardian_id', o.guardian_id, 'to_email', o.g_email,
                             'obligation_id', o.id))
  returning id into v_msg;
  return v_msg;
end; $$;
revoke all on function public.approve_obligation_and_queue(uuid) from public, anon;
grant execute on function public.approve_obligation_and_queue(uuid) to authenticated;

-- H ── bulk decisions on a whole agent sweep (run_id = the unit of undo)
create or replace function public.decide_agent_run(p_provider uuid, p_run uuid, p_decision text)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  if not exists (select 1 from public.providers where id = p_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may decide';
  end if;
  if p_decision not in ('approved','void') then raise exception 'decision must be approved or void'; end if;
  update public.obligations set status = p_decision
   where provider_id = p_provider and run_id = p_run and status = 'draft';
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.decide_agent_run(uuid, uuid, text) from public, anon;
grant execute on function public.decide_agent_run(uuid, uuid, text) to authenticated;

-- I ── Job 1 + practice reminders regenerated with run_id + enforced key
drop function if exists public.generate_installment_followups(uuid, boolean);
create or replace function public.generate_installment_followups(
  p_provider uuid default null, p_force boolean default false,
  p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, amount_cents, currency,
     due_at, source_kind, source_ref, inverse, member_id, guardian_id, run_id)
  select fs.provider_id, 'fee', 'draft',
    'Installment ' || to_char(i.amount_cents/100.0,'FM$999,990.00')
      || ' overdue ' || (current_date - i.due_date) || 'd — attempt ' || (i.attempt_count + 1) || ' of 3',
    'Hi ' || coalesce(g.first_name, 'there')
      || ' — the ' || to_char(i.due_date,'Mon DD') || ' installment of '
      || to_char(i.amount_cents/100.0,'FM$999,990.00')
      || case when i.attempt_count = 0 then ' has not come through yet. You can pay from your original link, or reply here if a different plan would help.'
              when i.attempt_count = 1 then ' is still outstanding. If something is in the way, tell us — a split or a later date is usually possible.'
              else ' remains unpaid after several reminders. Please reach out today so we can keep your athlete on the roster.' end,
    i.amount_cents, 'USD', i.due_date::timestamptz, 'agent',
    'installment:' || i.id || ':attempt:' || (i.attempt_count + 1),
    jsonb_build_object('action','void','reason','undo retry follow-up'),
    i.member_id, g.id, v_run
  from public.installments i
  join public.fee_schedules fs on fs.id = i.fee_schedule_id
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = i.member_id and gl.is_payer limit 1) g on true
  where i.status in ('due','failed')
    and fs.status = 'active'
    and i.due_date < current_date
    and i.attempt_count < 3
    and (current_date - i.due_date) >= (case i.attempt_count when 0 then 1 when 1 then 3 else 7 end)
    and (p_provider is null or fs.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(fs.provider_id))
    and not exists (select 1 from public.obligations o
                    where o.source_ref = 'installment:' || i.id || ':attempt:' || (i.attempt_count + 1)
                      and o.status <> 'void')
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.generate_installment_followups(uuid, boolean, uuid) from public, anon, authenticated;

drop function if exists public.generate_practice_reminders(uuid, boolean);
create or replace function public.generate_practice_reminders(
  p_provider uuid default null, p_force boolean default false,
  p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, due_at, source_kind, source_ref,
     inverse, member_id, guardian_id, run_id)
  select pr.provider_id, 'schedule', 'draft',
    'Practice tomorrow — ' || coalesce(s.title, pr.title),
    'Hi ' || coalesce(g.first_name,'there') || ' — reminder: ' || coalesce(s.title, pr.title)
      || ' is tomorrow (' || to_char(s.start_date,'Mon DD') || ')'
      || coalesce(' at ' || s.start_time, '') || coalesce(', ' || s.address, '') || '.',
    s.start_date::timestamptz, 'agent',
    'session:' || s.id || ':member:' || fs2.member_id,
    jsonb_build_object('action','void','reason','undo practice reminder'),
    fs2.member_id, g.id, v_run
  from public.sessions s
  join public.programs pr on pr.id = s.program_id and pr.offering_type = 'team'
  join (select distinct member_id, program_id from public.fee_schedules
        where status = 'active') fs2 on fs2.program_id = pr.id
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = fs2.member_id and gl.is_payer limit 1) g on true
  where s.start_date = current_date + 1
    and (p_provider is null or pr.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(pr.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.generate_practice_reminders(uuid, boolean, uuid) from public, anon, authenticated;

-- J ── the manual run covers all five jobs and reports a total
create or replace function public.run_agent_drafts(p_provider uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v1 integer; v2 integer; v3 integer; v4 integer; v5 integer;
        v_run uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.providers
                 where id = p_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may run the agent';
  end if;
  v1 := public.generate_installment_followups(p_provider, true, v_run);
  v2 := public.generate_waiver_followups(p_provider, true, v_run);
  v3 := public.generate_practice_reminders(p_provider, true, v_run);
  v4 := public.generate_reactivation_drafts(p_provider, true, v_run);
  v5 := public.generate_eligibility_report(p_provider, true, v_run);
  return jsonb_build_object('dues', v1, 'waivers', v2, 'practice', v3,
                            'reactivation', v4, 'eligibility', v5,
                            'total', v1+v2+v3+v4+v5, 'run_id', v_run);
end; $$;
revoke all on function public.run_agent_drafts(uuid) from public, anon;
grant execute on function public.run_agent_drafts(uuid) to authenticated;

-- K ── crons: B2 Thursday, D1 monthly, beside the nightly three
do $$
begin
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-eligibility-thursday';
    perform cron.schedule('sporv-eligibility-thursday', '30 3 * * 4',
      $job$ select public.generate_eligibility_report(); $job$);
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-reactivation-monthly';
    perform cron.schedule('sporv-reactivation-monthly', '35 3 1 * *',
      $job$ select public.generate_reactivation_drafts(); $job$);
  exception when others then
    raise notice 'pg_cron unavailable (%)', sqlerrm;
  end;
end $$;
