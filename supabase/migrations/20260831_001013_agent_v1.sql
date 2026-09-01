-- ============================================================================
-- Spec 05 · THE AGENT — recipient addressing, single-owner retry counter,
-- webhook-immediate drafting, Jobs 2+3, per-org auto-draft toggle, and the
-- approve→send bridge. (2026-08-31)
--
-- What spec 05 asked for vs what this does (premises checked, rule 9):
--  · "vercel.json cron" REJECTED: pg_cron already fires nightly inside the DB,
--    where no service-role key has to leave the building. Same acceptance
--    ("drafts by 6am, no browser open"), zero new secrets.
--  · "new agent_actions audit table" REJECTED: the obligation row IS the audit
--    (source_kind/source_ref/created_at/approved_by via trigger), and the send
--    is audited on outbound_messages (approved_by/sent_at, server-stamped).
--  · Draft-first is enforced by the 000200 lifecycle trigger, not convention.
--  · No agent path can move money: the generators INSERT obligations only;
--    apply_* stay service-role-only; refunds live behind their own edge fn.
-- ============================================================================

-- A ── a draft must know who it is for
alter table public.obligations
  add column if not exists guardian_id uuid references public.guardians(id) on delete set null,
  add column if not exists member_id uuid references public.team_athletes(id) on delete set null;
alter table public.outbound_messages
  add column if not exists obligation_id uuid references public.obligations(id) on delete set null;

-- B ── vocabulary: three agent message types + the org toggle
alter table public.outbound_messages drop constraint if exists outbound_messages_event_type_check;
alter table public.outbound_messages add constraint outbound_messages_event_type_check
  check (event_type in ('booking_confirmed','reminder_24h','post_session','no_show_followup',
                        'rebook_nudge','dues_reminder','waiver_reminder','practice_reminder'));
alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_message_prefs_event_type_check;
alter table public.lifecycle_message_prefs add constraint lifecycle_message_prefs_event_type_check
  check (event_type in ('booking_confirmed','reminder_24h','post_session','no_show_followup',
                        'rebook_nudge','agent_autodraft'));
-- lifecycle_prefs_auto_only_logistics untouched: 'agent_autodraft' can be
-- off|draft, NEVER auto — there is no "agent sends everything" toggle (spec 05).

create or replace function public.agent_autodraft_on(p_provider uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select mode from public.lifecycle_message_prefs
                   where provider_id = p_provider and event_type = 'agent_autodraft'),
                  'draft') <> 'off';
$$;
revoke all on function public.agent_autodraft_on(uuid) from public, anon;

-- C ── attempt_count gets exactly ONE writer: drafting an installment follow-up
-- bumps it, nothing else does. (Before this, the webhook failure branch AND the
-- generator both bumped — a real decline silently skipped ladder day 1.)
create or replace function public.bump_installment_attempt()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  update public.installments
     set attempt_count = attempt_count + 1, last_attempt_at = now()
   where id = nullif(split_part(new.source_ref, ':', 2), '')::uuid;
  return new;
end; $$;
revoke all on function public.bump_installment_attempt() from public, anon, authenticated;
drop trigger if exists trg_bump_installment_attempt on public.obligations;
create trigger trg_bump_installment_attempt after insert on public.obligations
  for each row when (new.source_kind = 'agent' and new.source_ref like 'installment:%')
  execute function public.bump_installment_attempt();

