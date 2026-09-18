-- ============================================================================
-- 20260915_001079 — audit 2026-09-17 P2-7 and P2-8: errors a client can act on,
-- and edits that cannot silently overwrite each other.
--
-- P2-7 · issue_guardian_token past its 10/hour ceiling raised 53400, which
--   PostgREST surfaces as a 5xx. It now raises PT429 — HTTP 429 with the
--   message — and approve_obligation_and_queue keeps degrading the link (not
--   the message) under either code. (event_conflicts_in_range for a coach was
--   fixed in 001076: rows for the events they coach, zero rows elsewhere.)
-- P2-8 · Two people editing one event: last write won, sequence bumped
--   twice, nobody was told. cancel_event gains p_expected_sequence, and
--   edit_event is the one write path for the family-visible fields — both
--   raise PT409 ("changed since you loaded it") when the sequence the screen
--   holds is stale. The event_guard trigger still bumps SEQUENCE; nothing
--   about ICS or notices changes. Bodies below are 001059/001069/001071
--   verbatim except the lines called out.
-- ============================================================================
create or replace function public.issue_guardian_token(
  p_guardian uuid, p_scope text, p_subject_kind text default null, p_subject_id uuid default null,
  p_channel text default 'email', p_ttl interval default null)
returns text language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; v_secret text; v_ttl interval; v_single boolean; v_ok boolean;
begin
  select provider_id into v_provider from public.guardians where id = p_guardian;
  if v_provider is null then raise exception 'guardian not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may issue a guardian link' using errcode = '42501';
  end if;
  if p_scope not in ('rsvp','waiver','pay','register') then
    raise exception 'unknown scope %', p_scope using errcode = '22023';
  end if;
  -- the subject must exist AND belong to the same organisation as the guardian
  if p_scope = 'rsvp' then
    if p_subject_kind is distinct from 'event' or not exists
       (select 1 from public.event e where e.id = p_subject_id and e.provider_id = v_provider) then
      raise exception 'an rsvp link must name an event of this organisation' using errcode = '22023';
    end if;
  elsif p_scope = 'pay' then
    if p_subject_kind is distinct from 'obligation' or not exists
       (select 1 from public.obligations o where o.id = p_subject_id and o.provider_id = v_provider) then
      raise exception 'a pay link must name an obligation of this organisation' using errcode = '22023';
    end if;
  end if;
  -- issuance ceiling: 10 links per guardian per hour
  v_ok := public.consume_edge_rate_limit('guardian:' || p_guardian::text, 'guardian-token-issue', 10, 3600);
  if v_ok is distinct from true then
    raise exception 'too many links issued for this guardian this hour — try again in an hour' using errcode = 'PT429';  -- PostgREST answers 429, not 500
  end if;
  v_single := p_scope in ('pay','waiver');
  v_ttl := coalesce(p_ttl, case when v_single then interval '72 hours' else interval '7 days' end);
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.guardian_access_token
    (provider_id, guardian_id, token_hash, scope, subject_kind, subject_id, channel, single_use, expires_at)
  values (v_provider, p_guardian, public.guardian_token_hash(v_secret), p_scope, p_subject_kind, p_subject_id,
          p_channel, v_single, now() + v_ttl);
  return v_secret;
end $$;

revoke all on function public.issue_guardian_token(uuid,text,text,uuid,text,interval) from public, anon;
grant execute on function public.issue_guardian_token(uuid,text,text,uuid,text,interval) to authenticated, service_role;

drop function if exists public.cancel_event(uuid,text,boolean);
create or replace function public.cancel_event(p_event uuid, p_reason text, p_notify boolean default true, p_expected_sequence integer default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_e public.event; v_drafts integer := 0; v_seq integer;
begin
  select * into v_e from public.event where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = '23503'; end if;
  -- audit P2-8: a screen that loaded sequence N may not cancel sequence N+1 without seeing the change first
  if p_expected_sequence is not null and p_expected_sequence <> v_e.sequence then
    raise exception 'this event changed since you loaded it — reload the schedule and look again' using errcode = 'PT409';
  end if;
  if auth.uid() is not null and not public.is_org_admin(v_e.provider_id) then
    raise exception 'only organisation staff may cancel an event' using errcode = '42501';
  end if;
  if v_e.status = 'cancelled' then
    return jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'already_cancelled', true, 'drafted_notices', 0,
                              'sequence', v_e.sequence, 'venue_released', false);
  end if;
  if not p_notify then
    -- a silent cancel (an event never published, or the families already know)
    perform set_config('sporv.suppress_notices', '1', true);
  end if;
  update public.event set status = 'cancelled', cancellation_reason = left(nullif(trim(coalesce(p_reason,'')),''), 300)
    where id = p_event returning sequence into v_seq;
  perform set_config('sporv.suppress_notices', '', true);
  select count(*) into v_drafts from public.obligations
    where source_kind = 'agent' and status = 'draft' and draft_type = 'schedule_cancellation'
      and source_ref like 'event:' || p_event || ':cancel:%';
  insert into public.settings_audit (provider_id, surface, key, old_value, new_value, changed_by)
  values (v_e.provider_id, 'schedule', 'event_cancelled',
          jsonb_build_object('event_id', v_e.id, 'status', v_e.status, 'sequence', v_e.sequence),
          jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'reason', p_reason, 'notify', p_notify,
                             'sequence', v_seq, 'drafted_notices', v_drafts),
          auth.uid());
  return jsonb_build_object('event_id', v_e.id, 'status', 'cancelled', 'already_cancelled', false,
                            'drafted_notices', v_drafts, 'sequence', v_seq, 'venue_released', v_e.venue_id is not null);
