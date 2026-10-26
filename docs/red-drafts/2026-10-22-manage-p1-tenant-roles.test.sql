-- ============================================================================
-- Proof for 2026-10-22-manage-p1-tenant-roles.sql (Manage Phase 1).
-- Spec: docs/specs/31-COLLEGE-ATHLETICS.md §14 Phase 1 (tests 1.1–1.11).
--
-- Run AFTER the migration, in the same project's SQL editor. Everything runs
-- inside ONE transaction that ends in ROLLBACK: the seeded users, orgs, teams
-- and athletes never persist. Every assertion RAISES on failure, so:
--     success = "Success. No rows returned"  (psql: a list of NOTICE PASS lines)
--     failure = a red ERROR whose message starts with "FAIL <test id>"
-- A failure also rolls everything back.
--
-- Works on the real project (handle_new_user may auto-create each test user's
-- empty org; the seed adopts that row with ON CONFLICT (owner_id)) and on a
-- disposable cluster with Supabase stubs. Impersonation is the PostgREST way:
-- SET ROLE authenticated + request.jwt.claims.sub.
--
-- Not covered here (need the app or production-sized data): 1.12 (club
-- screens unchanged + smoke.sh) and 1.13 (EXPLAIN at 600 athletes).
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.role_assignments') is null or to_regprocedure('public.has_team_access(uuid,text)') is null then
    raise exception 'FAIL setup: apply 2026-10-22-manage-p1-tenant-roles.sql first';
  end if;
  raise notice 'running as % (superuser=%, bypassrls=%)', current_user,
    (select rolsuper from pg_roles where rolname = current_user), (select rolbypassrls from pg_roles where rolname = current_user);
end $$;

-- impersonation helper (rolled back with everything else)
create or replace function public.p1_test_as(p_uid uuid) returns void language plpgsql as $$
begin
  if p_uid is null then
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'none', true);
  else
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end $$;
grant execute on function public.p1_test_as(uuid) to authenticated, anon;

