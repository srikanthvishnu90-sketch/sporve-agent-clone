-- Disposable-database fixture for migration 20260915_001067 (C11: invite
-- tokens bound to the invited address). Never runs against production.
--     bash tools/run-sql-fixtures.sh 2026-09-16-c11
-- RED-FIRST: the stand-in below is the LIVE function verbatim in the parts
-- that matter; with the \ir line removed, assertion A fails — a stranger
-- holding the token is attached and adopts the invited family's record.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_invite' then
    raise exception 'refusing to run outside the disposable sporv_spec_invite database (got %)', current_database();
  end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
do $$ begin create role anon nologin; create role authenticated nologin; create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.providers (id uuid primary key default gen_random_uuid(), owner_id uuid, business_name text);
create table public.guardians (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), user_id uuid, first_name text not null, email text, email_status text default 'ok');
create unique index uq_guardians_provider_user on public.guardians (provider_id, user_id) where user_id is not null;
create table public.coach_invites (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), inviter_owner_id uuid, invited_email text, invited_phone text,
  token text unique, status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')), redeemed_by uuid, redeemed_at timestamptz, expires_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
-- the live function, verbatim in the parts that matter (token-only)
create or replace function public.redeem_coach_invite(p_token text) returns uuid language plpgsql security definer set search_path = '' as $f$
declare v_inv public.coach_invites; v_email text;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  select * into v_inv from public.coach_invites where token = p_token for update;
  if v_inv.id is null then raise exception 'invalid invite'; end if;
  if v_inv.status <> 'pending' then raise exception 'used'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if not exists (select 1 from public.guardians g where g.provider_id = v_inv.provider_id and g.user_id = auth.uid()) then
    if exists (select 1 from public.guardians g where g.provider_id = v_inv.provider_id and g.user_id is null and lower(g.email) = lower(coalesce(v_inv.invited_email, v_email))) then
      update public.guardians set user_id = auth.uid() where provider_id = v_inv.provider_id and user_id is null and lower(email) = lower(coalesce(v_inv.invited_email, v_email));
    else
      insert into public.guardians (provider_id, user_id, first_name, email) values (v_inv.provider_id, auth.uid(), 'Guardian', coalesce(v_inv.invited_email, v_email));
    end if;
  end if;
  update public.coach_invites set status = 'accepted', redeemed_by = auth.uid(), redeemed_at = now() where id = v_inv.id;
  return v_inv.id;
end $f$;

-- fixture: club A invites maria@; Maria has an existing unclaimed guardian row; a stranger holds the link
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a','owner@club.org'), ('b0000000-0000-4000-8000-00000000000b','maria@example.com'), ('c0000000-0000-4000-8000-00000000000c','stranger@example.com');
insert into public.providers (id, owner_id, business_name) values ('10000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-00000000000a','Rivertown FC');
insert into public.guardians (id, provider_id, first_name, email) values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a','Maria','maria@example.com');
insert into public.coach_invites (id, provider_id, inviter_owner_id, invited_email, token) values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-00000000000a','maria@example.com','tok-maria'),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-00000000000a', null, 'tok-noemail');

\ir ../../supabase/migrations/20260915_001067_invite_email_binding.sql

-- the migration revoked every pending token; re-issue for the assertions (this is what a club would do after the fix)
update public.coach_invites set status = 'pending';

do $$
declare v uuid; r record;
begin
  -- A ── a stranger holding Maria's link is refused and Maria's record stays unclaimed
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  begin v := public.redeem_coach_invite('tok-maria'); raise exception 'FAIL A: a stranger redeemed the invite';
  exception when insufficient_privilege then null; end;
  if (select user_id from public.guardians where id='20000000-0000-4000-8000-000000000001') is not null then raise exception 'FAIL A: guardian record was adopted'; end if;
  if (select count(*) from public.guardians where user_id='c0000000-0000-4000-8000-00000000000c') <> 0 then raise exception 'FAIL A: a guardian row was created for the stranger'; end if;
  if (select status from public.coach_invites where token='tok-maria') <> 'pending' then raise exception 'FAIL A: invite consumed by the refusal'; end if;
  raise notice 'PASS A: the token alone attaches nobody; the family record is untouched';

  -- B ── the preview tells the stranger this is not for them, without revealing the address
  select * into r from public.preview_coach_invite('tok-maria');
  if r.org_name <> 'Rivertown FC' or r.matches_caller or r.invited_email_masked <> 'ma***@example.com' then raise exception 'FAIL B: preview % % %', r.org_name, r.matches_caller, r.invited_email_masked; end if;
  raise notice 'PASS B: preview shows the org and a masked address, and says it does not match';

  -- C ── Maria, signed in with the invited address, is attached and her existing record is claimed (not duplicated)
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  select * into r from public.preview_coach_invite('tok-maria');
  if not r.matches_caller then raise exception 'FAIL C: preview does not recognise the invitee'; end if;
  v := public.redeem_coach_invite('tok-maria');
  if (select user_id from public.guardians where id='20000000-0000-4000-8000-000000000001') <> 'b0000000-0000-4000-8000-00000000000b' then raise exception 'FAIL C: record not claimed by Maria'; end if;
  if (select count(*) from public.guardians where provider_id='10000000-0000-4000-8000-00000000000a') <> 1 then raise exception 'FAIL C: a duplicate guardian was created'; end if;
  if (select status from public.coach_invites where token='tok-maria') <> 'accepted' then raise exception 'FAIL C: invite not marked accepted'; end if;
  raise notice 'PASS C: the invited person, and only that person, is attached; the existing record is claimed once';

  -- D ── an invite with no address cannot be redeemed by anyone
  begin v := public.redeem_coach_invite('tok-noemail'); raise exception 'FAIL D: address-less invite redeemed';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS D: an invite without an address is not redeemable';

  -- E ── case does not matter; a second redemption of a used token is refused
  begin v := public.redeem_coach_invite('tok-maria'); raise exception 'FAIL E: used token redeemed again';
  exception when others then if sqlerrm not like '%already been used%' then raise; end if; end;
  raise notice 'PASS E: a used token stays used';

  -- F ── unknown token previews as nothing; anon cannot preview or redeem
  if exists (select 1 from public.preview_coach_invite('tok-nope')) then raise exception 'FAIL F: unknown token leaked a preview'; end if;
  if has_function_privilege('anon', 'public.preview_coach_invite(text)', 'execute') or has_function_privilege('anon', 'public.redeem_coach_invite(text)', 'execute') then raise exception 'FAIL F: anon may call'; end if;
  raise notice 'PASS F: unknown tokens reveal nothing; anon has no access';
end $$;
