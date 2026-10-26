-- ============================================================================
-- RED DRAFT — Source R1 (recruiting core). NEVER applied by an agent.
-- Spec: docs/specs/31-COLLEGE-ATHLETICS.md Part II (Module E), E3.1-E3.5,
-- E3.7, E4, E8; acceptance tests §14 Phase R1.
-- Fixture: docs/red-drafts/2026-10-22-recruiting-r1.test.sql
--     bash tools/run-sql-fixtures.sh 2026-10-22-recruiting-r1
--
-- WHAT THIS IS
--   The smallest schema a coach can run a recruit board on: who the recruit
--   is (recruits), their interest per sport (recruit_pipelines), where they
--   sit on the board (stage + append-only recruit_stage_history), how staff
--   scored them (recruit_evaluations), every touch (recruit_contacts), the
--   minor's guardians (recruit_guardians, compartmented), and how many the
--   program needs per position per entry year (recruiting_targets).
--
-- WHERE IT DEPARTS FROM THE SPEC, AND WHY (CLAUDE.md rule 9)
--   1. Spec Phase 1 (sport_programs, role_assignments, has_program_access,
--      student_athletes, audit_log) is NOT in the repo or production. So:
--        - pipelines are keyed by (recruit, sport text) and an optional
--          team_id, not sport_program_id. Phase 1 adds sport_program_id and
--          backfills it from team_id/sport; the unique key moves then.
--        - access is "active member of the owning org" (is_org_member from
--          migration 20260915_001075), not per-program capabilities.
--          Acceptance tests R1.1/R1.2 (program-to-program isolation) are
--          therefore DEFERRED to Phase 1; R1.3 (org-to-org) is proven here.
--        - "recruit.read_sensitive" is approximated by is_org_admin(): org
--          owners/admins read a minor's DOB, email, phone and guardians;
--          coaches (role 'trainer') do not (invariant I7).
--        - recruits.student_athlete_id has no FK yet (table does not exist).
--   2. Stage set follows the spec, not the brief: the brief said "lost"; the
--      spec says 'closed' with a required closed_reason (E3.2), plus
--      'enrolled', which only the R2 conversion RPC may set. The UI labels
--      'closed' as "Closed / lost".
--   3. Contact kinds follow the spec (E3.7) — the brief's call/visit/in_person
--      map to phone / in_person_on_campus / in_person_off_campus.
--      permissible_window_status is 'unchecked' for every row in R1: the
--      window engine (recruiting_periods, compliance_rules, E5 trigger) is
--      R2 and its values must be VERIFIED by a compliance officer first. The
--      UI says so on every logged contact. Nothing here claims a contact
--      was permitted.
--   4. Evaluations use one built-in generic rubric ('generic_v1': five
--      criteria, 1-5, equal weight). Program rubrics (evaluation_rubrics)
--      are R2. overall is computed by the trigger, never sent by the client.
--   5. Offers do not exist yet, so 'offer' and 'signed' have no offer-row
--      precondition in R1 (spec E3.2). R2 adds it with recruit_offers.
--   6. data_access_log is created minimally (if absent) for the sensitive
--      read receipt; spec §10.2 owns its final shape.
--
-- G4 (every write has a precondition, an inverse, a receipt)
--   Stage changes go through move_recruit_stage() only (column UPDATE on
--   stage is revoked): precondition = membership + legal transition,
--   inverse = recruit_stage_history.from_stage, receipt = the history row it
--   returns. A no-op move returns the existing last row and writes nothing.
--
-- PRECONDITIONS (probe production before applying — APPLY-ORDER.md)
--   public.providers, public.organization_members, public.teams,
--   public.is_org_admin(uuid) (baseline), public.is_org_member(uuid)
--   (20260915_001075). This file refuses to run if either helper is missing.
-- ============================================================================

do $$ begin
  if to_regprocedure('public.is_org_admin(uuid)') is null then
    raise exception 'recruiting-r1: public.is_org_admin(uuid) is missing (baseline)';
  end if;
  if to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'recruiting-r1: public.is_org_member(uuid) is missing — apply 20260915_001075_staff_workspace_access first';
  end if;
end $$;