-- ── Seed (as the database owner, no JWT) ─────────────────────────────────────
-- Org A: D2 college. Owner uA, admin member uAdm, AD uAD (trainer member + ad
--        role), head coach uH1 (Men's Soccer team A1), head coach uH2 (Women's
--        Basketball team A2), compliance officer uCO, expired assoc AD uX,
--        student uS (linked to athlete s1).
-- Org B: second college. Owner uB, head coach uHB (team B1).
-- Org C: an ordinary club. Owner uC, trainer coach uK assigned to a C1 event.
do $$
declare v_a uuid; v_b uuid; v_c uuid;
begin
  perform public.p1_test_as(null);
  insert into auth.users (id, email, aud, role) values
    ('a1000000-0000-4000-8000-000000000001','p1-owner-a@example.invalid','authenticated','authenticated'),
    ('a1000000-0000-4000-8000-000000000002','p1-admin-a@example.invalid','authenticated','authenticated'),
    ('a1000000-0000-4000-8000-000000000003','p1-ad-a@example.invalid','authenticated','authenticated'),
    ('a1000000-0000-4000-8000-000000000004','p1-hc1-a@example.invalid','authenticated','authenticated'),
    ('a1000000-0000-4000-8000-000000000005','p1-hc2-a@example.invalid','authenticated','authenticated'),
    ('a1000000-0000-4000-8000-000000000006','p1-co-a@example.invalid','authenticated','authenticated'),
    ('a1000000-0000-4000-8000-000000000007','p1-exp-a@example.invalid','authenticated','authenticated'),
    ('a1000000-0000-4000-8000-000000000008','p1-student-a@example.invalid','authenticated','authenticated'),
    ('b1000000-0000-4000-8000-000000000001','p1-owner-b@example.invalid','authenticated','authenticated'),
    ('b1000000-0000-4000-8000-000000000004','p1-hc-b@example.invalid','authenticated','authenticated'),
    ('c1000000-0000-4000-8000-000000000001','p1-owner-c@example.invalid','authenticated','authenticated'),
    ('c1000000-0000-4000-8000-000000000002','p1-coach-c@example.invalid','authenticated','authenticated');
  insert into public.profiles (id, role, first_name, email)
    select u.id, 'provider', 'P1 test', u.email from auth.users u where u.email like 'p1-%@example.invalid'
  on conflict (id) do nothing;

  insert into public.providers (owner_id, business_name, provider_type, plan, org_kind, institution_type, ncaa_division)
  values ('a1000000-0000-4000-8000-000000000001','P1 Test College A','organization','enterprise','institution','college','D2')
  on conflict (owner_id) do update set business_name = excluded.business_name, provider_type = excluded.provider_type,
    plan = excluded.plan, org_kind = excluded.org_kind, institution_type = excluded.institution_type,
    ncaa_division = excluded.ncaa_division
  returning id into v_a;
  insert into public.providers (owner_id, business_name, provider_type, plan, org_kind, institution_type, ncaa_division)
  values ('b1000000-0000-4000-8000-000000000001','P1 Test College B','organization','enterprise','institution','college','D3')
  on conflict (owner_id) do update set business_name = excluded.business_name, provider_type = excluded.provider_type,
    plan = excluded.plan, org_kind = excluded.org_kind, institution_type = excluded.institution_type,
    ncaa_division = excluded.ncaa_division
  returning id into v_b;
  insert into public.providers (owner_id, business_name, provider_type, plan)            -- club: org_kind left to its default
  values ('c1000000-0000-4000-8000-000000000001','P1 Test Club C','organization','enterprise')
  on conflict (owner_id) do update set business_name = excluded.business_name, provider_type = excluded.provider_type,
    plan = excluded.plan
  returning id into v_c;
  perform set_config('p1.org_a', v_a::text, true);
  perform set_config('p1.org_b', v_b::text, true);
  perform set_config('p1.org_c', v_c::text, true);

  insert into public.organization_members (id, organization_id, member_user_id, role) values
    ('a2000000-0000-4000-8000-000000000002', v_a, 'a1000000-0000-4000-8000-000000000002', 'admin'),
    ('a2000000-0000-4000-8000-000000000003', v_a, 'a1000000-0000-4000-8000-000000000003', 'trainer'),
    ('a2000000-0000-4000-8000-000000000004', v_a, 'a1000000-0000-4000-8000-000000000004', 'trainer'),
    ('a2000000-0000-4000-8000-000000000005', v_a, 'a1000000-0000-4000-8000-000000000005', 'trainer'),
    ('a2000000-0000-4000-8000-000000000006', v_a, 'a1000000-0000-4000-8000-000000000006', 'trainer'),
    ('a2000000-0000-4000-8000-000000000007', v_a, 'a1000000-0000-4000-8000-000000000007', 'trainer'),
    ('b2000000-0000-4000-8000-000000000004', v_b, 'b1000000-0000-4000-8000-000000000004', 'trainer'),
    ('c2000000-0000-4000-8000-000000000002', v_c, 'c1000000-0000-4000-8000-000000000002', 'trainer');

  -- club team (no program) + a club season, created by the club owner through RLS
  perform public.p1_test_as('c1000000-0000-4000-8000-000000000001');
  insert into public.teams (id, provider_id, name, sport) values
    ('c3000000-0000-4000-8000-000000000001', v_c, '14U Flight', 'basketball');
  insert into public.seasons (provider_id, name, start_date, end_date) values (v_c, 'Fall', current_date, current_date + 90);
  perform public.p1_test_as(null);
end $$;

