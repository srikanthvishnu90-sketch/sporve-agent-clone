-- Applied to production 2026-09-10 via `supabase db query --linked -f`, which
-- writes no ledger row — so this file, byte-identical to the red draft that
-- was executed, is the record. See 20260910_001042 for the same note and the
-- `supabase migration repair` command if you want the ledger to match.
-- Every statement is idempotent, so a replay reproduces the same end state.

-- [CRITICAL-PATH] RED DRAFT — Supabase security advisor 2026-09-08
-- (lint 0028 anon_security_definer_function_executable, 6 findings).
--
-- Six SECURITY DEFINER functions are callable by the signed-out `anon` role
-- through /rest/v1/rpc/. None of them is used on an anon path:
--   * no RLS policy granted to anon references them (checked pg_policies —
--     the only referencing policies are organization_members_* and
--     staff_certifications_admin_all, all {authenticated});
--   * no view references them;
--   * the only callers are other functions (search_candidates,
--     enforce_booking_provider_verified, enforce_org_member, data_health,
--     check_production_invariants), all SECURITY DEFINER themselves, so they
--     keep working regardless of the caller's own grant;
--   * neither the web client (src/) nor the Flutter client
--     (~/SportsMan-main/lib) calls any of them by name.
-- Effect: an unauthenticated visitor can no longer probe a provider's
-- safety-cleared / instant-book / freshness / response-time state by id,
-- nor call is_org_admin. Signed-in behaviour is unchanged.
-- Inverse: `grant execute on function <each> to anon;`
-- Verification (after apply): the advisor's 0028 count drops 6 → 0, and
--   curl -s -X POST "$SUPA/rest/v1/rpc/provider_is_fresh" -H "apikey: $ANON" \
--     -H 'Content-Type: application/json' -d '{"p_provider_id":"00000000-0000-0000-0000-000000000000","p_days":30}'
--   returns 42501 (permission denied) instead of a boolean.
begin;

-- Functions get EXECUTE for PUBLIC by default, and is_org_admin still has it
-- (checked 2026-09-08: has_function_privilege('public', …) = true). Revoking
-- anon alone would leave that path open, so revoke PUBLIC too and re-grant
-- explicitly to the roles that call them.
revoke execute on function public.is_org_admin(uuid) from public, anon;
revoke execute on function public.provider_acceptance_rate(uuid) from public, anon;
revoke execute on function public.provider_instant_book_eligible(uuid) from public, anon;
revoke execute on function public.provider_is_fresh(uuid, integer) from public, anon;
revoke execute on function public.provider_median_response_seconds(uuid) from public, anon;
revoke execute on function public.provider_safety_cleared(uuid) from public, anon;

grant execute on function public.is_org_admin(uuid) to authenticated, service_role;
grant execute on function public.provider_acceptance_rate(uuid) to authenticated, service_role;
grant execute on function public.provider_instant_book_eligible(uuid) to authenticated, service_role;
grant execute on function public.provider_is_fresh(uuid, integer) to authenticated, service_role;
grant execute on function public.provider_median_response_seconds(uuid) to authenticated, service_role;
grant execute on function public.provider_safety_cleared(uuid) to authenticated, service_role;

-- Advisor INFO 0008: email_suppressions has RLS on and no policy. That already
-- denies every non-service role; this makes the intent explicit so the next
-- reader does not "fix" it by adding a permissive policy.
comment on table public.email_suppressions is
  'Bounce/complaint suppression list, written only by the resend-webhook rail (service_role). RLS on, NO policies on purpose: clients never read or write it.';

commit;
