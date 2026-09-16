-- ============================================================================
-- 20260915_001065 — STAFF-ONLY SIGNUP, NO ANONYMOUS ORG READ (owner rules
-- 2026-09-16 §1, §2, §4). Single lane. FILE ONLY — never applied (D5).
--
-- 1. Everyone who logs in is staff. handle_new_user() used to honour a
--    client-supplied role and default to 'searcher' (the dead marketplace
--    parent role); a staff signup that omitted metadata became a parent with
--    no org. Now every new account is a provider with its own EMPTY org —
--    the account's container, nothing attached (§4: a new account starts
--    empty; linkage is always an explicit, confirmed action).
-- 2. No anonymous read path (§2). providers_select_public exposed every
--    approved org's name, bio, location and check status to anyone with the
--    publishable key (verified live 2026-09-16: "Rivertown FC"). Dropped, and
--    the anon column grant revoked. organization_members_select_public would
--    have exposed the first verified staff member the same way; re-scoped to
--    the member's own org.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  full_name text := coalesce(new.raw_user_meta_data ->> 'name', '');
  biz_name  text := coalesce(new.raw_user_meta_data ->> 'business_name', '');
  first_tok text := split_part(full_name, ' ', 1);
  rest_tok  text := btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1));
begin
  -- staff, always: the client cannot elect a role, and there is no parent role to fall into
  insert into public.profiles (id, role, first_name, last_name, email, phone_number)
  values (new.id, 'provider',
          coalesce(nullif(first_tok, ''), split_part(coalesce(new.email, 'member'), '@', 1), 'Member'),
          nullif(rest_tok, ''), new.email, nullif(new.raw_user_meta_data ->> 'phone', ''))
  on conflict (id) do nothing;
  -- the account's own, empty organization — never a lookup, never a join to an existing row
  insert into public.providers (owner_id, business_name)
  values (new.id, coalesce(nullif(biz_name, ''), 'Your organization'))
  on conflict (owner_id) do nothing;
  return new;
exception when others then
  raise log 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end; $$;

-- no anonymous read of organizations
drop policy if exists providers_select_public on public.providers;
revoke select on public.providers from anon;
-- staff members are visible to their own organization only
drop policy if exists organization_members_select_public on public.organization_members;
create policy organization_members_select_same_org on public.organization_members
  for select to authenticated
  using (member_user_id = auth.uid() or public.is_org_admin(organization_id));
revoke select on public.organization_members from anon;
