-- 20260907_001033 — agent cron hygiene: onboarding gate in read/autodraft helpers (red draft 2026-09-06, owner-approved)
-- [CRITICAL-PATH] REVIEWABLE DRAFT ONLY. Not applied to any shared database.
-- S05: every agent finding/draft generator must skip organizations that have
-- not completed onboarding, including when agent mode is observe/draft.
-- Preconditions: verify all generator call sites use agent_read_on or
-- agent_autodraft_on, then apply with the canonical migration owner.
-- Inverse: restore the saved function definitions after a compare-before-
-- restore review; no rows or settings are changed by this migration.

create or replace function public.agent_read_on(p_provider uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.providers p
    where p.id=p_provider and p.onboarding_completed is true
  ) and public.agent_mode(p_provider) in ('observe','draft');
$$;

create or replace function public.agent_autodraft_on(p_provider uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.providers p
    where p.id=p_provider and p.onboarding_completed is true
  ) and public.agent_mode(p_provider) = 'draft';
$$;

revoke all on function public.agent_read_on(uuid) from public, anon, authenticated;
revoke all on function public.agent_autodraft_on(uuid) from public, anon, authenticated;
-- Existing generator functions are SECURITY DEFINER and call these helpers.
-- Their service-role execution therefore retains no new client capability.

