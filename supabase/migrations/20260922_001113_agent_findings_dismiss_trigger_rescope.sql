-- 2026-09-22: Bug 3 — re-scope trg_agent_findings_dismiss_only to UPDATE OF status.
--
-- Root cause: the trigger was BEFORE UPDATE (every column). The generator's
-- same-day refresh upsert (on conflict ... do update set title=..., run_id=...
-- on an existing OPEN finding) never touches status, but the trigger still
-- fired. For the authenticated owner, enforce_agent_finding_dismiss_only()
-- only permits open -> dismissed; any other update raises
-- 'findings can only be dismissed ...' -> the whole read-pass transaction
-- rolled back -> every repeat run reported "Read pass · unavailable this run".
-- (Service-role generator paths were already exempt via the auth.uid() guard.)
--
-- Repo-vs-prod reconciliation (2026-09-22, checked live before writing):
--  * public.agent_findings.dismissed_at EXISTS in production, so no column add.
--  * enforce_agent_finding_dismiss_only() is byte-identical to the repo
--    pentest migration (20260910_001042) — no hand-added drift to reconcile.
--  * The trigger was BEFORE UPDATE in prod, matching the repo.
--
-- Fix: BEFORE UPDATE OF status. Owner dismiss (PATCH {status:'dismissed'})
-- still fires it — pentest intent preserved exactly. Generator refresh upserts
-- never touch status, so they stop firing it.
alter table public.agent_findings add column if not exists dismissed_at timestamptz;

drop trigger if exists trg_agent_findings_dismiss_only on public.agent_findings;
create trigger trg_agent_findings_dismiss_only
  before update of status on public.agent_findings
  for each row execute function public.enforce_agent_finding_dismiss_only();