-- ── recruits: identity, one row per person per institution (E3.1) ─────────
create table if not exists public.recruits (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  first_name         text not null check (length(btrim(first_name)) between 1 and 80),
  last_name          text not null check (length(btrim(last_name)) between 1 and 80),
  preferred_name     text,
  prospect_type      text not null default 'high_school'
                       check (prospect_type in ('high_school','juco','transfer_portal','international','post_grad','walk_on')),
  grad_year          smallint check (grad_year between 2000 and 2100),
  expected_entry_term text,
  date_of_birth      date,                                  -- SENSITIVE (column grant withheld)
  is_minor           boolean not null default true,          -- trigger-maintained; unknown DOB = minor
  current_school     text,
  current_school_level text check (current_school_level in ('high_school','juco','four_year','prep','club_only','other')),
  club_team          text,
  city               text,
  state_region       text,
  country            text default 'US',
  email              text,                                  -- SENSITIVE
  phone              text,                                  -- SENSITIVE
  social_handles     jsonb not null default '{}',
  hs_gpa             numeric(4,3) check (hs_gpa is null or hs_gpa between 0 and 5),
  test_scores        jsonb not null default '{}',
  intended_major     text,
  eligibility_center_id text,                               -- VERIFY field name (spec E3.1)
  eligibility_center_status text,
  transcript_received boolean not null default false,
  admissions_status  text check (admissions_status in ('not_applied','applied','admitted','denied','deposited','withdrawn')),
  status             text not null default 'active' check (status in ('active','enrolled','archived','deleted_pending')),
  student_athlete_id uuid unique,                           -- FK added with Phase 1 student_athletes
  retain_until       date,
  dedupe_key         text generated always as
                       (lower(btrim(last_name)) || '|' || lower(btrim(first_name)) || '|' || coalesce(grad_year::text,'')) stored,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, provider_id)
);
create index if not exists recruits_dedupe_idx on public.recruits (provider_id, dedupe_key);
create index if not exists recruits_email_idx  on public.recruits (provider_id, lower(email)) where email is not null;
create index if not exists recruits_grad_idx   on public.recruits (provider_id, grad_year);

-- ── recruit_pipelines: interest per sport, the board row (E3.2) ───────────
create table if not exists public.recruit_pipelines (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  recruit_id         uuid not null,
  team_id            uuid references public.teams(id) on delete set null,   -- optional program scope
  sport              text not null check (length(btrim(sport)) between 1 and 60),
  stage              text not null default 'identified'
                       check (stage in ('identified','evaluated','contacted','visit','offer','committed','signed','enrolled','closed')),
  closed_reason      text check (closed_reason in ('not_a_fit','chose_other_school','academic','no_response','withdrew','admissions_denied','other')),
  position_primary   text,
  positions          text[] not null default '{}',
  metrics            jsonb not null default '{}',
  film_links         text[] not null default '{}' check (array_position(film_links, null) is null),
  priority           smallint check (priority between 1 and 5),
  owner_member_id    uuid references public.organization_members(id) on delete set null,
  target_entry_year  text check (target_entry_year is null or target_entry_year ~ '^[0-9]{4}(-[0-9]{2})?$'),
  recruiting_target_id uuid,
  last_contact_at    timestamptz,
  next_action_on     date,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (recruit_id, provider_id) references public.recruits(id, provider_id) on delete cascade,
  unique (id, provider_id),
  constraint rp_closed_reason check ((stage = 'closed') = (closed_reason is not null))
);
create unique index if not exists rp_recruit_sport_uq on public.recruit_pipelines (recruit_id, lower(btrim(sport)));
create index if not exists rp_board_idx on public.recruit_pipelines (provider_id, stage, priority);
create index if not exists rp_team_idx  on public.recruit_pipelines (team_id) where team_id is not null;

-- film links: https only (spec E3.2 "https only, validated")
create or replace function public.recruit_film_links_ok(p text[]) returns boolean
language sql immutable set search_path to '' as $$
  select coalesce(bool_and(l ~* '^https://[^\s]+$' and length(l) <= 500), true) from unnest(p) l
$$;
alter table public.recruit_pipelines drop constraint if exists rp_film_https;
alter table public.recruit_pipelines add constraint rp_film_https check (public.recruit_film_links_ok(film_links));

