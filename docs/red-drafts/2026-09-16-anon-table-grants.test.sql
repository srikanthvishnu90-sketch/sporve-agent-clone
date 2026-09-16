-- Disposable-database fixture for migration 20260915_001068. Never runs against production.
--     bash tools/run-sql-fixtures.sh 2026-09-16-anon
-- RED-FIRST: with the \ir line removed, assertion A fails — anon holds SELECT on a
-- table created under Supabase-style default privileges.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_anongrants' then
    raise exception 'refusing to run outside the disposable sporv_spec_anongrants database (got %)', current_database();
  end if;
end $$;
do $$ begin create role anon nologin; create role authenticated nologin; create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;
-- Supabase's shape: default privileges hand anon SELECT on every new table
alter default privileges for role postgres in schema public grant all on tables to anon;
create table public.plan_entitlements (plan text primary key, price_usd_month numeric);
create table public.guardian_links (id uuid primary key, member_id uuid);
create table public.background_check (id uuid primary key, status text);
alter table public.guardian_links enable row level security; alter table public.background_check enable row level security;

\ir ../../supabase/migrations/20260915_001068_revoke_anon_table_grants.sql

do $$
begin
  -- A ── no anon grant survives on org-data tables
  if has_table_privilege('anon', 'public.guardian_links', 'select') or has_table_privilege('anon', 'public.background_check', 'select') then
    raise exception 'FAIL A: anon still holds SELECT on an org-data table';
  end if;
  raise notice 'PASS A: anon has no table grant on org data';
  -- B ── the one deliberate public read stays
  if not has_table_privilege('anon', 'public.plan_entitlements', 'select') then raise exception 'FAIL B: pricing read lost'; end if;
  raise notice 'PASS B: plan_entitlements stays readable (public pricing)';
  -- C ── a table created AFTER the migration gets no anon grant
  create table public.later_table (id uuid primary key);
  if has_table_privilege('anon', 'public.later_table', 'select') then raise exception 'FAIL C: a new table re-opened the class'; end if;
  raise notice 'PASS C: default privileges no longer grant anon on new tables';
end $$;
