-- 20260915_001051 — spec 12 · event_series: the recurrence rule.
-- Wall-clock intent lives here (local_start_time + IANA timezone). Instants are
-- never stored on the series; they are derived per occurrence by the
-- materializer, which is what keeps a 6pm practice at 6pm across DST.

create table if not exists public.event_series (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.providers(id) on delete cascade,
  team_id           uuid references public.teams(id) on delete cascade,
  program_id        uuid references public.programs(id) on delete set null,
  kind              text not null check (kind in ('practice','game','tryout','camp_day','lesson','meeting','other')),
  title             text not null,
  timezone          text not null,
  local_start_time  time not null,
  duration_minutes  integer not null check (duration_minutes between 5 and 1440),
  rrule             text,                 -- RFC 5545 subset; null = single occurrence
  series_start_date date not null,
  series_end_date   date,
  venue_id          uuid references public.venue(id) on delete set null,
  location_text     text,
  assigned_member_id uuid references public.organization_members(id) on delete set null,
  capacity          integer check (capacity is null or capacity > 0),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  constraint event_series_dates check (series_end_date is null or series_end_date >= series_start_date)
);
create index if not exists event_series_provider_idx on public.event_series (provider_id);
create index if not exists event_series_team_idx on public.event_series (team_id);

create or replace function public.event_series_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  perform public.assert_iana_timezone(new.timezone);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.provider_id := old.provider_id;       -- server-owned; never re-parented
    new.created_by  := old.created_by;
    new.created_at  := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists trg_event_series_guard on public.event_series;
create trigger trg_event_series_guard before insert or update on public.event_series
  for each row execute function public.event_series_guard();

alter table public.event_series enable row level security;
alter table public.event_series force row level security;
revoke all on public.event_series from public, anon;
drop policy if exists event_series_admin_all on public.event_series;
create policy event_series_admin_all on public.event_series for all to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
grant select, insert, update, delete on public.event_series to authenticated;
