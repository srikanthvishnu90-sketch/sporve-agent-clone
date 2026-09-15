-- ============================================================================
-- 20260915_001066 — spec 12.1/12.2 · materialise a series into event rows.
-- Slice 1 of spec 12 (owner's order 2026-09-16: 12.1-12.2 + 12.7 first).
-- Publication (12.6) and conflict detection (12.3) are NOT here — they are
-- slices 3 and 2, and this file must not grow them back.
-- Single lane. FILE ONLY — never applied (D5).
--
-- RRULE subset (RFC 5545): FREQ=DAILY|WEEKLY; INTERVAL=n; BYDAY=MO,TU,WE,TH,FR,SA,SU;
-- UNTIL=YYYYMMDD[THHMMSSZ]; COUNT=n. That covers "Tue/Thu 6pm for ten weeks", which
-- is the acceptance case; anything else is rejected loudly, never approximated.
-- The instant is derived per occurrence as (local_date + local_start_time) AT TIME
-- ZONE series.timezone, so a 6pm practice is 6pm on both sides of a DST change.
-- Idempotent on (series_id, series_local_date); an occurrence marked is_exception
-- is never regenerated or reverted.
-- ============================================================================

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