-- D ── Job 1 v2: recipient-addressed, toggle-aware, counter delegated to (C)
drop function if exists public.generate_installment_followups();
create or replace function public.generate_installment_followups(
  p_provider uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0;
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, amount_cents, currency,
     due_at, source_kind, source_ref, inverse, member_id, guardian_id)
  select fs.provider_id, 'fee', 'draft',
    'Installment ' || to_char(i.amount_cents/100.0,'FM$999,990.00')
      || ' overdue ' || (current_date - i.due_date) || 'd — attempt ' || (i.attempt_count + 1) || ' of 3',
    'Hi ' || coalesce(g.first_name, 'there')
      || ' — the ' || to_char(i.due_date,'Mon DD') || ' installment of '
      || to_char(i.amount_cents/100.0,'FM$999,990.00')
      || case when i.attempt_count = 0 then ' has not come through yet. You can pay from your original link, or reply here if a different plan would help.'
              when i.attempt_count = 1 then ' is still outstanding. If something is in the way, tell us — a split or a later date is usually possible.'
              else ' remains unpaid after several reminders. Please reach out today so we can keep your athlete on the roster.' end,
    i.amount_cents, 'USD', i.due_date::timestamptz, 'agent',
    'installment:' || i.id || ':attempt:' || (i.attempt_count + 1),
    jsonb_build_object('action','void','reason','undo retry follow-up'),
    i.member_id, g.id
  from public.installments i
  join public.fee_schedules fs on fs.id = i.fee_schedule_id
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = i.member_id and gl.is_payer limit 1) g on true
  where i.status in ('due','failed')
    and fs.status = 'active'
    and i.due_date < current_date
    and i.attempt_count < 3
    and (current_date - i.due_date) >= (case i.attempt_count when 0 then 1 when 1 then 3 else 7 end)
    and (p_provider is null or fs.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(fs.provider_id))
    and not exists (select 1 from public.obligations o
                    where o.source_ref = 'installment:' || i.id || ':attempt:' || (i.attempt_count + 1)
                      and o.status <> 'void');
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.generate_installment_followups(uuid, boolean) from public, anon, authenticated;

-- E ── webhook path: a failed charge drafts within seconds, not tomorrow.
-- Failure no longer bumps the counter (C owns it); it marks the row and drafts
-- the next-attempt follow-up immediately, same dedupe key the cron uses.
create or replace function public.apply_installment_event(
  p_event_id text, p_event_type text, p_installment_id uuid,
  p_stripe_object_id text, p_amount_minor bigint, p_currency text,
  p_payload_sha256 text, p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path to '' as $$
declare v_rows integer;
begin
  insert into public.payment_event_ledger
    (stripe_event_id, event_type, stripe_object_id, amount_minor, currency,
     payload_sha256, outcome, occurred_at)
  values (p_event_id, p_event_type, p_stripe_object_id, p_amount_minor,
          p_currency, p_payload_sha256, 'applied', p_occurred_at)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    update public.installments
       set status = 'paid', stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_stripe_object_id)
     where id = p_installment_id and status <> 'paid';
    update public.fee_schedules fs set status = 'complete'
     where fs.id = (select fee_schedule_id from public.installments where id = p_installment_id)
       and not exists (select 1 from public.installments i
                       where i.fee_schedule_id = fs.id and i.status not in ('paid','waived'));
  elsif p_event_type in ('checkout.session.async_payment_failed') then
    update public.installments set status = 'failed' where id = p_installment_id;
    insert into public.obligations
      (provider_id, kind, status, title, detail, amount_cents, currency,
       due_at, source_kind, source_ref, inverse, member_id, guardian_id)
    select fs.provider_id, 'fee', 'draft',
      'Payment failed — ' || to_char(i.amount_cents/100.0,'FM$999,990.00') || ' installment',
      'Hi ' || coalesce(g.first_name,'there') || ' — the bank returned the '
        || to_char(i.due_date,'Mon DD') || ' payment of '
        || to_char(i.amount_cents/100.0,'FM$999,990.00')
        || '. No charge went through. You can retry from your original link, or reply if a different plan would help.',
      i.amount_cents, 'USD', now(), 'agent',
      'installment:' || i.id || ':attempt:' || (i.attempt_count + 1),
      jsonb_build_object('action','void','reason','undo failed-charge follow-up'),
      i.member_id, g.id
    from public.installments i
    join public.fee_schedules fs on fs.id = i.fee_schedule_id
    left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                       join public.guardians g2 on g2.id = gl.guardian_id
                       where gl.member_id = i.member_id and gl.is_payer limit 1) g on true
    where i.id = p_installment_id
      and public.agent_autodraft_on(fs.provider_id)
      and not exists (select 1 from public.obligations o
                      where o.source_ref = 'installment:' || i.id || ':attempt:' || (i.attempt_count + 1)
                        and o.status <> 'void');
  end if;
  return true;
end; $$;
revoke all on function public.apply_installment_event(text,text,uuid,text,bigint,text,text,timestamptz) from public, anon, authenticated;