-- ── College data, written THROUGH RLS by the org owners (proves write paths) ─
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; v_b uuid := current_setting('p1.org_b')::uuid; v_id uuid;
begin
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000001');                   -- owner A
  insert into public.sport_programs (id, provider_id, sport_code, display_name) values
    ('a4000000-0000-4000-8000-000000000001', v_a, 'msoc', 'Men''s Soccer'),
    ('a4000000-0000-4000-8000-000000000002', v_a, 'wbb',  'Women''s Basketball');
  insert into public.teams (id, provider_id, name, sport_program_id, gender, level, academic_year) values
    ('a3000000-0000-4000-8000-000000000001', v_a, '2026-27 Men''s Soccer', 'a4000000-0000-4000-8000-000000000001', 'men', 'varsity', '2026-27'),
    ('a3000000-0000-4000-8000-000000000002', v_a, '2026-27 Women''s Basketball', 'a4000000-0000-4000-8000-000000000002', 'women', 'varsity', '2026-27');
  insert into public.seasons (provider_id, name, start_date, end_date, sport_program_id, segment, academic_year)
    values (v_a, 'MSOC championship', current_date, current_date + 100, 'a4000000-0000-4000-8000-000000000001', 'championship', '2026-27');
  insert into public.role_assignments (provider_id, member_id, role_key, team_id, sport_program_id, ends_on, starts_on) values
    (v_a, 'a2000000-0000-4000-8000-000000000003', 'ad', null, null, null, current_date),
    (v_a, 'a2000000-0000-4000-8000-000000000004', 'head_coach', 'a3000000-0000-4000-8000-000000000001', null, null, current_date),
    (v_a, 'a2000000-0000-4000-8000-000000000005', 'head_coach', 'a3000000-0000-4000-8000-000000000002', null, null, current_date),
    (v_a, 'a2000000-0000-4000-8000-000000000006', 'compliance_officer', null, null, null, current_date),
    (v_a, 'a2000000-0000-4000-8000-000000000007', 'assoc_ad', null, null, current_date - 1, current_date - 10);   -- expired yesterday
  insert into public.student_athletes (id, provider_id, institution_student_id, legal_first_name, legal_last_name) values
    ('a5000000-0000-4000-8000-000000000001', v_a, 'A001', 'Sam', 'Ortiz'),
    ('a5000000-0000-4000-8000-000000000002', v_a, 'A002', 'Lee', 'Park'),
    ('a5000000-0000-4000-8000-000000000003', v_a, 'A003', 'Max', 'Reyes'),
    ('a5000000-0000-4000-8000-000000000004', v_a, 'A004', 'Ana', 'Cole'),
    ('a5000000-0000-4000-8000-000000000005', v_a, 'A005', 'Jo',  'Kim');
  insert into public.athlete_team_memberships (provider_id, student_athlete_id, team_id, jersey_number) values
    (v_a, 'a5000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', '7'),
    (v_a, 'a5000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', '9'),
    (v_a, 'a5000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001', '10'),
    (v_a, 'a5000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000002', '3'),
    (v_a, 'a5000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000002', '4');
  insert into public.org_verified_domains (provider_id, domain) values (v_a, 'p1-college-a.example');

  perform public.p1_test_as('b1000000-0000-4000-8000-000000000001');                   -- owner B
  insert into public.sport_programs (id, provider_id, sport_code, display_name) values
    ('b4000000-0000-4000-8000-000000000001', v_b, 'wbb', 'Women''s Basketball');
  insert into public.teams (id, provider_id, name, sport_program_id, academic_year) values
    ('b3000000-0000-4000-8000-000000000001', v_b, '2026-27 WBB', 'b4000000-0000-4000-8000-000000000001', '2026-27');
  insert into public.role_assignments (provider_id, member_id, role_key, team_id) values
    (v_b, 'b2000000-0000-4000-8000-000000000004', 'head_coach', 'b3000000-0000-4000-8000-000000000001');
  insert into public.student_athletes (id, provider_id, institution_student_id, legal_first_name, legal_last_name) values
    ('b5000000-0000-4000-8000-000000000001', v_b, 'B001', 'Ria', 'Shah');
  insert into public.athlete_team_memberships (provider_id, student_athlete_id, team_id) values
    (v_b, 'b5000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001');

  -- account linking is service-role only (user_id is not granted to clients)
  perform public.p1_test_as(null);
  update public.student_athletes set user_id = 'a1000000-0000-4000-8000-000000000008'
   where id = 'a5000000-0000-4000-8000-000000000001';
  raise notice 'PASS seed: owners created programs, teams, assignments, athletes and memberships through RLS';
end $$;

