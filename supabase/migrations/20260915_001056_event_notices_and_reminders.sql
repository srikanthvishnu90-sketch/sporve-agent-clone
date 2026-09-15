-- 20260915_001056 — spec 12.4/12.6 · schedule-change notices, cancellation,
-- reminders — all over the EXISTING draft-first path. Nothing here sends: every
-- row is an obligations draft that approve_obligation_and_queue turns into an
-- outbound_messages row behind trg_outbound_freeze. This ports
-- draft_schedule_change_notices / generate_practice_reminders from sessions to
-- event, routing by roster (team_athletes on event.team_id) with the payer
-- guardian, deduped by uq_oblig_agent_source_ref. The sessions versions stay
-- live until the SPA writer is re-pointed (dual-write period).

create or replace function public.event_family_recipients(p_event uuid)
returns table (member_id uuid, guardian_id uuid, first_name text)
language sql stable security definer set search_path to '' as $$
  select ta.id, g.id, g.first_name
  from public.event e
  join public.team_athletes ta on ta.team_id = e.team_id and ta.status = 'active'
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = ta.id and gl.is_payer and g2.email_status = 'ok' limit 1) g on true
  where e.id = p_event
$$;

create or replace function public.draft_event_change_notices() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_run uuid := gen_random_uuid(); v_kind text;
begin
  if current_setting('sporv.suppress_notices', true) = '1' then return new; end if;
  if new.published_at is null or new.starts_at < now() then return new; end if;
  v_kind := case when new.status = 'cancelled' and old.status <> 'cancelled' then 'cancel' else 'change' end;
  insert into public.obligations
    (provider_id, kind, status, title, detail, due_at, source_kind, source_ref,
     inverse, member_id, guardian_id, run_id, draft_type)
  select new.provider_id, 'schedule', 'draft',
    case v_kind when 'cancel' then 'Cancelled — ' else 'Schedule change — ' end || new.title,
    'Hi ' || coalesce(r.first_name,'there') || ' — ' || new.title
      || case v_kind
           when 'cancel' then ' on ' || to_char(new.starts_at at time zone new.timezone, 'Dy Mon DD') || ' is cancelled'
                || coalesce(' (' || new.cancellation_reason || ')', '') || '.'
           else ' has changed: now ' || to_char(new.starts_at at time zone new.timezone, 'Dy Mon DD HH12:MI AM')
                || coalesce(', ' || new.location_text, '') || '. Sorry for the shuffle — see the updated schedule in Sporv.'
         end,
    new.starts_at, 'agent',
    'event:' || new.id || ':' || v_kind || ':' || current_date || ':member:' || r.member_id,
    jsonb_build_object('action','void','reason','undo schedule notice'),
    r.member_id, r.guardian_id, v_run,
    case v_kind when 'cancel' then 'schedule_cancellation' else 'schedule_change_notice' end
  from public.event_family_recipients(new.id) r
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void'
  do update set title = excluded.title, detail = excluded.detail, run_id = excluded.run_id, updated_at = now()
  where obligations.status = 'draft';
  return new;
end $$;
drop trigger if exists trg_event_change_notices on public.event;
create trigger trg_event_change_notices after update on public.event
  for each row
  when ((new.starts_at, new.ends_at, new.venue_id, new.location_text, new.status)
        is distinct from (old.starts_at, old.ends_at, old.venue_id, old.location_text, old.status))
  execute function public.draft_event_change_notices();

-- Reminders: tomorrow's published events, one draft per rostered athlete.
create or replace function public.generate_event_reminders(
  p_provider uuid default null, p_force boolean default false, p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, due_at, source_kind, source_ref,
     inverse, member_id, guardian_id, run_id, draft_type)
  select e.provider_id, 'schedule', 'draft',
    'Tomorrow — ' || e.title,
    'Hi ' || coalesce(r.first_name,'there') || ' — reminder: ' || e.title || ' is tomorrow at '
      || to_char(e.starts_at at time zone e.timezone, 'HH12:MI AM')
      || coalesce(', ' || e.location_text, '') || '.',
    e.starts_at, 'agent',
    'event:' || e.id || ':member:' || r.member_id,
    jsonb_build_object('action','void','reason','undo event reminder'),
    r.member_id, r.guardian_id, v_run, 'event_reminder'
  from public.event e
  cross join lateral public.event_family_recipients(e.id) r
  where e.published_at is not null and e.status = 'scheduled'
    and (e.starts_at at time zone e.timezone)::date = current_date + 1
    and (p_provider is null or e.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(e.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function public.generate_event_reminders(uuid,boolean,uuid) from public, anon, authenticated;

-- cancelEvent(event_id, reason, notify): status + reason (the trigger drafts the
-- notices), settings_audit row, receipt. Draft-first: notify=true drafts; nothing
-- is sent until a human approves (DECISIONS defaults; an auto-send flag is a
-- separate owner decision and is NOT implemented here).
create or replace function public.cancel_event(p_event uuid, p_reason text, p_notify boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_e public.event; v_drafts integer := 0;
begin
  select * into v_e from public.event where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_e.provider_id) then
    raise exception 'only organisation staff may cancel an event' using errcode = '42501';
  end if;
  if v_e.status = 'cancelled' then
    return jsonb_build_object('event_id', v_e.id, 'already_cancelled', true, 'drafted_notices', 0);
  end if;
  if p_notify then
    update public.event set status = 'cancelled', cancellation_reason = left(coalesce(p_reason,''), 300) where id = p_event;
    select count(*) into v_drafts from public.obligations
      where source_kind = 'agent' and status = 'draft' and source_ref like 'event:' || p_event || ':cancel:%';
  else
    -- suppress the notice trigger for a silent cancel (e.g. a draft never published)
    perform set_config('sporv.suppress_notices', '1', true);
    update public.event set status = 'cancelled', cancellation_reason = left(coalesce(p_reason,''), 300) where id = p_event;
  end if;
  insert into public.settings_audit (provider_id, surface, key, old_value, new_value, changed_by)
  values (v_e.provider_id, 'schedule', 'event_cancelled',
          jsonb_build_object('event_id', v_e.id, 'status', v_e.status),
          jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'reason', p_reason, 'notify', p_notify),
          auth.uid());
  return jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'drafted_notices', v_drafts,
                            'venue_released', v_e.venue_id is not null);
end $$;
revoke all on function public.cancel_event(uuid,text,boolean) from public, anon;
grant execute on function public.cancel_event(uuid,text,boolean) to authenticated, service_role;

