-- Disposable-database fixture for the Source R1 recruiting draft
-- (docs/red-drafts/2026-10-22-recruiting-r1.sql, spec 31 §14 Phase R1).
--
--     bash tools/run-sql-fixtures.sh 2026-10-22-recruiting-r1
--
-- RED-FIRST: remove the \ir line below and group A fails on
-- "relation public.recruits does not exist".
--
-- Proves: org-to-org isolation on every Module E table returns zero rows
-- (R1.3 / I6); a minor's guardian rows and DOB/email/phone are hidden from a
-- non-admin coach and readable by an admin with a receipt (R1.13 / I7);
-- under-13 is rejected (R1.7); stage moves only through the RPC, append one
-- receipt each, cannot reach 'enrolled' and need a reason to close
-- (R1.9-R1.11); evaluations are validated and overall is computed (R1.8).
-- Deferred to Phase 1: R1.1/R1.2 (program-to-program), R1.4-R1.6 (sources,
-- imports), R1.12 (gap view) — see the draft header.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_recruit' then
    raise exception 'refusing to run outside the disposable sporv_spec_recruit database (got %)', current_database();
  end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- baseline shapes this draft depends on (columns it touches only)
create table public.providers (id uuid primary key default gen_random_uuid(), owner_id uuid, business_name text);
create table public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid references public.providers(id),
  member_user_id uuid, role text not null default 'trainer', is_active boolean not null default true);
create table public.teams (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), name text, sport text);
-- baseline line 2729, verbatim body
create or replace function public.is_org_admin(p_org uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = auth.uid())
      or exists (select 1 from public.organization_members m where m.organization_id = p_org and m.member_user_id = auth.uid()
                 and m.role in ('owner','admin') and m.is_active) $$;
-- migration 20260915_001075, verbatim body
create or replace function public.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = auth.uid())
      or exists (select 1 from public.organization_members m where m.organization_id = p_org and m.member_user_id = auth.uid() and m.is_active) $$;

\ir 2026-10-22-recruiting-r1.sql

-- ── seed: org A (owner uA, coach uC as 'trainer'), org B (owner uB) ──────
insert into auth.users (id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b'), ('c0000000-0000-4000-8000-00000000000c');
insert into public.providers (id, owner_id, business_name) values
  ('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000a','Lakeview College'),
  ('0b000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','Other College');
insert into public.organization_members (id, organization_id, member_user_id, role) values
  ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','trainer');
insert into public.teams (id, provider_id, name, sport) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Men''s Soccer','Soccer'),
  ('1b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','Women''s Soccer','Soccer');

-- org A data, written AS the org A owner through RLS (not as postgres)
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true); perform set_config('role', 'authenticated', true);
  insert into public.recruits (id, provider_id, first_name, last_name, grad_year, date_of_birth, email, phone, current_school) values
    ('2a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','Maya','Torres',2027,(current_date - interval '16 years')::date,'maya@example.com','555-0101','Westfield HS'),
    ('2a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','Jon','Price',2026,(current_date - interval '19 years')::date,'jon@example.com','555-0102','Lake JC');
  insert into public.recruit_pipelines (id, provider_id, recruit_id, team_id, sport, position_primary, film_links) values
    ('3a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','Soccer','GK',array['https://example.com/film/1']),
    ('3a000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000002',null,'Soccer','CB','{}');
  insert into public.recruit_guardians (provider_id, recruit_id, full_name, relationship, email, is_primary) values
    ('0a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Ana Torres','mother','ana@example.com',true);
  insert into public.recruit_contacts (provider_id, pipeline_id, recruit_id, contact_kind, summary) values
    ('0a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000002','phone','Intro call');
  insert into public.recruiting_targets (provider_id, sport, entry_year, position, target_count) values
    ('0a000000-0000-4000-8000-000000000001','Soccer','2027','GK',2);
  perform set_config('role', 'postgres', true);
end $$;

