-- ISOLATED FIXTURE ONLY, not production schema-equivalence or live RLS proof.
-- createdb sporv_launch_security_test
-- psql -X -v ON_ERROR_STOP=1 -d sporv_launch_security_test -f this-file
\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'sporv_launch_security_test' then
    raise exception 'refusing: use the dedicated disposable sporv_launch_security_test database';
  end if;
end $$;
create schema auth;
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon;
create table public.providers(id uuid primary key,owner_id uuid,onboarding_completed boolean default true);
create table public.guardians(id uuid primary key,provider_id uuid references public.providers,user_id uuid);
create table public.team_athletes(id uuid primary key,provider_id uuid references public.providers);
create table public.guardian_links(id uuid primary key default gen_random_uuid(),guardian_id uuid references public.guardians,
  member_id uuid references public.team_athletes,is_payer boolean default false,unique(guardian_id,member_id));
alter table public.guardian_links enable row level security;
create policy guardian_links_all_owner on public.guardian_links for all to authenticated using(true) with check(true);
create policy guardian_links_select_self on public.guardian_links for select to authenticated using(
  exists(select from public.guardians g where g.id=guardian_id and g.user_id=auth.uid()));
grant select on public.providers,public.guardians,public.team_athletes to authenticated;
grant select,insert,update,delete on public.guardian_links to authenticated;
create table public.organization_members(id uuid primary key,organization_id uuid,member_user_id uuid,is_active boolean,
  background_check_status text,background_check_completed_at timestamptz);
create table public.programs(id uuid primary key,provider_id uuid);
create table public.sessions(id uuid primary key,program_id uuid,title text,start_date date,end_date date,
  assigned_member_id uuid references public.organization_members,address text,start_time text);
create table public.agent_findings(id uuid primary key,provider_id uuid,code text,status text default 'open',title text,
  subject_id uuid,member_id uuid,amount_cents integer,evidence jsonb);
create table public.agent_proposals(id uuid primary key default gen_random_uuid(),provider_id uuid,kind text,status text default 'pending',
  title text,detail text,proposed jsonb,why_finding_id uuid,applied_by uuid,applied_at timestamptz,run_id uuid);
create unique index uq_proposal_ref on public.agent_proposals(provider_id,kind,(proposed->>'ref')) where status='pending';
alter table public.agent_proposals enable row level security;
create policy agent_proposals_owner on public.agent_proposals for all to authenticated using(
  exists(select from public.providers p where p.id=provider_id and p.owner_id=auth.uid()));
grant all on public.agent_proposals to authenticated;
-- Seed the anonymous grant explicitly so the draft must remove it.
grant select on public.agent_proposals to anon;
create function public.agent_autodraft_on(uuid) returns boolean language sql as $$
  select coalesce(nullif(current_setting('test.agent_mode',true),''),'draft')='draft'$$;
-- Counter fixture records the wrapper's exact fixed arguments; not a live quota test.
create table public.test_quota_calls(actor text,scope text,lim integer,seconds integer);
create function public.consume_edge_rate_limit(text,text,integer,integer) returns boolean language plpgsql as $$begin
  insert into public.test_quota_calls values($1,$2,$3,$4);
  if $2='club-extract:minute' then
    if current_setting('test.minute_verdict',true)='deny' then return false; end if;
    if current_setting('test.minute_verdict',true)='unknown' then return null; end if;
  end if;
  return true; end$$;

insert into public.providers values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',true);
insert into public.guardians values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
insert into public.team_athletes values
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into public.programs select id,id from public.providers;
insert into public.sessions(id,program_id,start_date,address,start_time)
  select id,id,date '2026-10-01','Fixture Hall','10:00' from public.providers;
insert into public.sessions(id,program_id,start_date,address,start_time) values
 ('80000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','2026-10-01','Fixture Hall','10:00');
insert into public.organization_members values
 ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',true,'verified',now()),
 ('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002',true,'verified',now());
