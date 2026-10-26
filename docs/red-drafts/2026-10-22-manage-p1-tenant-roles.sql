-- ============================================================================
-- 2026-10-22 — MANAGE PHASE 1: tenant + roles (college athletics)
-- Spec: docs/specs/31-COLLEGE-ATHLETICS.md §2.3–§2.7, §3.1–§3.5, §10.1, §14
-- Phase 1, §15 row "1. Tenant and roles".
--
-- RED TIER — DRAFT ONLY. The owner applies this by hand in the Supabase SQL
-- editor (project aveqjeafghmwafkbbnor). No agent applies it. Steps:
-- docs/red-drafts/APPLY-ORDER.md § "Manage Phase 1 (tenant + roles)".
-- Proof:    docs/red-drafts/2026-10-22-manage-p1-tenant-roles.test.sql
-- Inverse:  docs/red-drafts/2026-10-22-manage-p1-rollback.sql
--
-- WHAT THIS ADDS (all additive; nothing existing is renamed or dropped)
--   providers   + org_kind, institution_type, ncaa_division, conference,
--                 ipeds_unit_id, fiscal_year_start_month, default_timezone,
--                 team_scoping (opt-in switch, see BACKWARD COMPATIBILITY)
--   new tables    org_verified_domains, sports (catalog), sport_programs,
--                 college_roles, college_capabilities, role_capabilities,
--                 org_role_capability_overrides, role_assignments,
--                 student_athletes, athlete_team_memberships, audit_log
--   new view      team_staff (security_invoker, over role_assignments — §2.6)
--   teams       + sport_program_id, gender, level, academic_year, roster_locked_at
--   seasons     + sport_program_id, segment, academic_year
--   helpers       has_org_capability(org,cap), has_team_access(team,cap),
--                 team_access_check(org,program,team,cap), is_self_athlete,
--                 has_athlete_access, college_org_member, team_scope_allows*
--   triggers      role-scope guard, restricted-capability guard, D3 aid guard,
--                 generic audit_row() with a per-org hash chain, append-only
--                 guard on audit_log
--
-- BACKWARD COMPATIBILITY — how existing club behaviour is guaranteed unchanged
--   1. Every new policy on an EXISTING table (teams, seasons) is PERMISSIVE
--      and requires `sport_program_id is not null`. Permissive policies are
--      OR-ed, so they can only ADD rows a user may see; and every club team /
--      season has sport_program_id = null, so for club rows they add nothing.
--   2. No existing policy, function, trigger or column is dropped or altered.
--      is_org_admin, coaches_team, my_workspace, teams_select_member and the
--      owner policies are untouched.
--   3. The only RESTRICTIVE policies (on teams, team_athletes, event,
--      attendance_record, event_response) pass unconditionally unless the
--      org sets providers.team_scoping = true. The column is added with
--      default false, so for every existing org the restrictive policy is
--      `true AND <existing policies>` = the existing policies. A coach with no
--      role_assignments keeps today's event-assignment access (coaches_team)
--      until their org opts in.
--   4. When an org opts in (team_scoping = true), the restriction binds ONLY
--      active non-admin members of that org: owners and owner/admin members
--      (is_org_admin) pass, and anyone who is not a member of that org
--      (parents, other orgs) passes through to the existing policies.
--   5. The new providers columns are nullable or defaulted (fast default, no
--      table rewrite). Club inserts that omit them behave as before.
--
-- DEVIATIONS FROM THE SPEC TEXT (each deliberate, each reported)
--   a. `force row level security` is NOT set on the new tables. FORCE only
--      binds the table OWNER (postgres) — never anon/authenticated — and the
--      owner is exactly the identity every SECURITY DEFINER helper and the
--      audit trigger run as. Forcing would subject has_team_access() to the
--      very policies that call it (infinite recursion) on any role without
--      BYPASSRLS. RLS is ENABLED on every new table (I6).
--   b. org_verified_domains.domain is unique only once VERIFIED (plus unique
--      per org). The spec's global unique(domain) would let any org squat a
--      school's domain before the school signs up.
--   c. medical.break_glass is excluded from the is_org_admin short-circuit.
--      §3.4's helper text omitted it while §3.1 lists it as restricted.
--   d. Capability overrides with granted = true are honoured by the helpers
--      (§3.1 allows adding non-restricted capabilities; §3.4's helper only
--      handled removals). Unknown capability keys fail closed (FK + catalog).
--   e. teams UPDATE for college rows needs roster.write at DEPARTMENT level
--      (ad, assoc_ad, sid), not team level: RLS cannot stop a team-scoped
--      coach from rewriting sport_program_id / roster_locked_at on their own
--      team row. Coaches edit memberships, not the team row, in Phase 1.
--   f. student_athletes.date_of_birth is not granted to `authenticated` at all
--      (select/insert/update). Invariant I7: a 17-year-old freshman is a minor.
--      DOB enters via service role / the Phase 2 SIS import RPC. user_id is
--      likewise service-role only (account linking is SSO JIT, Phase 4).
--   g. granted_by / changed_by / verified_by are nullable with ON DELETE SET
--      NULL, filled from auth.uid() by trigger. A NOT NULL FK to auth.users
--      would block deleting that user's account.
--
-- IDEMPOTENT: IF NOT EXISTS on tables/columns/indexes, guarded constraint
-- adds, CREATE OR REPLACE functions, DROP … IF EXISTS before policies and
-- triggers, ON CONFLICT DO NOTHING seeds. Safe to run twice.
-- ============================================================================
begin;

-- ── 0. Preflight: refuse to run against the wrong database ───────────────────
do $$
begin
  if to_regclass('public.providers') is null
     or to_regclass('public.teams') is null
     or to_regclass('public.organization_members') is null
     or to_regclass('public.seasons') is null then
    raise exception 'P1 preflight: providers / teams / organization_members / seasons missing — wrong project?';
  end if;
  if to_regprocedure('public.is_org_admin(uuid)') is null then
    raise exception 'P1 preflight: public.is_org_admin(uuid) missing — wrong project?';
  end if;
  if to_regprocedure('public.tg_touch_updated_at()') is null then
    raise exception 'P1 preflight: public.tg_touch_updated_at() missing — wrong project?';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'P1 preflight: auth.uid() missing — not a Supabase database';
  end if;
  if to_regclass('public.athletes') is null or to_regclass('public.team_athletes') is null then
    raise exception 'P1 preflight: youth athletes / team_athletes missing — wrong project?';
  end if;
end $$;