-- ── recruit_stage_history: append-only receipt of every stage change ──────
create table if not exists public.recruit_stage_history (
  id                 bigint generated always as identity primary key,
  provider_id        uuid not null references public.providers(id) on delete cascade,
  pipeline_id        uuid not null references public.recruit_pipelines(id) on delete cascade,
  from_stage         text,
  to_stage           text not null,
  actor_id           uuid,
  actor_kind         text not null check (actor_kind in ('user','system','import')),
  note               text,
  occurred_at        timestamptz not null default now()
);
create index if not exists rsh_pipeline_idx on public.recruit_stage_history (pipeline_id, occurred_at desc);

-- ── recruit_guardians: minor contact data, compartmented (E3.1, E8.3) ─────
create table if not exists public.recruit_guardians (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  recruit_id         uuid not null,
  full_name          text not null check (length(btrim(full_name)) between 1 and 120),
  relationship       text,
  email              text,
  phone              text,
  is_primary         boolean not null default false,
  consent_status     text not null default 'not_requested'
                       check (consent_status in ('not_requested','requested','granted','refused','withdrawn')),
  consent_scope      text[] not null default '{}',
  consent_at         timestamptz,
  consent_method     text check (consent_method in ('form_checkbox_email_verified','signed_form','verbal_logged')),
  consent_evidence_ref text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  foreign key (recruit_id, provider_id) references public.recruits(id, provider_id) on delete cascade
);
create unique index if not exists rg_primary_uq on public.recruit_guardians (recruit_id) where is_primary;
create index if not exists rg_recruit_idx on public.recruit_guardians (recruit_id);

-- ── recruit_evaluations: generic rubric in R1 (E3.5) ──────────────────────
create table if not exists public.recruit_evaluations (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  pipeline_id        uuid not null,
  recruit_id         uuid not null,
  rubric_key         text not null default 'generic_v1' check (rubric_key in ('generic_v1')),
  evaluator_id       uuid not null default auth.uid(),
  context            text not null default 'film' check (context in ('film','live_game','camp','visit','practice','interview')),
  seen_on            date not null default current_date,
  seen_at_event      text,
  scores             jsonb not null,                 -- {criterion: 1..5}; validated by trigger
  overall            numeric(3,2) not null,          -- computed by trigger; client value ignored
  projection         text check (projection in ('impact','contributor','developmental','not_a_fit')),
  notes              text check (notes is null or length(notes) <= 4000),
  created_at         timestamptz not null default now(),
  foreign key (pipeline_id, provider_id) references public.recruit_pipelines(id, provider_id) on delete cascade,
  foreign key (recruit_id, provider_id) references public.recruits(id, provider_id) on delete cascade,
  unique (pipeline_id, evaluator_id, context, seen_on)
);
create index if not exists re_pipeline_idx on public.recruit_evaluations (pipeline_id);

-- ── recruit_contacts: the contact log (E3.7) ──────────────────────────────
create table if not exists public.recruit_contacts (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  pipeline_id        uuid not null,
  recruit_id         uuid not null,
  contact_kind       text not null check (contact_kind in
                       ('email','text','phone','video','social_dm','mail','in_person_off_campus','in_person_on_campus','evaluation_live')),
  direction          text not null default 'outbound' check (direction in ('outbound','inbound')),
  counterpart        text not null default 'prospect' check (counterpart in ('prospect','guardian','hs_coach','club_coach','other')),
  occurred_at        timestamptz not null default now(),
  staff_member_id    uuid references public.organization_members(id) on delete set null,
  subject            text check (subject is null or length(subject) <= 200),
  summary            text check (summary is null or length(summary) <= 4000),
  -- R1: always 'unchecked'. The R2 window trigger (spec E5) fills these; until
  -- the recruiting calendar is VERIFIED nothing may claim 'permitted'.
  permissible_window_status text not null default 'unchecked'
                       check (permissible_window_status in ('unchecked','permitted','warn','blocked')),
  window_result      jsonb not null default '{}',
  logged_by          uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  foreign key (pipeline_id, provider_id) references public.recruit_pipelines(id, provider_id) on delete cascade,
  foreign key (recruit_id, provider_id) references public.recruits(id, provider_id) on delete cascade
);
create index if not exists rc_pipeline_time_idx on public.recruit_contacts (pipeline_id, occurred_at desc);
create index if not exists rc_provider_time_idx on public.recruit_contacts (provider_id, occurred_at desc);

