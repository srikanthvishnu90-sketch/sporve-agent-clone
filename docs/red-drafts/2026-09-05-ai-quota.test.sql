-- DISPOSABLE SYNTHETIC FIXTURE ONLY; not live auth/RLS or concurrency proof.
-- createdb sporv_ai_quota_test
-- psql -X -v ON_ERROR_STOP=1 -d sporv_ai_quota_test -f this-file
\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'sporv_ai_quota_test' then raise exception 'use dedicated disposable sporv_ai_quota_test database'; end if;
end $$;
create schema auth;
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.providers(id uuid primary key,owner_id uuid unique,plan text);
create table public.plan_entitlements(plan text primary key,ai_monthly_quota integer);
create table public.ai_usage(id uuid primary key default gen_random_uuid(),provider_id uuid,kind text,used_at timestamptz default now());
-- Stub records the exact actor/scope/limit arguments; does not prove PG's actual
-- atomic limiter. That requires the canonical schema and concurrent sessions.
create table public.test_burst_calls(actor text,scope text,lim integer,seconds integer);
create function public.consume_edge_rate_limit(text,text,integer,integer) returns boolean language plpgsql as $$begin
  insert into public.test_burst_calls values($1,$2,$3,$4);
  if current_setting('test.burst_allowed',true)='null' then return null; end if;
  return coalesce(nullif(current_setting('test.burst_allowed',true),''),'true')::boolean;
end$$;

insert into public.providers values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','free'),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','pro'),
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','enterprise'),
 ('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','free');
insert into public.plan_entitlements values ('free',3),('pro',null);

\ir 2026-09-05-ai-quota.sql

begin;
do $$ declare r jsonb; i integer; n integer; begin
  perform set_config('test.actor','',true);
  r:=public.consume_ai_quota();
  if r->>'reason'<>'not_authenticated' then raise exception 'FAIL unauthenticated not denied'; end if;
  perform set_config('test.actor','10000000-0000-0000-0000-000000000099',true);
  if public.consume_ai_quota()->>'reason'<>'not_a_coach' then raise exception 'FAIL non-coach not denied'; end if;

  perform set_config('test.actor','10000000-0000-0000-0000-000000000003',true);
  r:=public.consume_ai_quota();
  if r->>'allowed'<>'false' or r->>'reason'<>'quota_unavailable' then
    raise exception 'FAIL missing entitlement became unlimited'; end if;
  if exists(select from public.ai_usage) or exists(select from public.test_burst_calls) then
    raise exception 'FAIL denied configuration wrote usage'; end if;

  perform set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
  for i in 1..3 loop
    r:=public.consume_ai_quota();
    if r->>'allowed'<>'true' or (r->>'used')::integer<>i then raise exception 'FAIL free plan receipt'; end if;
  end loop;
  r:=public.consume_ai_quota();
  if r->>'allowed'<>'false' or r->>'reason'<>'quota_exhausted' or (r->>'used')::integer<>3 then
    raise exception 'FAIL monthly exhaustion'; end if;
  if (select count(*) from public.ai_usage)<>3 then raise exception 'FAIL rejected request wrote usage'; end if;

  perform set_config('test.actor','10000000-0000-0000-0000-000000000002',true);
  if public.consume_ai_quota()->>'allowed'<>'true' then raise exception 'FAIL configured unlimited plan denied'; end if;
  select count(*) into n from public.ai_usage;
  perform set_config('test.burst_allowed','false',true);
  r:=public.consume_ai_quota();
  if r->>'allowed'<>'false' or r->>'reason'<>'rate_limited' or (r->>'retry_after')::integer not between 1 and 60 then
    raise exception 'FAIL unlimited plan bypassed burst cap'; end if;
  if (select count(*) from public.ai_usage)<>n then raise exception 'FAIL burst denial wrote usage'; end if;
  perform set_config('test.burst_allowed','null',true);
  if public.consume_ai_quota()->>'reason'<>'quota_unavailable' then raise exception 'FAIL null limiter verdict allowed'; end if;
  perform set_config('test.burst_allowed','true',true);

  update public.plan_entitlements set ai_monthly_quota=0 where plan='free';
  perform set_config('test.actor','10000000-0000-0000-0000-000000000004',true);
  r:=public.consume_ai_quota();
  if r->>'reason'<>'quota_exhausted' or (r->>'used')::integer<>0 then raise exception 'FAIL zero quota'; end if;
  update public.plan_entitlements set ai_monthly_quota=-1 where plan='free';
  if public.consume_ai_quota()->>'reason'<>'quota_unavailable' then raise exception 'FAIL negative quota'; end if;

  if exists(select from public.test_burst_calls where scope<>'coach-ai:minute' or lim<>12 or seconds<>60)
    or not exists(select from public.test_burst_calls where actor='user:10000000-0000-0000-0000-000000000002') then
    raise exception 'FAIL fixed burst arguments'; end if;
end $$;

-- A suppressed receipt insert must fail loudly for both finite and unlimited plans.
create function public.test_suppress_usage() returns trigger language plpgsql as $$begin return null; end$$;
create trigger test_usage_noop before insert on public.ai_usage for each row execute function public.test_suppress_usage();
do $$ declare actor text; begin
  update public.plan_entitlements set ai_monthly_quota=3 where plan='free';
  foreach actor in array array['10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004'] loop
    perform set_config('test.actor',actor,true);
    begin
      perform public.consume_ai_quota();
      raise exception using errcode='23514',message='FAIL missing receipt allowed model spend';
    exception when raise_exception then
      if sqlerrm<>'AI usage receipt was not written' then raise; end if;
    end;
  end loop;
  raise notice 'PASS synthetic AI quota fixture (not live auth or concurrent limiter proof)';
end $$;
rollback;