-- ── 1. Institution fields on providers (§2.3) ───────────────────────────────
alter table public.providers
  add column if not exists org_kind text not null default 'club'
    check (org_kind in ('club','trainer','gym','institution')),
  add column if not exists institution_type text
    check (institution_type is null or institution_type in ('university','college','community_college','other')),
  add column if not exists ncaa_division text
    check (ncaa_division is null or ncaa_division in ('D1','D2','D3','NAIA','NJCAA','none')),
  add column if not exists conference text
    check (conference is null or length(conference) <= 200),
  add column if not exists ipeds_unit_id text,          -- federal institution id, optional
  add column if not exists fiscal_year_start_month smallint not null default 7
    check (fiscal_year_start_month between 1 and 12),
  add column if not exists default_timezone text,
  add column if not exists team_scoping boolean not null default false;

comment on column public.providers.org_kind is
  'Manage P1: club | trainer | gym | institution. provider_type keeps its solo/organization meaning.';
comment on column public.providers.team_scoping is
  'Manage P1 opt-in. false (default) = today''s access rules. true = non-admin members see only teams their role_assignments grant (roster.read).';

-- providers carries column-level SELECT grants (baseline line 4781): the new
-- columns are invisible to the app until granted. anon gets none of them.
grant select (org_kind, institution_type, ncaa_division, conference, ipeds_unit_id,
              fiscal_year_start_month, default_timezone, team_scoping)
  on public.providers to authenticated;
grant update (institution_type, ncaa_division, conference, ipeds_unit_id,
              fiscal_year_start_month, default_timezone, team_scoping)
  on public.providers to authenticated;   -- row access still = providers_update_owner

-- default_timezone must be a real IANA name. Self-contained (no dependency on
-- assert_iana_timezone, whose production state is unverified).
create or replace function public.p1_providers_tz_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.default_timezone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.default_timezone) then
    raise exception 'default_timezone % is not an IANA time zone', new.default_timezone using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.p1_providers_tz_guard() from public, anon, authenticated;
drop trigger if exists p1_providers_tz_guard on public.providers;
create trigger p1_providers_tz_guard before insert or update of default_timezone on public.providers
  for each row execute function public.p1_providers_tz_guard();

-- ── 2. Verified domains (§2.3) ──────────────────────────────────────────────
create table if not exists public.org_verified_domains (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  domain             text not null check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  verification_token text not null default replace(gen_random_uuid()::text, '-', ''),
  verified_at        timestamptz,
  verified_by        uuid references auth.users(id) on delete set null,
  auto_join          boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint ovd_auto_join_needs_verification check (not auto_join or verified_at is not null)
);
create unique index if not exists ovd_provider_domain_uq on public.org_verified_domains (provider_id, domain);
create unique index if not exists ovd_verified_domain_uq on public.org_verified_domains (domain) where verified_at is not null;
create index if not exists ovd_verified_by_idx on public.org_verified_domains (verified_by) where verified_by is not null;

-- ── 3. Sports catalog and sport programs (§2.4) ─────────────────────────────
create table if not exists public.sports (
  code                 text primary key check (code ~ '^[a-z0-9_]{2,16}$'),
  name                 text not null,
  gender               text not null check (gender in ('men','women','mixed')),
  default_season       text not null check (default_season in ('fall','winter','spring','year_round')),
  championship_segment text check (championship_segment in ('fall','winter','spring')),
  stat_format          text,
  ncaa_sport_code      text,                    -- VERIFY against the NCAA sport list; seeded null
  roster_positions     text[] not null default '{}'
);

-- Seed: common D2/D3 sports. Segments are typical, not asserted (VERIFY per
-- conference). ON CONFLICT DO NOTHING so a rerun never overwrites edits.
insert into public.sports (code, name, gender, default_season, championship_segment) values
  ('mbb','Basketball','men','winter','winter'),        ('wbb','Basketball','women','winter','winter'),
  ('msoc','Soccer','men','fall','fall'),               ('wsoc','Soccer','women','fall','fall'),
  ('fb','Football','men','fall','fall'),
  ('mvb','Volleyball','men','spring','spring'),        ('wvb','Volleyball','women','fall','fall'),
  ('mxc','Cross Country','men','fall','fall'),         ('wxc','Cross Country','women','fall','fall'),
  ('mitf','Indoor Track and Field','men','winter','winter'),   ('witf','Indoor Track and Field','women','winter','winter'),
  ('motf','Outdoor Track and Field','men','spring','spring'),  ('wotf','Outdoor Track and Field','women','spring','spring'),
  ('bsb','Baseball','men','spring','spring'),          ('sb','Softball','women','spring','spring'),
  ('mlax','Lacrosse','men','spring','spring'),         ('wlax','Lacrosse','women','spring','spring'),
  ('mten','Tennis','men','spring','spring'),           ('wten','Tennis','women','spring','spring'),
  ('mgolf','Golf','men','spring','spring'),            ('wgolf','Golf','women','spring','spring'),
  ('mswim','Swimming and Diving','men','winter','winter'), ('wswim','Swimming and Diving','women','winter','winter'),
  ('wres','Wrestling','men','winter','winter'),
  ('wfh','Field Hockey','women','fall','fall'),
  ('mih','Ice Hockey','men','winter','winter'),        ('wih','Ice Hockey','women','winter','winter')
on conflict (code) do nothing;