-- ── recruiting_targets: roster need per position per entry year (E3.4) ────
create table if not exists public.recruiting_targets (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        uuid not null references public.providers(id) on delete cascade,
  sport              text not null check (length(btrim(sport)) between 1 and 60),
  team_id            uuid references public.teams(id) on delete set null,
  entry_year         text not null check (entry_year ~ '^[0-9]{4}(-[0-9]{2})?$'),
  position           text not null check (length(btrim(position)) between 1 and 60),
  target_count       smallint not null check (target_count between 0 and 99),
  priority           smallint not null default 3 check (priority between 1 and 5),
  note               text,
  set_by             uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  unique (id, provider_id)
);
create unique index if not exists rt_need_uq on public.recruiting_targets (provider_id, lower(btrim(sport)), entry_year, lower(btrim(position)));
alter table public.recruit_pipelines drop constraint if exists rp_target_fk;
alter table public.recruit_pipelines add constraint rp_target_fk
  foreign key (recruiting_target_id) references public.recruiting_targets(id) on delete set null;

-- ── data_access_log: minimal receipt for sensitive reads (spec §10.2) ─────
create table if not exists public.data_access_log (
  id                 bigint generated always as identity primary key,
  provider_id        uuid not null references public.providers(id) on delete cascade,
  actor_id           uuid,
  subject_kind       text not null,
  subject_id         uuid not null,
  fields             text[] not null default '{}',
  occurred_at        timestamptz not null default now()
);
create index if not exists dal_provider_time_idx on public.data_access_log (provider_id, occurred_at desc);

-- ════════════════════════════ TRIGGERS ════════════════════════════════════

-- recruits: minor status + under-13 block (E8.1, E8.2) + updated_at
create or replace function public.recruits_guard() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > (current_date - interval '13 years')::date then
    raise exception 'RECRUIT_UNDER_13: recruits must be 13 or older; youth registrations belong in the club product'
      using errcode = 'P0001';
  end if;
  -- age of majority 18 by default (VERIFY states that differ); unknown DOB = minor
  new.is_minor := new.date_of_birth is null or new.date_of_birth > (current_date - interval '18 years')::date;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_recruits_guard on public.recruits;
create trigger trg_recruits_guard before insert or update on public.recruits
  for each row execute function public.recruits_guard();

-- children take their tenant from their parent, so a client cannot attach a
-- row to another org's recruit; RLS WITH CHECK then runs on the derived value
create or replace function public.recruit_child_tenant() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_pid uuid; v_rid uuid;
begin
  if tg_table_name in ('recruit_pipelines','recruit_guardians') then
    select r.provider_id into v_pid from public.recruits r where r.id = new.recruit_id;
    if v_pid is null then raise exception 'recruit not found' using errcode = '23503'; end if;
    new.provider_id := v_pid;
  else  -- recruit_evaluations, recruit_contacts
    select p.provider_id, p.recruit_id into v_pid, v_rid from public.recruit_pipelines p where p.id = new.pipeline_id;
    if v_pid is null then raise exception 'pipeline not found' using errcode = '23503'; end if;
    new.provider_id := v_pid; new.recruit_id := v_rid;
  end if;
  -- nested IFs: plpgsql does not short-circuit, and NEW has no team_id on the other tables
  if tg_table_name = 'recruit_pipelines' then
    if new.team_id is not null
       and not exists (select 1 from public.teams t where t.id = new.team_id and t.provider_id = new.provider_id) then
      raise exception 'team does not belong to this organization' using errcode = '23503';
    end if;
  end if;
  if tg_table_name = 'recruit_contacts' then
    if tg_op = 'INSERT' then
      -- R1 never claims a window verdict; see header note 3
      new.permissible_window_status := 'unchecked'; new.window_result := '{}'::jsonb;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_rp_tenant on public.recruit_pipelines;
create trigger trg_rp_tenant before insert or update of recruit_id, team_id, provider_id on public.recruit_pipelines
  for each row execute function public.recruit_child_tenant();
drop trigger if exists trg_rg_tenant on public.recruit_guardians;
create trigger trg_rg_tenant before insert or update of recruit_id, provider_id on public.recruit_guardians
  for each row execute function public.recruit_child_tenant();
