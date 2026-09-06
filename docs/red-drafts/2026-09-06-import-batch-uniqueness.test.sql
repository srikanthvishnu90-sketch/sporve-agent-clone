-- Isolated regression fixture for 2026-09-06-import-batch-uniqueness.sql.
-- Run in a disposable PostgreSQL database as an owner; no Sporv connection.
begin;
create schema if not exists sporv_import_batch_test;
create table sporv_import_batch_test.import_batches(
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null,
  content_hash text not null,
  undone_at timestamptz
);
create unique index import_batches_provider_content_hash_active_uq
  on sporv_import_batch_test.import_batches(provider_id,content_hash)
  where undone_at is null;

insert into sporv_import_batch_test.import_batches(provider_id,content_hash)
values ('00000000-0000-0000-0000-000000000001','hash-a');
do $$ begin
  begin
    insert into sporv_import_batch_test.import_batches(provider_id,content_hash)
    values ('00000000-0000-0000-0000-000000000001','hash-a');
    raise exception 'active duplicate import unexpectedly succeeded';
  exception when unique_violation then null;
  end;
  insert into sporv_import_batch_test.import_batches(provider_id,content_hash,undone_at)
  values ('00000000-0000-0000-0000-000000000001','hash-a',now());
end $$;
rollback;
