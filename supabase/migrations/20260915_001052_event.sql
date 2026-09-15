-- 20260915_001052 — spec 12 · event: one materialised occurrence.
-- Lands ALONGSIDE public.sessions (bookings.session_id and
-- disputes.proposed_session_id are real foreign keys to sessions, and a foreign
-- key cannot reference a view — so sessions stays a table until every writer is
-- re-pointed; see 001054 for the copy). starts_at/ends_at are the resolved
-- instants; timezone is kept for display and re-derivation.

create table if not exists public.event (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         uuid not null references public.providers(id) on delete cascade,
  series_id           uuid references public.event_series(id) on delete cascade,
  series_local_date   date,                                  -- which occurrence of the series
  team_id             uuid references public.teams(id) on delete cascade,
  program_id          uuid references public.programs(id) on delete set null,
  kind                text not null check (kind in ('practice','game','tryout','camp_day','lesson','meeting','other')),
  title               text not null,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  timezone            text not null,
  venue_id            uuid references public.venue(id) on delete set null,
  location_text       text,
  status              text not null default 'scheduled'
                        check (status in ('scheduled','cancelled','postponed','completed')),
  cancellation_reason text,
  is_exception        boolean not null default false,
  opponent            text,
  home_away           text check (home_away is null or home_away in ('home','away','neutral')),
  arrival_offset_minutes integer not null default 0,
  notes               text,
  assigned_member_id  uuid references public.organization_members(id) on delete set null,
  capacity            integer check (capacity is null or capacity > 0),
  published_at        timestamptz,                             -- null = invisible to families
  sequence            integer not null default 0,              -- ICS SEQUENCE; bumped on change
  source_session_id   uuid unique references public.sessions(id) on delete set null,
  source_fixture_id   uuid unique references public.program_fixtures(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint event_time_order check (ends_at > starts_at)
);
create index if not exists event_provider_starts_idx on public.event (provider_id, starts_at);
create index if not exists event_team_starts_idx on public.event (team_id, starts_at) where status <> 'cancelled';
create unique index if not exists event_series_occurrence_uq on public.event (series_id, series_local_date)
  where series_id is not null;

create or replace function public.event_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  perform public.assert_iana_timezone(new.timezone);
  if tg_op = 'INSERT' then
    new.sequence   := 0;
    new.created_at := now();
    new.updated_at := now();
  else
    new.provider_id := old.provider_id;   -- server-owned
    new.created_at  := old.created_at;
    -- Unpublishing is not allowed (spec 12.6): a published event is cancelled, never hidden.
    if old.published_at is not null and new.published_at is null then
      raise exception 'an event cannot be unpublished; cancel it instead' using errcode = '55000';
    end if;
    -- Any family-visible change bumps SEQUENCE so subscribed calendars refresh.
    if (new.starts_at, new.ends_at, new.venue_id, new.location_text, new.status, new.title)
       is distinct from (old.starts_at, old.ends_at, old.venue_id, old.location_text, old.status, old.title) then
      new.sequence := old.sequence + 1;
      if new.series_id is not null and (new.starts_at, new.ends_at, new.venue_id, new.location_text)
         is distinct from (old.starts_at, old.ends_at, old.venue_id, old.location_text) then
        new.is_exception := true;         -- diverged from its series; regeneration leaves it alone
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_event_guard on public.event;
create trigger trg_event_guard before insert or update on public.event
  for each row execute function public.event_guard();

alter table public.event enable row level security;
alter table public.event force row level security;
revoke all on public.event from public, anon;      -- no anon feed of the schedule; ICS goes via token
drop policy if exists event_admin_all on public.event;
create policy event_admin_all on public.event for all to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
-- Families: published events for teams their athlete is rostered on. Parents have
-- no login today (spec 13 is token-first); this is the future logged-in path and
-- costs nothing now.
drop policy if exists event_select_family on public.event;
create policy event_select_family on public.event for select to authenticated
  using (published_at is not null and exists (
    select 1 from public.guardian_links gl
    join public.guardians g on g.id = gl.guardian_id
    join public.team_athletes ta on ta.id = gl.member_id
    where g.user_id = auth.uid() and ta.team_id = event.team_id));
grant select, insert, update, delete on public.event to authenticated;
