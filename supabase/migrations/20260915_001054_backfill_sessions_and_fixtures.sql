-- 20260915_001054 — spec 12.7 · copy sessions + program_fixtures into event.
-- COPY, not move: sessions stays live (FKs from bookings/disputes; four writers
-- still target it). Idempotent via event.source_session_id / source_fixture_id.
-- start_time is text in two formats seen in the wild — "18:00" (the app) and
-- "05:00 PM" (the baseline's documented display form). Both parse; anything else
-- is quarantined with its payload.

create or replace function public.parse_local_clock(p_date date, p_time text)
returns timestamp language plpgsql immutable set search_path to '' as $$
begin
  if p_time is null then return null; end if;
  if p_time ~ '^\d{1,2}:\d{2}$' then
    return to_timestamp(p_date::text || ' ' || p_time, 'YYYY-MM-DD HH24:MI')::timestamp;
  elsif p_time ~* '^\d{1,2}:\d{2}\s*[ap]m$' then
    return to_timestamp(p_date::text || ' ' || upper(p_time), 'YYYY-MM-DD HH12:MI AM')::timestamp;
  end if;
  return null;
end $$;

do $$
declare s record; v_tz text; v_start timestamp; v_end timestamp; v_moved int := 0; v_q int := 0;
begin
  for s in
    select se.*, pr.provider_id, pr.assigned_member_id as program_member
    from public.sessions se join public.programs pr on pr.id = se.program_id
    where not exists (select 1 from public.event e where e.source_session_id = se.id)
  loop
    v_tz := coalesce(s.timezone, 'America/Chicago');
    v_start := public.parse_local_clock(s.start_date, coalesce(s.start_time, '00:00'));
    v_end   := public.parse_local_clock(coalesce(s.end_date, s.start_date), s.end_time);
    if v_start is null then
      insert into public.migration_quarantine (provider_id, source_table, source_id, reason, payload)
      values (s.provider_id, 'sessions', s.id, 'unparseable start_time: ' || coalesce(s.start_time,'null'), to_jsonb(s));
      v_q := v_q + 1; continue;
    end if;
    if v_end is null or v_end <= v_start then v_end := v_start + interval '60 minutes'; end if;
    insert into public.event (provider_id, program_id, kind, title, starts_at, ends_at, timezone,
                              location_text, capacity, assigned_member_id, published_at, source_session_id)
    values (s.provider_id, s.program_id, 'other', coalesce(s.title, 'Session'),
            v_start at time zone v_tz, v_end at time zone v_tz, v_tz,
            s.address, s.capacity, coalesce(s.assigned_member_id, s.program_member), now(), s.id)
    on conflict (source_session_id) do nothing;
    v_moved := v_moved + 1;
  end loop;
  raise notice 'sessions -> event: % copied, % quarantined', v_moved, v_q;
end $$;

do $$
declare f record; v_moved int := 0;
begin
  for f in
    select pf.*, pr.provider_id
    from public.program_fixtures pf join public.programs pr on pr.id = pf.program_id
    where not exists (select 1 from public.event e where e.source_fixture_id = pf.id)
  loop
    insert into public.event (provider_id, program_id, kind, title, starts_at, ends_at, timezone,
                              location_text, opponent, home_away, notes, published_at, source_fixture_id)
    values (f.provider_id, f.program_id,
            case when f.kind in ('practice','game','tryout','camp_day','lesson','meeting') then f.kind else 'other' end,
            coalesce(nullif(f.kind,''), 'Fixture') || coalesce(' vs ' || f.opponent, ''),
            f.starts_at, coalesce(f.ends_at, f.starts_at + interval '120 minutes'), 'America/Chicago',
            f.location, f.opponent,
            case when f.home_away in ('home','away','neutral') then f.home_away end,
            f.note, now(), f.id)
    on conflict (source_fixture_id) do nothing;
    v_moved := v_moved + 1;
  end loop;
  raise notice 'program_fixtures -> event: % copied', v_moved;
end $$;