create table if not exists public.sport_programs (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  sport_code    text not null references public.sports(code),
  display_name  text not null check (length(display_name) between 1 and 120),
  level         text not null default 'varsity' check (level in ('varsity','jv','club','emerging')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint sport_programs_provider_sport_level_key unique (provider_id, sport_code, level),
  constraint sport_programs_id_provider_key unique (id, provider_id)        -- target of composite FKs
);
create index if not exists sport_programs_sport_code_idx on public.sport_programs (sport_code);

-- ── 4. Composite-key targets on existing tables (cross-org link guard, I9) ──
-- A row that names a team / member / program must name one in its OWN org.
-- (id is already the PK, so these unique constraints always hold.)
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.teams'::regclass and conname = 'teams_id_provider_key') then
    alter table public.teams add constraint teams_id_provider_key unique (id, provider_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.organization_members'::regclass and conname = 'organization_members_id_org_key') then
    alter table public.organization_members add constraint organization_members_id_org_key unique (id, organization_id);
  end if;
end $$;
-- §3.4 performance note: helpers look members up by (user, org).
create index if not exists organization_members_user_org_idx
  on public.organization_members (member_user_id, organization_id);

-- ── 5. teams and seasons extensions (§2.5) ──────────────────────────────────
alter table public.teams
  add column if not exists sport_program_id uuid,
  add column if not exists gender text check (gender is null or gender in ('men','women','mixed')),
  add column if not exists level  text check (level is null or level in ('varsity','jv','club','emerging','youth')),
  add column if not exists academic_year text check (academic_year is null or academic_year ~ '^\d{4}-\d{2}$'),
  add column if not exists roster_locked_at timestamptz;

alter table public.seasons
  add column if not exists sport_program_id uuid,
  add column if not exists segment text check (segment is null or segment in ('championship','nontraditional','preseason','postseason')),
  add column if not exists academic_year text check (academic_year is null or academic_year ~ '^\d{4}-\d{2}$');

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.teams'::regclass and conname = 'teams_sport_program_fkey') then
    alter table public.teams add constraint teams_sport_program_fkey
      foreign key (sport_program_id, provider_id) references public.sport_programs (id, provider_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.seasons'::regclass and conname = 'seasons_sport_program_fkey') then
    alter table public.seasons add constraint seasons_sport_program_fkey
      foreign key (sport_program_id, provider_id) references public.sport_programs (id, provider_id) on delete cascade;
  end if;
end $$;

create unique index if not exists teams_program_year_uq on public.teams (sport_program_id, academic_year)
  where sport_program_id is not null;
create index if not exists teams_provider_program_idx on public.teams (provider_id, sport_program_id);
create index if not exists seasons_sport_program_idx on public.seasons (sport_program_id, provider_id)
  where sport_program_id is not null;

-- ── 6. Roles and capabilities (§3.1–§3.3) ───────────────────────────────────
create table if not exists public.college_roles (
  key   text primary key,
  name  text not null,
  scope text not null check (scope in ('department','team','either','self'))
);
insert into public.college_roles (key, name, scope) values
  ('ad','Athletic Director','department'),
  ('assoc_ad','Associate / Assistant AD','department'),
  ('compliance_officer','Compliance officer','department'),
  ('sid','Sports Information Director','department'),
  ('head_coach','Head coach','team'),
  ('assistant_coach','Assistant coach','team'),
  ('athletic_trainer','Athletic trainer','either'),
  ('team_physician','Team physician','department'),
  ('business_office','Business office','department'),
  ('student_athlete','Student-athlete','self'),
  ('auditor','Read-only auditor','department'),
  ('recruiting_coordinator','Recruiting coordinator','either')
on conflict (key) do nothing;

-- Catalog of capability keys (§3.2). restricted = can never be ADDED to a role
-- by an org override (§3.1). admin_implied = granted by the is_org_admin
-- superuser short-circuit (§3.4); false for restricted keys and medical.clear.
create table if not exists public.college_capabilities (
  key           text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description   text not null,
  restricted    boolean not null default false,
  admin_implied boolean not null default true,
  constraint cc_restricted_not_admin check (not (restricted and admin_implied))
);
insert into public.college_capabilities (key, description, restricted, admin_implied) values
  ('roster.read','See athletes and memberships on a team',false,true),
  ('roster.write','Add, remove, edit memberships, jersey numbers, bios',false,true),
  ('academics.read','See term records (credits, GPA, PTD)',false,true),
  ('academics.write','Manual entry and SIS import apply',false,true),
  ('eligibility.read','See computed and certified status with reasons',false,true),
  ('eligibility.status_only','See only eligible / not eligible, no reasons',false,true),
  ('eligibility.certify','Certify or decertify',true,false),
  ('eligibility.rules','Edit and verify compliance_rules',false,true),
  ('clearance.read','See current clearance status (no diagnosis)',false,true),
  ('medical.read','Read injury, treatment, screening detail',true,false),
  ('medical.write','Create and edit medical records',true,false),
  ('medical.clear','Issue a clearance',false,false),
  ('medical.break_glass','Time-boxed emergency read with reason',true,false),
  ('lineup.submit','Build and submit a game roster',false,true),
  ('lineup.override','Grant a Roster Lock override',true,false),
  ('schedule.write','Create and edit events for the team',false,true),
  ('facility.request','Request a venue booking',false,true),
  ('facility.approve','Confirm, bump or deny bookings',false,true),
  ('stats.import','Upload stat files and reconcile',false,true),
  ('stats.publish','Publish results, stats, media releases to feeds',false,true),
  ('travel.plan','Create trips, rooming lists',false,true),
  ('travel.approve','Approve trips',false,true),
  ('budget.read','See budget lines and actuals',false,true),
  ('budget.write','Edit budget lines, enter actuals',false,true),
  ('budget.approve','Approve expenses and budget changes',false,true),
  ('cara.log','Enter CARA hours',false,true),
  ('export.ncaa','Run compliance exports',false,true),
  ('audit.read','Read audit_log and data_access_log',false,true),
  ('admin.users','Assign roles, manage SSO mappings',false,true),
  ('agent.review','Approve agent drafts in the inbox for their scope',false,true)
on conflict (key) do nothing;

create table if not exists public.role_capabilities (
  role_key   text not null references public.college_roles(key) on delete cascade,
  capability text not null references public.college_capabilities(key) on delete cascade,
  primary key (role_key, capability)
);
create index if not exists role_capabilities_capability_idx on public.role_capabilities (capability);

-- §3.3 default matrix. D vs T is carried by the ASSIGNMENT's scope, not here.
-- student_athlete gets no rows: "S" access is is_self_athlete(), never a role.
-- recruiting_coordinator's recruit.* capabilities ship with Source R1 (E9).
insert into public.role_capabilities (role_key, capability)
select r.role_key, m.capability
from (values
  ('roster.read',            array['ad','assoc_ad','compliance_officer','sid','head_coach','assistant_coach','athletic_trainer','team_physician','business_office','auditor']),
  ('roster.write',           array['ad','assoc_ad','sid','head_coach']),
  ('academics.read',         array['ad','assoc_ad','compliance_officer','auditor']),
  ('academics.write',        array['compliance_officer']),
  ('eligibility.read',       array['ad','assoc_ad','compliance_officer','auditor']),
  ('eligibility.status_only',array['sid','head_coach','assistant_coach','athletic_trainer']),
  ('eligibility.certify',    array['compliance_officer']),
  ('eligibility.rules',      array['compliance_officer']),
  ('clearance.read',         array['ad','assoc_ad','compliance_officer','head_coach','assistant_coach','athletic_trainer','team_physician','auditor']),
  ('medical.read',           array['athletic_trainer','team_physician']),
  ('medical.write',          array['athletic_trainer','team_physician']),
  ('medical.clear',          array['athletic_trainer','team_physician']),
  ('medical.break_glass',    array['compliance_officer']),
  ('lineup.submit',          array['head_coach','assistant_coach']),
  ('lineup.override',        array['compliance_officer']),
  ('schedule.write',         array['ad','assoc_ad','sid','head_coach','assistant_coach']),
  ('facility.request',       array['ad','assoc_ad','sid','head_coach','assistant_coach','athletic_trainer']),
  ('facility.approve',       array['ad','assoc_ad']),
  ('stats.import',           array['sid','head_coach']),
  ('stats.publish',          array['sid']),
  ('travel.plan',            array['ad','assoc_ad','head_coach','assistant_coach','business_office']),
  ('travel.approve',         array['ad','assoc_ad','business_office']),
  ('budget.read',            array['ad','assoc_ad','head_coach','business_office','auditor']),
  ('budget.write',           array['business_office']),
  ('budget.approve',         array['ad','business_office']),
  ('cara.log',               array['compliance_officer','head_coach','assistant_coach']),
  ('export.ncaa',            array['ad','compliance_officer']),
  ('audit.read',             array['ad','compliance_officer','auditor']),
  ('admin.users',            array['ad']),
  ('agent.review',           array['ad','assoc_ad','compliance_officer','sid','head_coach','assistant_coach','athletic_trainer','business_office'])
) as m(capability, roles)
cross join lateral unnest(m.roles) as r(role_key)
on conflict do nothing;

create table if not exists public.org_role_capability_overrides (
  provider_id uuid not null references public.providers(id) on delete cascade,
  role_key    text not null references public.college_roles(key) on delete cascade,
  capability  text not null references public.college_capabilities(key) on delete cascade,
  granted     boolean not null,
  changed_by  uuid references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now(),
  primary key (provider_id, role_key, capability)
);
create index if not exists orco_role_key_idx   on public.org_role_capability_overrides (role_key);
create index if not exists orco_capability_idx on public.org_role_capability_overrides (capability);
create index if not exists orco_changed_by_idx on public.org_role_capability_overrides (changed_by) where changed_by is not null;

-- §3.1: restricted capabilities can never be ADDED to a role that lacks them
-- by default. Removing them is allowed. Self roles cannot be overridden.
create or replace function public.p1_capability_override_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.college_roles r where r.key = new.role_key and r.scope = 'self') then
    raise exception 'role % is derived, not assignable; it cannot be overridden', new.role_key using errcode = '42501';
  end if;
  if new.granted
     and exists (select 1 from public.college_capabilities c where c.key = new.capability and c.restricted)
     and not exists (select 1 from public.role_capabilities rc where rc.role_key = new.role_key and rc.capability = new.capability) then
    raise exception 'RESTRICTED_CAPABILITY: % cannot be added to role %', new.capability, new.role_key using errcode = '42501';
  end if;
  new.changed_by := coalesce(auth.uid(), new.changed_by);
  new.changed_at := now();
  return new;
end $$;
revoke all on function public.p1_capability_override_guard() from public, anon, authenticated;
drop trigger if exists p1_capability_override_guard on public.org_role_capability_overrides;
create trigger p1_capability_override_guard before insert or update on public.org_role_capability_overrides
  for each row execute function public.p1_capability_override_guard();

-- ── 7. Role assignments (§2.6) ──────────────────────────────────────────────
create table if not exists public.role_assignments (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  member_id        uuid not null,
  role_key         text not null references public.college_roles(key),
  team_id          uuid,                 -- null = not team-scoped
  sport_program_id uuid,                 -- program-wide (all seasons)
  title            text check (title is null or length(title) <= 120),
  starts_on        date not null default current_date,
  ends_on          date,
  granted_by       uuid references auth.users(id) on delete set null,
  source           text not null default 'manual' check (source in ('manual','sso_group','import')),
  created_at       timestamptz not null default now(),
  constraint ra_scope check (not (team_id is not null and sport_program_id is not null)),
  constraint ra_dates check (ends_on is null or ends_on >= starts_on),
  constraint ra_member_fkey  foreign key (member_id, provider_id)
    references public.organization_members (id, organization_id) on delete cascade,
  constraint ra_team_fkey    foreign key (team_id, provider_id)
    references public.teams (id, provider_id) on delete cascade,
  constraint ra_program_fkey foreign key (sport_program_id, provider_id)
    references public.sport_programs (id, provider_id) on delete cascade
);
create unique index if not exists ra_uq on public.role_assignments
  (member_id, role_key,
   coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(sport_program_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- Full (not partial) index: the helpers' date predicate does not imply
-- `ends_on is null`, so a partial index would never be chosen.
create index if not exists ra_member_idx      on public.role_assignments (member_id);
create index if not exists ra_provider_idx    on public.role_assignments (provider_id);
create index if not exists ra_team_idx        on public.role_assignments (team_id) where team_id is not null;
create index if not exists ra_program_idx     on public.role_assignments (sport_program_id) where sport_program_id is not null;
create index if not exists ra_role_key_idx    on public.role_assignments (role_key);
create index if not exists ra_granted_by_idx  on public.role_assignments (granted_by) where granted_by is not null;

-- Scope guard (§2.6, §3.1): department roles cannot be team-scoped
-- (spec test 1.6), team roles must be, self roles are never assigned, auditors
-- are time-boxed. granted_by is stamped from the caller.
create or replace function public.p1_role_assignment_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_scope text;
begin
  select r.scope into v_scope from public.college_roles r where r.key = new.role_key;
  if v_scope = 'self' then
    raise exception 'ROLE_SCOPE: % is derived from the student record and cannot be assigned', new.role_key using errcode = '23514';
  elsif v_scope = 'department' and (new.team_id is not null or new.sport_program_id is not null) then
    raise exception 'ROLE_SCOPE: % is department-wide and cannot be assigned to a team or program', new.role_key using errcode = '23514';
  elsif v_scope = 'team' and new.team_id is null and new.sport_program_id is null then
    raise exception 'ROLE_SCOPE: % must be assigned to a team or a sport program', new.role_key using errcode = '23514';
  end if;
  if new.role_key = 'auditor' and new.ends_on is null then
    raise exception 'ROLE_SCOPE: auditor assignments must have ends_on' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.granted_by := coalesce(auth.uid(), new.granted_by);
  else
    new.granted_by := old.granted_by;           -- provenance is immutable
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function public.p1_role_assignment_guard() from public, anon, authenticated;
drop trigger if exists p1_role_assignment_guard on public.role_assignments;
create trigger p1_role_assignment_guard before insert or update on public.role_assignments
  for each row execute function public.p1_role_assignment_guard();

-- ── 8. Student-athletes and memberships (§2.7) ──────────────────────────────
create table if not exists public.student_athletes (
  id                        uuid primary key default gen_random_uuid(),
  provider_id               uuid not null references public.providers(id) on delete cascade,
  user_id                   uuid unique references auth.users(id) on delete set null,
  institution_student_id    text not null,
  legal_first_name          text not null,
  legal_last_name           text not null,
  preferred_name            text,
  email                     text,
  date_of_birth             date,
  class_year                text check (class_year is null or class_year in ('FR','SO','JR','SR','GR','5th')),
  hometown                  text,
  high_school               text,
  previous_school           text,
  major                     text,
  headshot_path             text,
  bio_md                    text,
  directory_opt_out         boolean not null default false,
  directory_opt_out_fields  text[] not null default '{}',
  ncaa_id                   text,
  initial_full_time_term_id uuid,           -- FK added in Phase 2 with academic_terms
  status                    text not null default 'active'
                              check (status in ('active','inactive','graduated','transferred_out','withdrawn')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint student_athletes_provider_sid_key unique (provider_id, institution_student_id),
  constraint student_athletes_id_provider_key  unique (id, provider_id)
);
create index if not exists sa_provider_name_idx on public.student_athletes (provider_id, legal_last_name, legal_first_name);

drop trigger if exists p1_student_athletes_touch on public.student_athletes;
create trigger p1_student_athletes_touch before update on public.student_athletes
  for each row execute function public.tg_touch_updated_at();

create table if not exists public.athlete_team_memberships (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null,
  team_id            uuid not null,
  jersey_number      text check (jersey_number is null or jersey_number ~ '^[0-9]{1,3}$'),
  position           text,
  roster_status      text not null default 'active'
                       check (roster_status in ('prospect','active','redshirt','medical_hardship','injured_reserve','departed')),
  is_public          boolean not null default false,
  scholarship_flag   boolean not null default false,
  joined_on          date not null default current_date,
  left_on            date,
  created_at         timestamptz not null default now(),
  constraint atm_team_athlete_key unique (team_id, student_athlete_id),
  constraint atm_dates check (left_on is null or left_on >= joined_on),
  constraint atm_athlete_fkey foreign key (student_athlete_id, provider_id)
    references public.student_athletes (id, provider_id) on delete cascade,
  constraint atm_team_fkey foreign key (team_id, provider_id)
    references public.teams (id, provider_id) on delete cascade
);
create unique index if not exists atm_jersey_uq on public.athlete_team_memberships (team_id, jersey_number)
  where jersey_number is not null and roster_status <> 'departed';
create index if not exists atm_athlete_idx  on public.athlete_team_memberships (student_athlete_id, provider_id);
create index if not exists atm_provider_idx on public.athlete_team_memberships (provider_id);

-- D3 prohibits athletically related aid (VERIFY rule text, §2.7).
create or replace function public.p1_d3_aid_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.scholarship_flag
     and exists (select 1 from public.providers p where p.id = new.provider_id and p.ncaa_division = 'D3') then
    raise exception 'D3_NO_ATHLETIC_AID: a Division III membership cannot carry athletic aid' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.p1_d3_aid_guard() from public, anon, authenticated;
drop trigger if exists p1_d3_aid_guard on public.athlete_team_memberships;
create trigger p1_d3_aid_guard before insert or update of scholarship_flag, provider_id on public.athlete_team_memberships
  for each row execute function public.p1_d3_aid_guard();

-- ── 9. Helpers (§3.4) — SECURITY DEFINER, search_path '', STABLE ───────────
-- All read only the CALLER's own memberships/assignments (auth.uid()); none
-- returns rows, only booleans, so none can leak another org's data.

-- internal: effective capability of a role in an org = override if present,
-- else the default matrix. NOT granted to clients (would expose org config).
create or replace function public.role_capability_effective(p_org uuid, p_role text, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select o.granted from public.org_role_capability_overrides o
      where o.provider_id = p_org and o.role_key = p_role and o.capability = p_cap),
    exists (select 1 from public.role_capabilities rc where rc.role_key = p_role and rc.capability = p_cap));
$$;

create or replace function public.college_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = (select auth.uid()))
      or exists (select 1 from public.organization_members m
                  where m.organization_id = p_org and m.member_user_id = (select auth.uid()) and m.is_active);
$$;

create or replace function public.has_org_capability(p_org uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(
       exists (
         select 1
           from public.organization_members m
           join public.role_assignments ra on ra.member_id = m.id and ra.provider_id = m.organization_id
          where m.organization_id = p_org
            and m.member_user_id = (select auth.uid())
            and m.is_active
            and ra.team_id is null and ra.sport_program_id is null           -- department-wide only
            and ra.starts_on <= current_date
            and (ra.ends_on is null or ra.ends_on >= current_date)
            and public.role_capability_effective(p_org, ra.role_key, p_cap))
    or (public.is_org_admin(p_org)
        and exists (select 1 from public.college_capabilities c where c.key = p_cap and c.admin_implied)),
    false);
$$;

-- Row-based form used by policies on `teams` itself: it takes the team row's
-- own columns, so it also works for INSERT … RETURNING (where a lookup of the
-- new row by id would not yet see it).
create or replace function public.team_access_check(p_org uuid, p_program uuid, p_team uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(
       exists (
         select 1
           from public.organization_members m
           join public.role_assignments ra on ra.member_id = m.id and ra.provider_id = m.organization_id
          where m.organization_id = p_org
            and m.member_user_id = (select auth.uid())
            and m.is_active
            and (   (ra.team_id is not null and ra.team_id = p_team)
                 or (ra.sport_program_id is not null and ra.sport_program_id = p_program)
                 or (ra.team_id is null and ra.sport_program_id is null))     -- department-wide
            and ra.starts_on <= current_date
            and (ra.ends_on is null or ra.ends_on >= current_date)
            and public.role_capability_effective(p_org, ra.role_key, p_cap))
    or (public.is_org_admin(p_org)
        and exists (select 1 from public.college_capabilities c where c.key = p_cap and c.admin_implied)),
    false);
$$;

create or replace function public.has_team_access(p_team uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select public.team_access_check(t.provider_id, t.sport_program_id, t.id, p_cap)
       from public.teams t where t.id = p_team),
    false);
$$;

create or replace function public.is_self_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.student_athletes s
                  where s.id = p_athlete and s.user_id = (select auth.uid()));
$$;

create or replace function public.has_athlete_access(p_athlete uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.student_athletes s
                  where s.id = p_athlete and public.has_org_capability(s.provider_id, p_cap))
      or exists (select 1 from public.athlete_team_memberships atm
                  where atm.student_athlete_id = p_athlete and atm.roster_status <> 'departed'
                    and public.has_team_access(atm.team_id, p_cap));
$$;

-- membership-only half of has_athlete_access, for the student_athletes SELECT
-- policy (the org half is evaluated on the row's own provider_id there).
create or replace function public.has_athlete_team_access(p_athlete uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.athlete_team_memberships atm
                  where atm.student_athlete_id = p_athlete and atm.roster_status <> 'departed'
                    and public.has_team_access(atm.team_id, p_cap));
$$;

create or replace function public.is_my_member(p_member uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.organization_members m
                  where m.id = p_member and m.member_user_id = (select auth.uid()) and m.is_active);
$$;

-- Opt-in team scoping for EXISTING team-level tables. plpgsql so the cheap
-- `team_scoping = false` exit is guaranteed to run first.
create or replace function public.team_scope_allows_row(p_org uuid, p_program uuid, p_team uuid)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare v_scoped boolean;
begin
  if p_team is null or p_org is null then return true; end if;
  select p.team_scoping into v_scoped from public.providers p where p.id = p_org;
  if not coalesce(v_scoped, false) then return true; end if;            -- every existing org
  if public.is_org_admin(p_org) then return true; end if;              -- owner / admin
  if not exists (select 1 from public.organization_members m
                  where m.organization_id = p_org and m.member_user_id = auth.uid() and m.is_active) then
    return true;                                                       -- not staff of this org: existing policies decide
  end if;
  return public.team_access_check(p_org, p_program, p_team, 'roster.read');
end $$;

create or replace function public.team_scope_allows(p_team uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select public.team_scope_allows_row(t.provider_id, t.sport_program_id, t.id)
                     from public.teams t where t.id = p_team), true);
$$;

create or replace function public.team_scope_allows_event(p_event uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select public.team_scope_allows(e.team_id) from public.event e where e.id = p_event), true);
$$;

revoke all on function
  public.role_capability_effective(uuid,text,text),
  public.college_org_member(uuid),
  public.has_org_capability(uuid,text),
  public.team_access_check(uuid,uuid,uuid,text),
  public.has_team_access(uuid,text),
  public.is_self_athlete(uuid),
  public.has_athlete_access(uuid,text),
  public.has_athlete_team_access(uuid,text),
  public.is_my_member(uuid),
  public.team_scope_allows_row(uuid,uuid,uuid),
  public.team_scope_allows(uuid),
  public.team_scope_allows_event(uuid)
from public, anon;
revoke all on function public.role_capability_effective(uuid,text,text) from authenticated;
grant execute on function
  public.college_org_member(uuid),
  public.has_org_capability(uuid,text),
  public.team_access_check(uuid,uuid,uuid,text),
  public.has_team_access(uuid,text),
  public.is_self_athlete(uuid),
  public.has_athlete_access(uuid,text),
  public.has_athlete_team_access(uuid,text),
  public.is_my_member(uuid),
  public.team_scope_allows_row(uuid,uuid,uuid),
  public.team_scope_allows(uuid),
  public.team_scope_allows_event(uuid)
to authenticated, service_role;
grant execute on function public.role_capability_effective(uuid,text,text) to service_role;

-- ── 10. audit_log (§2.14, §10.1) ────────────────────────────────────────────
create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  provider_id   uuid not null,                       -- no FK: the record outlives the org row
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,
  actor_kind    text not null check (actor_kind in ('user','system','agent','sso_jit','import')),
  action        text not null,
  table_name    text not null,
  row_id        text not null,
  before_sha256 text,
  after_sha256  text,
  diff          jsonb,
  request_id    text,
  prev_hash     text,
  row_hash      text not null
);
create index if not exists audit_provider_time_idx on public.audit_log (provider_id, occurred_at desc);
create index if not exists audit_provider_id_idx   on public.audit_log (provider_id, id desc);   -- chain tip lookup

create or replace function public.audit_log_append_only() returns trigger
language plpgsql set search_path to '' as $$
begin
  raise exception 'audit_log is append-only' using errcode = '55000';
end $$;
revoke all on function public.audit_log_append_only() from public, anon, authenticated;
drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

-- Generic row audit. TG_ARGV[0] = 'college_only' skips rows whose
-- sport_program_id is null in both images (club teams/seasons are not audited,
-- so club writes are unchanged). Sensitive columns appear only inside the
-- before/after hashes, never in diff. Hash chain per org, serialised by an
-- advisory lock so two concurrent writers cannot fork the chain.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_new      jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_old      jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_row      jsonb;
  v_provider uuid;
  v_sensitive text[] := array['date_of_birth','email','institution_student_id','ncaa_id','verification_token'];
  v_diff     jsonb;
  v_prev     text;
  v_actor    uuid := auth.uid();
  v_kind     text;
  v_action   text;
  v_now      timestamptz := now();
  v_hash     text;
begin
  v_row := coalesce(v_new, v_old);
  if tg_nargs > 0 and tg_argv[0] = 'college_only'
     and (v_new->>'sport_program_id') is null and (v_old->>'sport_program_id') is null then
    return null;
  end if;
  v_provider := (v_row->>'provider_id')::uuid;
  if v_provider is null then return null; end if;

  select coalesce(jsonb_object_agg(k.key,
           case when k.key = any(v_sensitive) then to_jsonb('[redacted]'::text)
                else coalesce(v_new->k.key, v_old->k.key) end), '{}'::jsonb)
    into v_diff
    from jsonb_object_keys(v_row) as k(key)
   where v_old is null or v_new is null or (v_new->k.key) is distinct from (v_old->k.key);
  if tg_op = 'UPDATE' and v_diff = '{}'::jsonb then return null; end if;   -- no-op update

  v_kind := case when v_actor is not null then 'user'
                 else coalesce(nullif(current_setting('sporv.actor_kind', true), ''), 'system') end;
  if v_kind not in ('user','system','agent','sso_jit','import') then v_kind := 'system'; end if;
  v_action := coalesce(nullif(current_setting('sporv.audit_action', true), ''),
                       tg_table_name || '.' || lower(tg_op));

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sporv.audit:' || v_provider::text, 0));
  select a.row_hash into v_prev from public.audit_log a
   where a.provider_id = v_provider order by a.id desc limit 1;

  v_hash := encode(sha256(convert_to(coalesce(v_prev, '') || '|' || jsonb_build_object(
              'provider_id', v_provider,
              'occurred_at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
              'actor_id', v_actor, 'actor_kind', v_kind, 'action', v_action,
              'table_name', tg_table_name, 'row_id', v_row->>'id',
              'before', case when v_old is not null then encode(sha256(convert_to(v_old::text, 'UTF8')), 'hex') end,
              'after',  case when v_new is not null then encode(sha256(convert_to(v_new::text, 'UTF8')), 'hex') end,
              'diff', v_diff)::text, 'UTF8')), 'hex');

  insert into public.audit_log (provider_id, occurred_at, actor_id, actor_kind, action, table_name, row_id,
                                before_sha256, after_sha256, diff, request_id, prev_hash, row_hash)
  values (v_provider, v_now, v_actor, v_kind, v_action, tg_table_name, coalesce(v_row->>'id', ''),
          case when v_old is not null then encode(sha256(convert_to(v_old::text, 'UTF8')), 'hex') end,
          case when v_new is not null then encode(sha256(convert_to(v_new::text, 'UTF8')), 'hex') end,
          v_diff, nullif(current_setting('sporv.request_id', true), ''), v_prev, v_hash);
  return null;
end $$;
revoke all on function public.audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['org_verified_domains','sport_programs','org_role_capability_overrides',
                           'role_assignments','student_athletes','athlete_team_memberships'] loop
    execute format('drop trigger if exists p1_audit on public.%I', t);
    execute format('create trigger p1_audit after insert or update or delete on public.%I
                      for each row execute function public.audit_row()', t);
  end loop;
  foreach t in array array['teams','seasons'] loop
    execute format('drop trigger if exists p1_audit on public.%I', t);
    execute format('create trigger p1_audit after insert or update or delete on public.%I
                      for each row execute function public.audit_row(%L)', t, 'college_only');
  end loop;
end $$;

-- ── 11. team_staff view (§2.6) ──────────────────────────────────────────────
create or replace view public.team_staff with (security_invoker = true) as
  select id, provider_id, member_id, role_key, team_id, sport_program_id, title, starts_on, ends_on
    from public.role_assignments
   where team_id is not null or sport_program_id is not null;

-- ── 12. RLS on every new table (§2.2, §3.5) ─────────────────────────────────
alter table public.org_verified_domains          enable row level security;
alter table public.sports                        enable row level security;
alter table public.sport_programs                enable row level security;
alter table public.college_roles                 enable row level security;
alter table public.college_capabilities          enable row level security;
alter table public.role_capabilities             enable row level security;
alter table public.org_role_capability_overrides enable row level security;
alter table public.role_assignments              enable row level security;
alter table public.student_athletes              enable row level security;
alter table public.athlete_team_memberships      enable row level security;
alter table public.audit_log                     enable row level security;

-- Supabase default privileges hand anon/authenticated ALL on new tables;
-- strip them, then grant back exactly what each policy set needs.
revoke all on public.org_verified_domains, public.sports, public.sport_programs, public.college_roles,
              public.college_capabilities, public.role_capabilities, public.org_role_capability_overrides,
              public.role_assignments, public.student_athletes, public.athlete_team_memberships,
              public.audit_log, public.team_staff
  from public, anon, authenticated;
grant all on public.org_verified_domains, public.sports, public.sport_programs, public.college_roles,
             public.college_capabilities, public.role_capabilities, public.org_role_capability_overrides,
             public.role_assignments, public.student_athletes, public.athlete_team_memberships,
             public.team_staff
  to service_role;
grant select, insert on public.audit_log to service_role;     -- never update/delete/truncate, even service role

-- global catalogs: read-only to signed-in users, written only by migrations
grant select on public.sports, public.college_roles, public.college_capabilities, public.role_capabilities to authenticated;
drop policy if exists sports_read on public.sports;
create policy sports_read on public.sports for select to authenticated using (true);
drop policy if exists college_roles_read on public.college_roles;
create policy college_roles_read on public.college_roles for select to authenticated using (true);
drop policy if exists college_capabilities_read on public.college_capabilities;
create policy college_capabilities_read on public.college_capabilities for select to authenticated using (true);
drop policy if exists role_capabilities_read on public.role_capabilities;
create policy role_capabilities_read on public.role_capabilities for select to authenticated using (true);

-- org_verified_domains: admin.users manages; verification is service-role only
grant select on public.org_verified_domains to authenticated;
grant insert (provider_id, domain) on public.org_verified_domains to authenticated;
grant delete on public.org_verified_domains to authenticated;
drop policy if exists ovd_select on public.org_verified_domains;
create policy ovd_select on public.org_verified_domains for select to authenticated
  using (public.has_org_capability(provider_id, 'admin.users'));
drop policy if exists ovd_insert on public.org_verified_domains;
create policy ovd_insert on public.org_verified_domains for insert to authenticated
  with check (public.has_org_capability(provider_id, 'admin.users') and verified_at is null and not auto_join);
drop policy if exists ovd_delete on public.org_verified_domains;
create policy ovd_delete on public.org_verified_domains for delete to authenticated
  using (public.has_org_capability(provider_id, 'admin.users'));

-- sport_programs: any member of the org reads; admin.users writes
grant select, insert, update, delete on public.sport_programs to authenticated;
drop policy if exists sport_programs_select on public.sport_programs;
create policy sport_programs_select on public.sport_programs for select to authenticated
  using (public.college_org_member(provider_id));
drop policy if exists sport_programs_insert on public.sport_programs;
create policy sport_programs_insert on public.sport_programs for insert to authenticated
  with check (public.has_org_capability(provider_id, 'admin.users'));
drop policy if exists sport_programs_update on public.sport_programs;
create policy sport_programs_update on public.sport_programs for update to authenticated
  using (public.has_org_capability(provider_id, 'admin.users'))
  with check (public.has_org_capability(provider_id, 'admin.users'));
drop policy if exists sport_programs_delete on public.sport_programs;
create policy sport_programs_delete on public.sport_programs for delete to authenticated
  using (public.has_org_capability(provider_id, 'admin.users'));

-- org_role_capability_overrides: admin.users only
grant select, insert, update, delete on public.org_role_capability_overrides to authenticated;
drop policy if exists orco_all on public.org_role_capability_overrides;
create policy orco_all on public.org_role_capability_overrides for all to authenticated
  using (public.has_org_capability(provider_id, 'admin.users'))
  with check (public.has_org_capability(provider_id, 'admin.users'));

-- role_assignments: own rows, or admin.users (§3.5)
grant select, insert, delete on public.role_assignments to authenticated;
grant update (title, starts_on, ends_on) on public.role_assignments to authenticated;
drop policy if exists ra_select on public.role_assignments;
create policy ra_select on public.role_assignments for select to authenticated
  using (public.is_my_member(member_id) or public.has_org_capability(provider_id, 'admin.users'));
drop policy if exists ra_insert on public.role_assignments;
create policy ra_insert on public.role_assignments for insert to authenticated
  with check (public.has_org_capability(provider_id, 'admin.users'));
drop policy if exists ra_update on public.role_assignments;
create policy ra_update on public.role_assignments for update to authenticated
  using (public.has_org_capability(provider_id, 'admin.users'))
  with check (public.has_org_capability(provider_id, 'admin.users'));
drop policy if exists ra_delete on public.role_assignments;
create policy ra_delete on public.role_assignments for delete to authenticated
  using (public.has_org_capability(provider_id, 'admin.users'));
grant select on public.team_staff to authenticated;         -- security_invoker: ra_* policies apply

-- student_athletes: date_of_birth and user_id are NOT granted (deviation f)
grant select (id, provider_id, user_id, institution_student_id, legal_first_name, legal_last_name, preferred_name,
              email, class_year, hometown, high_school, previous_school, major, headshot_path, bio_md,
              directory_opt_out, directory_opt_out_fields, ncaa_id, initial_full_time_term_id, status,
              created_at, updated_at)
  on public.student_athletes to authenticated;
grant insert (id, provider_id, institution_student_id, legal_first_name, legal_last_name, preferred_name, email,
              class_year, hometown, high_school, previous_school, major, headshot_path, bio_md,
              directory_opt_out, directory_opt_out_fields, ncaa_id, status)
  on public.student_athletes to authenticated;
grant update (institution_student_id, legal_first_name, legal_last_name, preferred_name, email, class_year,
              hometown, high_school, previous_school, major, headshot_path, bio_md, directory_opt_out,
              directory_opt_out_fields, ncaa_id, status)
  on public.student_athletes to authenticated;
drop policy if exists sa_select on public.student_athletes;
create policy sa_select on public.student_athletes for select to authenticated
  using (user_id = (select auth.uid())
         or public.has_org_capability(provider_id, 'roster.read')
         or public.has_athlete_team_access(id, 'roster.read'));
drop policy if exists sa_insert on public.student_athletes;
create policy sa_insert on public.student_athletes for insert to authenticated
  with check (public.has_org_capability(provider_id, 'roster.write'));
drop policy if exists sa_update on public.student_athletes;
create policy sa_update on public.student_athletes for update to authenticated
  using (public.has_org_capability(provider_id, 'roster.write'))
  with check (public.has_org_capability(provider_id, 'roster.write'));
-- no DELETE policy: departures are status = 'inactive' (§3.5)

-- athlete_team_memberships: team-scoped (§3.5)
grant select, insert, delete on public.athlete_team_memberships to authenticated;
grant update (team_id, jersey_number, position, roster_status, is_public, scholarship_flag, joined_on, left_on)
  on public.athlete_team_memberships to authenticated;
drop policy if exists atm_select on public.athlete_team_memberships;
create policy atm_select on public.athlete_team_memberships for select to authenticated
  using (public.has_team_access(team_id, 'roster.read') or public.is_self_athlete(student_athlete_id));
drop policy if exists atm_insert on public.athlete_team_memberships;
create policy atm_insert on public.athlete_team_memberships for insert to authenticated
  with check (public.has_team_access(team_id, 'roster.write'));
drop policy if exists atm_update on public.athlete_team_memberships;
create policy atm_update on public.athlete_team_memberships for update to authenticated
  using (public.has_team_access(team_id, 'roster.write'))
  with check (public.has_team_access(team_id, 'roster.write'));
drop policy if exists atm_delete on public.athlete_team_memberships;
create policy atm_delete on public.athlete_team_memberships for delete to authenticated
  using (public.has_team_access(team_id, 'roster.write'));

-- audit_log: audit.read only; writes only through audit_row()
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.has_org_capability(provider_id, 'audit.read'));

-- ── 13. Policies on EXISTING tables — college rows only, additive ───────────
-- teams (§3.5 row "teams (college rows)"). Club rows: sport_program_id is null
-- → every predicate below is false → these policies grant nothing.
drop policy if exists teams_p1_college_select on public.teams;
create policy teams_p1_college_select on public.teams for select to authenticated
  using (sport_program_id is not null
         and public.team_access_check(provider_id, sport_program_id, id, 'roster.read'));
drop policy if exists teams_p1_college_insert on public.teams;
create policy teams_p1_college_insert on public.teams for insert to authenticated
  with check (sport_program_id is not null and public.has_org_capability(provider_id, 'admin.users'));
drop policy if exists teams_p1_college_update on public.teams;
create policy teams_p1_college_update on public.teams for update to authenticated
  using (sport_program_id is not null and public.has_org_capability(provider_id, 'roster.write'))
  with check (sport_program_id is not null and public.has_org_capability(provider_id, 'roster.write'));
drop policy if exists teams_p1_college_delete on public.teams;
create policy teams_p1_college_delete on public.teams for delete to authenticated
  using (sport_program_id is not null and public.has_org_capability(provider_id, 'admin.users'));

-- seasons of a sport program: members read, admin.users writes
drop policy if exists seasons_p1_college_select on public.seasons;
create policy seasons_p1_college_select on public.seasons for select to authenticated
  using (sport_program_id is not null and public.college_org_member(provider_id));
drop policy if exists seasons_p1_college_write on public.seasons;
create policy seasons_p1_college_write on public.seasons for all to authenticated
  using (sport_program_id is not null and public.has_org_capability(provider_id, 'admin.users'))
  with check (sport_program_id is not null and public.has_org_capability(provider_id, 'admin.users'));

-- Opt-in team scoping: RESTRICTIVE, SELECT only, true for every org whose
-- providers.team_scoping is false (all existing orgs). Guarded per table so a
-- table whose migration never reached this project is skipped, not created.
drop policy if exists teams_p1_team_scope on public.teams;
create policy teams_p1_team_scope on public.teams as restrictive for select to authenticated
  using (public.team_scope_allows_row(provider_id, sport_program_id, id));
drop policy if exists team_athletes_p1_team_scope on public.team_athletes;
create policy team_athletes_p1_team_scope on public.team_athletes as restrictive for select to authenticated
  using (public.team_scope_allows(team_id));
do $$
begin
  if to_regclass('public.event') is not null then
    execute 'drop policy if exists event_p1_team_scope on public.event';
    execute 'create policy event_p1_team_scope on public.event as restrictive for select to authenticated
               using (public.team_scope_allows(team_id))';
  end if;
  if to_regclass('public.attendance_record') is not null then
    execute 'drop policy if exists attendance_record_p1_team_scope on public.attendance_record';
    execute 'create policy attendance_record_p1_team_scope on public.attendance_record as restrictive for select to authenticated
               using (public.team_scope_allows_event(event_id))';
  end if;
  if to_regclass('public.event_response') is not null then
    execute 'drop policy if exists event_response_p1_team_scope on public.event_response';
    execute 'create policy event_response_p1_team_scope on public.event_response as restrictive for select to authenticated
               using (public.team_scope_allows_event(event_id))';
  end if;
end $$;

-- ── 14. Post-flight: I6 for everything this file created ───────────────────
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
     and c.relname in ('org_verified_domains','sports','sport_programs','college_roles','college_capabilities',
                       'role_capabilities','org_role_capability_overrides','role_assignments',
                       'student_athletes','athlete_team_memberships','audit_log');
  if v_missing is not null then
    raise exception 'P1 post-flight: RLS not enabled on %', v_missing;
  end if;
end $$;

commit;
