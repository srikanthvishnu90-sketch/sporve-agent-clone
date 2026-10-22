-- ============================================================================
-- 2026-10-22 — ROLLBACK for 2026-10-22-manage-p1-tenant-roles.sql
-- RED TIER — the owner runs this by hand, only if Phase 1 must come out.
--
-- DATA-PRESERVING. Nothing Phase 1 stored is destroyed:
--   · every Phase 1 table that holds rows is COPIED to schema p1_archive
--     (name suffixed with the rollback timestamp) before it is dropped —
--     audit_log above all (§10.1: the audit trail is append-only and must
--     outlive the feature; §10.3 retention);
--   · the college columns on providers / teams / seasons are copied (only rows
--     where a value was set) before the columns are dropped.
-- p1_archive is not exposed to the API (no grants to anon/authenticated, RLS
-- on, no policies). Delete it later by hand only when retention allows.
--
-- What comes back exactly as before: every pre-existing policy, function,
-- trigger, column and grant on providers, teams, seasons, team_athletes,
-- event, attendance_record, event_response and organization_members. The
-- migration never altered those, so dropping its additions restores them.
-- Idempotent: every drop is IF EXISTS; a second run archives nothing new.
-- ============================================================================
begin;

create schema if not exists p1_archive;
revoke all on schema p1_archive from public, anon, authenticated;

-- ── 1. Archive (copy, never move) ───────────────────────────────────────────
do $$
declare
  v_stamp text := to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MISS');
  t text; n bigint; v_name text;
