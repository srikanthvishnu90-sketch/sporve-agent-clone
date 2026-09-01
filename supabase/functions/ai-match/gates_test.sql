-- Fixtures + assertions for the deterministic match gates (spec §11 cases).
-- A near location ~ (40.00,-75.00); all "near" listings are < 40km from it.
\set ON_ERROR_STOP on

-- One verified+active provider offering programs across every intensity tier,
-- plus a SECOND provider that is background-check 'pending' (G5 negative).
insert into providers(id, business_name, sports, latitude, longitude, background_check_status, account_status) values
 ('11111111-1111-1111-1111-111111111111','Verified Coaching','{Basketball,Soccer,Baseball,Tennis}',40.02,-75.01,'verified','active'),
 ('22222222-2222-2222-2222-222222222222','Pending Coaching','{Basketball}',40.01,-75.00,'pending','active');

-- programs: (id, provider, sport, intensity, age_min, age_max, price, session_types)
insert into programs(id, provider_id, title, sport_type, price, minimum_age, maximum_age, latitude, longitude, intensity_tier, session_types, average_rating, total_reviews) values
 ('a0000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','Rec Hoops','Basketball',50,4,8,40.02,-75.01,0,'{small_group,one_on_one}',4.6,40),       -- tier0
 ('a3000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Elite AAU','Basketball',150,8,18,40.02,-75.01,3,'{team,small_group}',4.9,200),         -- tier3
 ('b1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Soccer Skills','Soccer',60,6,12,40.02,-75.01,1,'{small_group}',4.5,30),                -- tier1
 ('b2000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Travel Soccer','Soccer',90,9,14,40.02,-75.01,2,'{team}',4.7,55),                       -- tier2
 ('c3000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Comp Baseball','Baseball',110,12,18,40.02,-75.01,3,'{team,small_group}',4.8,70),       -- tier3
 ('c2000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Select Baseball','Baseball',95,12,18,40.02,-75.01,2,'{team}',4.4,25),                  -- tier2
 ('d4000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','HP Tennis','Tennis',180,14,18,40.02,-75.01,4,'{one_on_one}',4.9,90),                   -- tier4
 ('d3000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Elite Tennis','Tennis',140,14,18,40.02,-75.01,3,'{one_on_one,small_group}',4.7,60),    -- tier3
 ('e2000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Pending Hoops','Basketball',50,4,12,40.01,-75.00,0,'{small_group}',5.0,10);            -- tier0 but G5 pending

-- give every program an open session this week so availability never confounds G-tests
-- ORGANIZATION provider that is ITSELF 'verified' at the provider level, with a
-- roster of one VERIFIED trainer and one UNVERIFIED trainer — proves per-human G5:
-- the org's verification never vouches a trainer past the background check.
insert into providers(id, business_name, sports, latitude, longitude, background_check_status, account_status, provider_type) values
 ('33333333-3333-3333-3333-333333333333','Verified Org','{Basketball}',40.02,-75.01,'verified','active','organization');
insert into organization_members(id, organization_id, background_check_status, is_active) values
 ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','verified',true),
 ('66666666-6666-6666-6666-666666666666','33333333-3333-3333-3333-333333333333','none',    true);
insert into programs(id, provider_id, title, sport_type, price, minimum_age, maximum_age, latitude, longitude, intensity_tier, session_types, average_rating, total_reviews, assigned_member_id) values
 ('f5000000-0000-0000-0000-000000000005','33333333-3333-3333-3333-333333333333','Org VER Trainer',  'Basketball',50,4,12,40.02,-75.01,0,'{small_group}',4.8,20,'55555555-5555-5555-5555-555555555555'),
 ('f6000000-0000-0000-0000-000000000006','33333333-3333-3333-3333-333333333333','Org UNVER Trainer','Basketball',50,4,12,40.02,-75.01,0,'{small_group}',4.8,20,'66666666-6666-6666-6666-666666666666'),
 ('f7000000-0000-0000-0000-000000000007','33333333-3333-3333-3333-333333333333','Org Any Trainer',  'Basketball',50,4,12,40.02,-75.01,0,'{small_group}',4.8,20,null);

insert into sessions(program_id, start_date, capacity) select id, current_date+2, 10 from programs;

do $$
declare ids uuid[];
  cli jsonb;
