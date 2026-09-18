-- Disposable-database fixture for audit 2026-09-17 P2-2 — impossible
-- birthdates are refused by the database. Migration 20260915_001078.
--
--     bash tools/run-sql-fixtures.sh 2026-09-18-dob-guard
--
-- RED-FIRST: remove the 001078 \ir line and group A fails on
-- "FAIL A: a future date of birth was stored".
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_dob' then
    raise exception 'refusing to run outside the disposable sporv_spec_dob database (got %)', current_database();
  end if;
end $$;
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; create role authenticated nologin; exception when duplicate_object then null; end $$;
create table public.providers (id uuid primary key default gen_random_uuid(), business_name text);
create table public.teams (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), name text);
create table public.team_athletes (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams(id), provider_id uuid references public.providers(id), first_name text, last_name text, dob date, status text not null default 'active');
create table public.athletes (id uuid primary key default gen_random_uuid(), first_name text, date_of_birth date);
\ir ../../supabase/migrations/20260915_001078_dob_guard.sql
insert into public.providers (id, business_name) values ('0a000000-0000-4000-8000-000000000001','Rivertown FC');

-- A · future and pre-1920 dates are refused with 23514; null and a real past date are stored ──
do $$ declare ok boolean; msg text; begin
  ok := false; begin insert into public.team_athletes (provider_id, first_name, dob) values ('0a000000-0000-4000-8000-000000000001','Tomorrow', current_date + 1);
  exception when sqlstate '23514' then ok := true; msg := sqlerrm; end;
  if not ok then raise exception 'FAIL A: a future date of birth was stored'; end if;
  if msg not like '%in the future%' then raise exception 'FAIL A: message % is not legible', msg; end if;
  ok := false; begin insert into public.team_athletes (provider_id, first_name, dob) values ('0a000000-0000-4000-8000-000000000001','Ancient', date '1899-01-01');
  exception when sqlstate '23514' then ok := true; end;
  if not ok then raise exception 'FAIL A: an 1899 date of birth was stored'; end if;
  insert into public.team_athletes (provider_id, first_name, dob) values ('0a000000-0000-4000-8000-000000000001','Unknown', null);
  insert into public.team_athletes (id, provider_id, first_name, dob) values ('3a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Ava', date '2013-04-02');
  if (select count(*) from public.team_athletes) <> 2 then raise exception 'FAIL A: expected exactly the two valid rows'; end if;
  raise notice 'PASS A: future and 1899 refused (23514, legible); null and 2013 stored';
end $$;
-- B · an update cannot smuggle an impossible date in; the family-side athletes table is guarded too ──
do $$ declare ok boolean := false; begin
  begin update public.team_athletes set dob = current_date + 30 where id = '3a000000-0000-4000-8000-000000000001'; exception when sqlstate '23514' then ok := true; end;
  if not ok then raise exception 'FAIL B: update stored a future date'; end if;
  ok := false; begin insert into public.athletes (first_name, date_of_birth) values ('X', date '1800-01-01'); exception when sqlstate '23514' then ok := true; end;
  if not ok then raise exception 'FAIL B: athletes.date_of_birth accepted 1800'; end if;
  raise notice 'PASS B: update refused; athletes guarded';
end $$;
