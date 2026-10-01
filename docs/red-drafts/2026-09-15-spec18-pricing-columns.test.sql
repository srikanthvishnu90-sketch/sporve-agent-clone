-- Disposable-database fixture for migration 20260915_001063. Never runs against production.
--     bash tools/run-sql-fixtures.sh 2026-09-15-spec18
-- RED-FIRST: with the \ir line removed, assertion A fails (column missing).
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_pricing' then
    raise exception 'refusing to run outside the disposable sporv_spec_pricing database (got %)', current_database();
  end if;
end $$;
create table public.plan_entitlements (plan text primary key, ai_monthly_quota integer, seat_limit integer,
  workspace_enabled boolean not null default false, purchasable boolean not null default false, price_usd_month numeric(6,2), updated_at timestamptz not null default now());
insert into public.plan_entitlements (plan, price_usd_month, purchasable) values ('solo', 49.00, true), ('org', 199.00, true);

\ir ../../supabase/migrations/20260915_001063_plan_entitlements_pricing_columns.sql

do $$
begin
  -- A ── the two columns exist, nullable, and every existing plan is unpriced on them
  if (select count(*) from information_schema.columns where table_name='plan_entitlements' and column_name in ('per_athlete_minor','payment_margin_bps') and is_nullable='YES') <> 2 then
    raise exception 'FAIL A: pricing columns missing or not nullable';
  end if;
  if exists (select 1 from public.plan_entitlements where per_athlete_minor is not null or payment_margin_bps is not null) then
    raise exception 'FAIL A: a plan is priced on the new columns at launch';
  end if;
  raise notice 'PASS A: per_athlete_minor and payment_margin_bps exist, nullable, unused at launch';

  -- B ── no org_subscription table anywhere
  if to_regclass('public.org_subscription') is not null then raise exception 'FAIL B: org_subscription exists'; end if;
  raise notice 'PASS B: no second billing table';

  -- C ── ranges: negative per-athlete and >100% margin are refused
  begin update public.plan_entitlements set per_athlete_minor = -1 where plan='solo'; raise exception 'FAIL C: negative per-athlete accepted';
  exception when check_violation then null; end;
  begin update public.plan_entitlements set payment_margin_bps = 10001 where plan='solo'; raise exception 'FAIL C: margin over 100%% accepted';
  exception when check_violation then null; end;
  update public.plan_entitlements set per_athlete_minor = 500, payment_margin_bps = 50 where plan='org';
  raise notice 'PASS C: per-athlete >= 0, margin 0..10000 bps';
end $$;