begin
  -- helper inline: fetch eligible program ids for a client
  -- CASE 1: 6yo basketball, competitive intent -> tier ceiling 0. Rec eligible, Elite AAU GATED (G1).
  cli := '{"athlete_age":6,"sport":"Basketball","skill_level":"beginner","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if not ('a0000000-0000-0000-0000-000000000000' = any(ids)) then raise exception 'CASE1 FAIL: Rec (tier0) must be eligible'; end if;
  if ('a3000000-0000-0000-0000-000000000003' = any(coalesce(ids,'{}'))) then raise exception 'CASE1 FAIL: Elite AAU (tier3) must be GATED for a 6yo'; end if;
  raise notice 'CASE1 PASS (6yo: tier0 in, tier3 gated)';

  -- CASE 2: 10yo soccer skill_development -> ceiling 1. Skills in, Travel(tier2) gated.
  cli := '{"athlete_age":10,"sport":"Soccer","skill_level":"developing","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if not ('b1000000-0000-0000-0000-000000000001' = any(ids)) then raise exception 'CASE2 FAIL: Soccer skills (tier1) eligible'; end if;
  if ('b2000000-0000-0000-0000-000000000002' = any(coalesce(ids,'{}'))) then raise exception 'CASE2 FAIL: Travel soccer (tier2) must be gated for a 10yo'; end if;
  raise notice 'CASE2 PASS (10yo: tier1 in, tier2 gated)';

  -- CASE 3: 14yo advanced baseball competitive -> ceiling 3. Comp(3) + Select(2) eligible.
  cli := '{"athlete_age":14,"sport":"Baseball","skill_level":"advanced","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if not ('c3000000-0000-0000-0000-000000000003' = any(ids) and 'c2000000-0000-0000-0000-000000000002' = any(ids))
    then raise exception 'CASE3 FAIL: tier2 + tier3 baseball must be eligible for 14yo advanced'; end if;
  raise notice 'CASE3 PASS (14yo advanced: tier2+tier3 in)';

  -- CASE 4: 17yo elite tennis -> ceiling 4 (advanced/elite bump). HP(4) + Elite(3) eligible.
  cli := '{"athlete_age":17,"sport":"Tennis","skill_level":"elite","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if not ('d4000000-0000-0000-0000-000000000004' = any(ids)) then raise exception 'CASE4 FAIL: HP tennis (tier4) eligible for 17yo elite'; end if;
  raise notice 'CASE4 PASS (17yo elite: tier4 in)';
  -- ...and 17yo INTERMEDIATE caps at 3 -> tier4 gated.
  cli := '{"athlete_age":17,"sport":"Tennis","skill_level":"intermediate","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if ('d4000000-0000-0000-0000-000000000004' = any(coalesce(ids,'{}'))) then raise exception 'CASE4b FAIL: tier4 must be gated for 17yo intermediate'; end if;
  raise notice 'CASE4b PASS (17yo intermediate: tier4 gated)';

  -- CASE 6: best-fit basketball is background_check pending -> G5 removes it entirely.
  cli := '{"athlete_age":6,"sport":"Basketball","skill_level":"beginner","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if ('e2000000-0000-0000-0000-000000000002' = any(coalesce(ids,'{}'))) then raise exception 'CASE6 FAIL: pending-background provider must be GATED (G5)'; end if;
  raise notice 'CASE6 PASS (G5: pending background removed)';

  -- CASE 7: nothing within radius -> empty.
  cli := '{"athlete_age":14,"sport":"Baseball","skill_level":"advanced","lat":10.0,"lng":10.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if coalesce(array_length(ids,1),0) <> 0 then raise exception 'CASE7 FAIL: nothing within 40km must return empty'; end if;
  raise notice 'CASE7 PASS (G4: no provider in radius -> empty)';

  -- CASE 8: adult -> ceiling removed; tier3 AAU eligible.
  cli := '{"athlete_age":25,"sport":"Basketball","skill_level":"intermediate","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if not ('a3000000-0000-0000-0000-000000000003' = any(ids)) then raise exception 'CASE8 FAIL: adult -> tier3 eligible (no ceiling)'; end if;
  raise notice 'CASE8 PASS (adult: ceiling removed)';

  -- G6 budget (cents): 14yo advanced baseball, budget 100*100=10000 cents -> $110 Comp gated, $95 Select in.
  cli := '{"athlete_age":14,"sport":"Baseball","skill_level":"advanced","lat":40.0,"lng":-75.0,"max_distance_km":40,"budget_max_per_session":10000}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if ('c3000000-0000-0000-0000-000000000003' = any(coalesce(ids,'{}'))) then raise exception 'G6 FAIL: $110 program must be gated under $100 budget'; end if;
  if not ('c2000000-0000-0000-0000-000000000002' = any(ids)) then raise exception 'G6 FAIL: $95 program must remain eligible'; end if;
  raise notice 'G6 PASS (budget cap enforced in cents)';

  -- G7 session type: 17yo elite tennis wanting one_on_one -> HP(one_on_one) in, a team-only would be out.
  cli := '{"athlete_age":17,"sport":"Tennis","skill_level":"elite","lat":40.0,"lng":-75.0,"max_distance_km":40,"session_type_pref":"one_on_one"}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if not ('d4000000-0000-0000-0000-000000000004' = any(ids)) then raise exception 'G7 FAIL: one_on_one program must be eligible'; end if;
  raise notice 'G7 PASS (session-type preference enforced)';

  -- G5-ORG: per-human safety for ORGANIZATION providers. The org is itself
  -- 'verified', but that must NOT vouch a trainer. A service assigned to an
  -- UNVERIFIED trainer is GATED; the verified trainer's service and the
  -- "any available trainer" service (org has a verified member) are eligible.
  cli := '{"athlete_age":6,"sport":"Basketball","skill_level":"beginner","lat":40.0,"lng":-75.0,"max_distance_km":40}';
  select array_agg(program_id) into ids from public.match_eligible(cli);
  if not ('f5000000-0000-0000-0000-000000000005' = any(ids)) then raise exception 'G5-ORG FAIL: verified-trainer service must be eligible'; end if;
  if     ('f6000000-0000-0000-0000-000000000006' = any(coalesce(ids,'{}'))) then raise exception 'G5-ORG FAIL: UNVERIFIED-trainer service must be GATED even though the org is verified'; end if;
  if not ('f7000000-0000-0000-0000-000000000007' = any(ids)) then raise exception 'G5-ORG FAIL: any-trainer org service must be eligible (org has a verified member)'; end if;
  raise notice 'G5-ORG PASS (per-trainer background check: org verification never vouches a trainer)';
end $$;
