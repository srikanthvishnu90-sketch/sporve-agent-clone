-- ============================================================================
-- 20260923_001116 — RESTORE on_auth_user_created TRIGGER (lost in production
-- restore). public.handle_new_user() exists in prod but is not attached to
-- auth.users, so new signups never get profiles/providers rows and the app
-- hits "WE COULDN'T LOAD YOUR WORKSPACE" (FK error).
--
-- Minimal trigger attach ONLY. Function body unchanged (see
-- 20260915_001065_staff_only_signup.sql). Do NOT touch
-- trg_enforce_staff_check_attestation.
--
-- Idempotent: drop-then-create is safe to re-run.
-- ============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
