-- ============================================================================
-- 3-day brief deltas (2026-09-01): settings history, SERVER-side money-auto
-- consent (the modal alone was client-side — a direct PATCH could bypass it),
-- and B2 keyed to the org's next scheduled event instead of a hardcoded
-- Saturday. Applied to prod as spec_audit_gate_nextevent (identical body).
-- ============================================================================

-- A ── settings_audit: history rows, not last-write. The director's audit log.
create table if not exists public.settings_audit (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  surface text not null,           -- 'automation' | 'org_setting'
  key text not null,               -- pref event_type or settings key
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table public.settings_audit enable row level security;
drop policy if exists settings_audit_select_owner on public.settings_audit;
create policy settings_audit_select_owner on public.settings_audit
  for select to authenticated
  using (exists (select 1 from public.providers p
                 where p.id = settings_audit.provider_id and p.owner_id = auth.uid()));
grant select on public.settings_audit to authenticated;   -- write path is triggers only

create or replace function public.audit_lmp_change()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.settings_audit (provider_id, surface, key, old_value, new_value, changed_by)
  values (new.provider_id, 'automation', new.event_type,
          case when tg_op='UPDATE' then to_jsonb(old.mode) end, to_jsonb(new.mode),
          coalesce(auth.uid(), new.updated_by));
  return new;
end; $$;
revoke all on function public.audit_lmp_change() from public, anon, authenticated;
drop trigger if exists trg_audit_lmp on public.lifecycle_message_prefs;
create trigger trg_audit_lmp after insert or update on public.lifecycle_message_prefs
  for each row execute function public.audit_lmp_change();

create or replace function public.audit_ps_change()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.settings_audit (provider_id, surface, key, old_value, new_value, changed_by)
  values (new.provider_id, 'org_setting', new.key,
          case when tg_op='UPDATE' then old.value end, new.value,
          coalesce(auth.uid(), new.updated_by));
  return new;
end; $$;
revoke all on function public.audit_ps_change() from public, anon, authenticated;
drop trigger if exists trg_audit_ps on public.provider_settings;
create trigger trg_audit_ps after insert or update on public.provider_settings
  for each row execute function public.audit_ps_change();

-- B ── SERVER-side money-auto gate: setting agent_a1/agent_a2 to 'auto'
-- requires a consent record written by the SAME user within the last two
-- minutes (the modal writes it; a bare PATCH has none and is refused).
create or replace function public.enforce_money_auto_consent()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.event_type in ('agent_a1','agent_a2') and new.mode = 'auto'
     and (tg_op = 'INSERT' or new.mode is distinct from old.mode) then
    if auth.uid() is null then return new; end if;   -- server paths carry their own consent
    if not exists (
      select 1 from public.provider_settings ps
      where ps.provider_id = new.provider_id and ps.key = 'money_auto_consent'
        and ps.value->>'job' = new.event_type
        and ps.updated_by = auth.uid()
        and ps.updated_at > now() - interval '2 minutes') then
      raise exception 'money-job auto requires explicit confirmation (open the confirmation dialog)';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.enforce_money_auto_consent() from public, anon, authenticated;
drop trigger if exists trg_money_auto_consent on public.lifecycle_message_prefs;
create trigger trg_money_auto_consent before insert or update on public.lifecycle_message_prefs
  for each row execute function public.enforce_money_auto_consent();

-- C ── B2 keyed to the org's NEXT scheduled event (fallback: coming Saturday),
-- drafted only inside the lead window (default 2 days, provider_settings
-- 'eligibility_lead_days'). Same silent-when-clean and upsert semantics.
create or replace function public.generate_eligibility_report(
  p_provider uuid default null, p_force boolean default false,
  p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse, run_id)
  select p.id, 'deadline', 'draft',
    'Who can''t play ' || to_char(ev.event_date,'Dy Mon DD'),
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
        and sc.expires_at <= ev.event_date + 1), ''),
    'agent', 'eligibility:' || p.id || ':' || ev.event_date,
    jsonb_build_object('action','void','reason','undo eligibility report'), v_run
  from public.providers p
  join lateral (
    select coalesce(
      (select min(s.start_date) from public.sessions s
       join public.programs pr2 on pr2.id = s.program_id and pr2.provider_id = p.id
       where s.start_date >= current_date),
      current_date + ((6 - extract(dow from current_date)::int) % 7)) as event_date
  ) ev on true
  left join public.provider_settings lead
    on lead.provider_id = p.id and lead.key = 'eligibility_lead_days'
  where (p_provider is null or p.id = p_provider)
    and (p_force or public.agent_autodraft_on(p.id))
    and (p_force or (ev.event_date - current_date) <= coalesce((lead.value->>'days')::int, 2))
    and exists (select 1 from public.programs pr where pr.provider_id = p.id and pr.offering_type = 'team')
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do update set detail = excluded.detail, title = excluded.title,
                run_id = excluded.run_id, updated_at = now()
  where obligations.status = 'draft';
  delete from public.obligations o
   where o.run_id = v_run and o.source_ref like 'eligibility:%'
     and o.status = 'draft' and coalesce(o.detail,'') = '';
  select count(*) into inserted from public.obligations
   where run_id = v_run and source_ref like 'eligibility:%';
  return inserted;
end; $$;
revoke all on function public.generate_eligibility_report(uuid, boolean, uuid) from public, anon, authenticated;
do $$
begin
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-eligibility-thursday';
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-eligibility-daily';
    perform cron.schedule('sporv-eligibility-daily', '30 3 * * *',
      $job$ select public.generate_eligibility_report(); $job$);
  exception when others then
    raise notice 'pg_cron unavailable (%)', sqlerrm;
  end;
end $$;