drop trigger if exists trg_re_tenant on public.recruit_evaluations;
create trigger trg_re_tenant before insert or update of pipeline_id, recruit_id, provider_id on public.recruit_evaluations
  for each row execute function public.recruit_child_tenant();
drop trigger if exists trg_rc_tenant on public.recruit_contacts;
create trigger trg_rc_tenant before insert or update of pipeline_id, recruit_id, provider_id on public.recruit_contacts
  for each row execute function public.recruit_child_tenant();

-- target: tenant must match its team when one is named
create or replace function public.recruiting_targets_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.team_id is not null and not exists (select 1 from public.teams t where t.id = new.team_id and t.provider_id = new.provider_id) then
    raise exception 'team does not belong to this organization' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_rt_guard on public.recruiting_targets;
create trigger trg_rt_guard before insert or update on public.recruiting_targets
  for each row execute function public.recruiting_targets_guard();

-- stage order; 'closed' sits outside it (closing is always allowed, reopening needs a note)
create or replace function public.recruit_stage_rank(p text) returns int
language sql immutable set search_path to '' as $$
  select case p when 'identified' then 1 when 'evaluated' then 2 when 'contacted' then 3 when 'visit' then 4
                when 'offer' then 5 when 'committed' then 6 when 'signed' then 7 when 'enrolled' then 8 else null end
$$;

-- pipelines: transition rules (E3.2) + updated_at
create or replace function public.recruit_pipelines_stage_guard() returns trigger
language plpgsql set search_path to '' as $$
declare v_note text := nullif(btrim(coalesce(current_setting('sporv.stage_note', true), '')), '');
begin
  if new.stage = 'enrolled' and coalesce(current_setting('sporv.recruit_convert', true), '') <> 'on'
     and (tg_op = 'INSERT' or old.stage is distinct from 'enrolled') then
    raise exception 'RECRUIT_ENROLLED_BY_CONVERSION_ONLY: only the conversion step can mark a recruit enrolled'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    if old.stage = 'enrolled' then
      raise exception 'RECRUIT_STAGE_LOCKED: an enrolled recruit has left the board' using errcode = 'P0001';
    end if;
    if (old.stage = 'closed' or public.recruit_stage_rank(new.stage) < public.recruit_stage_rank(old.stage))
       and v_note is null then
      raise exception 'RECRUIT_STAGE_BACKWARD_NOTE: moving a recruit back or reopening needs a note'
        using errcode = 'P0001';
    end if;
    if new.stage <> 'closed' then new.closed_reason := null; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_rp_stage_guard on public.recruit_pipelines;
create trigger trg_rp_stage_guard before insert or update on public.recruit_pipelines
  for each row execute function public.recruit_pipelines_stage_guard();

-- every stage set / change appends exactly one history row
create or replace function public.recruit_pipelines_history() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.recruit_stage_history (provider_id, pipeline_id, from_stage, to_stage, actor_id, actor_kind, note)
    values (new.provider_id, new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage, auth.uid(),
            coalesce(nullif(current_setting('sporv.stage_actor', true), ''), 'user'),
            nullif(btrim(coalesce(current_setting('sporv.stage_note', true), '')), ''));
  end if;
  return null;
end $$;
drop trigger if exists trg_rp_history on public.recruit_pipelines;
create trigger trg_rp_history after insert or update of stage on public.recruit_pipelines
  for each row execute function public.recruit_pipelines_history();

-- history is append-only, even for the table owner
create or replace function public.recruit_stage_history_append_only() returns trigger
language plpgsql set search_path to '' as $$
begin
  raise exception 'recruit_stage_history is append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_rsh_append_only on public.recruit_stage_history;
create trigger trg_rsh_append_only before update or delete on public.recruit_stage_history
  for each row execute function public.recruit_stage_history_append_only();

-- evaluations: validate against generic_v1 and compute overall (E3.5)
create or replace function public.recruit_evaluations_score() returns trigger
language plpgsql set search_path to '' as $$
declare k text; v jsonb; n int := 0; total numeric := 0;
  allowed constant text[] := array['athleticism','technique','game_sense','competitiveness','coachability'];