insert into public.agent_findings(id,provider_id,code,title,subject_id)
 select id,id,'staffing_gap','Fixture staffing gap',id from public.providers;
insert into public.agent_findings(id,provider_id,code,title,evidence) values
 ('90000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','schedule_conflict','Fixture conflict',
 '{"address":"Fixture Hall","date":"2026-10-01","time":"10:00"}');

\ir 2026-09-04-launch-security.sql

begin;
set local role anon;
do $$ begin
  begin
    perform id from public.agent_proposals;
    raise exception 'FAIL anonymous proposal SELECT still granted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
set local test.actor='10000000-0000-0000-0000-000000000001';
insert into public.guardian_links(guardian_id,member_id) values
 ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
do $$ begin
  begin
    insert into public.guardian_links(guardian_id,member_id) values
      ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002');
    raise exception 'FAIL cross-org insert accepted';
  exception when check_violation then null; end;
  begin
    update public.guardian_links set member_id='40000000-0000-0000-0000-000000000002';
    raise exception 'FAIL cross-org update accepted';
  exception when check_violation then null; end;
  if (select count(*) from public.guardian_links)<>1 then raise exception 'FAIL own link missing'; end if;
end $$;
set local test.actor='30000000-0000-0000-0000-000000000002';
do $$ begin if exists(select from public.guardian_links) then raise exception 'FAIL foreign family sees links'; end if; end $$;
reset role;
do $$ begin
  begin
    update public.guardians set provider_id='00000000-0000-0000-0000-000000000002'
      where id='20000000-0000-0000-0000-000000000001';
    raise exception 'FAIL parent org reassignment broke link';
  exception when foreign_key_violation then null; end;
end $$;

-- Both normal and forced calls must honor Off/Observe and onboarding gates.
do $$ declare mode text; forced boolean; begin
  foreach mode in array array['off','observe'] loop
    perform set_config('test.agent_mode',mode,true);
    foreach forced in array array[false,true] loop
      if public.generate_agent_proposals(null,forced)<>0 or exists(select from public.agent_proposals) then
        raise exception 'FAIL % mode created drafts (force=%)',mode,forced; end if;
    end loop;
  end loop;
  perform set_config('test.agent_mode','draft',true);
  update public.providers set onboarding_completed=false;
  if public.generate_agent_proposals(null,true)<>0 or exists(select from public.agent_proposals) then
    raise exception 'FAIL incomplete onboarding created drafts'; end if;
  update public.providers set onboarding_completed=true;
  if public.generate_agent_proposals()<>2 then raise exception 'FAIL Draft mode did not create both staffing proposals'; end if;
end $$;
do $$ begin
  if not exists(select from public.agent_proposals where provider_id='00000000-0000-0000-0000-000000000001'
    and proposed->>'assign_member'='50000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL generator used user id instead of member id'; end if;
end $$;
-- Malicious service fixture: prove apply defends even an unsafe stored payload.
insert into public.agent_proposals(id,provider_id,kind,proposed,why_finding_id) values
 ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','schedule_adjustment',
 '{"session_id":"00000000-0000-0000-0000-000000000002","expected_start_date":"2026-10-01","new_date":"2026-10-02"}',
 '00000000-0000-0000-0000-000000000001');
set local role authenticated;
set local test.actor='10000000-0000-0000-0000-000000000001';
do $$ declare p uuid; r jsonb; begin
  begin
    update public.agent_proposals set proposed='{}';
    raise exception 'FAIL client forged proposal';
  exception when insufficient_privilege then null; end;
  begin
    perform public.apply_agent_proposal('70000000-0000-0000-0000-000000000001');
    raise exception 'FAIL foreign session changed';
  exception when insufficient_privilege then null; end;
  select id into p from public.agent_proposals where kind='staff_assignment' limit 1;
  r:=public.apply_agent_proposal(p);
  if r->>'rows_written'<>'1' or not(r ? 'inverse') or not(r ? 'before') or not(r ? 'after') then
    raise exception 'FAIL incomplete write receipt'; end if;
  begin
    perform public.apply_agent_proposal(p);
    raise exception using errcode='23514',message='FAIL duplicate application succeeded';
  exception when raise_exception then null; end;
  perform public.consume_club_extract_rate_limit();
