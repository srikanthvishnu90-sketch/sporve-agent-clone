-- 20260915_001057 — spec 12.2/12.3/12.6 · materialise a series into event rows,
-- publish, and detect conflicts.
--
-- RRULE subset (RFC 5545): FREQ=DAILY|WEEKLY; INTERVAL=n; BYDAY=MO,TU,WE,TH,FR,SA,SU;
-- UNTIL=YYYYMMDD[THHMMSSZ]; COUNT=n. That covers "Tue/Thu 6pm for ten weeks", which
-- is the acceptance case; anything else is rejected loudly, never approximated.
-- The instant is derived per occurrence as (local_date + local_start_time) AT TIME
-- ZONE series.timezone, so a 6pm practice is 6pm on both sides of a DST change.
-- Idempotent on (series_id, series_local_date); an occurrence marked is_exception
-- is never regenerated or reverted.

create or replace function public.rrule_parts(p_rrule text) returns jsonb
language sql immutable set search_path to '' as $$
  select coalesce(jsonb_object_agg(upper(split_part(kv,'=',1)), upper(split_part(kv,'=',2))), '{}'::jsonb)
  from regexp_split_to_table(coalesce(p_rrule,''), ';') kv where kv <> ''
$$;

create or replace function public.materialize_event_series(p_series uuid, p_horizon_days integer default 180)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  s public.event_series; parts jsonb; v_freq text; v_interval int; v_byday text[]; v_until date; v_count int;
  d date; v_last date; v_n int := 0; v_ins int := 0; v_local timestamp; v_start timestamptz; dow text;
  dows text[] := array['SU','MO','TU','WE','TH','FR','SA'];
begin
  select * into s from public.event_series where id = p_series;
  if not found then raise exception 'series not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(s.provider_id) then
    raise exception 'only organisation staff may materialise a series' using errcode = '42501';
  end if;
  parts := public.rrule_parts(s.rrule);
  v_freq := coalesce(parts->>'FREQ', case when s.rrule is null then 'ONCE' end);
  if v_freq not in ('ONCE','DAILY','WEEKLY') then
    raise exception 'unsupported RRULE FREQ=% (supported: DAILY, WEEKLY, or no rule)', v_freq using errcode = '22023';
  end if;
  v_interval := greatest(1, coalesce((parts->>'INTERVAL')::int, 1));
  v_byday := case when parts ? 'BYDAY' then string_to_array(parts->>'BYDAY', ',') end;
  v_until := case when parts ? 'UNTIL' then to_date(left(parts->>'UNTIL', 8), 'YYYYMMDD') end;
  v_count := (parts->>'COUNT')::int;
  v_last := least(coalesce(s.series_end_date, 'infinity'::date), coalesce(v_until, 'infinity'::date),
                  current_date + p_horizon_days);
  d := s.series_start_date;
  while d <= v_last loop
    dow := dows[extract(dow from d)::int + 1];
    if v_freq = 'ONCE' then
      if d <> s.series_start_date then exit; end if;
    elsif v_freq = 'WEEKLY' then
      if ((d - s.series_start_date) / 7) % v_interval <> 0 then d := d + 1; continue; end if;
      if v_byday is not null and not (dow = any(v_byday)) then d := d + 1; continue; end if;
      if v_byday is null and extract(dow from d) <> extract(dow from s.series_start_date) then d := d + 1; continue; end if;
    else -- DAILY
      if (d - s.series_start_date) % v_interval <> 0 then d := d + 1; continue; end if;
    end if;
    v_n := v_n + 1;
    if v_count is not null and v_n > v_count then exit; end if;
    if d >= current_date - 1 then
      v_local := d + s.local_start_time;
      v_start := v_local at time zone s.timezone;
      insert into public.event (provider_id, series_id, series_local_date, team_id, program_id, kind, title,
                                starts_at, ends_at, timezone, venue_id, location_text, assigned_member_id, capacity)
      values (s.provider_id, s.id, d, s.team_id, s.program_id, s.kind, s.title,
              v_start, v_start + make_interval(mins => s.duration_minutes), s.timezone,
              s.venue_id, s.location_text, s.assigned_member_id, s.capacity)
      on conflict (series_id, series_local_date) where series_id is not null do nothing;
      if found then v_ins := v_ins + 1; end if;
    end if;
    if v_freq = 'ONCE' then exit; end if;
    d := d + 1;
  end loop;
  return v_ins;
end $$;
revoke all on function public.materialize_event_series(uuid,integer) from public, anon;
grant execute on function public.materialize_event_series(uuid,integer) to authenticated, service_role;

create or replace function public.materialize_all_series(p_horizon_days integer default 180)
returns integer language plpgsql security definer set search_path to '' as $$
declare r record; total int := 0;
begin
  for r in select id from public.event_series where series_end_date is null or series_end_date >= current_date loop
    total := total + public.materialize_event_series(r.id, p_horizon_days);
  end loop;
  return total;
