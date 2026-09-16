-- ============================================================================
-- 20260915_001071 — spec 13 slice 1, delivery half: an approved event draft
-- (reminder, schedule change, cancellation from spec 12) becomes a sendable
-- outbound message, and a reminder or change carries a one-tap RSVP link.
--
-- Owner 2026-09-16: "drafts that cannot be delivered are not a product" and
-- "messages can be sent if they approve". Approval stays the only gate:
-- approve_obligation_and_queue is called by the org owner, flips the draft,
-- and queues ONE outbound_messages row that lifecycle-process delivers.
-- Before this file, every 'event:%' source_ref fell into the generic
-- kind='schedule' → practice_reminder mapping, and no message carried a way
-- for a parent to answer. Now:
--   event:<id>:reminder:…  → practice_reminder  + rsvp link
--   event:<id>:change:…    → schedule_change    + rsvp link
--   event:<id>:cancel:…    → schedule_change    (no link: nothing to answer)
-- The link is an 'rsvp' guardian token (001059) bound to that one event,
-- minted at approval, stored once in the outbound content (spec 13.3: "the
-- secret exists once, in the outbound message"); lifecycle-process turns it
-- into the URL. A guardian who hit the issuance ceiling still gets the
-- message, without the link, and the content says so.
-- ============================================================================
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
      exception when sqlstate '53400' then
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
