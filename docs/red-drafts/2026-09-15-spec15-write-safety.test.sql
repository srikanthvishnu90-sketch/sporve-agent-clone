-- Disposable-database fixture for spec 15 slice 0+1 (write safety), migration
-- 20260915_001060. Never runs against production.
--
--     bash tools/run-sql-fixtures.sh 2026-09-15-spec15
--
-- RED-FIRST: with the \ir line removed, assertion A fails — the stand-in
-- schema (a faithful copy of the live constraint) still ACCEPTS mode='auto',
-- and the stub auto_approve_agent_drafts() still exists (B). With the include
-- present every assertion must PASS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_writes' then
    raise exception 'refusing to run outside the disposable sporv_spec_writes database (got %)', current_database();
  end if;
end $$;

-- ── stand-ins for what the migration references ───────────────────────────
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
exception when duplicate_object then null; end $$;
create table public.providers (id uuid primary key default gen_random_uuid(), owner_id uuid, business_name text);
create table public.guardians (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), first_name text, email text);
create table public.obligations (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id),
  kind text not null, status text not null default 'draft', title text, detail text, source_ref text,
  guardian_id uuid references public.guardians(id), run_id uuid);
create table public.outbound_messages (id uuid primary key default gen_random_uuid(), provider_id uuid, event_type text, status text,
  scheduled_for timestamptz, obligation_id uuid references public.obligations(id), content jsonb);
-- the live constraint, verbatim from the baseline: 'auto' is admitted today
create table public.lifecycle_message_prefs (provider_id uuid references public.providers(id), event_type text not null, mode text not null,
  constraint lifecycle_message_prefs_mode_check check (mode = any (array['off','draft','auto'])),
  constraint lifecycle_prefs_auto_only_logistics check (mode <> 'auto' or event_type = any (array['booking_confirmed','reminder_24h'])));
create or replace function public.auto_approve_agent_drafts() returns integer language sql as $$ select 0 $$;

\ir ../../supabase/migrations/20260915_001060_agent_write_safety.sql

-- ── fixture: one org, one guardian, four obligations ─────────────────────
insert into public.providers (id, owner_id, business_name) values
  ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Org A');
insert into public.guardians (id, provider_id, first_name, email) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'Maria', 'maria@example.com');
insert into public.obligations (id, provider_id, kind, status, title, detail, source_ref, guardian_id, run_id) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'fee', 'draft', 'Dues', 'Hi Maria', 'installment:x', '20000000-0000-4000-8000-000000000001', null),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', 'fee', 'draft', 'No guardian', 'x', 'installment:y', null, null),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a', 'fee', 'draft', 'Run 1', 'x', null, null, '40000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-00000000000a', 'fee', 'draft', 'Run 1b', 'x', null, null, '40000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);

do $$
declare v uuid; n integer;
begin
  -- A ── the fourth mode is gone at the constraint
  begin
    insert into public.lifecycle_message_prefs values ('10000000-0000-4000-8000-00000000000a', 'booking_confirmed', 'auto');
    raise exception 'FAIL A: mode=auto still accepted';
  exception when check_violation then null; end;
  insert into public.lifecycle_message_prefs values ('10000000-0000-4000-8000-00000000000a', 'agent_a1', 'draft');
  raise notice 'PASS A: lifecycle_message_prefs.mode is off|draft only';

  -- B ── the auto-approve function no longer exists
  if exists (select 1 from pg_proc where proname = 'auto_approve_agent_drafts') then
    raise exception 'FAIL B: auto_approve_agent_drafts() still exists';
  end if;
  raise notice 'PASS B: auto_approve_agent_drafts() dropped';

  -- C ── approve: status write + queued message, receipt is the message id
  v := public.approve_obligation_and_queue('30000000-0000-4000-8000-000000000001');
  if v is null then raise exception 'FAIL C: no message id returned'; end if;
  if (select status from public.obligations where id = '30000000-0000-4000-8000-000000000001') <> 'approved' then raise exception 'FAIL C: not approved'; end if;
  if (select content->>'obligation_id' from public.outbound_messages where id = v) <> '30000000-0000-4000-8000-000000000001' then raise exception 'FAIL C: message not linked'; end if;
  raise notice 'PASS C: approve writes the status and queues one drafted message';

  -- D ── approving again, or a missing id, raises rather than returning success
  begin perform public.approve_obligation_and_queue('30000000-0000-4000-8000-000000000001'); raise exception 'FAIL D: re-approve succeeded';
  exception when others then if sqlerrm not like '%only a draft%' then raise; end if; end;
  begin perform public.approve_obligation_and_queue('30000000-0000-4000-8000-0000000000ff'); raise exception 'FAIL D: unknown id succeeded';
  exception when others then if sqlerrm not like '%no such obligation%' then raise; end if; end;
  raise notice 'PASS D: non-draft and unknown obligations raise';

  -- E ── no-guardian approve: the status write is still receipted, null means "nothing to queue"
  v := public.approve_obligation_and_queue('30000000-0000-4000-8000-000000000002');
  if v is not null then raise exception 'FAIL E: queued a message with no guardian'; end if;
  if (select status from public.obligations where id = '30000000-0000-4000-8000-000000000002') <> 'approved' then raise exception 'FAIL E: status not written'; end if;
  raise notice 'PASS E: null return is "approved, nothing to queue", never "nothing happened"';

  -- F ── decide_agent_run: an empty run raises (P0002); a real run returns the count
  begin perform public.decide_agent_run('10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-0000000000ee', 'void');
    raise exception 'FAIL F: empty run reported success';
  exception when no_data_found then null; end;
  n := public.decide_agent_run('10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000001', 'void');
  if n <> 2 then raise exception 'FAIL F: expected 2 voided, got %', n; end if;
  begin perform public.decide_agent_run('10000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000001', 'void');
    raise exception 'FAIL F: second decide on same run reported success';
  exception when no_data_found then null; end;
  raise notice 'PASS F: decide_agent_run raises on zero rows and counts real ones';

  -- G ── a non-owner cannot approve or decide
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  begin perform public.approve_obligation_and_queue('30000000-0000-4000-8000-000000000003'); raise exception 'FAIL G: non-owner approved';
  exception when others then if sqlerrm not like '%only the org owner%' then raise; end if; end;
  raise notice 'PASS G: only the org owner may approve';
end $$;
