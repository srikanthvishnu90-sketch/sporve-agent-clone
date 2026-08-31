-- ============================================================================
-- Spec 02 · migration 1 — SEASONS (applied 2026-08-31, owner-directed)
-- Mapping-first: org=providers, team=teams, membership=team_athletes. This adds
-- only what is missing — the season spine that fee schedules, waivers and
-- rosters date against. team_id stays NULLABLE everywhere downstream (a solo
-- trainer is an org with members and zero teams; the member is the spine).
-- ============================================================================
create table if not exists public.seasons (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  constraint seasons_dates check (end_date >= start_date)
);
comment on table public.seasons is
  'A dated container per org: fees, waivers and rosters attach to a season, never to "this year" implied.';

alter table public.teams
  add column if not exists season_id uuid references public.seasons(id) on delete set null;
alter table public.team_athletes
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

create index if not exists idx_seasons_provider on public.seasons(provider_id, start_date desc);

alter table public.seasons enable row level security;
create policy seasons_all_owner on public.seasons
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = seasons.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = seasons.provider_id and pv.owner_id = auth.uid()));
grant select, insert, update, delete on public.seasons to authenticated;
