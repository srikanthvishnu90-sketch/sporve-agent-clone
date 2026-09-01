-- Spec 04 follow-up: SporveCoach.load()'s named select included
-- stripe_account_id, which the 2026-08-20 lockdown ungranted — every provider
-- load 401'd. The UI only needs the BOOLEAN "onboarding started"; a stored
-- generated column carries that one bit and is granted, the id stays
-- service-role only. Also grants the spec-03 refund policy columns.
-- Applied to prod 2026-08-31 as spec04_provider_grants.
alter table public.providers
  add column if not exists stripe_onboarding_started boolean
    generated always as (stripe_account_id is not null) stored;
grant select (stripe_onboarding_started, refund_policy, refund_deposit_cents)
  on public.providers to authenticated;
grant update (refund_policy, refund_deposit_cents) on public.providers to authenticated;