-- A · RLS is on for every Module E table (I6) and anon has no table grant ──
do $$ declare n int; begin
  select count(*) into n from pg_tables where schemaname='public' and tablename in
    ('recruits','recruit_pipelines','recruit_stage_history','recruit_guardians','recruit_evaluations','recruit_contacts','recruiting_targets','data_access_log')
    and rowsecurity;
  if n <> 8 then raise exception 'FAIL A: % of 8 recruiting tables have RLS on', n; end if;
  select count(*) into n from information_schema.role_table_grants where grantee = 'anon' and table_name like 'recruit%';
  if n <> 0 then raise exception 'FAIL A: anon holds % grants on recruiting tables', n; end if;
  raise notice 'PASS A: RLS on all 8 recruiting tables; anon holds no grants';
end $$;

-- B · cross-org isolation: org B's owner reads ZERO rows of org A, and cannot attach to org A's recruit (R1.3) ──
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true); perform set_config('role', 'authenticated', true);
  select count(*) into n from public.recruits;              if n <> 0 then raise exception 'FAIL B: org B reads % recruits', n; end if;
  select count(*) into n from public.recruit_pipelines;     if n <> 0 then raise exception 'FAIL B: org B reads % pipelines', n; end if;
  select count(*) into n from public.recruit_stage_history; if n <> 0 then raise exception 'FAIL B: org B reads % history rows', n; end if;
  select count(*) into n from public.recruit_guardians;     if n <> 0 then raise exception 'FAIL B: org B reads % guardians', n; end if;
  select count(*) into n from public.recruit_contacts;      if n <> 0 then raise exception 'FAIL B: org B reads % contacts', n; end if;
  select count(*) into n from public.recruit_evaluations;   if n <> 0 then raise exception 'FAIL B: org B reads % evaluations', n; end if;
  select count(*) into n from public.recruiting_targets;    if n <> 0 then raise exception 'FAIL B: org B reads % targets', n; end if;
  begin   -- org B claims its own provider_id but points at org A's recruit: the tenant is derived from the recruit, so RLS refuses
    insert into public.recruit_pipelines (provider_id, recruit_id, sport) values
      ('0b000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','Basketball');
    raise exception 'FAIL B: org B attached a pipeline to org A''s recruit';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.recruit_contacts (provider_id, pipeline_id, recruit_id, contact_kind) values
      ('0b000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','email');
    raise exception 'FAIL B: org B logged a contact on org A''s pipeline';
  exception when insufficient_privilege then null; end;
  begin
    perform public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','contacted');
    raise exception 'FAIL B: org B moved org A''s recruit';
  exception when insufficient_privilege then null; end;
  begin   -- a pipeline in org B may not name org A's team
    insert into public.recruits (id, provider_id, first_name, last_name) values ('2b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','Lee','Kim');
    insert into public.recruit_pipelines (recruit_id, provider_id, sport, team_id) values
      ('2b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','Soccer','1a000000-0000-4000-8000-000000000001');
    raise exception 'FAIL B: org B scoped a pipeline to org A''s team';
  exception when foreign_key_violation then null; end;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS B: org B reads 0 rows from all 7 org-A tables and cannot write into org A';
end $$;

-- C · minors compartmented (I7): coach sees the recruit but not the guardian, DOB, email or phone ──
do $$ declare n int; r record; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true); perform set_config('role', 'authenticated', true);
  select count(*) into n from public.recruits; if n <> 2 then raise exception 'FAIL C: coach sees % recruits, expected 2', n; end if;
  select count(*) into n from public.recruit_guardians; if n <> 0 then raise exception 'FAIL C: coach reads % guardian rows', n; end if;
  begin
    perform date_of_birth from public.recruits limit 1;
    raise exception 'FAIL C: coach selected recruits.date_of_birth';
  exception when insufficient_privilege then null; end;
  begin
    perform email from public.recruits limit 1;
    raise exception 'FAIL C: coach selected recruits.email';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.get_recruit_sensitive('2a000000-0000-4000-8000-000000000001');
    raise exception 'FAIL C: coach read a minor''s contact details through the RPC';
  exception when insufficient_privilege then null; end;
  select * into r from public.get_recruit_sensitive('2a000000-0000-4000-8000-000000000002');   -- an adult: allowed
  if r.email <> 'jon@example.com' or r.is_minor then raise exception 'FAIL C: adult sensitive read returned %', r; end if;
  -- the coach may still RECORD a guardian (they collect it at camp), but cannot read it back
  insert into public.recruit_guardians (provider_id, recruit_id, full_name) values ('0a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000002','Pat Price');
  select count(*) into n from public.recruit_guardians; if n <> 0 then raise exception 'FAIL C: coach reads back % guardians', n; end if;

  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  select count(*) into n from public.recruit_guardians; if n <> 2 then raise exception 'FAIL C: admin sees % guardians, expected 2', n; end if;
  select * into r from public.get_recruit_sensitive('2a000000-0000-4000-8000-000000000001');
  if r.email <> 'maya@example.com' or not r.is_minor then raise exception 'FAIL C: admin minor read returned %', r; end if;
  select count(*) into n from public.data_access_log where subject_id = '2a000000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL C: % access receipts for the minor, expected 1', n; end if;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS C: coach reads 0 guardian rows and no minor DOB/email/phone; admin reads them with one receipt';
