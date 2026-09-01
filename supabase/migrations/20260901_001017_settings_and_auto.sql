-- ============================================================================
-- SETTINGS + PER-JOB AUTO (owner overrule, 2026-09-01) — the owner has now
-- asked three times for "the agent sends everything" behind a setting, and the
-- pasted mock designs the guardrails in: per-job Off/Draft/Auto, a consent
-- modal, an escalation cap, per-family exclusions, a sending window, and
-- "auto never applies backwards". This migration supersedes the
-- auto-only-logistics stance for AGENT job keys, with every guardrail
-- enforced HERE in SQL, not in the client.
--
-- Consent semantics: flipping a job to 'auto' stamps updated_by = the admin
-- who flipped it; every auto-approved message carries that admin as
-- approved_by. The audit answers "who let this send" with a person.
-- ============================================================================

-- A ── org settings: one owner-scoped KV table, no new provider GRANT surface
create table if not exists public.provider_settings (
  provider_id uuid not null references public.providers(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (provider_id, key)
);
alter table public.provider_settings enable row level security;
create policy provider_settings_all_owner on public.provider_settings
  for all to authenticated
  using (exists (select 1 from public.providers p
                 where p.id = provider_settings.provider_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers p
                 where p.id = provider_settings.provider_id and p.owner_id = auth.uid()));
grant select, insert, update, delete on public.provider_settings to authenticated;
create or replace function public.stamp_provider_setting()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end; $$;
revoke all on function public.stamp_provider_setting() from public, anon, authenticated;
drop trigger if exists trg_stamp_provider_setting on public.provider_settings;
create trigger trg_stamp_provider_setting before insert or update on public.provider_settings
  for each row execute function public.stamp_provider_setting();

-- B ── per-job pref keys + auto permitted on agent jobs (consented)
alter table public.lifecycle_message_prefs
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
create or replace function public.stamp_lmp()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end; $$;
revoke all on function public.stamp_lmp() from public, anon, authenticated;
drop trigger if exists trg_stamp_lmp on public.lifecycle_message_prefs;
create trigger trg_stamp_lmp before insert or update on public.lifecycle_message_prefs
  for each row execute function public.stamp_lmp();

alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_message_prefs_event_type_check;
alter table public.lifecycle_message_prefs add constraint lifecycle_message_prefs_event_type_check
  check (event_type in ('booking_confirmed','reminder_24h','post_session','no_show_followup',
                        'rebook_nudge','agent_autodraft',
                        'agent_a1','agent_a2','agent_b1','agent_b2','agent_c1','agent_c2','agent_d1'));
alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_prefs_auto_only_logistics;
alter table public.lifecycle_message_prefs add constraint lifecycle_prefs_auto_scope
  check (mode <> 'auto' or event_type in
    ('booking_confirmed','reminder_24h',
     'agent_a1','agent_a2','agent_b1','agent_b2','agent_c1','agent_c2','agent_d1'));
-- agent_autodraft (the master draft toggle) stays off|draft by the check above.

-- C ── the auto-approver: cron-side, service-role, every guardrail in one place
create or replace function public.auto_approve_agent_drafts()
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer := 0; r record; v_msg uuid; v_event text;
        v_now_local time; v_dow int;
begin
  for r in
    select o.*, p.mode, p.updated_at as consent_at, p.updated_by as consented_by,
           g.email as g_email, g.email_bounced_at,
           coalesce((ws.value->>'start')::time, time '08:00') as win_start,
           coalesce((ws.value->>'end')::time,   time '20:00') as win_end,
           coalesce(ws.value->'blocked_days', '[]'::jsonb) as blocked_days,
           nullif(ws.value->>'pause_until','')::date as pause_until,
           coalesce(tz.value->>'tz','America/Chicago') as org_tz,
           coalesce(cap.value->>'level','friendly') as cap_level,
           coalesce(ex.value, '[]'::jsonb) as excluded
    from public.obligations o
    join public.lifecycle_message_prefs p
      on p.provider_id = o.provider_id
     and p.event_type = case
           when o.source_ref like 'installment:%' and o.title like 'Payment failed%' then 'agent_a2'
           when o.source_ref like 'installment:%' then 'agent_a1'
           when o.source_ref like 'waiver:%' then 'agent_b1'
           when o.source_ref like 'eligibility:%' then 'agent_b2'
           when o.source_ref like 'session:%:change:%' then 'agent_c2'
           when o.source_ref like 'session:%' then 'agent_c1'
           when o.source_ref like 'reactivation:%' then 'agent_d1'
           else '__none__' end
     and p.mode = 'auto'
    left join public.guardians g on g.id = o.guardian_id
    left join public.provider_settings ws on ws.provider_id = o.provider_id and ws.key = 'send_window'
    left join public.provider_settings tz on tz.provider_id = o.provider_id and tz.key = 'org_tz'
    left join public.provider_settings cap on cap.provider_id = o.provider_id and cap.key = 'auto_money_cap'
    left join public.provider_settings ex on ex.provider_id = o.provider_id and ex.key = 'auto_exclude_guardians'
    where o.status = 'draft' and o.source_kind = 'agent'
      -- AUTO NEVER APPLIES BACKWARDS: only drafts created after the consent flip
      and o.created_at > p.updated_at
  loop
    -- sending window (org-local): outside it, leave the draft; next tick retries
    v_now_local := (now() at time zone r.org_tz)::time;
    v_dow := extract(dow from (now() at time zone r.org_tz))::int;
    if r.pause_until is not null and current_date <= r.pause_until then continue; end if;
    if v_now_local < r.win_start or v_now_local > r.win_end then continue; end if;
    if r.blocked_days ? v_dow::text then continue; end if;
    -- escalation cap on dues: friendly = attempt 1 only, firm <= 2, final <= 3
    if r.source_ref like 'installment:%' and r.title not like 'Payment failed%' then
      if (split_part(r.source_ref, ':attempt:', 2))::int >
         (case r.cap_level when 'friendly' then 1 when 'firm' then 2 else 3 end) then
        continue;   -- firmer than the cap: stays a draft for a human
      end if;
    end if;
    -- per-family exclusion: these guardians always get drafts
    if r.guardian_id is not null and r.excluded ? r.guardian_id::text then continue; end if;
    if r.guardian_id is not null and r.email_bounced_at is not null then continue; end if;

    update public.obligations
       set status = 'approved', approved_by = r.consented_by, approved_at = now()
     where id = r.id and status = 'draft';
    if not found then continue; end if;
    n := n + 1;
    if r.guardian_id is null then continue; end if;  -- reports approve, never send
    v_event := case
      when r.source_ref like 'installment:%' then 'dues_reminder'
      when r.source_ref like 'waiver:%' then 'waiver_reminder'
      when r.source_ref like 'session:%:change:%' then 'schedule_change'
      when r.source_ref like 'session:%' then 'practice_reminder'
      when r.source_ref like 'reactivation:%' then 'reactivation'
      else null end;
    if v_event is null then continue; end if;
    insert into public.outbound_messages
      (provider_id, event_type, status, scheduled_for, obligation_id,
       approved_by, approved_at, content)
    values (r.provider_id, v_event, 'approved', now(), r.id,
            r.consented_by, now(),
            jsonb_build_object('subject', r.title, 'body', r.detail,
                               'guardian_id', r.guardian_id, 'to_email', r.g_email,
                               'obligation_id', r.id, 'auto', true));
  end loop;
  return n;
end; $$;
revoke all on function public.auto_approve_agent_drafts() from public, anon, authenticated;
do $$
begin
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-auto-approve';
    perform cron.schedule('sporv-auto-approve', '*/5 * * * *',
      $job$ select public.auto_approve_agent_drafts(); $job$);
  exception when others then
    raise notice 'pg_cron unavailable (%)', sqlerrm;
  end;
end $$;

-- The obligations lifecycle trigger stamps approved_by from auth.uid() on
-- client approvals; the cron path writes it explicitly. Ensure the trigger
-- does not overwrite an explicit value when auth.uid() is null (cron).
