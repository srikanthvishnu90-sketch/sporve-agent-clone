-- 20260904_001024 — RED-set fixes, owner-authorized 2026-09-04
-- ("apply the red fixes"). Pentest-delta findings 1, 4, 5, 10.

-- ── 1 (HIGH): create_member_fee_schedule asserted no ownership — any
--    signed-in account could mint dues against another org. SECURITY DEFINER
--    bypasses RLS, so ownership is re-asserted in the body. Sole caller is
--    the wizard under the coach's own JWT; no service path exists, so
--    auth.uid() ownership is required, full stop.
create or replace function public.create_member_fee_schedule(
  p_provider_id uuid, p_program_id uuid, p_member_id uuid, p_season_id uuid,
  p_total_cents integer, p_installment_count integer default null,
  p_first_due date default null
) returns uuid
language plpgsql security definer set search_path to '' as $$
declare
  v_type text; v_count integer; v_fs uuid; v_per integer; v_rem integer;
  v_due date := coalesce(p_first_due, current_date + 7);
  v_pol text; v_dep integer;
begin
  if not exists (select 1 from public.providers
                 where id = p_provider_id and owner_id = auth.uid()) then
    raise exception 'not your organization';
  end if;
  if p_program_id is not null and not exists (select 1 from public.programs
      where id = p_program_id and provider_id = p_provider_id) then
    raise exception 'program does not belong to this organization';
  end if;
  if not exists (select 1 from public.team_athletes
      where id = p_member_id and provider_id = p_provider_id) then
    raise exception 'member does not belong to this organization';
  end if;
  select offering_type into v_type from public.programs where id = p_program_id;
  select refund_policy, refund_deposit_cents into v_pol, v_dep
    from public.providers where id = p_provider_id;
  v_count := case
    when v_type = 'team' then greatest(coalesce(p_installment_count, 3), 1)
    else 1 end;
  insert into public.fee_schedules
    (provider_id, program_id, member_id, season_id, total_cents,
     installment_count, refund_policy, refund_deposit_cents)
  values (p_provider_id, p_program_id, p_member_id, p_season_id,
          p_total_cents, v_count, v_pol, v_dep)
  returning id into v_fs;
  v_per := p_total_cents / v_count;
  v_rem := p_total_cents - v_per * v_count;
  insert into public.installments (fee_schedule_id, member_id, due_date, amount_cents)
  select v_fs, p_member_id, v_due + (n * 30),
         v_per + case when n = 0 then v_rem else 0 end
  from generate_series(0, v_count - 1) n;
  return v_fs;
end; $$;

-- ── 2 (MED): suppression must survive the row. An org could clear a spam
--    complaint by deleting + re-inserting the guardian. The suppression now
--    lives per-EMAIL in its own table (service-role written by the webhook),
--    and the guardians guard consults it on INSERT and on email change.
create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null default 'complained' check (reason in ('complained','bounced','unsubscribed')),
  created_at timestamptz not null default now()
);
alter table public.email_suppressions enable row level security;
-- deliberately NO authenticated policies: the webhook (service role) writes,
-- the send path reads with service role. Orgs can neither see nor clear it.

create or replace function public.guard_guardian_email_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_server boolean; v_sup text; v_check boolean;
begin
  v_server := (auth.uid() is null)
    or coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'role','') = 'service_role';
  if tg_op = 'UPDATE' then
    if old.email_status = 'complained'
       and new.email_status is distinct from old.email_status
       and not v_server then
      raise exception 'a spam complaint cannot be cleared by the organization';
    end if;
  end if;
  -- Fresh row (or changed address): a suppressed email stays suppressed no
  -- matter how many times the row is recreated. OLD is only touched on
  -- UPDATE — an INSERT trigger has no OLD and evaluation order in SQL
  -- expressions is not guaranteed, so this is a statement-level branch.
  v_check := (tg_op = 'INSERT');
  if not v_check then
    v_check := (new.email is distinct from old.email)
            or (new.email_status is distinct from old.email_status);
  end if;
  if new.email is not null and v_check then
    select reason into v_sup from public.email_suppressions where email = lower(new.email);
    if v_sup is not null and not v_server then
      new.email_status := v_sup;
      if v_sup in ('bounced','complained') and new.email_bounced_at is null then
        new.email_bounced_at := now();
      end if;
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.email_status = 'ok' and old.email_status is distinct from 'ok' then
      new.email_bounced_at := null;
    end if;
  end if;
  if new.email_status in ('bounced','complained') and new.email_bounced_at is null then
    new.email_bounced_at := now();
  end if;
  return new;
end; $$;

drop trigger if exists guard_guardian_email_status on public.guardians;
create trigger guard_guardian_email_status
  before insert or update on public.guardians
  for each row execute function public.guard_guardian_email_status();

-- ── 3 (MED): anon held table-level SELECT on guardian emails + obligations;
--    RLS was the only thing between them and a public dump.
revoke select on public.guardians from anon;
revoke select on public.obligations from anon;

-- ── 4 (LOW): the auto-approve per-row skip was silent — a permanently
--    failing org became invisible. Same body as 20260903_001022 with one
--    warning line in the exception block (full body restated so git never
--    drifts from prod — the finding-1 lesson).
create or replace function public.auto_approve_agent_drafts()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare n integer := 0; r record; v_event text;
        v_now_local time; v_dow int;
        v_win_start time; v_win_end time; v_pause date;
begin
  for r in
    select o.*, p.mode, p.updated_at as consent_at, p.updated_by as consented_by,
           g.email as g_email, g.email_bounced_at,
           ws.value->>'start' as win_start_txt,
           ws.value->>'end'   as win_end_txt,
           coalesce(ws.value->'blocked_days', '[]'::jsonb) as blocked_days,
           nullif(ws.value->>'pause_until','') as pause_until_txt,
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
      and o.created_at > p.updated_at
  loop
    begin
      v_win_start := coalesce(r.win_start_txt::time, time '08:00');
      v_win_end   := coalesce(r.win_end_txt::time,   time '20:00');
      v_pause     := r.pause_until_txt::date;
      v_now_local := (now() at time zone r.org_tz)::time;
      v_dow := extract(dow from (now() at time zone r.org_tz))::int;
      if v_pause is not null and current_date <= v_pause then continue; end if;
      if v_now_local < v_win_start or v_now_local > v_win_end then continue; end if;
      if r.blocked_days ? v_dow::text then continue; end if;
      if r.source_ref like 'installment:%' and r.title not like 'Payment failed%' then
        if (split_part(r.source_ref, ':attempt:', 2))::int >
           (case r.cap_level when 'friendly' then 1 when 'firm' then 2 else 3 end) then
          continue;
        end if;
      end if;
      if r.guardian_id is not null and r.excluded ? r.guardian_id::text then continue; end if;
      if r.guardian_id is not null and r.email_bounced_at is not null then continue; end if;

      update public.obligations
         set status = 'approved', approved_by = r.consented_by, approved_at = now()
       where id = r.id and status = 'draft';
      if not found then continue; end if;
      n := n + 1;
      if r.guardian_id is null then continue; end if;
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
    exception when others then
      raise warning 'auto_approve skipped obligation %: %', r.id, sqlerrm;
      continue;
    end;
  end loop;
  return n;
end; $function$;