end $$;

-- D · under-13 rejected; unknown DOB is treated as a minor (R1.7, E8.1) ──
do $$ declare m boolean; begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true); perform set_config('role', 'authenticated', true);
  begin
    insert into public.recruits (provider_id, first_name, last_name, date_of_birth) values
      ('0a000000-0000-4000-8000-000000000001','Too','Young',(current_date - interval '12 years')::date);
    raise exception 'FAIL D: a 12-year-old recruit was accepted';
  exception when raise_exception then
    if sqlerrm not like 'RECRUIT_UNDER_13%' then raise; end if;
  end;
  insert into public.recruits (id, provider_id, first_name, last_name) values ('2a000000-0000-4000-8000-000000000009','0a000000-0000-4000-8000-000000000001','No','Dob');
  select is_minor into m from public.recruits where id = '2a000000-0000-4000-8000-000000000009';
  if not m then raise exception 'FAIL D: unknown DOB was not treated as a minor'; end if;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS D: age 12 rejected with RECRUIT_UNDER_13; unknown DOB is a minor';
end $$;

-- E · stage moves: RPC only, one receipt each, no enrolled, closed needs a reason, history append-only (R1.9-R1.11) ──
do $$ declare n int; h public.recruit_stage_history; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true); perform set_config('role', 'authenticated', true);
  begin
    update public.recruit_pipelines set stage = 'offer' where id = '3a000000-0000-4000-8000-000000000001';
    raise exception 'FAIL E: a direct UPDATE of stage was allowed';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.recruit_stage_history where pipeline_id = '3a000000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL E: % history rows after insert, expected 1', n; end if;
  h := public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','visit');
  if h.from_stage <> 'identified' or h.to_stage <> 'visit' or h.actor_id <> 'c0000000-0000-4000-8000-00000000000c' then raise exception 'FAIL E: receipt %', h; end if;
  h := public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','visit');   -- no-op
  select count(*) into n from public.recruit_stage_history where pipeline_id = '3a000000-0000-4000-8000-000000000001';
  if n <> 2 then raise exception 'FAIL E: % history rows after a forward move and a no-op, expected 2', n; end if;
  begin
    perform public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','identified');
    raise exception 'FAIL E: moved backward without a note';
  exception when raise_exception then if sqlerrm not like 'RECRUIT_STAGE_BACKWARD_NOTE%' then raise; end if; end;
  h := public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','contacted','Visit cancelled by family');
  if h.note <> 'Visit cancelled by family' then raise exception 'FAIL E: backward note not recorded'; end if;
  begin
    perform public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','enrolled');
    raise exception 'FAIL E: reached enrolled without conversion';
  exception when raise_exception then if sqlerrm not like 'RECRUIT_ENROLLED_BY_CONVERSION_ONLY%' then raise; end if; end;
  begin
    perform public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','closed');
    raise exception 'FAIL E: closed without a reason';
  exception when raise_exception then if sqlerrm not like 'RECRUIT_CLOSED_REASON%' then raise; end if; end;
  h := public.move_recruit_stage('3a000000-0000-4000-8000-000000000001','closed',null,'chose_other_school');
  if h.to_stage <> 'closed' then raise exception 'FAIL E: close receipt %', h; end if;
  perform set_config('role', 'postgres', true);
  begin
    update public.recruit_stage_history set note = 'edited' where pipeline_id = '3a000000-0000-4000-8000-000000000001';
    raise exception 'FAIL E: history row edited';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.recruit_stage_history where pipeline_id = '3a000000-0000-4000-8000-000000000001';
    raise exception 'FAIL E: history row deleted';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS E: stage only via RPC; one receipt per real move; backward needs a note; no enrolled; closed needs a reason; history append-only even for the owner';
