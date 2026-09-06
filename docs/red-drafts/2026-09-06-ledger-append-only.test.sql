-- Isolated regression fixture for 2026-09-06-ledger-append-only.sql.
-- Run in a disposable PostgreSQL database as an owner; this file is not a
-- production migration and intentionally does not connect to Sporv.
begin;

create schema if not exists sporv_ledger_append_only_test;
create table sporv_ledger_append_only_test.payment_event_ledger(
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  event_type text not null,
  amount_minor bigint,
  outcome text not null,
  reverses_entry_id uuid,
  processed_at timestamptz not null default now()
);

create or replace function sporv_ledger_append_only_test.reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception using errcode='55000', message='ledger is append-only';
end $$;
create trigger reject_mutation before update or delete
  on sporv_ledger_append_only_test.payment_event_ledger
  for each row execute function sporv_ledger_append_only_test.reject_mutation();

insert into sporv_ledger_append_only_test.payment_event_ledger
  (stripe_event_id,event_type,amount_minor,outcome)
values ('evt_fixture','payment_succeeded',1000,'succeeded');

do $$
declare original jsonb; reversed jsonb; rows_written integer;
begin
  select to_jsonb(l) - 'processed_at' into original
  from sporv_ledger_append_only_test.payment_event_ledger l
  where l.stripe_event_id='evt_fixture';
  begin
    update sporv_ledger_append_only_test.payment_event_ledger
      set amount_minor=1 where stripe_event_id='evt_fixture';
    raise exception 'update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from sporv_ledger_append_only_test.payment_event_ledger
      where stripe_event_id='evt_fixture';
    raise exception 'delete unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  insert into sporv_ledger_append_only_test.payment_event_ledger
    (stripe_event_id,event_type,amount_minor,outcome,reverses_entry_id)
    select 'evt_fixture_reversal','refund',-amount_minor,'reversed',id
    from sporv_ledger_append_only_test.payment_event_ledger
    where stripe_event_id='evt_fixture';
  get diagnostics rows_written=row_count;
  if rows_written<>1 then raise exception 'reversal did not append exactly one row'; end if;
  select to_jsonb(l) - 'processed_at' into reversed
  from sporv_ledger_append_only_test.payment_event_ledger l
  where l.stripe_event_id='evt_fixture_reversal';
  if original is null or reversed->>'reverses_entry_id' is null then
    raise exception 'original/reversal receipt missing';
  end if;
  if (select count(*) from sporv_ledger_append_only_test.payment_event_ledger)<>2 then
    raise exception 'ledger row count changed unexpectedly';
  end if;
end $$;

rollback;