-- ── 1.1 / 1.2 / 1.6 / 1.10 — constraints and guards ─────────────────────────
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; v_b uuid := current_setting('p1.org_b')::uuid;
begin
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000001');
  begin
    insert into public.sport_programs (provider_id, sport_code, display_name) values (v_a, 'msoc', 'Dup');
    raise exception 'FAIL 1.1: duplicate (provider, sport, level) accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.teams (provider_id, name, sport_program_id, academic_year)
      values (v_a, 'Dup team', 'a4000000-0000-4000-8000-000000000001', '2026-27');
    raise exception 'FAIL 1.2: second team for the same program and academic_year accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.role_assignments (provider_id, member_id, role_key, team_id)
      values (v_a, 'a2000000-0000-4000-8000-000000000006', 'compliance_officer', 'a3000000-0000-4000-8000-000000000001');
    raise exception 'FAIL 1.6: compliance_officer accepted with a team_id';
  exception when check_violation then
    if sqlerrm not like 'ROLE_SCOPE%' then raise exception 'FAIL 1.6: wrong error %', sqlerrm; end if;
  end;
  begin
    insert into public.org_role_capability_overrides (provider_id, role_key, capability, granted)
      values (v_a, 'head_coach', 'medical.read', true);
    raise exception 'FAIL 1.10: medical.read added to head_coach';
  exception when insufficient_privilege then
    if sqlerrm not like 'RESTRICTED_CAPABILITY%' then raise exception 'FAIL 1.10: wrong error %', sqlerrm; end if;
  end;
  -- I9: an org-A assignment cannot point at an org-B team; an org-A athlete cannot join an org-B team
  begin
    insert into public.role_assignments (provider_id, member_id, role_key, team_id)
      values (v_a, 'a2000000-0000-4000-8000-000000000004', 'assistant_coach', 'b3000000-0000-4000-8000-000000000001');
    raise exception 'FAIL I9: org A assignment linked to an org B team';
  exception when foreign_key_violation then null; end;
  begin                                         -- through the API: RLS refuses (no access to B's team)
    insert into public.athlete_team_memberships (provider_id, student_athlete_id, team_id)
      values (v_a, 'a5000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001');
    raise exception 'FAIL I9: org A athlete placed on an org B team';
  exception when insufficient_privilege then null; end;
  perform public.p1_test_as(null);
  begin                                         -- even with RLS bypassed: the composite FK refuses
    insert into public.athlete_team_memberships (provider_id, student_athlete_id, team_id)
      values (v_a, 'a5000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001');
    raise exception 'FAIL I9: owner-level insert linked an org A athlete to an org B team';
  exception when foreign_key_violation then null; end;
  -- D3 aid guard (org B is D3)
  perform public.p1_test_as('b1000000-0000-4000-8000-000000000001');
  begin
    update public.athlete_team_memberships set scholarship_flag = true where provider_id = v_b;
    raise exception 'FAIL D3: athletic aid accepted at a D3 school';
  exception when check_violation then
    if sqlerrm not like 'D3_NO_ATHLETIC_AID%' then raise exception 'FAIL D3: wrong error %', sqlerrm; end if;
  end;
  perform public.p1_test_as(null);
  raise notice 'PASS 1.1 1.2 1.6 1.10 I9 D3: duplicates, scope, restricted capability, cross-org links and D3 aid all rejected';
end $$;

-- ── (a) 1.5 — cross-org reads return 0 rows, both directions ─────────────────
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; v_b uuid := current_setting('p1.org_b')::uuid;
        n int; who uuid; target uuid; t text;
begin
  foreach who in array array['b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004',
                             'a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003']::uuid[] loop
    target := case when who::text like 'b1%' then v_a else v_b end;
    perform public.p1_test_as(who);
    foreach t in array array['org_verified_domains','sport_programs','org_role_capability_overrides','role_assignments',
                             'team_staff','student_athletes','athlete_team_memberships','audit_log','teams','seasons'] loop
      execute format('select count(*) from public.%I where provider_id = $1', t) into n using target;
      if n <> 0 then raise exception 'FAIL 1.5/(a): user % reads % row(s) of another org in %', who, n, t; end if;
    end loop;
    if public.has_org_capability(target, 'roster.read') or public.has_team_access(
         case when target = v_a then 'a3000000-0000-4000-8000-000000000001'::uuid else 'b3000000-0000-4000-8000-000000000001'::uuid end,
         'roster.read') then
      raise exception 'FAIL 1.5/(a): user % holds a capability in another org', who;
    end if;
  end loop;
  perform public.p1_test_as(null);
  raise notice 'PASS (a) 1.5: every Phase 1 table returns 0 rows across orgs, both directions, for owners, an AD and a coach';
end $$;

-- ── (b) 1.3 / 1.4 — head coach of team A1 sees only A1 ───────────────────────
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; n int;
begin
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000004');                   -- head coach, Men's Soccer
  select count(*) into n from public.athlete_team_memberships where team_id = 'a3000000-0000-4000-8000-000000000002';
  if n <> 0 then raise exception 'FAIL 1.3/(b): head coach A1 sees % WBB memberships', n; end if;
  select count(*) into n from public.athlete_team_memberships where team_id = 'a3000000-0000-4000-8000-000000000001';
  if n <> 3 then raise exception 'FAIL 1.4/(b): head coach A1 sees % of 3 own memberships', n; end if;
  select count(*) into n from public.athlete_team_memberships;
  if n <> 3 then raise exception 'FAIL (b): head coach A1 sees % memberships in total, expected 3', n; end if;
  select count(*) into n from public.student_athletes;
  if n <> 3 then raise exception 'FAIL (b): head coach A1 sees % student-athletes, expected 3', n; end if;
  select count(*) into n from public.teams where id = 'a3000000-0000-4000-8000-000000000002';
  if n <> 0 then raise exception 'FAIL (b): head coach A1 sees team A2'; end if;
  select count(*) into n from public.teams where id = 'a3000000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL (b): head coach A1 cannot see own team'; end if;
  select count(*) into n from public.role_assignments;
  if n <> 1 then raise exception 'FAIL (b): head coach A1 sees % assignments, expected own 1', n; end if;
  select count(*) into n from public.audit_log;
  if n <> 0 then raise exception 'FAIL (b): head coach reads audit_log (% rows)', n; end if;
  if public.has_team_access('a3000000-0000-4000-8000-000000000002', 'roster.read') then
    raise exception 'FAIL (b): has_team_access(A2) true for head coach A1'; end if;
  if public.has_org_capability(v_a, 'roster.read') then
    raise exception 'FAIL (b): team-scoped coach holds a department capability'; end if;
  -- coach writes stay inside the team: cannot add an athlete to WBB
  begin
    insert into public.athlete_team_memberships (provider_id, student_athlete_id, team_id)
      values (v_a, 'a5000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002');
    raise exception 'FAIL (b): head coach A1 wrote a WBB membership';
  exception when insufficient_privilege then null; end;
  -- student uS sees only themselves
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000008');
  select count(*) into n from public.student_athletes;
  if n <> 1 then raise exception 'FAIL (b): student sees % student rows, expected self only', n; end if;
  select count(*) into n from public.athlete_team_memberships;
  if n <> 1 then raise exception 'FAIL (b): student sees % memberships, expected own 1', n; end if;
  perform public.p1_test_as(null);
  raise notice 'PASS (b) 1.3 1.4: head coach sees exactly own 3 memberships, 0 of the other team; student sees only self';
end $$;

-- ── (c) — the AD (role, not admin) and the owner see both teams ──────────────
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; n int; v_new uuid; who uuid;
begin
  foreach who in array array['a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001']::uuid[] loop
    perform public.p1_test_as(who);
    select count(*) into n from public.athlete_team_memberships where provider_id = v_a;
    if n <> 5 then raise exception 'FAIL (c): % sees % of 5 memberships', who, n; end if;
    select count(*) into n from public.teams where provider_id = v_a;
    if n <> 2 then raise exception 'FAIL (c): % sees % of 2 college teams', who, n; end if;
    select count(*) into n from public.student_athletes where provider_id = v_a;
    if n <> 5 then raise exception 'FAIL (c): % sees % of 5 student-athletes', who, n; end if;
    select count(*) into n from public.audit_log where provider_id = v_a;
    if n = 0 then raise exception 'FAIL (c): % (audit.read) sees no audit rows', who; end if;
  end loop;
  -- the AD is NOT is_org_admin: everything above came from role_assignments.
  -- AD creates and deletes a college team through RLS, with RETURNING.
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000003');
  insert into public.teams (provider_id, name, sport_program_id, academic_year)
    values (v_a, '2027-28 Men''s Soccer', 'a4000000-0000-4000-8000-000000000001', '2027-28') returning id into v_new;
  if v_new is null then raise exception 'FAIL (c): AD insert … returning gave no row'; end if;
  delete from public.teams where id = v_new;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL (c): AD could not delete the team it created'; end if;
  perform public.p1_test_as(null);
  raise notice 'PASS (c): AD role-holder and owner both see all 5 memberships across both teams; AD manages teams';
end $$;

-- ── (d) 1.7 / 1.8 / 1.9 — capability checks ──────────────────────────────────
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; v_b uuid := current_setting('p1.org_b')::uuid;
begin
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000006');                   -- compliance officer
  if not public.has_org_capability(v_a, 'eligibility.certify') then raise exception 'FAIL (d): compliance officer cannot certify'; end if;
  if not public.has_org_capability(v_a, 'lineup.override')     then raise exception 'FAIL (d): compliance officer cannot override'; end if;
  if public.has_org_capability(v_a, 'medical.read')            then raise exception 'FAIL (d): compliance officer reads medical'; end if;
  if public.has_org_capability(v_b, 'eligibility.certify')     then raise exception 'FAIL (d): compliance officer certifies at org B'; end if;
  if public.has_org_capability(v_a, 'no.such_capability')      then raise exception 'FAIL (d): unknown capability granted'; end if;

  perform public.p1_test_as('a1000000-0000-4000-8000-000000000004');                   -- head coach
  if public.has_org_capability(v_a, 'eligibility.certify') then raise exception 'FAIL (d): head coach can certify'; end if;
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000003');                   -- AD
  if public.has_org_capability(v_a, 'eligibility.certify') then raise exception 'FAIL (d): AD can certify by default (Q6 matrix)'; end if;

  perform public.p1_test_as('a1000000-0000-4000-8000-000000000001');                   -- owner (is_org_admin)
  if public.has_org_capability(v_a, 'eligibility.certify') then raise exception 'FAIL 1.7: owner certifies without a compliance role'; end if;
  if public.has_org_capability(v_a, 'medical.break_glass') then raise exception 'FAIL 1.7: owner holds medical.break_glass'; end if;
  if not public.has_org_capability(v_a, 'roster.write')    then raise exception 'FAIL 1.7: owner lost roster.write'; end if;
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000002');                   -- admin member (is_org_admin)
  if public.has_org_capability(v_a, 'eligibility.certify') then raise exception 'FAIL 1.7: admin member certifies'; end if;
  if not public.has_org_capability(v_a, 'admin.users')     then raise exception 'FAIL 1.7: admin member lost admin.users'; end if;

  perform public.p1_test_as('a1000000-0000-4000-8000-000000000007');                   -- assignment ended yesterday
  if public.has_org_capability(v_a, 'roster.read') then raise exception 'FAIL 1.8: expired assignment still grants roster.read'; end if;

  -- 1.9: org A removes roster.write from head_coach; org B unaffected
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000001');
  insert into public.org_role_capability_overrides (provider_id, role_key, capability, granted)
    values (v_a, 'head_coach', 'roster.write', false);
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000004');
  if public.has_team_access('a3000000-0000-4000-8000-000000000001', 'roster.write') then
    raise exception 'FAIL 1.9: override did not remove roster.write at org A'; end if;
  if not public.has_team_access('a3000000-0000-4000-8000-000000000001', 'roster.read') then
    raise exception 'FAIL 1.9: override removed more than roster.write'; end if;
  perform public.p1_test_as('b1000000-0000-4000-8000-000000000004');
  if not public.has_team_access('b3000000-0000-4000-8000-000000000001', 'roster.write') then
    raise exception 'FAIL 1.9: org A override leaked into org B'; end if;
  perform public.p1_test_as(null);
  raise notice 'PASS (d) 1.7 1.8 1.9: compliance capability true only for the compliance officer at their own org; admins excluded from restricted caps';
end $$;

-- ── (d2) self-assignment of a restricted role is refused ─────────────────────
-- An admin member (is_org_admin -> admin.users) and the AD (ad role ->
-- admin.users) try to give THEMSELVES a role whose defaults carry a restricted
-- capability. Both must fail, and neither may end up holding the capability.
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; n int;
begin
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000002');                   -- admin member
  begin
    insert into public.role_assignments (provider_id, member_id, role_key)
      values (v_a, 'a2000000-0000-4000-8000-000000000002', 'compliance_officer');
    raise exception 'FAIL (d2): admin member self-assigned compliance_officer';
  exception when insufficient_privilege then
    if sqlerrm not like 'SELF_ASSIGN_RESTRICTED%' then raise exception 'FAIL (d2): wrong error %', sqlerrm; end if;
  end;
  if public.has_org_capability(v_a, 'eligibility.certify') then
    raise exception 'FAIL (d2): admin member holds eligibility.certify after the refused self-assignment'; end if;
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000003');                   -- AD
  begin
    insert into public.role_assignments (provider_id, member_id, role_key)
      values (v_a, 'a2000000-0000-4000-8000-000000000003', 'athletic_trainer');
    raise exception 'FAIL (d2): AD self-assigned athletic_trainer';
  exception when insufficient_privilege then
    if sqlerrm not like 'SELF_ASSIGN_RESTRICTED%' then raise exception 'FAIL (d2): wrong error %', sqlerrm; end if;
  end;
  if public.has_org_capability(v_a, 'medical.read') then
    raise exception 'FAIL (d2): AD holds medical.read after the refused self-assignment'; end if;
  -- a non-restricted role may still be self-assigned, and another admin may
  -- still assign the restricted role to someone else
  insert into public.role_assignments (provider_id, member_id, role_key)
    values (v_a, 'a2000000-0000-4000-8000-000000000003', 'sid');
  insert into public.role_assignments (provider_id, member_id, role_key)
    values (v_a, 'a2000000-0000-4000-8000-000000000002', 'compliance_officer');
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000002');
  if not public.has_org_capability(v_a, 'eligibility.certify') then
    raise exception 'FAIL (d2): assignment by another admin did not grant eligibility.certify'; end if;
  perform public.p1_test_as(null);
  raise notice 'PASS (d2): restricted roles cannot be self-assigned; non-restricted self-assignment and admin-to-other still work';
end $$;

-- ── (e) 1.12 (database half) — existing club behaviour unchanged ─────────────
do $$
declare v_c uuid := current_setting('p1.org_c')::uuid; v_a uuid := current_setting('p1.org_a')::uuid; n int; v_kind text; v_scope boolean;
begin
  select org_kind, team_scoping into v_kind, v_scope from public.providers where id = v_c;
  if v_kind <> 'club' or v_scope then raise exception 'FAIL (e): club defaults are org_kind=%, team_scoping=%', v_kind, v_scope; end if;

  perform public.p1_test_as('c1000000-0000-4000-8000-000000000001');                   -- club owner
  select count(*) into n from public.teams where provider_id = v_c;
  if n <> 1 then raise exception 'FAIL (e): club owner sees % of 1 team', n; end if;
  update public.teams set name = '14U Flight Black' where id = 'c3000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL (e): club owner cannot rename own team'; end if;
  insert into public.teams (provider_id, name) values (v_c, '16U Flight');
  select count(*) into n from public.teams where provider_id = v_c;
  if n <> 2 then raise exception 'FAIL (e): club owner insert did not land (% teams)', n; end if;
  delete from public.teams where provider_id = v_c and name = '16U Flight';
  get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL (e): club owner cannot delete own team'; end if;
  select count(*) into n from public.seasons where provider_id = v_c;
  if n <> 1 then raise exception 'FAIL (e): club owner sees % of 1 season', n; end if;
  select count(*) into n from public.teams where provider_id = v_a;
  if n <> 0 then raise exception 'FAIL (e): club owner sees college teams'; end if;

  perform public.p1_test_as('a1000000-0000-4000-8000-000000000001');                   -- college owner keeps owner access
  select count(*) into n from public.teams where provider_id = v_a;
  if n <> 2 then raise exception 'FAIL (e): college owner sees % of 2 teams via owner policies', n; end if;
  perform public.p1_test_as(null);

  select count(*) into n from public.audit_log where provider_id = v_c;
  if n <> 0 then raise exception 'FAIL (e): club team writes produced % audit rows', n; end if;
  raise notice 'PASS (e): club owner select/insert/update/delete on teams and seasons unchanged; club rows not audited';
end $$;

-- (e) continued — a coach with NO role_assignments keeps today's
-- event-assignment access; team_scoping is the only thing that removes it.
-- Needs the staff-access migration (coaches_team) and the event table.
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; v_c uuid := current_setting('p1.org_c')::uuid; n int;
begin
  if to_regclass('public.event') is null or to_regprocedure('public.coaches_team(uuid,uuid)') is null then
    raise notice 'SKIP (e) coach path: public.event or coaches_team() not in this database';
    return;
  end if;
  -- event is FORCE RLS: each owner writes their own event through event_admin_all
  perform public.p1_test_as('c1000000-0000-4000-8000-000000000001');
  insert into public.event (provider_id, team_id, kind, title, starts_at, ends_at, timezone, assigned_member_id) values
    (v_c, 'c3000000-0000-4000-8000-000000000001', 'practice', 'P1 club practice', now() + interval '1 day', now() + interval '1 day 1 hour',
     'America/Chicago', 'c2000000-0000-4000-8000-000000000002');
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000001');
  insert into public.event (provider_id, team_id, kind, title, starts_at, ends_at, timezone, assigned_member_id) values
    (v_a, 'a3000000-0000-4000-8000-000000000002', 'practice', 'P1 WBB practice covered by HC1', now() + interval '1 day', now() + interval '1 day 1 hour',
     'America/Chicago', 'a2000000-0000-4000-8000-000000000004');

  perform public.p1_test_as('c1000000-0000-4000-8000-000000000002');                   -- club coach, no role_assignments
  select count(*) into n from public.teams;
  if n <> 1 then raise exception 'FAIL (e): club coach sees % teams, expected the 1 they coach', n; end if;
  if public.has_team_access('c3000000-0000-4000-8000-000000000001', 'roster.read') then
    raise exception 'FAIL (e): club coach gained a college capability'; end if;

  perform public.p1_test_as('a1000000-0000-4000-8000-000000000004');                   -- HC1, also assigned a WBB event
  select count(*) into n from public.teams where provider_id = v_a;
  if n <> 2 then raise exception 'FAIL (e): with team_scoping off, HC1 should keep event-path access to WBB (saw % teams)', n; end if;

  perform public.p1_test_as(null);
  update public.providers set team_scoping = true where id = v_a;
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000004');
  select count(*) into n from public.teams where provider_id = v_a;
  if n <> 1 then raise exception 'FAIL (e): with team_scoping on, HC1 sees % teams, expected 1', n; end if;
  select count(*) into n from public.event where provider_id = v_a;
  if n <> 0 then raise exception 'FAIL (e): with team_scoping on, HC1 still sees the WBB event'; end if;
  perform public.p1_test_as('a1000000-0000-4000-8000-000000000001');
  select count(*) into n from public.teams where provider_id = v_a;
  if n <> 2 then raise exception 'FAIL (e): team_scoping restricted the owner (% teams)', n; end if;
  perform public.p1_test_as('c1000000-0000-4000-8000-000000000002');
  select count(*) into n from public.teams;
  if n <> 1 then raise exception 'FAIL (e): org A opting in changed the club coach (% teams)', n; end if;
  perform public.p1_test_as(null);
  update public.providers set team_scoping = false where id = v_a;
  raise notice 'PASS (e): coach without assignments keeps event access; team_scoping opt-in narrows only that org''s non-admin staff';
end $$;

-- ── audit_log: append-only and chained ───────────────────────────────────────
do $$
declare v_a uuid := current_setting('p1.org_a')::uuid; n int;
begin
  perform public.p1_test_as(null);
  begin
    update public.audit_log set action = 'tampered' where provider_id = v_a;
    raise exception 'FAIL audit: update succeeded';
  exception when sqlstate '55000' then null; end;
  begin
    delete from public.audit_log where provider_id = v_a;
    raise exception 'FAIL audit: delete succeeded';
  exception when sqlstate '55000' then null; end;
  select count(*) into n from public.audit_log a
   where a.provider_id = v_a and a.prev_hash is not null
     and not exists (select 1 from public.audit_log p where p.provider_id = v_a and p.row_hash = a.prev_hash);
  if n <> 0 then raise exception 'FAIL audit: % rows point at a missing prev_hash', n; end if;
  select count(*) into n from public.audit_log where provider_id = v_a and prev_hash is null;
  if n <> 1 then raise exception 'FAIL audit: % chain heads for org A, expected 1', n; end if;
  select count(*) into n from public.audit_log where provider_id = v_a and diff ? 'institution_student_id'
     and diff->>'institution_student_id' <> '[redacted]';
  if n <> 0 then raise exception 'FAIL audit: sensitive column in clear in diff'; end if;
  -- hashes are keyed: a row hash must not equal a plain sha256 of its own image
  select count(*) into n from public.audit_log a
   where a.provider_id = v_a and a.table_name = 'student_athletes' and a.after_sha256 is not null
     and a.after_sha256 = encode(sha256(convert_to((select to_jsonb(s) from public.student_athletes s where s.id::text = a.row_id)::text, 'UTF8')), 'hex');
  if n <> 0 then raise exception 'FAIL audit: % after-hashes are plain sha256 (unkeyed)', n; end if;
  select count(*) into n from public.audit_log where provider_id = v_a and length(row_hash) <> 64;
  if n <> 0 then raise exception 'FAIL audit: % row hashes are not 32-byte HMAC-SHA256', n; end if;
  raise notice 'PASS audit: update/delete rejected, one chain per org, sensitive values redacted, hashes keyed';
end $$;

-- ── anon gets nothing ────────────────────────────────────────────────────────
do $$
begin
  perform public.p1_test_as(null);
  perform set_config('role', 'anon', true);
  begin
    perform 1 from public.student_athletes limit 1;
    raise exception 'FAIL anon: anon can select student_athletes';
  exception when insufficient_privilege then null; end;
  begin
    perform public.has_org_capability(gen_random_uuid(), 'roster.read');
    raise exception 'FAIL anon: anon can execute has_org_capability';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'authenticated', true);
  begin
    perform s.date_of_birth from public.student_athletes s limit 1;
    raise exception 'FAIL I7: authenticated can select student_athletes.date_of_birth';
  exception when insufficient_privilege then null; end;
  begin
    perform s.user_id from public.student_athletes s limit 1;
    raise exception 'FAIL I7: authenticated can select student_athletes.user_id';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from vault.decrypted_secrets limit 1;
    raise exception 'FAIL audit key: authenticated can read vault.decrypted_secrets';
  exception when insufficient_privilege then null; end;
  perform public.p1_test_as(null);
  raise notice 'PASS anon/I7: anon has no table or helper access; date_of_birth, user_id and the audit HMAC key not readable by clients';
end $$;

-- ── (f) 1.11 — rowsecurity on every new table, and on all of public ──────────
do $$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['org_verified_domains','sports','sport_programs','college_roles','college_capabilities',
                      'role_capabilities','org_role_capability_overrides','role_assignments',
                      'student_athletes','athlete_team_memberships','audit_log']) t
   where not exists (select 1 from pg_tables p where p.schemaname = 'public' and p.tablename = t and p.rowsecurity);
  if v_missing is not null then raise exception 'FAIL (f): rowsecurity false or table missing: %', v_missing; end if;
  select string_agg(tablename, ', ') into v_missing from pg_tables where schemaname = 'public' and not rowsecurity;
  if v_missing is not null then raise exception 'FAIL 1.11: public tables without RLS: %', v_missing; end if;
  raise notice 'PASS (f) 1.11: rowsecurity = true on all 11 new tables and on every table in public';
end $$;

do $$ begin raise notice 'ALL MANAGE PHASE 1 TESTS PASSED (rolling back the test data now)'; end $$;
rollback;