begin
  if jsonb_typeof(new.scores) <> 'object' then
    raise exception 'RECRUIT_EVAL_SCORES: scores must be an object' using errcode = 'P0001';
  end if;
  foreach k in array allowed loop
    v := new.scores -> k;
    if v is null or jsonb_typeof(v) <> 'number' or (v::text)::numeric not in (1,2,3,4,5) then
      raise exception 'RECRUIT_EVAL_SCORES: % must be scored 1 to 5', k using errcode = 'P0001';
    end if;
    n := n + 1; total := total + (v::text)::numeric;
  end loop;
  if exists (select 1 from jsonb_object_keys(new.scores) x where x <> all (allowed)) then
    raise exception 'RECRUIT_EVAL_SCORES: unknown criterion' using errcode = 'P0001';
  end if;
  new.overall := round(total / n, 2);
  return new;
end $$;
drop trigger if exists trg_re_score on public.recruit_evaluations;
create trigger trg_re_score before insert or update of scores on public.recruit_evaluations
  for each row execute function public.recruit_evaluations_score();

-- first evaluation moves identified -> evaluated; first outbound contact moves
-- identified/evaluated -> contacted and stamps last_contact_at (spec E4)
create or replace function public.recruit_activity_advance() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  perform set_config('sporv.stage_actor', 'system', true);
  if tg_table_name = 'recruit_evaluations' then
    perform set_config('sporv.stage_note', 'First evaluation recorded', true);
    update public.recruit_pipelines set stage = 'evaluated'
     where id = new.pipeline_id and stage = 'identified';
  else
    update public.recruit_pipelines
       set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
     where id = new.pipeline_id;
    if new.direction = 'outbound' then
      perform set_config('sporv.stage_note', 'First outbound contact logged', true);
      update public.recruit_pipelines set stage = 'contacted'
       where id = new.pipeline_id and stage in ('identified','evaluated');
    end if;
  end if;
  perform set_config('sporv.stage_actor', '', true);
  perform set_config('sporv.stage_note', '', true);
  return null;
end $$;
drop trigger if exists trg_re_advance on public.recruit_evaluations;
create trigger trg_re_advance after insert on public.recruit_evaluations
  for each row execute function public.recruit_activity_advance();
drop trigger if exists trg_rc_advance on public.recruit_contacts;
create trigger trg_rc_advance after insert on public.recruit_contacts
  for each row execute function public.recruit_activity_advance();

-- ════════════════════════════ RPCs ════════════════════════════════════════

-- The only way a person changes stage. Returns the receipt (history row).
create or replace function public.move_recruit_stage(
  p_pipeline uuid, p_to text, p_note text default null, p_closed_reason text default null)
returns public.recruit_stage_history
language plpgsql security definer set search_path to '' as $$
declare v public.recruit_pipelines; h public.recruit_stage_history;
begin
  select * into v from public.recruit_pipelines where id = p_pipeline;
  if v.id is null or not public.is_org_member(v.provider_id) then
    raise exception 'recruit not found' using errcode = '42501';
  end if;
  if p_to is null or public.recruit_stage_rank(p_to) is null and p_to <> 'closed' then
    raise exception 'unknown stage %', p_to using errcode = '22023';
  end if;
  if p_to = 'enrolled' then
    raise exception 'RECRUIT_ENROLLED_BY_CONVERSION_ONLY: only the conversion step can mark a recruit enrolled' using errcode = 'P0001';
  end if;
  if p_to = 'closed' and p_closed_reason is null then
    raise exception 'RECRUIT_CLOSED_REASON: say why the recruit is closed' using errcode = 'P0001';
  end if;
  if v.stage = p_to and (p_to <> 'closed' or v.closed_reason is not distinct from p_closed_reason) then
    select * into h from public.recruit_stage_history where pipeline_id = p_pipeline order by id desc limit 1;
    return h;   -- idempotent: no second receipt for a no-op
  end if;
  perform set_config('sporv.stage_note', coalesce(p_note, ''), true);
  perform set_config('sporv.stage_actor', 'user', true);
  update public.recruit_pipelines
     set stage = p_to, closed_reason = case when p_to = 'closed' then p_closed_reason end
   where id = p_pipeline;
  perform set_config('sporv.stage_note', '', true);
  select * into h from public.recruit_stage_history where pipeline_id = p_pipeline order by id desc limit 1;
  return h;
end $$;

