-- ============================================================================
-- Step 6 (north star) — the NIGHTLY DUES RECONCILER
-- Drafted 2026-08-31 under owner direction ("the follow-ups write themselves").
-- Applied with 000100/000200 by the owner's `supabase db push`.
--
-- WHAT IT DOES: every night at 03:10 UTC, sweep the REAL ledger (bookings that
-- are unpaid and still pending) and insert one DRAFT fee obligation per unpaid
-- booking that does not already have one. The queue tab renders these drafts —
-- so the work is genuinely waiting when the director opens the laptop, from
-- production data, with the lifecycle trigger (000200) guaranteeing a human
-- approval stands between a draft and anything that acts.
--
-- HONESTY PROPERTIES:
--   · source_kind='agent', source_ref='booking:<id>' — every draft is traceable
--     to the ledger row it was derived from, and dedupe keys on that ref.
--   · Runs as cron (no session): auth.uid() is null, so the 000200 lifecycle
--     trigger takes the service path; created_by stays null = "the agent".
--   · The inverse of a drafted fee is simply voiding it — recorded in `inverse`.
--   · No message SENDS from here. Drafting text is a template; nothing leaves
--     without a human approving the row (000200 ladder).
-- ============================================================================

create or replace function public.generate_dues_obligations()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  inserted integer := 0;
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, amount_cents, currency,
     due_at, athlete_id, source_kind, source_ref, inverse)
  select
    pr.provider_id,
    'fee',
    'draft',
    'Collect ' || to_char(coalesce(b.final_price,0), 'FM$999,990.00')
      || ' — ' || coalesce(pr.title, 'session'),
    'Hi ' || coalesce(nullif(p.first_name,''), 'there')
      || ' — the payment of ' || to_char(coalesce(b.final_price,0), 'FM$999,990.00')
      || ' for ' || coalesce(pr.title, 'your booking')
      || ' is still outstanding. You can settle it from your booking page. '
      || 'Reply here if a payment plan would help.',
    round(coalesce(b.final_price,0) * 100)::integer,
    upper(coalesce(b.currency,'USD')),
    b.created_at + interval '7 days',
    b.athlete_id,
    'agent',
    'booking:' || b.id,
    jsonb_build_object('action','void','reason','undo nightly dues draft')
  from public.bookings b
  join public.programs  pr on pr.id = b.program_id
  left join public.profiles p on p.id = b.searcher_id
  where b.payment_status = 'unpaid'
    and b.status = 'pending'
    and b.created_at < now() - interval '2 days'      -- give checkout a chance
    and not exists (
      select 1 from public.obligations o
      where o.source_ref = 'booking:' || b.id
        and o.status <> 'void'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.generate_dues_obligations() is
  'Nightly agent sweep: one draft fee obligation per unpaid pending booking older than 2 days, deduped on source_ref=booking:<id>. Drafts only — the 000200 lifecycle ladder means nothing acts without human approval.';

revoke all on function public.generate_dues_obligations() from public, anon, authenticated;

-- ── Schedule nightly via pg_cron (Supabase ships it; guard anyway) ──────────
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%); reconciler must be invoked manually', sqlerrm;
    return;
  end;
  -- idempotent re-schedule
  perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-dues-nightly';
  perform cron.schedule('sporv-dues-nightly', '10 3 * * *',
    $job$ select public.generate_dues_obligations(); $job$);
end $$;

-- ============================================================================
-- VERIFY AFTER APPLY:
--   select public.generate_dues_obligations();      -- returns N drafts created
--   select jobname, schedule from cron.job where jobname='sporv-dues-nightly';
--   select title, status, source_ref from public.obligations
--     where source_kind='agent' order by created_at desc limit 5;
-- ============================================================================
