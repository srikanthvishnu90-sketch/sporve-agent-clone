-- Spec 04 follow-up: teams_select_parent subqueries team_athletes, whose old
-- owner policies subqueried teams — Postgres refuses the cycle at plan time
-- ("infinite recursion detected in policy for relation teams"), which broke
-- the setup wizard's first team INSERT. team_athletes carries provider_id
-- directly (member spine), so the owner check needs no teams join: backfill
-- provider_id from teams, then drop the four join-based policies. Coverage
-- after: owner via team_athletes_all_owner (provider_id -> providers), parent
-- via team_athletes_select_parent (athletes). Applied to prod 2026-08-31 as
-- spec04_break_rls_recursion.
update public.team_athletes ta set provider_id = t.provider_id
  from public.teams t where t.id = ta.team_id and ta.provider_id is null;
drop policy if exists team_athletes_select_owner on public.team_athletes;
drop policy if exists team_athletes_insert_owner on public.team_athletes;
drop policy if exists team_athletes_update_owner on public.team_athletes;
drop policy if exists team_athletes_delete_owner on public.team_athletes;