end $$;

-- F · evaluations validated, overall computed; first eval advances identified -> evaluated; contacts stamp last contact (R1.8, E4) ──
do $$ declare o numeric; s text; lc timestamptz; ws text; begin
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true); perform set_config('role', 'authenticated', true);
  begin
    insert into public.recruit_evaluations (provider_id, pipeline_id, recruit_id, scores, overall) values
      ('0a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000002',
       '{"athleticism":6,"technique":3,"game_sense":3,"competitiveness":3,"coachability":3}', 0);
    raise exception 'FAIL F: a score of 6 was accepted';
  exception when raise_exception then if sqlerrm not like 'RECRUIT_EVAL_SCORES%' then raise; end if; end;
  begin
    insert into public.recruit_evaluations (provider_id, pipeline_id, recruit_id, scores, overall) values
      ('0a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000002',
       '{"athleticism":4,"technique":3}', 0);
    raise exception 'FAIL F: a missing criterion was accepted';
  exception when raise_exception then if sqlerrm not like 'RECRUIT_EVAL_SCORES%' then raise; end if; end;
  insert into public.recruit_evaluations (provider_id, pipeline_id, recruit_id, scores, overall, notes) values
    ('0a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000002',
     '{"athleticism":5,"technique":4,"game_sense":4,"competitiveness":5,"coachability":3}', 1.00, 'Strong in the air');
  select overall into o from public.recruit_evaluations where pipeline_id = '3a000000-0000-4000-8000-000000000002';
  if o <> 4.20 then raise exception 'FAIL F: overall % , expected 4.20 = (5+4+4+5+3)/5', o; end if;
  -- the pipeline already had an outbound contact (seed) so it sits at contacted; an evaluation never moves it backward
  select stage, last_contact_at::text into s, ws from public.recruit_pipelines where id = '3a000000-0000-4000-8000-000000000002';
  if s <> 'contacted' or ws is null then raise exception 'FAIL F: pipeline 2 at % with last contact %', s, ws; end if;
  select permissible_window_status into ws from public.recruit_contacts limit 1;
  if ws <> 'unchecked' then raise exception 'FAIL F: R1 claimed a window verdict %', ws; end if;
  -- a fresh pipeline at identified moves to evaluated on its first evaluation
  insert into public.recruit_pipelines (id, recruit_id, provider_id, sport) values
    ('3a000000-0000-4000-8000-000000000009','2a000000-0000-4000-8000-000000000009','0a000000-0000-4000-8000-000000000001','Soccer');
  insert into public.recruit_evaluations (provider_id, pipeline_id, recruit_id, scores, overall) values
    ('0a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000009','2a000000-0000-4000-8000-000000000009',
     '{"athleticism":3,"technique":3,"game_sense":3,"competitiveness":3,"coachability":3}', 0);
  select stage into s from public.recruit_pipelines where id = '3a000000-0000-4000-8000-000000000009';
  if s <> 'evaluated' then raise exception 'FAIL F: first evaluation left the pipeline at %', s; end if;
  begin   -- film links must be https
    update public.recruit_pipelines set film_links = array['javascript:alert(1)'] where id = '3a000000-0000-4000-8000-000000000009';
    raise exception 'FAIL F: a non-https film link was stored';
  exception when check_violation then null; end;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS F: bad scores rejected; overall 4.20 computed; contacts stamp last contact and stay unchecked; first eval advances to evaluated; https-only film';
end $$;