-- Sensitive fields of one recruit, with a receipt in data_access_log.
-- Adults: any active org member. Minors: org owners/admins only (I7).
create or replace function public.get_recruit_sensitive(p_recruit uuid)
returns table (recruit_id uuid, is_minor boolean, date_of_birth date, email text, phone text)
language plpgsql security definer set search_path to '' as $$
declare r public.recruits;
begin
  select * into r from public.recruits where id = p_recruit;
  if r.id is null or not public.is_org_member(r.provider_id) then
    raise exception 'recruit not found' using errcode = '42501';
  end if;
  if r.is_minor and not public.is_org_admin(r.provider_id) then
    raise exception 'RECRUIT_MINOR_SENSITIVE: a minor''s contact details are visible to organization admins only'
      using errcode = '42501';
  end if;
  insert into public.data_access_log (provider_id, actor_id, subject_kind, subject_id, fields)
  values (r.provider_id, auth.uid(), 'recruit', r.id, array['date_of_birth','email','phone']);
  return query select r.id, r.is_minor, r.date_of_birth, r.email, r.phone;
end $$;

-- ════════════════════════════ RLS + GRANTS (I6) ═══════════════════════════
alter table public.recruits              enable row level security; alter table public.recruits              force row level security;
alter table public.recruit_pipelines     enable row level security; alter table public.recruit_pipelines     force row level security;
alter table public.recruit_stage_history enable row level security; alter table public.recruit_stage_history force row level security;
alter table public.recruit_guardians     enable row level security; alter table public.recruit_guardians     force row level security;
alter table public.recruit_evaluations   enable row level security; alter table public.recruit_evaluations   force row level security;
alter table public.recruit_contacts      enable row level security; alter table public.recruit_contacts      force row level security;
alter table public.recruiting_targets    enable row level security; alter table public.recruiting_targets    force row level security;
alter table public.data_access_log       enable row level security; alter table public.data_access_log       force row level security;

revoke all on public.recruits, public.recruit_pipelines, public.recruit_stage_history, public.recruit_guardians,
              public.recruit_evaluations, public.recruit_contacts, public.recruiting_targets, public.data_access_log
  from public, anon, authenticated;

-- recruits: every column EXCEPT date_of_birth, email, phone is readable by members
grant select (id, provider_id, first_name, last_name, preferred_name, prospect_type, grad_year, expected_entry_term,
              is_minor, current_school, current_school_level, club_team, city, state_region, country, social_handles,
              hs_gpa, test_scores, intended_major, eligibility_center_id, eligibility_center_status, transcript_received,
              admissions_status, status, student_athlete_id, retain_until, dedupe_key, created_by, created_at, updated_at)
  on public.recruits to authenticated;
grant insert, update, delete on public.recruits to authenticated;
drop policy if exists recruits_member_select on public.recruits;
create policy recruits_member_select on public.recruits for select to authenticated using (public.is_org_member(provider_id));
drop policy if exists recruits_member_insert on public.recruits;
create policy recruits_member_insert on public.recruits for insert to authenticated with check (public.is_org_member(provider_id));
drop policy if exists recruits_member_update on public.recruits;
create policy recruits_member_update on public.recruits for update to authenticated
  using (public.is_org_member(provider_id)) with check (public.is_org_member(provider_id));
drop policy if exists recruits_admin_delete on public.recruits;
create policy recruits_admin_delete on public.recruits for delete to authenticated using (public.is_org_admin(provider_id));

-- pipelines: stage / closed_reason change only through move_recruit_stage()
grant select, insert, delete on public.recruit_pipelines to authenticated;
grant update (team_id, sport, position_primary, positions, metrics, film_links, priority, owner_member_id,
              target_entry_year, recruiting_target_id, next_action_on)
  on public.recruit_pipelines to authenticated;
drop policy if exists rp_member_all on public.recruit_pipelines;
create policy rp_member_all on public.recruit_pipelines for all to authenticated
  using (public.is_org_member(provider_id)) with check (public.is_org_member(provider_id));

-- history: read-only to members; written by triggers only
grant select on public.recruit_stage_history to authenticated;
drop policy if exists rsh_member_select on public.recruit_stage_history;
create policy rsh_member_select on public.recruit_stage_history for select to authenticated using (public.is_org_member(provider_id));

