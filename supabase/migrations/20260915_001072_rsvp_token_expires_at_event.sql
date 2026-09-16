-- 20260915_001072 — pentest 2026-09-16 on spec 13 slice 1: an 'rsvp' token
-- was reusable for 7 days by anyone holding the forwarded link. The answer is
-- only meaningful until the event starts, so the token now expires at the
-- event's starts_at when that is sooner than the default TTL. Everything else
-- in issue_guardian_token is unchanged from 001059.
create or replace function public.issue_guardian_token(
  p_guardian uuid, p_scope text, p_subject_kind text default null, p_subject_id uuid default null,
  p_channel text default 'email', p_ttl interval default null)
returns text language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; v_secret text; v_ttl interval; v_single boolean; v_ok boolean; v_expires timestamptz; v_event_start timestamptz;
begin
  select provider_id into v_provider from public.guardians where id = p_guardian;
  if v_provider is null then raise exception 'guardian not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may issue a guardian link' using errcode = '42501';
  end if;
  if p_scope not in ('rsvp','waiver','pay','register') then
    raise exception 'unknown scope %', p_scope using errcode = '22023';
  end if;
  if p_scope = 'rsvp' then
    select e.starts_at into v_event_start from public.event e where e.id = p_subject_id and e.provider_id = v_provider;
    if p_subject_kind is distinct from 'event' or v_event_start is null then
      raise exception 'an rsvp link must name an event of this organisation' using errcode = '22023';
    end if;
    if v_event_start <= now() then
      raise exception 'this event has already started; there is nothing to answer' using errcode = '22023';
    end if;
  elsif p_scope = 'pay' then
    if p_subject_kind is distinct from 'obligation' or not exists
       (select 1 from public.obligations o where o.id = p_subject_id and o.provider_id = v_provider) then
      raise exception 'a pay link must name an obligation of this organisation' using errcode = '22023';
    end if;
  end if;
  v_ok := public.consume_edge_rate_limit('guardian:' || p_guardian::text, 'guardian-token-issue', 10, 3600);
  if v_ok is distinct from true then
    raise exception 'too many links issued for this guardian this hour' using errcode = '53400';
  end if;
  v_single := p_scope in ('pay','waiver');
  v_ttl := coalesce(p_ttl, case when v_single then interval '72 hours' else interval '7 days' end);
  v_expires := now() + v_ttl;
  if p_scope = 'rsvp' then v_expires := least(v_expires, v_event_start); end if;   -- an answer is due before the whistle
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.guardian_access_token
    (provider_id, guardian_id, token_hash, scope, subject_kind, subject_id, channel, single_use, expires_at)
  values (v_provider, p_guardian, public.guardian_token_hash(v_secret), p_scope, p_subject_kind, p_subject_id,
          p_channel, v_single, v_expires);
  return v_secret;
end $$;
revoke all on function public.issue_guardian_token(uuid,text,text,uuid,text,interval) from public, anon;
grant execute on function public.issue_guardian_token(uuid,text,text,uuid,text,interval) to authenticated, service_role;
