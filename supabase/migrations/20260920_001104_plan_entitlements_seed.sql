-- 2026-09-20 · seed plan_entitlements so OAuth starts stop failing closed.
--
-- Production carried zero rows and no connectors column: the baseline created
-- the table empty, and 20260910_001039 only ran UPDATEs (matched nothing) plus
-- the add-column — neither of which survived to this project. Every OAuth
-- start reads plan_entitlements.connectors and fails closed (402/503) without it.
--
-- Connector mapping is CONTEXT.md §6 (customer labels Free/Solo/Organization;
-- database keys stay free|pro|enterprise until the rename draft ships with its
-- caller cutover — see 20260910_001039 header).
--
-- Prices and purchasable are deliberately left NULL/false: §6 prices are
-- marked ⚠ pending founder confirmation, and billing-create-checkout refuses
-- to sell without a valid price. Nothing can be sold until the founder
-- confirms — that is honest, not broken.
alter table public.plan_entitlements
  add column if not exists connectors text[] not null default '{}';

insert into public.plan_entitlements (plan, connectors) values
  ('free',
   array['website','file_import','stripe']),
  ('pro',
   array['website','file_import','stripe',
         'gmail','google_calendar','sms']),
  ('enterprise',
   array['website','file_import','stripe',
         'gmail','google_calendar','sms',
         'microsoft365','google_sheets','google_drive',
         'quickbooks','google_business_profile'])
on conflict (plan) do update
  set connectors = excluded.connectors,
      updated_at = now();
