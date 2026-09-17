-- ============================================================================
-- 20260915_001076 — audit 2026-09-17 P1-2: conflicts on the event, for the
-- people who coach it.
--
-- event_conflicts_in_range() (001069) refused everyone but owner/admin with
-- 42501. The schedule screen renders conflicts ON the event, and the person
-- most in need of "you are double-booked at 6pm" is the coach who is. This
-- admits every active member (001075's is_org_member) and returns rows only
-- for the events that member may already read (coaches_event) — an admin
-- still sees the whole org, a coach sees their own, everyone else zero rows.
-- The detection itself (detect_event_conflicts) is unchanged.
-- ============================================================================
create or replace function public.event_conflicts_in_range(p_provider uuid, p_from timestamptz, p_to timestamptz)
returns table (event_id uuid, conflict text, other_id uuid, detail text)
language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_provider) then
    raise exception 'only organisation staff may read conflicts' using errcode = '42501';
  end if;
  return query
    select e.id, c.conflict, c.other_id, c.detail
    from public.event e cross join lateral public.detect_event_conflicts(e.id) c
    where e.provider_id = p_provider and e.status <> 'cancelled'
      and tstzrange(e.starts_at, e.ends_at) && tstzrange(p_from, p_to)
      and (auth.uid() is null or public.coaches_event(e.id))
    order by e.starts_at, e.id, c.conflict;
end $$;
revoke all on function public.event_conflicts_in_range(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.event_conflicts_in_range(uuid,timestamptz,timestamptz) to authenticated, service_role;
