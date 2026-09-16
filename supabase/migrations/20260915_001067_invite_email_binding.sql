-- ============================================================================
-- 20260915_001067 — C11: an invite token is no longer a bearer credential.
-- Audit 2026-09-15 C11; owner ruling 2026-09-16 #1. Single lane. D5 is
-- REVERSED (one project): this file is applied to the live project.
--
-- Before: redeem_coach_invite() checked the token, its status, its expiry and
-- that the caller was not the inviter — and never compared the caller's email
-- with invited_email. It then adopted an unclaimed guardians row matched on
-- the INVITED address and set user_id to the caller, or inserted a guardian
-- carrying the invited address under the caller's account. A forwarded link
-- attached a stranger to a child's guardian record.
--
-- After: redemption requires invited_email to be set AND to equal the
-- caller's auth email (case-insensitive); an invite without an address cannot
-- be redeemed at all. The org and the invited address are readable by token
-- (preview_coach_invite) so the consent screen can show what is being joined
-- BEFORE the accept click. Every outstanding pending token is revoked here —
-- live count on 2026-09-16 was zero, so this is belt and braces.
-- ============================================================================

-- ── 1. what the consent screen shows before Accept ─────────────────────────
create or replace function public.preview_coach_invite(p_token text)
returns table(org_name text, invited_email_masked text, status text, expires_at timestamptz, matches_caller boolean)
language plpgsql stable security definer set search_path to '' as $$
declare v_inv public.coach_invites; v_email text;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'sign in to view an invite'; end if;
  select * into v_inv from public.coach_invites where token = p_token;
  if v_inv.id is null then return; end if;                       -- unknown token: nothing to learn
  select email into v_email from auth.users where id = auth.uid();
  return query
    select p.business_name,
           case when v_inv.invited_email is null then null
                else left(v_inv.invited_email, 2) || '***@' || split_part(v_inv.invited_email, '@', 2) end,
           v_inv.status, v_inv.expires_at,
           (v_inv.invited_email is not null and lower(v_inv.invited_email) = lower(coalesce(v_email, '')))
      from public.providers p where p.id = v_inv.provider_id;
end $$;
revoke all on function public.preview_coach_invite(text) from public, anon;
grant execute on function public.preview_coach_invite(text) to authenticated, service_role;

-- ── 2. redemption is bound to the invited address ──────────────────────────
create or replace function public.redeem_coach_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_inv public.coach_invites; v_email text;
begin
  if auth.uid() is null then raise exception 'must be signed in to redeem a coach invite'; end if;
  select * into v_inv from public.coach_invites where token = p_token for update;
  if v_inv.id is null then raise exception 'invalid invite'; end if;
  if v_inv.status <> 'pending' then
    raise exception 'this invite has already been used or is no longer active';
  end if;
  if v_inv.expires_at is not null and now() > v_inv.expires_at then
    perform set_config('sporve.invite_redeem', 'on', true);
    update public.coach_invites set status = 'expired', updated_at = now() where id = v_inv.id;
    perform set_config('sporve.invite_redeem', 'off', true);
    raise exception 'this invite has expired';
  end if;
  if auth.uid() = v_inv.inviter_owner_id then
    raise exception 'a coach cannot redeem their own family invite';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- C11: the token alone is not enough. The invite names a person; only that
  -- person's signed-in address may redeem it. An invite with no address is
  -- not redeemable until the club adds one.
  if v_inv.invited_email is null then
    raise exception using errcode = '42501', message = 'this invite has no email address on it; ask the club to re-send it to you';
  end if;
  if v_email is null or lower(v_email) <> lower(v_inv.invited_email) then
    raise exception using errcode = '42501', message = 'this invite was sent to a different email address; sign in with the address it was sent to';
  end if;

  -- Attach the signed-in person to the club as a guardian (idempotent).
  if not exists (select 1 from public.guardians g where g.provider_id = v_inv.provider_id and g.user_id = auth.uid()) then
    if exists (select 1 from public.guardians g where g.provider_id = v_inv.provider_id
                 and g.user_id is null and lower(g.email) = lower(v_inv.invited_email)) then
      update public.guardians set user_id = auth.uid()
       where provider_id = v_inv.provider_id and user_id is null
         and lower(email) = lower(v_inv.invited_email);
    else
      insert into public.guardians (provider_id, user_id, first_name, email, email_status)
      values (v_inv.provider_id, auth.uid(),
              coalesce(nullif(split_part(v_inv.invited_email, '@', 1), ''), 'Guardian'),
              v_inv.invited_email, 'ok')
      on conflict (provider_id, user_id) where user_id is not null do nothing;
    end if;
  end if;

  perform set_config('sporve.invite_redeem', 'on', true);
  update public.coach_invites
     set status = 'accepted', redeemed_by = auth.uid(), redeemed_at = now(), updated_at = now()
   where id = v_inv.id;
  perform set_config('sporve.invite_redeem', 'off', true);
  return v_inv.id;
end $function$;

-- ── 3. every token issued under the old rule is dead ───────────────────────
do $$
declare n integer;
begin
  perform set_config('sporve.invite_redeem', 'on', true);
  update public.coach_invites set status = 'revoked', updated_at = now() where status = 'pending';
  get diagnostics n = row_count;
  perform set_config('sporve.invite_redeem', 'off', true);
  raise notice 'C11: revoked % outstanding invite token(s) issued under the token-only rule', n;
end $$;

-- ── 4. grants restated (create or replace keeps old grants live; a fresh
--       function elsewhere would default to PUBLIC execute) ─────────────────
revoke all on function public.redeem_coach_invite(text) from public, anon;
grant execute on function public.redeem_coach_invite(text) to authenticated, service_role;
