-- 2026-09-22: generate_agent_findings() (20260902_001020_brain_fill.sql §6
-- roster_gap) selects t.target_size from public.teams, but no migration ever
-- created that column, so POST /rest/v1/rpc/run_agent_read 400s with
-- "column t.target_size does not exist" and the whole read pass aborts —
-- Queue RUN AGENT NOW / SCAN NOW and the sporv-findings-daily cron are dead
-- until this lands. Nullable by design: the roster_gap query filters
-- `where t.target_size is not null`, so existing rows stay inert until a
-- team sets an explicit target size.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS target_size integer;
