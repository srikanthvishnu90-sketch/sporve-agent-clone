-- ISOLATED SYNTHETIC FIXTURE: not a full clean clone, RLS or JWT proof.
-- Empty dedicated local PostgreSQL17 database only; never production/shared DB.
-- psql -X -v ON_ERROR_STOP=1 -d sporv_outbound_status_test -f this-file
\set ON_ERROR_STOP on
do $$ begin
  if current_database()<>'sporv_outbound_status_test' then
    raise exception 'refusing: use dedicated disposable sporv_outbound_status_test';
  end if;
end $$;
create table public.outbound_messages (
  id integer primary key,
  status text not null default 'pending',
  content jsonb not null default '{}',
  constraint outbound_messages_status_check check (status = any (array[
    'pending'::text,'processing'::text,'drafted'::text,'approved'::text,'sent'::text,'skipped'::text]))
);
insert into public.outbound_messages(id,status,content)
select n,s,jsonb_build_object('fixture',s) from unnest(array[
  'pending','processing','drafted','approved','sent','skipped']) with ordinality as states(s,n);
create table fixture_original as select * from public.outbound_messages;
create table fixture_column_contract as select attname,atttypid,attnotnull,
  pg_get_expr(d.adbin,d.adrelid) as default_expression
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid='public.outbound_messages'::regclass and a.attnum>0 and not a.attisdropped;

-- Reproduce the canonical failure before the draft is applied.
do $$ begin
  begin
    update public.outbound_messages set status='needs_review' where id=4;
    raise exception 'fixture expected old six-state constraint to reject review receipt';
  exception when check_violation then null; end;
  begin
    update public.outbound_messages set status='failed' where id=4;
    raise exception 'fixture expected old six-state constraint to reject failed receipt';
  exception when check_violation then null; end;
end $$;

\ir 2026-09-05-outbound-status.sql
\ir 2026-09-05-outbound-status.sql

do $$ begin
  if exists((select * from public.outbound_messages except select * from fixture_original)
    union all (select * from fixture_original except select * from public.outbound_messages)) then
    raise exception 'reconciliation changed original data';
  end if;
  if exists((select attname,atttypid,attnotnull,pg_get_expr(d.adbin,d.adrelid)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.outbound_messages'::regclass and a.attnum>0 and not a.attisdropped
    except select * from fixture_column_contract)
    union all (select * from fixture_column_contract except
    select attname,atttypid,attnotnull,pg_get_expr(d.adbin,d.adrelid)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.outbound_messages'::regclass and a.attnum>0 and not a.attisdropped)) then
    raise exception 'reconciliation changed column/default contract';
  end if;
end $$;

insert into public.outbound_messages(id,status) values (7,'needs_review'),(8,'failed');
-- The already-live eight-state shape must also be accepted with nonempty rows.
\ir 2026-09-05-outbound-status.sql

do $$ declare received text; begin
  update public.outbound_messages set status='needs_review' where id=4 and status='approved'
    returning status into received;
  if received is distinct from 'needs_review' then raise exception 'review receipt missing'; end if;
  update public.outbound_messages set status='failed' where id=4 and status='needs_review'
    returning status into received;
  if received is distinct from 'failed' then raise exception 'failure receipt missing'; end if;
  begin
    insert into public.outbound_messages(id,status) values (9,'arbitrary_status');
    raise exception 'unknown status unexpectedly accepted';
  exception when check_violation then null; end;
  begin
    insert into public.outbound_messages(id,status) values (9,null);
    raise exception 'NULL status unexpectedly accepted';
  exception when not_null_violation then null; end;
  insert into public.outbound_messages(id) values (10) returning status into received;
  if received is distinct from 'pending' then raise exception 'pending default lost'; end if;
  if (select count(*) from public.outbound_messages)<>9 then raise exception 'unexpected row count'; end if;
end $$;
select 'PASS: six-to-eight status reconciliation, nonempty idempotence, receipts, invalid-status rejection, unchanged data/columns' as fixture_result;