-- guardians (I7): any member may RECORD one; only owners/admins may READ, edit or delete
grant select, insert, update, delete on public.recruit_guardians to authenticated;
drop policy if exists rg_member_insert on public.recruit_guardians;
create policy rg_member_insert on public.recruit_guardians for insert to authenticated with check (public.is_org_member(provider_id));
drop policy if exists rg_admin_select on public.recruit_guardians;
create policy rg_admin_select on public.recruit_guardians for select to authenticated using (public.is_org_admin(provider_id));
drop policy if exists rg_admin_update on public.recruit_guardians;
create policy rg_admin_update on public.recruit_guardians for update to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
drop policy if exists rg_admin_delete on public.recruit_guardians;
create policy rg_admin_delete on public.recruit_guardians for delete to authenticated using (public.is_org_admin(provider_id));

-- evaluations: members read and add; the evaluator or an admin edits/deletes
grant select, insert, update (context, seen_on, seen_at_event, scores, projection, notes), delete
  on public.recruit_evaluations to authenticated;
drop policy if exists re_member_select on public.recruit_evaluations;
create policy re_member_select on public.recruit_evaluations for select to authenticated using (public.is_org_member(provider_id));
drop policy if exists re_member_insert on public.recruit_evaluations;
create policy re_member_insert on public.recruit_evaluations for insert to authenticated
  with check (public.is_org_member(provider_id) and evaluator_id = auth.uid());
drop policy if exists re_owner_update on public.recruit_evaluations;
create policy re_owner_update on public.recruit_evaluations for update to authenticated
  using (evaluator_id = auth.uid() or public.is_org_admin(provider_id))
  with check (public.is_org_member(provider_id));
drop policy if exists re_owner_delete on public.recruit_evaluations;
create policy re_owner_delete on public.recruit_evaluations for delete to authenticated
  using (evaluator_id = auth.uid() or public.is_org_admin(provider_id));

-- contacts: a compliance record. Members read and add; only admins correct or remove.
grant select, insert, update (contact_kind, direction, counterpart, occurred_at, staff_member_id, subject, summary), delete
  on public.recruit_contacts to authenticated;
drop policy if exists rc_member_select on public.recruit_contacts;
create policy rc_member_select on public.recruit_contacts for select to authenticated using (public.is_org_member(provider_id));
drop policy if exists rc_member_insert on public.recruit_contacts;
create policy rc_member_insert on public.recruit_contacts for insert to authenticated with check (public.is_org_member(provider_id));
drop policy if exists rc_admin_update on public.recruit_contacts;
create policy rc_admin_update on public.recruit_contacts for update to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));
drop policy if exists rc_admin_delete on public.recruit_contacts;
create policy rc_admin_delete on public.recruit_contacts for delete to authenticated using (public.is_org_admin(provider_id));

-- targets: members read; owners/admins set (spec E9: recruit.targets is head-coach / AD)
grant select, insert, update, delete on public.recruiting_targets to authenticated;
drop policy if exists rt_member_select on public.recruiting_targets;
create policy rt_member_select on public.recruiting_targets for select to authenticated using (public.is_org_member(provider_id));
drop policy if exists rt_admin_write on public.recruiting_targets;
create policy rt_admin_write on public.recruiting_targets for all to authenticated
  using (public.is_org_admin(provider_id)) with check (public.is_org_admin(provider_id));

-- access log: admins read their own org's receipts; written only by RPCs
grant select on public.data_access_log to authenticated;
drop policy if exists dal_admin_select on public.data_access_log;
create policy dal_admin_select on public.data_access_log for select to authenticated using (public.is_org_admin(provider_id));

-- functions: no anon, no PUBLIC
revoke all on function public.recruit_film_links_ok(text[]), public.recruits_guard(), public.recruit_child_tenant(),
  public.recruiting_targets_guard(), public.recruit_stage_rank(text), public.recruit_pipelines_stage_guard(),
  public.recruit_pipelines_history(), public.recruit_stage_history_append_only(), public.recruit_evaluations_score(),
  public.recruit_activity_advance(), public.move_recruit_stage(uuid,text,text,text), public.get_recruit_sensitive(uuid)
  from public, anon;
grant execute on function public.recruit_film_links_ok(text[]), public.recruit_stage_rank(text),
  public.move_recruit_stage(uuid,text,text,text), public.get_recruit_sensitive(uuid) to authenticated;
