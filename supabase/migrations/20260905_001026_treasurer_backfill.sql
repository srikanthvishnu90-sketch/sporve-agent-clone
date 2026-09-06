-- 20260905_001026 — git/prod parity backfill: generate_treasurer_summary
-- existed only in prod (applied via execute_sql during the doc-06 sweep, with
-- the NULL-title coalesce fix of 2026-09-02 already in the body). Dumped
-- verbatim via pg_get_functiondef 2026-09-05 so the coverage matrix — and a
-- fresh clone — see what actually runs. Idempotent.
CREATE OR REPLACE FUNCTION public.generate_treasurer_summary(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_run uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id, evidence, subject_type)
  select fs.provider_id, 'money', 'treasurer_summary', 'info',
    'This month: ' || to_char(coalesce(sum(i.amount_cents) filter (where i.status='paid'),0)/100.0,'FM$999,990.00')
      || ' collected of ' || to_char(coalesce(sum(i.amount_cents),0)/100.0,'FM$999,990.00') || ' billed',
    'Billed ' || to_char(coalesce(sum(i.amount_cents),0)/100.0,'FM$999,990.00')
      || ' · collected ' || to_char(coalesce(sum(i.amount_cents) filter (where i.status='paid'),0)/100.0,'FM$999,990.00')
      || ' · overdue ' || to_char(coalesce(sum(i.amount_cents) filter (where i.status not in ('paid','waived') and i.due_date<current_date),0)/100.0,'FM$999,990.00')
      || '. Sporv platform fee $0; card processing runs on your own Stripe account.',
    'finding:treasurer:'||fs.provider_id||':'||to_char(current_date,'YYYY-MM'), v_run,
    jsonb_build_object('billed',coalesce(sum(i.amount_cents),0),'collected',coalesce(sum(i.amount_cents) filter (where i.status='paid'),0)), 'provider'
  from public.fee_schedules fs join public.installments i on i.fee_schedule_id=fs.id
  where i.due_date >= date_trunc('month',current_date)
    and (p_provider is null or fs.provider_id=p_provider) and (p_force or public.agent_read_on(fs.provider_id))
  group by fs.provider_id
  on conflict (provider_id, source_ref) where status<>'dismissed'
  do update set title=excluded.title, detail=excluded.detail, evidence=excluded.evidence, run_id=excluded.run_id, updated_at=now();
  get diagnostics n = row_count;
  return n;
end; $function$;
