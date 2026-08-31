-- Spec 02 design rule 1: team_id is NULLABLE everywhere — a solo trainer is an
-- org with members and zero teams. team_athletes is the member spine, so its
-- team link becomes optional; provider scope comes via a direct provider_id.
alter table public.team_athletes alter column team_id drop not null;
alter table public.team_athletes
  add column if not exists provider_id uuid references public.providers(id) on delete cascade;
comment on column public.team_athletes.provider_id is
  'Direct org scope so a member can exist with no team (solo trainer). Backfilled from the team where present; new rows set it explicitly.';
update public.team_athletes ta set provider_id = t.provider_id
  from public.teams t where ta.team_id = t.id and ta.provider_id is null;
create index if not exists idx_team_athletes_provider on public.team_athletes(provider_id);
alter table public.team_athletes drop constraint if exists team_athletes_scope;
alter table public.team_athletes
  add constraint team_athletes_scope check (team_id is not null or provider_id is not null);
