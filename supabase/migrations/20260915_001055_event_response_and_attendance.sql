-- 20260915_001055 — spec 12 · event_response (availability / RSVP) and
-- attendance_record (who actually came). Two tables on purpose:
--   * RSVP is a PREDICTION a family makes; 'no_response' is an explicit value so
--     "9 of 14 responded" has a real denominator.
--   * Attendance is a RECORD a staff member makes after the event starts. It is
--     append-only; the read model takes the latest row per (event, member). Nothing
--     ever copies an RSVP into it.
-- Roster identity is team_athletes.id (member_id) — the thing guardian_links points
-- at. public.athletes is the marketplace child identity and is not used here.
-- Server-owned columns are protected on INSERT *and* UPDATE (a WITH CHECK alone
-- lets a client set provider_id to its own org and cross-tenant the row).

create table if not exists public.event_response (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid not null references public.event(id) on delete cascade,
  member_id     uuid not null references public.team_athletes(id) on delete cascade,
  response      text not null check (response in ('yes','no','maybe','no_response')),
  responded_by  uuid,
  source        text not null check (source in ('web','sms','email','staff')),
  note          text,
  responded_at  timestamptz not null default now(),
  unique (event_id, member_id)
);
create index if not exists event_response_event_idx on public.event_response (event_id);

create table if not exists public.attendance_record (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid not null references public.event(id) on delete cascade,
  member_id     uuid not null references public.team_athletes(id) on delete cascade,
  state         text not null check (state in ('present','absent','late','excused')),
  marked_by     uuid not null,
  client_id     uuid not null unique,                 -- idempotency key from the offline queue
  marked_at     timestamptz not null default now()
);
create index if not exists attendance_record_read_idx on public.attendance_record (event_id, member_id, marked_at desc);

-- provider_id and the timestamps are derived server-side from the parent event.
create or replace function public.event_child_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; v_starts timestamptz; v_team uuid;
begin
  select e.provider_id, e.starts_at, e.team_id into v_provider, v_starts, v_team
    from public.event e where e.id = new.event_id;
  if v_provider is null then raise exception 'event % not found', new.event_id using errcode = '23503'; end if;
  -- the athlete must belong to the same org as the event
  if not exists (select 1 from public.team_athletes ta where ta.id = new.member_id and ta.provider_id = v_provider) then
    raise exception 'member % is not on this organisation''s roster', new.member_id using errcode = '23503';
  end if;
  new.provider_id := v_provider;
  if tg_table_name = 'event_response' then
    new.responded_at := clock_timestamp();   -- the real instant, not transaction start: two marks in one
                                              -- transaction (an offline replay batch) must still order
    if auth.uid() is not null then new.responded_by := auth.uid(); end if;
  else -- attendance_record
    if now() < v_starts then
      raise exception 'attendance cannot be recorded before the event starts (%)', v_starts using errcode = '22023';
    end if;
    new.marked_at := clock_timestamp();
    if auth.uid() is not null then new.marked_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_event_response_guard on public.event_response;
create trigger trg_event_response_guard before insert or update on public.event_response
  for each row execute function public.event_child_guard();
drop trigger if exists trg_attendance_guard on public.attendance_record;
create trigger trg_attendance_guard before insert on public.attendance_record
  for each row execute function public.event_child_guard();

-- attendance is append-only, same shape as the payment ledger
create or replace function public.attendance_is_append_only() returns trigger
language plpgsql set search_path to '' as $$
begin raise exception 'attendance_record is append-only; add a newer row instead' using errcode = '55000'; end $$;
drop trigger if exists trg_attendance_append_only on public.attendance_record;
create trigger trg_attendance_append_only before update or delete on public.attendance_record
  for each row execute function public.attendance_is_append_only();

-- read model: latest state per (event, member)
create or replace view public.attendance_current with (security_invoker = on) as
  select distinct on (event_id, member_id) id, provider_id, event_id, member_id, state, marked_by, marked_at
  from public.attendance_record order by event_id, member_id, marked_at desc;

alter table public.event_response enable row level security;
alter table public.event_response force row level security;
alter table public.attendance_record enable row level security;
alter table public.attendance_record force row level security;
revoke all on public.event_response, public.attendance_record from public, anon;

-- staff (owner/admin today; coach-of-team arrives with spec 11.6's role matrix)
drop policy if exists event_response_admin_all on public.event_response;
create policy event_response_admin_all on public.event_response for all to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
-- a guardian may read and write responses ONLY for athletes they are linked to,
-- and only on published events. (Parents have no login today — spec 13 adds the
-- token path via set_event_response below; this is the future logged-in path.)
drop policy if exists event_response_guardian on public.event_response;
create policy event_response_guardian on public.event_response for all to authenticated
  using (exists (select 1 from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
                 where gl.member_id = event_response.member_id and g.user_id = auth.uid()))
  with check (exists (select 1 from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
                      where gl.member_id = event_response.member_id and g.user_id = auth.uid())
              and exists (select 1 from public.event e where e.id = event_response.event_id and e.published_at is not null));
drop policy if exists attendance_admin_all on public.attendance_record;
create policy attendance_admin_all on public.attendance_record for all to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
grant select, insert, update on public.event_response to authenticated;
grant select, insert on public.attendance_record to authenticated;
grant select on public.attendance_current to authenticated;

-- One write path for RSVP that staff, a logged-in guardian, and (spec 13) a
-- token-authenticated edge function can all use. Upserts; never touches attendance.
create or replace function public.set_event_response(
  p_event uuid, p_member uuid, p_response text, p_source text default 'web', p_note text default null)
returns public.event_response language plpgsql security definer set search_path to '' as $$
declare v_row public.event_response; v_provider uuid;
begin
  select provider_id into v_provider from public.event where id = p_event;
  if v_provider is null then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null
     and not public.is_org_admin(v_provider)
     and not exists (select 1 from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
                     where gl.member_id = p_member and g.user_id = auth.uid()) then
    raise exception 'not allowed to respond for this athlete' using errcode = '42501';
  end if;
  insert into public.event_response (provider_id, event_id, member_id, response, source, note)
  values (v_provider, p_event, p_member, p_response, p_source, p_note)
  on conflict (event_id, member_id) do update
    set response = excluded.response, source = excluded.source, note = excluded.note
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.set_event_response(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.set_event_response(uuid,uuid,text,text,text) to authenticated, service_role;

-- Staff attendance write with the offline-queue idempotency key: replaying the
-- same client_id twice yields exactly one row.
create or replace function public.mark_attendance(
  p_event uuid, p_member uuid, p_state text, p_client_id uuid)
returns public.attendance_record language plpgsql security definer set search_path to '' as $$
declare v_row public.attendance_record; v_provider uuid;
begin
  select provider_id into v_provider from public.event where id = p_event;
  if v_provider is null then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may mark attendance' using errcode = '42501';
  end if;
  select * into v_row from public.attendance_record where client_id = p_client_id;
  if found then return v_row; end if;
  insert into public.attendance_record (provider_id, event_id, member_id, state, marked_by, client_id)
  values (v_provider, p_event, p_member, p_state, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'), p_client_id)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.mark_attendance(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.mark_attendance(uuid,uuid,text,uuid) to authenticated, service_role;
