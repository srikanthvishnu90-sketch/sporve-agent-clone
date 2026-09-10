-- Applied to production as migration version 20260910174531.
-- Written back into the repository 2026-09-10: this file is the EXACT
-- SQL the database recorded, pulled from supabase_migrations.schema_migrations
-- rather than retyped, so the repo can rebuild production byte-for-byte.

-- 2026-09-10 · schedule the Gmail reader
-- Source: docs/red-drafts/2026-09-10-gmail-scan-schedule.sql (owner-authorised)
--
-- Modelled exactly on public.invoke_lifecycle_process() and cron job 3. One
-- copy of each secret, read from Vault at call time — invoke_lifecycle_process
-- once used a COPY of the service key, the key rotated, the copy did not, and
-- every tick 403'd for six weeks while pg_cron reported success 63,321 times.
--
-- Nothing here can send: the connector holds gmail.readonly and gmail-scan
-- writes findings only, never a draft and never a message.

create or replace function public.invoke_gmail_scan()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_url text; v_key text; v_req bigint;
begin
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

-- Every fifteen minutes, not every minute: a parent's email does not need a
-- sixty-second response, and each tick costs a Gmail list call plus one
-- metadata call per message per connected org.
select cron.schedule('sporv-gmail-scan', '*/15 * * * *',
                     $$ select public.invoke_gmail_scan(); $$);
