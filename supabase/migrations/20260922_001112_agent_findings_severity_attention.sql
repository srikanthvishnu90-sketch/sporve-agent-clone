-- 2026-09-22: Bug 2 — widen agent_findings severity CHECK to include 'attention'.
--
-- generate_agent_findings emits severity 'attention' in 8 places (credentials
-- expiring in 8-30 days, reconciliation_drift, refund_exposure, camp start
-- imminence, waiver_drift, idle_capacity, collection_trend drop >10pts), but
-- agent_findings_severity_check only allowed info|warn|urgent. A single
-- 'attention' row violated the CHECK, which rolled back the ENTIRE read-pass
-- transaction -> zero findings written and the UI reported a clean bill of
-- health ("Read pass · N things noticed" never reached the client as a number).
--
-- Fix: widen the constraint to ('info','warn','urgent','attention'). One
-- migration, drop + re-add; no data touched.
alter table public.agent_findings drop constraint if exists agent_findings_severity_check;
alter table public.agent_findings
  add constraint agent_findings_severity_check
  check (severity in ('info','warn','urgent','attention'));
