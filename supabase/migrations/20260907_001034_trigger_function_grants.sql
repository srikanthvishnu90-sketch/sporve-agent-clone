-- 20260907_001034 — trigger-function EXECUTE revokes (red draft 2026-09-06, owner-approved)
-- [CRITICAL-PATH] REVIEWABLE DRAFT ONLY. Not applied to any shared database.
-- S01/S04: trigger and event-trigger SECURITY DEFINER functions are not RPC
-- endpoints. Remove API-role EXECUTE while preserving trigger invocation.
-- Preconditions: review the attached trigger/event identities and confirm none
-- is intentionally called by application RPC. Inverse: restore saved ACLs only
-- after a compare-before-restore review.

do $$
declare f record;
begin
  for f in
    select distinct p.oid::regprocedure as signature
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace
    where not t.tgisinternal and n.nspname='public'
      and p.prosecdef
    union
    select distinct p.oid::regprocedure
    from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f.signature);
  end loop;
end $$;

-- Explicitly pin the ledger trigger's search path as a defense-in-depth receipt.
-- Its trigger remains attached; only the function execution context changes.
create or replace function public.ledger_is_append_only()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='55000',
    message='payment_event_ledger is append-only: corrections are new rows with reverses_entry_id set';
end $$;
revoke all on function public.ledger_is_append_only() from public, anon, authenticated, service_role;

