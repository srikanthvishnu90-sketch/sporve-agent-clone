-- 2026-09-20 · org_connectors.external_id: a home for the QuickBooks realmId.
--
-- intuit-oauth-callback validated realmId for presence but could not persist
-- it: external_account is the "Connected as" display and scopes is a text[].
-- connector-read resolves the realm from params.realm_id or external_account
-- as a fallback; a dedicated column is the durable contract. Generic name on
-- purpose: any provider-side id for a connection lives here.
alter table public.org_connectors
  add column if not exists external_id text;

comment on column public.org_connectors.external_id is
  'Provider-side id for the connection — the QuickBooks realmId for kind quickbooks. Written by the OAuth callback; read by connector-read. Never a secret.';