end $$;
revoke all on function public.materialize_all_series(integer) from public, anon, authenticated;

-- Publication (spec 12.6): invisible until published_at; one action per series or
-- date range. Publishing also seeds an explicit 'no_response' row per rostered
-- athlete so every RSVP count has a real denominator.
create or replace function public.seed_no_response(p_event uuid) returns integer
language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  insert into public.event_response (provider_id, event_id, member_id, response, source)
  select e.provider_id, e.id, ta.id, 'no_response', 'staff'
  from public.event e join public.team_athletes ta on ta.team_id = e.team_id and ta.status = 'active'
  where e.id = p_event
  on conflict (event_id, member_id) do nothing;
  get diagnostics n = row_count; return n;
end $$;
create or replace function public.publish_series(p_series uuid) returns integer
language plpgsql security definer set search_path to '' as $$
declare r record; n int := 0; v_provider uuid;
begin
  select provider_id into v_provider from public.event_series where id = p_series;
  if v_provider is null then raise exception 'series not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may publish' using errcode = '42501';
  end if;
  for r in update public.event set published_at = now()
           where series_id = p_series and published_at is null and status <> 'cancelled' returning id loop
    perform public.seed_no_response(r.id); n := n + 1;
  end loop;
  insert into public.settings_audit (provider_id, surface, key, new_value, changed_by)
  values (v_provider, 'schedule', 'series_published', jsonb_build_object('series_id', p_series, 'events', n), auth.uid());
  return n;
end $$;
create or replace function public.publish_events(p_provider uuid, p_from date, p_to date) returns integer
language plpgsql security definer set search_path to '' as $$
declare r record; n int := 0;
begin
  if auth.uid() is not null and not public.is_org_admin(p_provider) then
    raise exception 'only organisation staff may publish' using errcode = '42501';
  end if;
  for r in update public.event set published_at = now()
           where provider_id = p_provider and published_at is null and status <> 'cancelled'
             and (starts_at at time zone timezone)::date between p_from and p_to returning id loop
    perform public.seed_no_response(r.id); n := n + 1;
  end loop;
  insert into public.settings_audit (provider_id, surface, key, new_value, changed_by)
  values (p_provider, 'schedule', 'range_published', jsonb_build_object('from', p_from, 'to', p_to, 'events', n), auth.uid());
  return n;
end $$;
revoke all on function public.publish_series(uuid) from public, anon;
revoke all on function public.publish_events(uuid,date,date) from public, anon;
revoke all on function public.seed_no_response(uuid) from public, anon, authenticated;
grant execute on function public.publish_series(uuid), public.publish_events(uuid,date,date) to authenticated, service_role;

-- Conflict detection (spec 12.3): warnings, never hard blocks. Four classes.
create or replace function public.detect_event_conflicts(p_event uuid)
returns table (conflict text, other_id uuid, detail text)
language sql stable security definer set search_path to '' as $$
  with e as (select * from public.event where id = p_event)
  select 'venue', o.id, o.title || ' overlaps at the same venue'
    from e join public.event o on o.venue_id = e.venue_id and o.id <> e.id and o.status <> 'cancelled'
    where e.venue_id is not null and tstzrange(o.starts_at, o.ends_at) && tstzrange(e.starts_at, e.ends_at)
  union all
  select 'staff', o.id, o.title || ' overlaps for the same coach'
    from e join public.event o on o.assigned_member_id = e.assigned_member_id and o.id <> e.id and o.status <> 'cancelled'
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

create or replace function public.record_conflict_override(p_event uuid, p_reason text) returns void
language plpgsql security definer set search_path to '' as $$
declare v_provider uuid;
begin
  select provider_id into v_provider from public.event where id = p_event;
  if v_provider is null then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may override a conflict' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'an override needs a reason' using errcode = '22023'; end if;
  insert into public.settings_audit (provider_id, surface, key, new_value, changed_by)
  values (v_provider, 'schedule', 'conflict_override',
          jsonb_build_object('event_id', p_event, 'reason', left(p_reason, 300),
                             'conflicts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.detect_event_conflicts(p_event) c)),
          auth.uid());
end $$;
revoke all on function public.record_conflict_override(uuid,text) from public, anon;
grant execute on function public.record_conflict_override(uuid,text) to authenticated, service_role;

-- nightly horizon roll (guarded: pg_cron may be absent on a scratch database)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-materialize-series';
    perform cron.schedule('sporv-materialize-series', '10 3 * * *', 'select public.materialize_all_series(180);');
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-event-reminders';
    perform cron.schedule('sporv-event-reminders', '30 3 * * *', 'select public.generate_event_reminders();');
  end if;
end $$;
