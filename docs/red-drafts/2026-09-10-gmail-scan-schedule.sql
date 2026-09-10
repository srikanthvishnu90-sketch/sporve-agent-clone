-- RED DRAFT — NOT APPLIED. The owner applies this by hand.
-- 2026-09-10 · schedule the Gmail reader
--
-- WHY THIS IS RED RATHER THAN GREEN
-- Everything else in the connector path is inert until a human clicks. This is
-- the statement that makes Sporv read a customer's mailbox on a timer, without
-- anyone present. That is a behaviour change, not a deployment detail, and it
-- should carry the owner's signature.
--
-- WHAT IT DOES NOT CHANGE
-- No RLS, no grants, no table, no customer data. It adds one SECURITY DEFINER
-- wrapper and one pg_cron entry, both modelled exactly on
-- public.invoke_lifecycle_process() and job 3, which have run every minute for
-- weeks. Nothing here can send: the connector holds gmail.readonly, and
-- gmail-scan writes findings only — never a draft, never a message.
--
-- PRECONDITIONS
--   1. gmail-scan is deployed (done 2026-09-10).
--   2. Vault holds `project_url` and `cron_secret`. Both already exist —
--      invoke_lifecycle_process reads the same two.
--   3. At least one org_connectors row with kind='gmail', status='connected'.
--      With none, the function is a no-op that reports zero connectors.
--
-- SCHEDULE. Every fifteen minutes, not every minute. A parent's email does not
-- need a sixty-second response, and each tick costs a Gmail list call plus one
-- metadata call per message per connected org. Hourly would be defensible;
-- fifteen minutes is the compromise that still feels responsive to a director
-- watching the queue.
--
-- APPLY WITH
--   supabase db push   (or the SQL editor on tseszaprvtvqrkfpditu)
-- ROLLBACK is at the bottom, and is a single unschedule.

begin;

create or replace function public.invoke_gmail_scan()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_url text; v_key text; v_req bigint;
begin
  -- One copy of each secret, read from Vault at call time. This is the whole
  -- point of the pattern: invoke_lifecycle_process once used a COPY of the
  -- service key, the key rotated, the copy did not, and every tick 403'd for
  -- six weeks while pg_cron reported success 63,321 times.
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    raise log 'invoke_gmail_scan: vault secrets project_url/cron_secret missing';
    return;
  end if;

  select net.http_post(
    url     => v_url || '/functions/v1/gmail-scan',
    headers => jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || v_key),
    body    => '{}'::jsonb) into v_req;

  -- Same audit table as every other cron HTTP call, so cron-http-health
  -- (job 6) can see this one fail rather than only the older ones.
  insert into public.cron_http_audit (job_name, request_id)
  values ('gmail-scan', v_req);
end $function$;

revoke all on function public.invoke_gmail_scan() from public, anon, authenticated;

select cron.schedule('sporv-gmail-scan', '*/15 * * * *',
                     $$ select public.invoke_gmail_scan(); $$);

commit;

-- ── VERIFICATION ─────────────────────────────────────────────────────────
-- 1. the job exists and is active:
--      select jobname, schedule, active from cron.job where jobname='sporv-gmail-scan';
-- 2. after the first tick, the call was made and answered:
--      select job_name, request_id, created_at from public.cron_http_audit
--       where job_name='gmail-scan' order by created_at desc limit 3;
--      select status_code, content::text from net._http_response
--       where id = (select request_id from public.cron_http_audit
--                    where job_name='gmail-scan' order by created_at desc limit 1);
--    Expect 200 and a body like {"connectors":1,"report":[{"connector":"…","scanned":N,"findings":M}]}.
-- 3. the connector recorded its own state rather than failing silently:
--      select last_success_at, last_error, last_error_at, items_seen
--        from public.connector_sync_state;
-- 4. nothing was sent, because nothing can be:
--      select count(*) from public.outbound_messages;   -- unchanged
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- select cron.unschedule('sporv-gmail-scan');
-- drop function if exists public.invoke_gmail_scan();
