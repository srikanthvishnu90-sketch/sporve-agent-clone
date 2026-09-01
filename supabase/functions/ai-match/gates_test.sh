#!/usr/bin/env bash
# DEV-ONLY: regression-test the deterministic match gates (G1-G7 + §5 LTAD
# ceilings) against the spec §11 worked cases, on a throwaway local Postgres 17.
# Applies the SHIPPED migration (20260706) over a minimal schema, seeds fixtures,
# and asserts eligibility. Requires: brew install postgresql@17.
set -e
export LC_ALL=C LANG=C
PG=/opt/homebrew/opt/postgresql@17/bin
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA=/tmp/gates_pgdata; SOCK=/tmp/gates_pg; PORT=5439
"$PG/pg_ctl" -D "$DATA" stop >/dev/null 2>&1 || true
rm -rf "$DATA"; mkdir -p "$DATA" "$SOCK"
"$PG/initdb" -D "$DATA" -U postgres --locale=C -E UTF8 >/dev/null 2>&1
"$PG/pg_ctl" -D "$DATA" -o "-p $PORT -k $SOCK" -l /tmp/gates_pg.log start >/dev/null 2>&1
sleep 3
export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres
"$PG/createdb" gates
"$PG/psql" -d gates -v ON_ERROR_STOP=1 -q -c "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
# Stub the Supabase auth surface the org-providers migration references. auth.uid()
# returns null here => service-role path, so fixture inserts are trusted.
"$PG/psql" -d gates -v ON_ERROR_STOP=1 -q -c "create schema if not exists auth; create table if not exists auth.users(id uuid primary key); create or replace function auth.uid() returns uuid language sql stable as \$\$ select null::uuid \$\$;"
# minimal schema WITH the matching columns (the migration's ALTERs then no-op).
"$PG/psql" -d gates -v ON_ERROR_STOP=1 -q <<'SQL'
create extension if not exists pgcrypto;
create table providers (id uuid primary key, owner_id uuid, provider_type text not null default 'solo',
  business_name text, bio text, sports text[] default '{}',
  latitude double precision, longitude double precision, status text default 'approved',
  background_check_status text default 'none', account_status text default 'active',
  coach_years_coaching int, coach_years_played int, credentials text[] default '{}');
create table programs (id uuid primary key, provider_id uuid references providers(id),
  title text, sport_type text not null, status text default 'published',
  price numeric(10,2) default 0, minimum_age int, maximum_age int,
  average_rating numeric(2,1) default 0, total_reviews int default 0,
  latitude double precision, longitude double precision,
  intensity_tier int, typical_client jsonb, session_types text[] default '{}');
create table sessions (id uuid primary key default gen_random_uuid(), program_id uuid, start_date date, capacity int default 0);
create table bookings (id uuid primary key default gen_random_uuid(), session_id uuid, status text default 'pending');
SQL
# apply the SHIPPED migrations (functions; ALTERs add the org columns + roster).
"$PG/psql" -d gates -v ON_ERROR_STOP=1 -f "$HERE/../../migrations/20260706_000000_matching_engine.sql" >/dev/null
"$PG/psql" -d gates -v ON_ERROR_STOP=1 -f "$HERE/../../migrations/20260708_000000_organization_providers.sql" >/dev/null
# fixtures + assertions
"$PG/psql" -d gates -v ON_ERROR_STOP=1 -f "$HERE/gates_test.sql"
echo "gates_test: ALL CASES PASS ✅"
"$PG/pg_ctl" -D "$DATA" stop >/dev/null 2>&1 || true; rm -rf "$DATA" "$SOCK"
