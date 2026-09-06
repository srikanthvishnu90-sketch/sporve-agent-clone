-- 20260906_001029 — git/prod parity backfill: run_agent_drafts
-- Prod's version (applied during the doc-06 sweep) runs SEVEN generators with
-- a shared run_id and returns a total; git still carried the original three
-- from 20260831_001013. Dumped verbatim via pg_get_functiondef 2026-09-06 so
-- the coverage matrix and a fresh clone see what actually runs. Idempotent.
CREATE OR REPLACE FUNCTION public.run_agent_drafts(p_provider uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v1 int; v2 int; v3 int; v4 int; v5 int; v6 int; v7 int; v_run uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.providers where id=p_provider and owner_id=auth.uid()) then
    raise exception 'only the org owner may run the agent'; end if;
  v1 := public.generate_installment_followups(p_provider, true, v_run);
  v2 := public.generate_waiver_followups(p_provider, true, v_run);
  v3 := public.generate_practice_reminders(p_provider, true, v_run);
  v4 := public.generate_reactivation_drafts(p_provider, true, v_run);
  v5 := public.generate_eligibility_report(p_provider, true, v_run);
  v6 := public.generate_missing_info_requests(p_provider, true, v_run);
  v7 := public.generate_idle_capacity_offers(p_provider, true, v_run);
  return jsonb_build_object('dues',v1,'waivers',v2,'practice',v3,'reactivation',v4,
    'eligibility',v5,'missing_info',v6,'capacity_offer',v7,
    'total',v1+v2+v3+v4+v5+v6+v7,'run_id',v_run);
end; $function$;
