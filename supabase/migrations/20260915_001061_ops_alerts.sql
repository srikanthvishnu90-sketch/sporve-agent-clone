-- ============================================================================
-- 20260915_001061 — ops_alerts(): the first READ of the telemetry we already
-- write. External-dependency item 7 / spec 18.3. Fable lane (D14). FILE ONLY
-- — never applied (D5).
--
-- Every table below existed before this file and had exactly zero readers:
-- webhook_dead_letter (one writer, stripe-webhook), cron_http_audit (a */5
-- reconciler that ends in `raise log`, which lands in Postgres logs nobody
-- watches), ai_observability_events, payment_event_ledger, outbound_messages.
-- data_health() checks the retired marketplace's invariants (listings without
-- sessions); it says nothing about money, delivery, or the agent.
--
-- ops_alerts() returns the same shape as data_health() — severity,
-- check_name, failing_count, detail — over the six things spec 18.3 says to
-- alert on. Counts and static detail strings only: no ids, no names, no
-- addresses, so the result can be echoed into a CI log. Page on critical,
-- digest high. service_role only; the ops-health edge function fronts it
-- behind its own shared secret so no database credential ever reaches CI.
-- ============================================================================

create or replace function public.ops_alerts()
returns table(severity text, check_name text, failing_count bigint, detail text)
language plpgsql stable security definer set search_path to '' as $$
declare v_last_tick timestamptz;
begin
  -- 1. webhook dead letters — money events Stripe sent that we could not apply
  return query
    select 'critical', 'webhook_dead_letter_unresolved', count(*),
           'Stripe events that failed to apply and are not resolved. A booking or dues payment may be paid at Stripe and unpaid here.'
      from public.webhook_dead_letter where resolved_at is null having count(*) > 0;
  return query
    select 'critical', 'webhook_dead_letter_new_24h', count(*),
           'New dead-lettered Stripe events in the last 24 hours — growth, not backlog.'
      from public.webhook_dead_letter where first_seen_at > now() - interval '24 hours' having count(*) > 0;

  -- 2. payment reconciliation drift — a paid record with no ledger entry behind it
  return query
    select 'critical', 'paid_without_ledger', count(*),
           'Bookings marked paid with no payment_event_ledger row. The ledger is the only proof money moved.'
      from public.bookings b
     where b.payment_status = 'paid'
       and not exists (select 1 from public.payment_event_ledger l where l.booking_id = b.id)
    having count(*) > 0;

  -- 3. delivery failure — messages a human approved that did not reach a family
  return query
    select case when count(*) >= 5 then 'critical' else 'high' end, 'delivery_failed_24h', count(*),
           'Approved messages that failed or need review in the last 24 hours. Families are not hearing from their club.'
      from public.outbound_messages
     where status in ('failed', 'needs_review') and created_at > now() - interval '24 hours'
    having count(*) > 0;
  return query
    select 'critical', 'approved_not_sent_15m', count(*),
           'Messages approved more than 15 minutes ago and still not sent. R5 promises approval-to-delivery under 15 seconds.'
      from public.outbound_messages
     where status = 'approved' and approved_at < now() - interval '15 minutes'
       and coalesce(send_after, approved_at) < now() - interval '15 minutes'
    having count(*) > 0;

  -- 4. cron HTTP failures — the every-minute worker ticks that did not return 2xx
  return query
    select 'critical', 'cron_http_failed_60m', count(*),
           'Scheduled HTTP calls (lifecycle worker, agent sweeps) that failed or never returned in the last hour.'
      from public.cron_http_audit
     where queued_at > now() - interval '60 minutes'
       and ((status_code is not null and (status_code < 200 or status_code >= 300))
            or error_msg like 'no response row%')
    having count(*) > 0;

  -- 5. agent error rate — model calls that errored, as a share of the last 24h
  return query
    select 'high', 'ai_error_rate_24h', count(*) filter (where outcome = 'error'),
           'AI gateway requests that ended in error in the last 24 hours (over 10% of at least 10 requests).'
      from public.ai_observability_events
     where occurred_at > now() - interval '24 hours'
    having count(*) >= 10 and count(*) filter (where outcome = 'error') * 10 > count(*);

  -- 6. scheduler heartbeat — if pg_cron stopped, every check above goes quiet, which is not the same as healthy
  if to_regclass('cron.job_run_details') is not null then
    execute $q$ select max(start_time) from cron.job_run_details where status = 'succeeded' $q$ into v_last_tick;
    if v_last_tick is null or v_last_tick < now() - interval '10 minutes' then
      return query select 'critical', 'cron_heartbeat_stale', 1::bigint,
        'No pg_cron job has succeeded in the last 10 minutes. Reminders, sweeps and sends are not running.';
    end if;
  end if;
  return;
end; $$;

revoke all on function public.ops_alerts() from public, anon, authenticated;
grant execute on function public.ops_alerts() to service_role;
comment on function public.ops_alerts() is
  'Spec 18.3 alert feed: counts + static detail only. Page on critical, digest high. Read by the ops-health edge function.';

-- ── 7. the function inventory, so CI can catch repo/prod drift ─────────────
-- #414 was the first occurrence of the repo/prod drift class; a 2026-09-15
-- report of three more (generate_treasurer_summary, generate_idle_capacity_
-- offers, enqueue_rebook_nudges) turned out to be a case-sensitive grep miss —
-- all three are in migrations. The owner ruled the class needs a guard, not
-- another fix: tools/check-migration-drift.mjs compares this list with
-- every `create function public.X(` in supabase/migrations and fails on any
-- live function the repo does not hold. Names and argument types only —
-- extension-owned functions excluded. service_role only, read by ops-health.
create or replace function public.ops_function_inventory()
returns table(name text, args text)
language sql stable security definer set search_path to '' as $$
  select p.proname::text, pg_get_function_identity_arguments(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
   where n.nspname = 'public' and d.objid is null
   order by 1, 2
$$;
revoke all on function public.ops_function_inventory() from public, anon, authenticated;
grant execute on function public.ops_function_inventory() to service_role;
