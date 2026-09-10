-- Applied to production as migration version 20260910175643.
-- Written back 2026-09-10: the EXACT recorded SQL, pulled from
-- supabase_migrations.schema_migrations rather than retyped.

-- 2026-09-10 · the same lesson as 001034, applied to today's two new triggers
--
-- Migration 001034 (trigger_function_grants) removed API-role EXECUTE from
-- every trigger function, on the principle that a trigger function is not an
-- RPC endpoint. Two functions added TODAY re-opened the hole because they were
-- created after that sweep ran:
--
--   connector_drop_secret_tg()          (001038, connector vault cleanup)
--   enforce_agent_finding_dismiss_only() (pentest hardening, findings guard)
--
-- Supabase's advisor 0028 flagged both as callable by `anon` through
-- /rest/v1/rpc/. Neither is reachable as an RPC in any useful way — a trigger
-- function called directly has no NEW/OLD and errors — but "it errors" is not
-- a security boundary, and the advisor is right to count them.
--
-- Triggers keep working: a trigger is invoked by the table owner, not by the
-- caller's role, so revoking EXECUTE from the API roles changes nothing about
-- firing. Verified by the same reasoning 001034 relied on.

revoke execute on function public.connector_drop_secret_tg() from public, anon, authenticated;
revoke execute on function public.enforce_agent_finding_dismiss_only() from public, anon, authenticated;
