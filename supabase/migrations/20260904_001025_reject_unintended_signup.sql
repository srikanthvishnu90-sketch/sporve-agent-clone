-- 20260904_001025 — sign-in must never CREATE an account (owner 2026-09-04).
-- OAuth providers auto-provision on first sign-in; when the client detects
-- that a plain "sign in with Google" minted a brand-new user, it calls this
-- to undo it. Self-scoped and time-bound: only your own row, only within 10
-- minutes of creation — an established account cannot be deleted this way.
create or replace function public.reject_unintended_signup()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from auth.users
   where id = auth.uid()
     and created_at > now() - interval '10 minutes';
end; $$;
revoke all on function public.reject_unintended_signup() from public, anon;
grant execute on function public.reject_unintended_signup() to authenticated;