begin
  foreach t in array array['audit_log','athlete_team_memberships','student_athletes','role_assignments',
                           'org_role_capability_overrides','org_verified_domains','sport_programs'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        v_name := t || '_' || v_stamp;
        execute format('create table p1_archive.%I as select * from public.%I', v_name, t);
        execute format('alter table p1_archive.%I enable row level security', v_name);
        execute format('revoke all on p1_archive.%I from public, anon, authenticated', v_name);
        raise notice 'archived % rows of public.% into p1_archive.%', n, t, v_name;
      end if;
    end if;
  end loop;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'teams' and column_name = 'sport_program_id') then
    execute 'select count(*) from public.teams where sport_program_id is not null or gender is not null or level is not null
               or academic_year is not null or roster_locked_at is not null' into n;
    if n > 0 then
      v_name := 'teams_college_columns_' || v_stamp;
      execute format('create table p1_archive.%I as select id, provider_id, name, sport_program_id, gender, level, academic_year, roster_locked_at
                        from public.teams where sport_program_id is not null or gender is not null or level is not null
                          or academic_year is not null or roster_locked_at is not null', v_name);
      execute format('alter table p1_archive.%I enable row level security', v_name);
      execute format('revoke all on p1_archive.%I from public, anon, authenticated', v_name);
      raise notice 'archived college columns of % teams into p1_archive.%', n, v_name;
    end if;
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'seasons' and column_name = 'sport_program_id') then
    execute 'select count(*) from public.seasons where sport_program_id is not null or segment is not null or academic_year is not null' into n;
    if n > 0 then
      v_name := 'seasons_college_columns_' || v_stamp;
      execute format('create table p1_archive.%I as select id, provider_id, name, sport_program_id, segment, academic_year
                        from public.seasons where sport_program_id is not null or segment is not null or academic_year is not null', v_name);
      execute format('alter table p1_archive.%I enable row level security', v_name);
      execute format('revoke all on p1_archive.%I from public, anon, authenticated', v_name);
      raise notice 'archived college columns of % seasons into p1_archive.%', n, v_name;
    end if;
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'providers' and column_name = 'team_scoping') then
    execute 'select count(*) from public.providers where org_kind <> ''club'' or institution_type is not null or ncaa_division is not null
               or conference is not null or ipeds_unit_id is not null or fiscal_year_start_month <> 7
               or default_timezone is not null or team_scoping' into n;
    if n > 0 then
      v_name := 'providers_institution_columns_' || v_stamp;
      execute format('create table p1_archive.%I as select id, org_kind, institution_type, ncaa_division, conference, ipeds_unit_id,
                             fiscal_year_start_month, default_timezone, team_scoping
                        from public.providers where org_kind <> ''club'' or institution_type is not null or ncaa_division is not null
                          or conference is not null or ipeds_unit_id is not null or fiscal_year_start_month <> 7
                          or default_timezone is not null or team_scoping', v_name);
      execute format('alter table p1_archive.%I enable row level security', v_name);
      execute format('revoke all on p1_archive.%I from public, anon, authenticated', v_name);
      raise notice 'archived institution columns of % providers into p1_archive.%', n, v_name;
    end if;
  end if;
end $$;

-- ── 2. Policies added to EXISTING tables (reverse of §13) ───────────────────
do $$
begin
  if to_regclass('public.event_response') is not null then
    execute 'drop policy if exists event_response_p1_team_scope on public.event_response';
  end if;
  if to_regclass('public.attendance_record') is not null then
    execute 'drop policy if exists attendance_record_p1_team_scope on public.attendance_record';
  end if;
  if to_regclass('public.event') is not null then
    execute 'drop policy if exists event_p1_team_scope on public.event';
  end if;
end $$;
drop policy if exists team_athletes_p1_team_scope on public.team_athletes;
drop policy if exists teams_p1_team_scope         on public.teams;
drop policy if exists seasons_p1_college_write    on public.seasons;
drop policy if exists seasons_p1_college_select   on public.seasons;
drop policy if exists teams_p1_college_delete     on public.teams;
drop policy if exists teams_p1_college_update     on public.teams;
drop policy if exists teams_p1_college_insert     on public.teams;
drop policy if exists teams_p1_college_select     on public.teams;

-- ── 3. Audit triggers on existing tables ────────────────────────────────────
drop trigger if exists p1_audit on public.seasons;
drop trigger if exists p1_audit on public.teams;

-- ── 4. View and new tables, children first ──────────────────────────────────
drop view  if exists public.team_staff;
drop table if exists public.athlete_team_memberships;
drop table if exists public.student_athletes;
drop table if exists public.role_assignments;
drop table if exists public.org_role_capability_overrides;
drop table if exists public.role_capabilities;
drop table if exists public.college_capabilities;
drop table if exists public.college_roles;
drop table if exists public.org_verified_domains;
drop table if exists public.audit_log;              -- archived in step 1

-- ── 5. teams / seasons extensions, then the program tables ──────────────────
alter table public.teams   drop constraint if exists teams_sport_program_fkey;
alter table public.seasons drop constraint if exists seasons_sport_program_fkey;
drop index if exists public.teams_program_year_uq;
drop index if exists public.teams_provider_program_idx;
drop index if exists public.seasons_sport_program_idx;
alter table public.teams
  drop column if exists roster_locked_at,
  drop column if exists academic_year,
  drop column if exists level,
  drop column if exists gender,
  drop column if exists sport_program_id;
alter table public.seasons
  drop column if exists academic_year,
  drop column if exists segment,
  drop column if exists sport_program_id;
drop table if exists public.sport_programs;
drop table if exists public.sports;

-- ── 6. Composite-key targets added to existing tables ───────────────────────
alter table public.teams                drop constraint if exists teams_id_provider_key;
alter table public.organization_members drop constraint if exists organization_members_id_org_key;
drop index if exists public.organization_members_user_org_idx;

-- ── 7. Functions ────────────────────────────────────────────────────────────
drop function if exists public.team_scope_allows_event(uuid);
drop function if exists public.team_scope_allows(uuid);
drop function if exists public.team_scope_allows_row(uuid,uuid,uuid);
drop function if exists public.is_my_member(uuid);
drop function if exists public.has_athlete_team_access(uuid,text);
drop function if exists public.has_athlete_access(uuid,text);
drop function if exists public.is_self_athlete(uuid);
drop function if exists public.has_team_access(uuid,text);
drop function if exists public.team_access_check(uuid,uuid,uuid,text);
drop function if exists public.has_org_capability(uuid,text);
drop function if exists public.college_org_member(uuid);
drop function if exists public.role_capability_effective(uuid,text,text);
drop function if exists public.audit_row();
drop function if exists public.audit_log_append_only();
drop function if exists public.p1_d3_aid_guard();
drop function if exists public.p1_role_assignment_guard();
drop function if exists public.p1_capability_override_guard();

-- ── 8. providers institution columns (archived in step 1) ───────────────────
drop trigger  if exists p1_providers_tz_guard on public.providers;
drop function if exists public.p1_providers_tz_guard();
alter table public.providers
  drop column if exists team_scoping,
  drop column if exists default_timezone,
  drop column if exists fiscal_year_start_month,
  drop column if exists ipeds_unit_id,
  drop column if exists conference,
  drop column if exists ncaa_division,
  drop column if exists institution_type,
  drop column if exists org_kind;

-- ── 9. Post-flight: nothing of Phase 1 left in public ───────────────────────
do $$
declare v_left text;
begin
  select string_agg(x, ', ') into v_left from (
    select c.relname::text as x from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('org_verified_domains','sports','sport_programs','college_roles',
           'college_capabilities','role_capabilities','org_role_capability_overrides','role_assignments',
           'student_athletes','athlete_team_memberships','audit_log','team_staff')
    union all
    select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('has_org_capability','has_team_access','team_access_check','audit_row',
           'team_scope_allows','team_scope_allows_row','team_scope_allows_event','role_capability_effective')
    union all
    select 'providers.' || a.attname from pg_attribute a
     where a.attrelid = 'public.providers'::regclass and a.attname in ('org_kind','team_scoping') and not a.attisdropped
  ) s;
  if v_left is not null then raise exception 'P1 rollback post-flight: still present: %', v_left; end if;
end $$;

commit;