end $$;
reset role;
-- Exercise the G4 silent-no-op contract, not just duplicate application.
insert into public.agent_proposals(id,provider_id,kind,proposed,why_finding_id) values
 ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','schedule_adjustment',
 '{"session_id":"00000000-0000-0000-0000-000000000001","expected_start_date":"2026-10-01","new_date":"2026-10-02"}',
 '90000000-0000-0000-0000-000000000001'),
 ('70000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','schedule_adjustment',
 '{"session_id":"00000000-0000-0000-0000-000000000001","expected_start_date":"2026-09-01","new_date":"2026-10-02"}',
 '90000000-0000-0000-0000-000000000001');
create function public.test_suppress_session_write() returns trigger language plpgsql as $$begin return null; end$$;
create trigger test_suppressed_write before update on public.sessions for each row execute function public.test_suppress_session_write();
set local role authenticated;
do $$ begin
  begin
    perform public.apply_agent_proposal('70000000-0000-0000-0000-000000000002');
    raise exception using errcode='23514',message='FAIL zero-row write returned success';
  exception when raise_exception then
    if sqlerrm<>'proposal wrote no row; nothing was applied' then raise; end if;
  end;
  begin
    perform public.apply_agent_proposal('70000000-0000-0000-0000-000000000003');
    raise exception using errcode='23514',message='FAIL stale schedule accepted';
  exception when raise_exception then
    if sqlerrm<>'schedule changed or snapshot missing; review a new proposal' then raise; end if;
  end;
  if exists(select from public.agent_proposals where id in (
    '70000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000003')
    and (status<>'pending' or receipt is not null or applied_at is not null)) then
    raise exception 'FAIL failed write left a success receipt'; end if;
end $$;
reset role;
drop trigger test_suppressed_write on public.sessions;
set local role authenticated;
do $$ declare r jsonb; begin
  r:=public.apply_agent_proposal('70000000-0000-0000-0000-000000000002');
  if r->'before'->>'start_date'<>'2026-10-01' or r->'after'->>'start_date'<>'2026-10-02'
    or r->>'rows_written'<>'1' then raise exception 'FAIL schedule receipt differs from change'; end if;
end $$;
reset role;
do $$ begin
  if (select start_date from public.sessions where id='00000000-0000-0000-0000-000000000002')<>date '2026-10-01' then
    raise exception 'FAIL foreign session modified'; end if;
  if not exists(select from public.test_quota_calls where actor='user:10000000-0000-0000-0000-000000000001'
    and scope='club-extract:minute' and lim=5 and seconds=60) or not exists(
    select from public.test_quota_calls where scope='club-extract:hour' and lim=30 and seconds=3600) then
    raise exception 'FAIL quota wrapper arguments'; end if;
end $$;
-- Fixed-window wrapper accounting: a denied or unknown minute verdict must
-- stop before the hour call; these doubles do not prove real counter atomicity.
do $$ declare verdict text; begin
  foreach verdict in array array['deny','unknown'] loop
    truncate public.test_quota_calls;
    perform set_config('test.minute_verdict',verdict,true);
    if public.consume_club_extract_rate_limit() is distinct from false then
      raise exception 'FAIL % minute verdict did not fail closed',verdict; end if;
    if (select count(*) from public.test_quota_calls)<>1 or exists(
      select from public.test_quota_calls where scope<>'club-extract:minute') then
      raise exception 'FAIL % minute verdict spent hour quota',verdict; end if;
  end loop;
  raise notice 'PASS launch security isolated fixture';
end $$;
rollback;