end $$;

revoke all on function public.cancel_event(uuid,text,boolean,integer) from public, anon;
grant execute on function public.cancel_event(uuid,text,boolean,integer) to authenticated, service_role;

create or replace function public.approve_obligation_and_queue(p_obligation_id uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare o record; v_msg uuid; v_event text; v_event_id uuid; v_token text; v_content jsonb;
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
  v_event := case
    when o.source_ref like 'installment:%'      then 'dues_reminder'
    when o.source_ref like 'waiver:%'           then 'waiver_reminder'
    when o.source_ref like 'session:%:change:%' then 'schedule_change'
    when o.source_ref like 'session:%'          then 'practice_reminder'
    when o.source_ref like 'event:%:reminder:%' then 'practice_reminder'
    when o.source_ref like 'event:%:change:%'   then 'schedule_change'
    when o.source_ref like 'event:%:cancel:%'   then 'schedule_change'
    when o.source_ref like 'reactivation:%'     then 'reactivation'
    when o.kind = 'fee'    then 'dues_reminder'
    when o.kind = 'waiver' then 'waiver_reminder'
    when o.kind = 'schedule' then 'practice_reminder'
    else null end;
  if v_event is null then return null; end if;  -- unmapped kinds stay unsent, never mislabeled
  v_content := jsonb_build_object('subject', o.title, 'body', o.detail,
                                  'guardian_id', o.guardian_id, 'to_email', o.g_email,
                                  'obligation_id', o.id);
  -- a reminder or a change is a question ("are you coming?"): attach the answer
  if o.source_ref like 'event:%:reminder:%' or o.source_ref like 'event:%:change:%' then
    v_event_id := nullif(split_part(o.source_ref, ':', 2), '')::uuid;
    if v_event_id is not null then
      begin
        v_token := public.issue_guardian_token(o.guardian_id, 'rsvp', 'event', v_event_id, 'email');
        v_content := v_content || jsonb_build_object('rsvp_token', v_token, 'rsvp_event_id', v_event_id);
      exception when sqlstate 'PT429' or sqlstate '53400' then
        v_content := v_content || jsonb_build_object('rsvp_link_omitted', 'issuance_ceiling');
      end;
    end if;
  end if;
  insert into public.outbound_messages
    (provider_id, event_type, status, scheduled_for, obligation_id, content)
  values (o.provider_id, v_event, 'drafted', now(), o.id, v_content)
  returning id into v_msg;
  return v_msg;
end; $$;

revoke all on function public.approve_obligation_and_queue(uuid) from public, anon;
grant execute on function public.approve_obligation_and_queue(uuid) to authenticated;

-- ── edit_event: the family-visible fields, guarded by the sequence the editor saw ──
create or replace function public.edit_event(p_event uuid, p_expected_sequence integer, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_e public.event; v_seq integer;
begin
  select * into v_e from public.event where id = p_event for update;
  if not found then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_e.provider_id) then
    raise exception 'only organisation staff may edit an event' using errcode = '42501';
  end if;
  if v_e.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited' using errcode = '55000';
  end if;
  if p_expected_sequence is null or p_expected_sequence <> v_e.sequence then
    raise exception 'this event changed since you loaded it — reload the schedule and look again' using errcode = 'PT409';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or (p_patch - array['title','starts_at','ends_at','venue_id','location_text','notes','assigned_member_id','capacity','arrival_offset_minutes']) <> '{}'::jsonb then
    raise exception 'edit_event accepts only title, starts_at, ends_at, venue_id, location_text, notes, assigned_member_id, capacity, arrival_offset_minutes' using errcode = '22023';
  end if;
  update public.event set
    title = coalesce(nullif(trim(p_patch ->> 'title'), ''), title),
    starts_at = coalesce((p_patch ->> 'starts_at')::timestamptz, starts_at),
    ends_at = coalesce((p_patch ->> 'ends_at')::timestamptz, ends_at),
    venue_id = case when p_patch ? 'venue_id' then nullif(p_patch ->> 'venue_id', '')::uuid else venue_id end,
    location_text = case when p_patch ? 'location_text' then nullif(p_patch ->> 'location_text', '') else location_text end,
    notes = case when p_patch ? 'notes' then nullif(p_patch ->> 'notes', '') else notes end,
    assigned_member_id = case when p_patch ? 'assigned_member_id' then nullif(p_patch ->> 'assigned_member_id', '')::uuid else assigned_member_id end,
    capacity = case when p_patch ? 'capacity' then nullif(p_patch ->> 'capacity', '')::integer else capacity end,
    arrival_offset_minutes = coalesce((p_patch ->> 'arrival_offset_minutes')::integer, arrival_offset_minutes)
  where id = p_event returning sequence into v_seq;
  return jsonb_build_object('event_id', p_event, 'sequence', v_seq, 'changed', v_seq <> v_e.sequence);
end $$;
revoke all on function public.edit_event(uuid,integer,jsonb) from public, anon;
grant execute on function public.edit_event(uuid,integer,jsonb) to authenticated, service_role;
