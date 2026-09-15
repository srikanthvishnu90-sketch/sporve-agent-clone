-- 20260915_001050 — spec 12 (scheduling) · venue + blackout windows.
-- Block: Fable 001050–001099 (DECISIONS 2026-09-15 D14). FILE ONLY — never applied
-- by an agent; D5 moves the agent product to its own Supabase project, so these
-- run there first. Org root is public.providers (no organizations table exists);
-- every schedule table carries provider_id -> providers(id).
--
-- WHY a venue table instead of facilities: facilities is a shared scouting
-- directory with `USING (true)` reads and no org owner. Conflict detection needs
-- an org-owned bookable resource. facilities is left untouched.

create table if not exists public.venue (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  name         text not null,
  address      text,
  timezone     text,                       -- IANA; null = inherit the series/org
  capacity     integer check (capacity is null or capacity > 0),
  created_at   timestamptz not null default now()
);
create index if not exists venue_provider_idx on public.venue (provider_id);

create table if not exists public.blackout_window (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  label        text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now(),
  constraint blackout_window_order check (ends_at > starts_at)
);
create index if not exists blackout_window_provider_idx on public.blackout_window (provider_id, starts_at);

-- IANA timezone guard, shared by venue and event_series. A CHECK cannot hold a
-- subquery, so it is a trigger; an unknown zone is rejected at write time rather
-- than surfacing as a wrong-hour practice in November.
create or replace function public.assert_iana_timezone(p_tz text)
returns void language plpgsql stable set search_path to '' as $$
begin
  if p_tz is null then return; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'unknown IANA timezone: %', p_tz using errcode = '22023';
  end if;
end $$;
create or replace function public.venue_guard_tz() returns trigger
language plpgsql set search_path to '' as $$
begin perform public.assert_iana_timezone(new.timezone); return new; end $$;
drop trigger if exists trg_venue_guard_tz on public.venue;
create trigger trg_venue_guard_tz before insert or update on public.venue
  for each row execute function public.venue_guard_tz();

alter table public.venue enable row level security;
alter table public.venue force row level security;
alter table public.blackout_window enable row level security;
alter table public.blackout_window force row level security;
revoke all on public.venue, public.blackout_window from public, anon;

drop policy if exists venue_admin_all on public.venue;
create policy venue_admin_all on public.venue for all to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
drop policy if exists blackout_admin_all on public.blackout_window;
create policy blackout_admin_all on public.blackout_window for all to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
grant select, insert, update, delete on public.venue, public.blackout_window to authenticated;
