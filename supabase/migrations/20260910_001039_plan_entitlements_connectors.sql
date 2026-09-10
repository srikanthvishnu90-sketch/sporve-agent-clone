-- Applied to production as migration version 20260910161848.
-- Written back into the repository 2026-09-10: this file is the EXACT
-- SQL the database recorded, pulled from supabase_migrations.schema_migrations
-- rather than retyped, so the repo can rebuild production byte-for-byte.

-- 2026-09-10 · which connectors each plan may hold
--
-- Narrow on purpose. google-oauth-start already reads
-- plan_entitlements.connectors and FAILS CLOSED when the column is absent,
-- which is why Gmail returns 503 today. This adds the column and seeds it, and
-- does nothing else.
--
-- It deliberately does NOT rename the plan keys. Production still carries the
-- baseline's free|pro|enterprise; the constitution's free|solo|organization
-- rename belongs to Codex's 2026-09-08-plan-entitlements draft, which ships
-- with its caller cutover. `add column if not exists` keeps this idempotent, so
-- that draft still applies cleanly on top.
--
-- Mapping used, from CONTEXT.md §6:
--   free       website extraction, CSV import, Stripe
--   pro   (≈ Solo)          + Gmail, Google Calendar, SMS
--   enterprise (≈ Organization) + Outlook/M365, Sheets, Drive, QuickBooks, GBP

alter table public.plan_entitlements
  add column if not exists connectors text[] not null default '{}';

update public.plan_entitlements
   set connectors = array['website','file_import','stripe']
 where plan = 'free';

update public.plan_entitlements
   set connectors = array['website','file_import','stripe',
                          'gmail','google_calendar','sms']
 where plan = 'pro';

update public.plan_entitlements
   set connectors = array['website','file_import','stripe',
                          'gmail','google_calendar','sms',
                          'microsoft365','google_sheets','google_drive',
                          'quickbooks','google_business_profile']
 where plan = 'enterprise';

comment on column public.plan_entitlements.connectors is
  'Connector kinds this plan may connect. Read by google-oauth-start, which returns 402 for a kind not listed. Changing a plan''s connectors is a DATA change, never a code change (invariant I2).';