-- F ── Job 2: chase unsigned waivers (derived: latest doc version, no signature)
create or replace function public.generate_waiver_followups(
  p_provider uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0;
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     member_id, guardian_id)
  select wd.provider_id, 'waiver', 'draft',
    '“' || wd.title || '” unsigned — ' || m.first_name || ' ' || coalesce(m.last_name,''),
    'Hi ' || coalesce(g.first_name,'there') || ' — the ' || wd.title
      || ' still needs a signature for ' || m.first_name
      || ' before they can participate. It takes about a minute from your Sporv account.',
    'agent', 'waiver:' || wd.id || ':member:' || m.id,
    jsonb_build_object('action','void','reason','undo waiver follow-up'),
    m.id, g.id
  from public.waiver_documents wd
  join public.team_athletes m on m.provider_id = wd.provider_id and m.status = 'active'
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = m.id and gl.is_payer limit 1) g on true
  where wd.version = (select max(w2.version) from public.waiver_documents w2
                      where w2.provider_id = wd.provider_id and w2.title = wd.title)
    and m.first_name is not null
    and not exists (select 1 from public.waiver_signatures ws
                    where ws.waiver_document_id = wd.id and ws.member_id = m.id)
    and (p_provider is null or wd.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(wd.provider_id))
    and not exists (select 1 from public.obligations o
                    where o.source_ref = 'waiver:' || wd.id || ':member:' || m.id
                      and o.status <> 'void');
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.generate_waiver_followups(uuid, boolean) from public, anon, authenticated;

-- G ── Job 3: practice reminders (tomorrow's team sessions -> payer guardians
-- of members on an active plan for that program; derived, no stored flag)
create or replace function public.generate_practice_reminders(
  p_provider uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0;
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, due_at, source_kind, source_ref,
     inverse, member_id, guardian_id)
  select pr.provider_id, 'schedule', 'draft',
    'Practice tomorrow — ' || coalesce(s.title, pr.title),
    'Hi ' || coalesce(g.first_name,'there') || ' — reminder: ' || coalesce(s.title, pr.title)
      || ' is tomorrow (' || to_char(s.start_date,'Mon DD') || ')'
      || coalesce(' at ' || s.start_time, '') || coalesce(', ' || s.address, '') || '.',
    s.start_date::timestamptz, 'agent',
    'session:' || s.id || ':member:' || fs2.member_id,
    jsonb_build_object('action','void','reason','undo practice reminder'),
    fs2.member_id, g.id
  from public.sessions s
  join public.programs pr on pr.id = s.program_id and pr.offering_type = 'team'
  join public.fee_schedules fs2 on fs2.program_id = pr.id and fs2.status = 'active'
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = fs2.member_id and gl.is_payer limit 1) g on true
  where s.start_date = current_date + 1
    and (p_provider is null or pr.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(pr.provider_id))
    and not exists (select 1 from public.obligations o
                    where o.source_ref = 'session:' || s.id || ':member:' || fs2.member_id
                      and o.status <> 'void');
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.generate_practice_reminders(uuid, boolean) from public, anon, authenticated;

-- H ── the director's manual run ("auto-draft off" still lets them fire it)
create or replace function public.run_agent_drafts(p_provider uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v1 integer; v2 integer; v3 integer;
begin
  if not exists (select 1 from public.providers
                 where id = p_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may run the agent';
  end if;
  v1 := public.generate_installment_followups(p_provider, true);
  v2 := public.generate_waiver_followups(p_provider, true);
  v3 := public.generate_practice_reminders(p_provider, true);
  return jsonb_build_object('dues', v1, 'waivers', v2, 'practice', v3);
end; $$;
revoke all on function public.run_agent_drafts(uuid) from public, anon;
grant execute on function public.run_agent_drafts(uuid) to authenticated;

-- I ── approve -> send bridge: approving a recipient-addressed agent draft
-- queues ONE outbound message (drafted). Delivery stays behind
-- lifecycle-approve, the single sender with the claim guardrail.
create or replace function public.approve_obligation_and_queue(p_obligation_id uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare o record; v_msg uuid; v_event text;
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
  if o.guardian_id is null then return null; end if;
  v_event := case o.kind when 'fee' then 'dues_reminder'
                         when 'waiver' then 'waiver_reminder'
                         else 'practice_reminder' end;
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

-- J ── schedule Jobs 2+3 beside Job 1 (03:15) — all inside the DB
do $$
begin
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-waiver-followups';
    perform cron.schedule('sporv-waiver-followups', '20 3 * * *',
      $job$ select public.generate_waiver_followups(); $job$);
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-practice-reminders';
    perform cron.schedule('sporv-practice-reminders', '25 3 * * *',
      $job$ select public.generate_practice_reminders(); $job$);
  exception when others then
    raise notice 'pg_cron unavailable (%)', sqlerrm;
  end;
end $$;
