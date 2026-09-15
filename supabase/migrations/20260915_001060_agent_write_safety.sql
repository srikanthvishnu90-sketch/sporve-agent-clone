-- ============================================================================
-- 20260915_001060 — SPEC 15 slice 0+1: three modes, and a receipt on every
-- agent write [G6]. Fable/Claude lane (D14). FILE ONLY — never applied (D5).
--
-- Slice 0 — kill the fourth mode. 15.1 / R5: modes are off / observe / draft
-- and there is no auto-send. The database disagreed: lifecycle_message_prefs
-- still admitted mode='auto' and auto_approve_agent_drafts() still existed,
-- one cron.schedule() away from approving drafts into outbound_messages with
-- no human click. Live check 2026-09-15 (read-only): 0 rows with mode='auto',
-- no cron job named sporv-auto-approve. It is dead code, so removing it costs
-- nothing and closes the only path by which "draft-first" could be turned off
-- by a settings row instead of a code review.
--
-- Slice 1 — the known defect class (15.3): a write that reports success while
-- writing nothing. approve_obligation_and_queue updated obligations with no
-- rowcount check; decide_agent_run returned 0 as a success. Both now raise
-- when the write touched no row. dismiss_agent_proposal (if not found → raise)
-- and apply_agent_proposal (written<>1 → raise) were already honest; the
-- registry in scripts/agent-write-registry.mjs records all four and CI
-- (scripts/agent-write-registry.test.mjs) asserts every authenticated write
-- RPC is either registered with its guard or explicitly a human write.
-- ============================================================================

-- ── 0. mode ∈ {off, draft}. 'observe' is the master switch (agent_mode), not
--       a per-job pref, so the per-job vocabulary stays exactly what 001019
--       already enforced for agent_% jobs — now for every event_type. ───────
alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_prefs_auto_only_logistics;
alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_prefs_auto_scope;
alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_message_prefs_mode_check;
alter table public.lifecycle_message_prefs add constraint lifecycle_message_prefs_mode_check
  check (mode in ('off', 'draft'));

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-auto-approve';
  end if;
exception when others then
  raise notice 'pg_cron unavailable (%)', sqlerrm;
end $$;

drop function if exists public.auto_approve_agent_drafts();

-- ── 1a. approve_obligation_and_queue — full body restated (001015) with the
--        status write receipted. A null return still means "approved, nothing
--        to queue" (no guardian / unmapped kind); it can no longer mean
--        "nothing happened". ──────────────────────────────────────────────
create or replace function public.approve_obligation_and_queue(p_obligation_id uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare o record; v_msg uuid; v_event text; n integer;
begin
  select ob.*, g.email as g_email into o
    from public.obligations ob
    left join public.guardians g on g.id = ob.guardian_id
   where ob.id = p_obligation_id;
  if o.id is null then raise exception 'no such obligation'; end if;
  if not exists (select 1 from public.providers
                 where id = o.provider_id and owner_id = auth.uid()) then
    raise exception 'only the org owner may approve';
  end if;
  if o.status <> 'draft' then raise exception 'only a draft can be approved'; end if;
  update public.obligations set status = 'approved' where id = p_obligation_id;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception using errcode = 'P0002',
      message = format('approve wrote %s rows for obligation %s; nothing was queued', n, p_obligation_id);
  end if;
  if o.guardian_id is null then return null; end if;
  v_event := case
    when o.source_ref like 'installment:%'      then 'dues_reminder'
    when o.source_ref like 'waiver:%'           then 'waiver_reminder'
    when o.source_ref like 'session:%:change:%' then 'schedule_change'
    when o.source_ref like 'session:%'          then 'practice_reminder'
    when o.source_ref like 'reactivation:%'     then 'reactivation'
    when o.kind = 'fee'    then 'dues_reminder'
    when o.kind = 'waiver' then 'waiver_reminder'
    when o.kind = 'schedule' then 'practice_reminder'
    else null end;
  if v_event is null then return null; end if;  -- unmapped kinds stay unsent, never mislabeled
  insert into public.outbound_messages
    (provider_id, event_type, status, scheduled_for, obligation_id, content)
  values (o.provider_id, v_event, 'drafted', now(), o.id,
          jsonb_build_object('subject', o.title, 'body', o.detail,
                             'guardian_id', o.guardian_id, 'to_email', o.g_email,
                             'obligation_id', o.id))
  returning id into v_msg;
  return v_msg;
end; $$;
revoke all on function public.approve_obligation_and_queue(uuid) from public, anon;
grant execute on function public.approve_obligation_and_queue(uuid) to authenticated;

-- ── 1b. decide_agent_run — zero drafts touched is an error, not a count. ───
create or replace function public.decide_agent_run(p_provider uuid, p_run uuid, p_decision text)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  if not exists (select 1 from public.providers where id = p_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may decide';
  end if;
  if p_decision not in ('approved','void') then raise exception 'decision must be approved or void'; end if;
  update public.obligations set status = p_decision
   where provider_id = p_provider and run_id = p_run and status = 'draft';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception using errcode = 'P0002',
      message = format('no draft in run %s to mark %s', p_run, p_decision);
  end if;
  return n;
end; $$;
revoke all on function public.decide_agent_run(uuid, uuid, text) from public, anon;
grant execute on function public.decide_agent_run(uuid, uuid, text) to authenticated;
