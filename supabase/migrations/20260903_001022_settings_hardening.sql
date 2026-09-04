-- 20260903_001022 — SETTINGS HARDENING (pentest findings 3 + 5, 2026-09-03).
--
-- Finding 3: provider_settings is free-form jsonb written by org owners, and
-- BOTH consumers parsed it unguarded — one org saving a bad timezone or a
-- malformed send-window aborted the email tick / auto-approve sweep for EVERY
-- org. Fix is two layers: reject bad values at write time, and make the
-- auto-approve loop skip a broken org instead of rolling back the sweep.
--
-- Finding 5: guardians.email_status / email_bounced_at told two different
-- stories, and the org that caused a spam complaint could clear it. Fix:
-- a trigger keeps the columns in sync (fixing an address un-suppresses the
-- family) and makes 'complained' clearable only by the server.

-- ── 1. validate provider_settings on write ────────────────────────────────
create or replace function public.validate_provider_setting()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_txt text;
begin
  if new.key = 'org_tz' then
    v_txt := new.value->>'tz';
    if v_txt is not null and not exists (
      select 1 from pg_catalog.pg_timezone_names where name = v_txt
    ) then
      raise exception 'org_tz must be a valid IANA timezone (got %)', v_txt;
    end if;
  elsif new.key = 'send_window' then
    v_txt := new.value->>'start';
    if v_txt is not null and v_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'send_window start must be HH:MM (got %)', v_txt;
    end if;
    v_txt := new.value->>'end';
    if v_txt is not null and v_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'send_window end must be HH:MM (got %)', v_txt;
    end if;
    v_txt := nullif(new.value->>'pause_until','');
    if v_txt is not null then
      begin
        perform v_txt::date;
      exception when others then
        raise exception 'send_window pause_until must be a date (got %)', v_txt;
      end;
    end if;
  elsif new.key = 'reply_to' then
    v_txt := new.value->>'email';
    if v_txt is not null and v_txt !~ '^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$' then
      raise exception 'reply_to must be a plain email address (got %)', v_txt;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists validate_provider_setting on public.provider_settings;
create trigger validate_provider_setting
  before insert or update on public.provider_settings
  for each row execute function public.validate_provider_setting();

-- ── 2. guardians: complaint lock + one email-status story ─────────────────
create or replace function public.guard_guardian_email_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_server boolean;
begin
  v_server := (auth.uid() is null)
    or coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'role','') = 'service_role';
  -- A spam complaint is the recipient's decision. The org that triggered it
  -- must not be able to un-suppress the family; only the server (webhook /
  -- support tooling) may.
  if old.email_status = 'complained'
     and new.email_status is distinct from old.email_status
     and not v_server then
    raise exception 'a spam complaint cannot be cleared by the organization';
  end if;
  -- Keep the two columns telling ONE story: a director fixing a bad address
  -- (email_status back to ok) also clears the bounce timestamp, so the family
  -- is not silently excluded from automation forever.
  if new.email_status = 'ok' and old.email_status is distinct from 'ok' then
    new.email_bounced_at := null;
  end if;
  if new.email_status in ('bounced','complained') and new.email_bounced_at is null then
    new.email_bounced_at := now();
  end if;
  return new;
end; $$;

drop trigger if exists guard_guardian_email_status on public.guardians;
create trigger guard_guardian_email_status
  before update on public.guardians
  for each row execute function public.guard_guardian_email_status();

-- ── 3. auto_approve_agent_drafts: one broken org no longer kills the sweep ─
-- Same body as prod (dumped 2026-09-03) with the loop wrapped in a per-row
-- exception block: a row whose settings still manage to raise (bad tz saved
-- before this migration, unexpected cast) is skipped, not fatal.
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
    -- Settings values stay TEXT here: a cast inside this query would abort the
    -- whole FOR statement on one org's bad row, out of reach of the per-row
    -- exception block below. All casts happen inside the guarded loop body.
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
      -- one org's bad row must not roll back every org's sweep
      continue;
    end;
  end loop;
  return n;
end; $function$;
