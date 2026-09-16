-- ============================================================================
-- 20260915_001069 — spec 12.3 conflict detection · 12.4 cancellation.
-- Slice 2 of spec 12 (owner's order 2026-09-16: 12.3-12.4 after slice 1).
-- Reminders, ICS and publication (12.5/12.6) are slice 3 and are NOT here.
-- Single lane. Applied to the live project on merge (D5 reversed 2026-09-16).
--
-- 12.3 — four conflict classes, WARNINGS never hard blocks: facility (same
-- venue overlapping), staff (same assigned coach overlapping), athlete (a
-- dual-rostered athlete has two events at once), blackout (inside an org
-- blackout window). A director may override with a recorded reason; the
-- override and the conflicts it waved through land in settings_audit.
--
-- 12.4 — cancel_event(event_id, reason, notify): status + reason, sequence
-- bump (ICS SEQUENCE, via trg_event_guard), one cancellation DRAFT per
-- rostered family through the existing draft-first path (an obligations row
-- that approve_obligation_and_queue turns into outbound_messages behind
-- trg_outbound_freeze — nothing here sends), an audit row, and the venue slot
-- released (cancelled rows are excluded from every conflict class). The same
-- trigger drafts a schedule-change notice when a published future event
-- moves. Delivery over spec 13 channels is spec 13's; the draft is the
-- handoff point.
-- ============================================================================

-- ── 12.3 conflict detection ────────────────────────────────────────────────
create or replace function public.detect_event_conflicts(p_event uuid)
returns table (conflict text, other_id uuid, detail text)
language sql stable security definer set search_path to '' as $$
  with e as (select * from public.event where id = p_event and status <> 'cancelled')
  select 'venue', o.id, o.title || ' overlaps at the same venue'
    from e join public.event o on o.provider_id = e.provider_id and o.venue_id = e.venue_id
                              and o.id <> e.id and o.status <> 'cancelled'
    where e.venue_id is not null and tstzrange(o.starts_at, o.ends_at) && tstzrange(e.starts_at, e.ends_at)
  union all
  select 'staff', o.id, o.title || ' overlaps for the same coach'
    from e join public.event o on o.provider_id = e.provider_id and o.assigned_member_id = e.assigned_member_id
                              and o.id <> e.id and o.status <> 'cancelled'
    where e.assigned_member_id is not null and tstzrange(o.starts_at, o.ends_at) && tstzrange(e.starts_at, e.ends_at)
  union all
  select distinct 'athlete', o.id, 'an athlete on both teams has ' || o.title || ' at the same time'
    from e join public.event o on o.provider_id = e.provider_id and o.id <> e.id and o.status <> 'cancelled'
                              and o.team_id is distinct from e.team_id
    join public.team_athletes a on a.team_id = e.team_id and a.status = 'active'
    join public.team_athletes b on b.team_id = o.team_id and b.status = 'active'
      and ((a.athlete_id is not null and a.athlete_id = b.athlete_id)
           or (lower(a.first_name) = lower(b.first_name) and lower(a.last_name) = lower(b.last_name)
               and a.dob is not distinct from b.dob))
    where tstzrange(o.starts_at, o.ends_at) && tstzrange(e.starts_at, e.ends_at)
  union all
  select 'blackout', b.id, 'inside blackout window: ' || b.label
    from e join public.blackout_window b on b.provider_id = e.provider_id
    where tstzrange(b.starts_at, b.ends_at) && tstzrange(e.starts_at, e.ends_at)
$$;
revoke all on function public.detect_event_conflicts(uuid) from public, anon;
grant execute on function public.detect_event_conflicts(uuid) to authenticated, service_role;

-- An org's conflicts over a window, for the schedule screen and for publish
-- time (slice 3 calls this before it publishes). Staff-only through RLS on
-- event: the SECURITY DEFINER function checks the caller itself.
create or replace function public.event_conflicts_in_range(p_provider uuid, p_from timestamptz, p_to timestamptz)
returns table (event_id uuid, conflict text, other_id uuid, detail text)
language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is not null and not public.is_org_admin(p_provider) then
    raise exception 'only organisation staff may read conflicts' using errcode = '42501';
  end if;
  return query
    select e.id, c.conflict, c.other_id, c.detail
    from public.event e cross join lateral public.detect_event_conflicts(e.id) c
    where e.provider_id = p_provider and e.status <> 'cancelled'
      and tstzrange(e.starts_at, e.ends_at) && tstzrange(p_from, p_to)
    order by e.starts_at, e.id, c.conflict;
end $$;
revoke all on function public.event_conflicts_in_range(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.event_conflicts_in_range(uuid,timestamptz,timestamptz) to authenticated, service_role;

create or replace function public.record_conflict_override(p_event uuid, p_reason text) returns uuid
language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; v_id uuid; v_conflicts jsonb;
begin
  select provider_id into v_provider from public.event where id = p_event;
  if v_provider is null then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may override a conflict' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'an override needs a reason' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_conflicts from public.detect_event_conflicts(p_event) c;
  if v_conflicts = '[]'::jsonb then raise exception 'nothing to override: this event has no conflicts' using errcode = '22023'; end if;
  insert into public.settings_audit (provider_id, surface, key, new_value, changed_by)
  values (v_provider, 'schedule', 'conflict_override',
          jsonb_build_object('event_id', p_event, 'reason', left(trim(p_reason), 300), 'conflicts', v_conflicts),
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_conflict_override(uuid,text) from public, anon;
grant execute on function public.record_conflict_override(uuid,text) to authenticated, service_role;

-- ── 12.4 cancellation and change notices (draft-first) ─────────────────────
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
revoke all on function public.event_family_recipients(uuid) from public, anon, authenticated;

create or replace function public.draft_event_change_notices() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_run uuid := gen_random_uuid(); v_kind text;
begin
  if current_setting('sporv.suppress_notices', true) = '1' then return new; end if;
  -- only a PUBLISHED, FUTURE event has families to tell
  if new.published_at is null or new.starts_at < now() then return new; end if;
  v_kind := case when new.status = 'cancelled' and old.status <> 'cancelled' then 'cancel' else 'change' end;
  if v_kind = 'change' and new.status = 'cancelled' then return new; end if;  -- editing an already-cancelled event tells nobody
  insert into public.obligations
    (provider_id, kind, status, title, detail, due_at, source_kind, source_ref,
     inverse, member_id, guardian_id, run_id, draft_type)
  select new.provider_id, 'schedule', 'draft',
    case v_kind when 'cancel' then 'Cancelled — ' else 'Schedule change — ' end || new.title,
    'Hi ' || coalesce(r.first_name,'there') || ' — ' || new.title
      || case v_kind
           when 'cancel' then ' on ' || to_char(new.starts_at at time zone new.timezone, 'Dy Mon DD') || ' is cancelled'
                || coalesce(' (' || nullif(new.cancellation_reason,'') || ')', '') || '.'
           else ' has changed: now ' || to_char(new.starts_at at time zone new.timezone, 'Dy Mon DD HH12:MI AM')
                || coalesce(', ' || new.location_text, '') || '. Sorry for the shuffle — see the updated schedule in Sporv.'
         end,
    new.starts_at, 'agent',
    'event:' || new.id || ':' || v_kind || ':member:' || r.member_id,
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

create or replace function public.cancel_event(p_event uuid, p_reason text, p_notify boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_e public.event; v_drafts integer := 0; v_seq integer;
begin
  select * into v_e from public.event where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_e.provider_id) then
    raise exception 'only organisation staff may cancel an event' using errcode = '42501';
  end if;
  if v_e.status = 'cancelled' then
    return jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'already_cancelled', true, 'drafted_notices', 0,
                              'sequence', v_e.sequence, 'venue_released', false);
  end if;
  if not p_notify then
    -- a silent cancel (an event never published, or the families already know)
    perform set_config('sporv.suppress_notices', '1', true);
  end if;
  update public.event set status = 'cancelled', cancellation_reason = left(nullif(trim(coalesce(p_reason,'')),''), 300)
    where id = p_event returning sequence into v_seq;
  perform set_config('sporv.suppress_notices', '', true);
  select count(*) into v_drafts from public.obligations
    where source_kind = 'agent' and status = 'draft' and draft_type = 'schedule_cancellation'
      and source_ref like 'event:' || p_event || ':cancel:%';
  insert into public.settings_audit (provider_id, surface, key, old_value, new_value, changed_by)
  values (v_e.provider_id, 'schedule', 'event_cancelled',
          jsonb_build_object('event_id', v_e.id, 'status', v_e.status, 'sequence', v_e.sequence),
          jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'reason', p_reason, 'notify', p_notify,
                             'sequence', v_seq, 'drafted_notices', v_drafts),
          auth.uid());
  return jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'already_cancelled', false,
                            'drafted_notices', v_drafts, 'sequence', v_seq, 'venue_released', v_e.venue_id is not null);
end $$;
revoke all on function public.cancel_event(uuid,text,boolean) from public, anon;
grant execute on function public.cancel_event(uuid,text,boolean) to authenticated, service_role;
