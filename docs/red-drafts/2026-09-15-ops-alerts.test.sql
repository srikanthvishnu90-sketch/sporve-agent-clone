-- Disposable-database fixture for migration 20260915_001061 (ops_alerts).
-- Never runs against production.
--
--     bash tools/run-sql-fixtures.sh 2026-09-15-ops-alerts
--
-- RED-FIRST: with the \ir line removed, assertion A fails on
-- "function public.ops_alerts() does not exist". With the include present
-- every assertion must PASS.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_ops' then
    raise exception 'refusing to run outside the disposable sporv_spec_ops database (got %)', current_database();
  end if;
end $$;

create extension if not exists pgcrypto;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
exception when duplicate_object then null; end $$;
-- stand-ins with the live column names (read from information_schema on 2026-09-15)
create table public.webhook_dead_letter (id uuid primary key default gen_random_uuid(), stripe_event_id text, event_type text, error_msg text,
  first_seen_at timestamptz not null default now(), resolved_at timestamptz);
create table public.bookings (id uuid primary key default gen_random_uuid(), payment_status text);
create table public.payment_event_ledger (id uuid primary key default gen_random_uuid(), booking_id uuid, amount_minor bigint);
create table public.outbound_messages (id uuid primary key default gen_random_uuid(), status text not null, approved_at timestamptz, send_after timestamptz,
  created_at timestamptz not null default now());
create table public.cron_http_audit (id bigserial primary key, job_name text, queued_at timestamptz not null default now(), status_code integer, error_msg text);
create table public.ai_observability_events (id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default now(), outcome text);

\ir ../../supabase/migrations/20260915_001061_ops_alerts.sql

