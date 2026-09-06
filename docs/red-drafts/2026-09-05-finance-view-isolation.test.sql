-- ISOLATED SYNTHETIC FIXTURE ONLY, not full production RLS or valid-JWT proof.
-- Use a disposable LOCAL PostgreSQL15+ cluster and an empty database named
-- sporv_finance_view_test; never point this fixture at a shared/production DB.
-- psql -X -v ON_ERROR_STOP=1 -d sporv_finance_view_test -f this-file
\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'sporv_finance_view_test' then
    raise exception 'refusing: use dedicated disposable sporv_finance_view_test';
  end if;
end $$;
create schema auth;
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists(select from pg_roles where rolname='service_role' and rolbypassrls) then
    raise exception 'fixture needs a service_role with BYPASSRLS on the disposable cluster'; end if;
end $$;
create function auth.uid() returns uuid language sql stable as
$$select nullif(current_setting('test.actor',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table public.providers(id uuid primary key,owner_id uuid);
create table public.guardians(id uuid primary key,provider_id uuid,user_id uuid);
create table public.guardian_links(guardian_id uuid,member_id uuid);
create table public.fee_schedules(id uuid primary key,provider_id uuid,member_id uuid);
create table public.installments(id uuid primary key,fee_schedule_id uuid,member_id uuid,
  amount_cents integer,status text check(status in ('due','processing','paid','failed','waived')),
  due_date date,attempt_count integer,last_attempt_at timestamptz);
grant select on public.providers,public.guardians,public.guardian_links,public.fee_schedules,public.installments
  to anon,authenticated,service_role;
alter table public.providers enable row level security;
alter table public.guardians enable row level security;
alter table public.guardian_links enable row level security;
alter table public.fee_schedules enable row level security;
alter table public.installments enable row level security;
create policy fixture_provider_owner on public.providers for select to authenticated using(owner_id=auth.uid());
create policy fixture_guardian_self on public.guardians for select to authenticated using(user_id=auth.uid());
create policy fixture_link_self on public.guardian_links for select to authenticated using(
  exists(select from public.guardians g where g.id=guardian_id and g.user_id=auth.uid()));
-- Mirrors the live fee/installment owner and guardian SELECT predicates.
create policy fixture_fee_owner on public.fee_schedules for select to authenticated using(
  exists(select from public.providers pv where pv.id=provider_id and pv.owner_id=auth.uid()));
create policy fixture_fee_guardian on public.fee_schedules for select to authenticated using(
  exists(select from public.guardian_links gl join public.guardians g on g.id=gl.guardian_id
    where gl.member_id=fee_schedules.member_id and g.user_id=auth.uid()));
create policy fixture_installment_owner on public.installments for select to authenticated using(
  exists(select from public.fee_schedules fs join public.providers pv on pv.id=fs.provider_id
    where fs.id=installments.fee_schedule_id and pv.owner_id=auth.uid()));
create policy fixture_installment_guardian on public.installments for select to authenticated using(
  exists(select from public.guardian_links gl join public.guardians g on g.id=gl.guardian_id
    where gl.member_id=installments.member_id and g.user_id=auth.uid()));
-- Two families in org A and one in org B, with distinct synthetic actors.
insert into public.providers values
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into public.guardians values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003');
insert into public.guardian_links select id,id from public.guardians;
insert into public.fee_schedules select id,provider_id,id from public.guardians;
insert into public.installments select id,id,id,1000,'due',current_date-1,0,null from public.guardians;
-- Existing view definitions preserved exactly in the proposed ALTER-only repair.
create view public.org_ar as select fs.provider_id,
 sum(i.amount_cents) as billed_cents,
 sum(i.amount_cents) filter(where i.status='paid') as collected_cents,
 sum(i.amount_cents) filter(where i.due_date<current_date and i.status<>'paid' and i.status<>'waived') as overdue_cents,
 count(distinct i.member_id) filter(where i.due_date<current_date and i.status<>'paid' and i.status<>'waived') as overdue_members
 from public.installments i join public.fee_schedules fs on fs.id=i.fee_schedule_id group by fs.provider_id;
create view public.org_overdue_list as select fs.provider_id,i.member_id,i.id as installment_id,
 i.amount_cents,i.due_date,current_date-i.due_date as days_late,i.attempt_count,i.last_attempt_at
 from public.installments i join public.fee_schedules fs on fs.id=i.fee_schedule_id
 where i.due_date<current_date and i.status not in ('paid','waived');
grant select on public.org_ar,public.org_overdue_list to public,anon,authenticated,service_role;
create temp table original_view_definitions as select oid,pg_get_viewdef(oid) as definition from pg_class
 where relnamespace='public'::regnamespace and relname in ('org_ar','org_overdue_list');
create temp table original_view_columns as select table_name,ordinal_position,column_name,data_type,udt_name
 from information_schema.columns where table_schema='public' and table_name in ('org_ar','org_overdue_list');
set role anon;
do $$ begin
  if (select count(*) from public.installments)<>0 then raise exception 'fixture base RLS invalid'; end if;
  if (select count(*) from public.org_overdue_list)<>3 then raise exception 'fixture did not reproduce definer exposure'; end if;
end $$;
reset role;
\ir 2026-09-05-finance-view-isolation.sql
-- Reapplication must remain safe and not change view definitions or data.
\ir 2026-09-05-finance-view-isolation.sql
do $$ begin
  if exists(select from original_view_definitions where definition<>pg_get_viewdef(oid)) then
    raise exception 'FAIL view query changed'; end if;
  if exists((select * from original_view_columns except
    select table_name,ordinal_position,column_name,data_type,udt_name from information_schema.columns
      where table_schema='public' and table_name in ('org_ar','org_overdue_list')) union all
    (select table_name,ordinal_position,column_name,data_type,udt_name from information_schema.columns
      where table_schema='public' and table_name in ('org_ar','org_overdue_list') except
    select * from original_view_columns)) then raise exception 'FAIL view column contract changed'; end if;
  if (select count(*) from public.installments)<>3 then raise exception 'FAIL fixture rows changed'; end if;
end $$;
set role anon;
do $$ begin
  begin perform * from public.org_ar; raise exception 'FAIL anon AR readable';
  exception when insufficient_privilege then null; end;
  begin perform * from public.org_overdue_list; raise exception 'FAIL anon overdue readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
set test.actor='10000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.org_ar)<>1 or (select billed_cents from public.org_ar)<>2000
    or (select count(*) from public.org_overdue_list)<>2
    or exists(select from public.org_ar where provider_id<>'00000000-0000-0000-0000-000000000001')
    or exists(select from public.org_overdue_list where provider_id<>'00000000-0000-0000-0000-000000000001')
    then raise exception 'FAIL owner A scope or totals'; end if;
end $$;
set test.actor='10000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from public.org_ar)<>1 or (select billed_cents from public.org_ar)<>1000
    or (select count(*) from public.org_overdue_list)<>1
    or exists(select from public.org_ar where provider_id<>'00000000-0000-0000-0000-000000000002')
    or exists(select from public.org_overdue_list where provider_id<>'00000000-0000-0000-0000-000000000002')
    then raise exception 'FAIL owner B scope or totals'; end if;
end $$;
set test.actor='30000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.org_overdue_list)<>1 or (select billed_cents from public.org_ar)<>1000
    or exists(select from public.org_overdue_list where member_id<>'20000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL guardian sees another family or incorrect totals'; end if;
end $$;
set test.actor='90000000-0000-0000-0000-000000000001';
do $$ begin
  if exists(select from public.org_ar) or exists(select from public.org_overdue_list) then
    raise exception 'FAIL unrelated authenticated actor sees finance'; end if;
end $$;
reset role;
set role service_role;
do $$ begin
  if (select count(*) from public.org_ar)<>2 or (select count(*) from public.org_overdue_list)<>3 then
    raise exception 'FAIL service-role finance access regressed'; end if;
end $$;
reset role;
do $$ begin raise notice 'PASS isolated finance-view role fixture; not live JWT proof'; end $$;
