-- Isolated regression fixture for 2026-09-06-trigger-function-grants.sql.
-- Run in a disposable PostgreSQL database as an owner; no Sporv connection.
begin;
do $$
declare fn record; attached integer := 0;
begin
  -- The production preflight must discover only attached trigger functions.
  for fn in
    select distinct p.oid::regprocedure as signature
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace
    where not t.tgisinternal and n.nspname='public' and p.prosecdef
    union
    select distinct p.oid::regprocedure
    from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    attached := attached + 1;
    execute format('revoke execute on function %s from public, anon, authenticated, service_role',fn.signature);
    if has_function_privilege('anon',fn.signature,'execute')
       or has_function_privilege('authenticated',fn.signature,'execute') then
      raise exception 'API execute remains on attached function %',fn.signature;
    end if;
  end loop;
  if attached=0 then raise exception 'fixture found no attached SECURITY DEFINER function'; end if;
end $$;

-- A normal application function is outside the target set and is untouched.
create or replace function public.sporv_rpc_fixture() returns integer
language sql immutable as $$ select 1 $$;
grant execute on function public.sporv_rpc_fixture() to authenticated;
do $$ begin
  if not has_function_privilege('authenticated','public.sporv_rpc_fixture()','execute') then
    raise exception 'unrelated RPC privilege was changed';
  end if;
end $$;
rollback;
