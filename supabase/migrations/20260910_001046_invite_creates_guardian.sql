-- Applied to production 2026-09-10 via `supabase db query --linked -f`, which
-- writes no ledger row — so this file, byte-identical to the red draft that
-- was executed, is the record. See 20260910_001042 for the same note and the
-- `supabase migration repair` command if you want the ledger to match.
-- Every statement is idempotent, so a replay reproduces the same end state.
--
-- CORRECTED 2026-09-10: the first applied version omitted first_name, which
-- is NOT NULL, so every redemption raised 23502 and unwound the function.
-- This file is the corrected SQL, re-applied to production the same day.

-- [CRITICAL-PATH] RED DRAFT — redeem_coach_invite() must actually join the family.
-- Launch item 13. Today the RPC flips coach_invites.status to 'accepted' and
-- returns — the person who clicked "Accept this invite" is NOT attached to the
-- club: no guardians row, so they never see their child's fees or waivers and
-- the club's queue never finds them by user. The UI copy ("nothing joins until
-- you press Accept") is honest today only because nothing joins at all.
-- coach_invites has no member_id, so a guardian_links row is not possible here;
-- the club links the child from the roster afterwards (existing flow).
-- Change: same checks as prod, plus an idempotent guardians upsert keyed on
-- (provider_id, user_id). Returns the invite id as before.
-- Inverse: re-run the previous definition (migration 20260905 body in git).
-- Verification: redeem as a fresh user → select * from guardians where user_id=auth.uid() → 1 row;
--   redeem the same token again → 'already been used' (unchanged).
-- Known (pre-existing, unchanged): the 'expired' status write below is rolled
-- back by the exception that follows it, so an expired invite stays 'pending'
-- in the table; the client still gets the right error. A cleanup sweep, not
-- this RPC, is the place to persist expiry.
begin;

-- Two concurrent redemptions lock two different invite rows, so the existence
-- check alone cannot stop a duplicate guardian. Checked 2026-09-08: prod has
-- zero (provider_id, user_id) duplicates today, so this index creates cleanly.
create unique index if not exists uq_guardians_provider_user
  on public.guardians (provider_id, user_id) where user_id is not null;

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

  -- Attach the signed-in person to the club as a guardian (idempotent).
  if not exists (select 1 from public.guardians g where g.provider_id = v_inv.provider_id and g.user_id = auth.uid()) then
    if exists (select 1 from public.guardians g where g.provider_id = v_inv.provider_id
                 and g.user_id is null and lower(g.email) = lower(coalesce(v_inv.invited_email, v_email))) then
      update public.guardians set user_id = auth.uid()
       where provider_id = v_inv.provider_id and user_id is null
         and lower(email) = lower(coalesce(v_inv.invited_email, v_email));
    else
      -- first_name is NOT NULL with no default (checked in production, not
      -- assumed). Omitting it made this INSERT raise 23502, and because there
      -- is no exception handler here the whole function unwound — so the
      -- `status='accepted'` write below never ran either. The result was that
      -- a family invited by email could no longer accept the invite AT ALL,
      -- which is strictly worse than the bug this draft set out to fix.
      -- Caught by a clo audit before any real invite existed.
      insert into public.guardians (provider_id, user_id, first_name, email, email_status)
      values (v_inv.provider_id, auth.uid(),
              coalesce(nullif(split_part(coalesce(v_inv.invited_email, v_email), '@', 1), ''), 'Guardian'),
              coalesce(v_inv.invited_email, v_email), 'ok')
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

commit;