do $$
declare n integer; sev text;
begin
  -- A ── a quiet system reports nothing
  select count(*) into n from public.ops_alerts();
  if n <> 0 then raise exception 'FAIL A: quiet system produced % alert(s)', n; end if;
  raise notice 'PASS A: no alerts on a quiet system';

  -- B ── an unresolved dead letter is critical; a resolved one is silent
  insert into public.webhook_dead_letter (stripe_event_id, event_type, error_msg) values ('evt_1', 'checkout.session.completed', 'boom');
  select count(*) into n from public.ops_alerts() a where a.check_name in ('webhook_dead_letter_unresolved','webhook_dead_letter_new_24h') and a.severity = 'critical';
  if n <> 2 then raise exception 'FAIL B: expected 2 critical dead-letter alerts, got %', n; end if;
  update public.webhook_dead_letter set resolved_at = now(), first_seen_at = now() - interval '2 days';
  select count(*) into n from public.ops_alerts() a where a.check_name like 'webhook_dead_letter%';
  if n <> 0 then raise exception 'FAIL B: resolved dead letter still alerts'; end if;
  raise notice 'PASS B: dead letters page while unresolved and fall silent when resolved';

  -- C ── a paid booking with no ledger row is drift
  insert into public.bookings (id, payment_status) values ('10000000-0000-4000-8000-000000000001', 'paid');
  select count(*) into n from public.ops_alerts() a where a.check_name = 'paid_without_ledger' and a.severity = 'critical' and a.failing_count = 1;
  if n <> 1 then raise exception 'FAIL C: drift not detected'; end if;
  insert into public.payment_event_ledger (booking_id, amount_minor) values ('10000000-0000-4000-8000-000000000001', 5000);
  select count(*) into n from public.ops_alerts() a where a.check_name = 'paid_without_ledger';
  if n <> 0 then raise exception 'FAIL C: reconciled booking still reported'; end if;
  raise notice 'PASS C: ledger drift is a critical alert until the ledger row exists';

  -- D ── delivery: one failure is high, five is critical; a stuck approval is critical
  insert into public.outbound_messages (status) values ('failed');
  select a.severity into sev from public.ops_alerts() a where a.check_name = 'delivery_failed_24h';
  if sev <> 'high' then raise exception 'FAIL D: one failure should be high, got %', sev; end if;
  insert into public.outbound_messages (status) select 'needs_review' from generate_series(1,4);
  select a.severity into sev from public.ops_alerts() a where a.check_name = 'delivery_failed_24h';
  if sev <> 'critical' then raise exception 'FAIL D: five failures should be critical, got %', sev; end if;
  insert into public.outbound_messages (status, approved_at) values ('approved', now() - interval '20 minutes');
  select count(*) into n from public.ops_alerts() a where a.check_name = 'approved_not_sent_15m' and a.severity = 'critical';
  if n <> 1 then raise exception 'FAIL D: stuck approval not detected'; end if;
  insert into public.outbound_messages (status, approved_at) values ('approved', now() - interval '1 minute');
  select a.failing_count into n from public.ops_alerts() a where a.check_name = 'approved_not_sent_15m';
  if n <> 1 then raise exception 'FAIL D: a fresh approval counted as stuck'; end if;
  raise notice 'PASS D: delivery failures escalate and stuck approvals page';

  -- E ── cron: a failed or lost tick in the last hour is critical; an old one is not
  insert into public.cron_http_audit (job_name, status_code) values ('lifecycle-process', 500);
  select count(*) into n from public.ops_alerts() a where a.check_name = 'cron_http_failed_60m' and a.severity = 'critical';
  if n <> 1 then raise exception 'FAIL E: failed tick not detected'; end if;
  update public.cron_http_audit set queued_at = now() - interval '3 hours';
  select count(*) into n from public.ops_alerts() a where a.check_name = 'cron_http_failed_60m';
  if n <> 0 then raise exception 'FAIL E: a three-hour-old failure still pages'; end if;
  raise notice 'PASS E: cron failures page for an hour, then age out';

  -- F ── AI: 1 error in 8 is quiet (under the floor of 10); 3 in 12 is high
  insert into public.ai_observability_events (outcome) select 'success' from generate_series(1,7);
  insert into public.ai_observability_events (outcome) values ('error');
  select count(*) into n from public.ops_alerts() a where a.check_name = 'ai_error_rate_24h';
  if n <> 0 then raise exception 'FAIL F: alerted under the 10-request floor'; end if;
  insert into public.ai_observability_events (outcome) select 'success' from generate_series(1,2);
  insert into public.ai_observability_events (outcome) select 'error' from generate_series(1,2);
  select count(*) into n from public.ops_alerts() a where a.check_name = 'ai_error_rate_24h' and a.severity = 'high' and a.failing_count = 3;
  if n <> 1 then raise exception 'FAIL F: 3/12 errors not reported as high'; end if;
  raise notice 'PASS F: AI error rate alerts over 10%% of at least 10 requests';

  -- G ── nothing in the feed can carry an id, a name or an address
  if exists (select 1 from public.ops_alerts() a where a.detail ~ '[0-9a-f]{8}-[0-9a-f]{4}-' or a.detail ~ '@') then
    raise exception 'FAIL G: alert detail carries an identifier';
  end if;
  raise notice 'PASS G: alert details are static strings — counts only, no PII';

  -- H ── service_role only
  if has_function_privilege('authenticated', 'public.ops_alerts()', 'execute') or has_function_privilege('anon', 'public.ops_alerts()', 'execute') then
    raise exception 'FAIL H: ops_alerts() callable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.ops_alerts()', 'execute') then raise exception 'FAIL H: service_role cannot call ops_alerts()'; end if;
  raise notice 'PASS H: ops_alerts() is service_role only';

  -- I ── the function inventory lists this schema's own functions, not extension ones, and is service_role only
  if not exists (select 1 from public.ops_function_inventory() f where f.name = 'ops_alerts') then raise exception 'FAIL I: inventory misses ops_alerts'; end if;
  if exists (select 1 from public.ops_function_inventory() f where f.name in ('gen_random_uuid','digest','crypt')) then raise exception 'FAIL I: inventory lists extension functions'; end if;
  if has_function_privilege('authenticated', 'public.ops_function_inventory()', 'execute') then raise exception 'FAIL I: inventory callable by clients'; end if;
  raise notice 'PASS I: ops_function_inventory() lists own functions only, service_role only';
end $$;
