-- 20260907_001036 — public org read (red draft 2026-09-07, owner-approved 'apply the public org grant'). Applied via apply_migration; receipts passed; live probes: allowed cols 200, latitude/owner_id 401, pending rows [].
-- [CRITICAL-PATH] RED DRAFT — anon read for PUBLIC org pages (design batch 2).
-- The geo-leak lockdown (2026-08-20) revoked ALL anon access to providers.
-- A public booking page needs a column-scoped re-grant: identity and policy
-- columns ONLY — never latitude/longitude/public_* coords, stripe ids,
-- owner_id, or plan state. RLS restricts anon to approved rows.
-- Inverse: revoke select on public.providers from anon; drop policy.
grant select (id,business_name,bio,sports,location,provider_type,
  cancellation_policy,logo_url,avatar_url,background_check_status,status)
  on public.providers to anon;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
      and tablename='providers' and policyname='providers_public_read_approved') then
    create policy providers_public_read_approved on public.providers
      for select to anon using (status='approved');
  end if;
end $$;
-- receipt
do $$ begin
  if not has_column_privilege('anon','public.providers','business_name','SELECT') then
    raise exception 'public-org-read: grant missing';
  end if;
  if has_column_privilege('anon','public.providers','latitude','SELECT')
     or has_column_privilege('anon','public.providers','stripe_account_id','SELECT')
     or has_column_privilege('anon','public.providers','owner_id','SELECT') then
    raise exception 'public-org-read: a sensitive column leaked into the anon grant';
  end if;
end $$;
