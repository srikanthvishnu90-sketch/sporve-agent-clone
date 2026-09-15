-- Disposable-database fixture for spec 17 slice 1, migration 20260915_001062.
-- Never runs against production.
--
--     bash tools/run-sql-fixtures.sh 2026-09-15-spec17
--
-- RED-FIRST: with the \ir line removed, assertion A fails on
-- "relation public.import_row does not exist". With the include present every
-- assertion must PASS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_importrow' then
    raise exception 'refusing to run outside the disposable sporv_spec_importrow database (got %)', current_database();
  end if;
end $$;

create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.providers (id uuid primary key default gen_random_uuid(), owner_id uuid, business_name text);
create table public.profiles (id uuid primary key);
create table public.import_batches (id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.providers(id) on delete cascade,
  created_by uuid, source_filename text, row_count integer not null default 0, content_hash text, undone_at timestamptz, created_at timestamptz not null default now());
create table public.obligations (id uuid primary key default gen_random_uuid(), provider_id uuid, kind text, status text default 'draft', title text,
  source_kind text not null default 'manual' check (source_kind in ('manual','email','pdf','sms','agent')), source_ref text);
grant select on public.providers to authenticated;
grant select, insert on public.import_batches to authenticated;

\ir ../../supabase/migrations/20260915_001062_import_row.sql

insert into public.providers (id, owner_id, business_name) values
  ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Org A'),
  ('10000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'Org B');
insert into public.import_batches (id, provider_id, source_filename, content_hash) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'teamsnap.csv', 'h1'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000b', 'other.csv', 'h2');

do $$
declare n integer; j jsonb;
begin
  -- A ── table exists, RLS forced, target/state vocab enforced
  if not exists (select 1 from pg_class where relname = 'import_row' and relrowsecurity and relforcerowsecurity) then
    raise exception 'FAIL A: import_row missing or RLS not forced';
  end if;
  begin insert into public.import_row (batch_id, provider_id, source_row_hash, raw, target) values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a','x','{}','athlete');
    raise exception 'FAIL A: target athlete accepted (roster identity is member)';
  exception when check_violation then null; end;
  raise notice 'PASS A: import_row exists, RLS forced, target vocabulary is member|guardian|team|obligation';

  -- B ── every outcome of a parse is a row: 3 imported, 2 quarantined, 1 skipped, 1 conflict
  insert into public.import_row (batch_id, provider_id, row_no, source_row_hash, raw, target, state, problem) values
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 2, 'r2', '{"name":"Ava Bell"}', 'member', 'imported', null),
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 3, 'r3', '{"name":"Ben Ortiz"}', 'member', 'imported', null),
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 4, 'r4', '{"name":"Cy Park"}', 'member', 'imported', null),
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 5, 'r5', '{"name":""}', 'member', 'quarantined', 'missing athlete name'),
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 6, 'r6', '{"name":"Di Ng","dob":"31/31/2013"}', 'member', 'quarantined', 'unreadable date of birth'),
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 7, 'r7', '{"name":"Ava Bell"}', 'member', 'skipped', 'duplicate row in this file'),
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 8, 'r8', '{"name":"Ben Ortiz"}', 'member', 'conflict', 'same name, no DOB to compare');
  j := public.import_batch_stats('20000000-0000-4000-8000-000000000001');
  if (j->>'imported')::int <> 3 or (j->>'quarantined')::int <> 2 or (j->>'skipped')::int <> 1 or (j->>'conflict')::int <> 1 then
    raise exception 'FAIL B: stats % ', j;
  end if;
  raise notice 'PASS B: quarantined and conflicting rows are counted, not dropped: %', j;

  -- C ── re-running the same source row is refused, so a re-run creates zero duplicates
  begin insert into public.import_row (batch_id, provider_id, row_no, source_row_hash, raw, target) values
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a', 2, 'r2', '{"name":"Ava Bell"}', 'member');
    raise exception 'FAIL C: duplicate source row accepted';
  exception when unique_violation then null; end;
  raise notice 'PASS C: (batch, source_row_hash) is unique — idempotent by construction';

  -- D ── a row cannot be filed under another org's batch
  begin insert into public.import_row (batch_id, provider_id, source_row_hash, raw, target) values
    ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-00000000000a', 'z', '{}', 'member');
    raise exception 'FAIL D: cross-org batch accepted';
  exception when check_violation then null; end;
  raise notice 'PASS D: batch and row must belong to the same organization';

  -- E ── undoing a batch takes its rows (and their raw PII) with it
  delete from public.import_batches where id = '20000000-0000-4000-8000-000000000001';
  select count(*) into n from public.import_row where batch_id = '20000000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL E: % rows survived batch deletion', n; end if;
  raise notice 'PASS E: batch deletion cascades to every row';

  -- F ── migrated debt is a legal source_kind; the ledger can tell it apart
  insert into public.obligations (provider_id, kind, title, source_kind, source_ref) values
    ('10000000-0000-4000-8000-00000000000a', 'fee', 'Fall 2025 balance', 'migrated', 'import:20000000-0000-4000-8000-000000000002');
  begin insert into public.obligations (provider_id, kind, title, source_kind) values ('10000000-0000-4000-8000-00000000000a', 'fee', 'x', 'teamsnap');
    raise exception 'FAIL F: unknown source_kind accepted';
  exception when check_violation then null; end;
  raise notice 'PASS F: obligations.source_kind admits migrated and nothing new';

  -- G ── import_batches carries source/mapping/stats; source vocabulary enforced
  update public.import_batches set source = 'teamsnap', mapping = '{"name":0,"dob":2}', stats = '{"imported":1}' where id = '20000000-0000-4000-8000-000000000002';
  begin update public.import_batches set source = 'excel' where id = '20000000-0000-4000-8000-000000000002';
    raise exception 'FAIL G: unknown source accepted';
  exception when check_violation then null; end;
  raise notice 'PASS G: import_batches.source is teamsnap|sports_connect|sportsengine|sheets|csv_generic|website';
end $$;

-- H ── RLS: org B's owner cannot read or write org A's rows
insert into public.import_batches (id, provider_id, source_filename, content_hash) values
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a', 'again.csv', 'h3');
insert into public.import_row (batch_id, provider_id, source_row_hash, raw, target, state) values
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-00000000000a', 'q1', '{"name":"Ava Bell"}', 'member', 'imported');
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', false);
do $$
declare n integer;
begin
  select count(*) into n from public.import_row;
  if n <> 0 then raise exception 'FAIL H: org B can read % of org A rows', n; end if;
  begin insert into public.import_row (batch_id, provider_id, source_row_hash, raw, target) values
    ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-00000000000a', 'q2', '{}', 'member');
    raise exception 'FAIL H: org B wrote into org A batch';
  exception when insufficient_privilege or check_violation then null; end;
  raise notice 'PASS H: rows are invisible and unwritable across organizations';
end $$;
reset role;
