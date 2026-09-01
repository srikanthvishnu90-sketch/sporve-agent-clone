-- ============================================================================
-- DOC 11 — THE COMPANY BRAIN (2026-09-01). READ (findings) + WRITE (drafts) +
-- SEND (human only). SUPERSEDES doc 06 tiering and all Auto: there is no
-- auto-send path. Master agent mode is Off / Observe / Draft.
--
-- OWNER REVERSAL, surfaced (rule 9): this removes the per-job Auto he asked
-- for three times and I built in 1017/1018. Auto is neutralized, not
-- silently: the */5 cron sporv-auto-approve is unscheduled, the 'auto'
-- allowance is revoked, and the UI drops every Auto affordance. The consent
-- gate + modal become dead code (left in place, unreachable).
-- ============================================================================

-- A ── master mode: Off | Observe | Draft (provider_settings 'agent_mode')
create or replace function public.agent_mode(p_provider uuid)
returns text language sql stable security definer set search_path to '' as $$
  select coalesce((select value->>'mode' from public.provider_settings
                   where provider_id = p_provider and key = 'agent_mode'), 'draft');
$$;
revoke all on function public.agent_mode(uuid) from public, anon;

-- WRITE gate: generators draft ONLY in Draft mode. Redefining the existing
-- gate every generator already calls means zero generator edits.
create or replace function public.agent_autodraft_on(p_provider uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select public.agent_mode(p_provider) = 'draft';
$$;
revoke all on function public.agent_autodraft_on(uuid) from public, anon;

-- READ gate: findings run in Observe or Draft.
create or replace function public.agent_read_on(p_provider uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select public.agent_mode(p_provider) in ('observe','draft');
$$;
revoke all on function public.agent_read_on(uuid) from public, anon;

-- B ── per-WRITE-job Off/On, enforced by a skip-trigger so ALL generators
-- honour it with no per-generator edit. A draft for a job toggled 'off' is
-- silently not inserted.
create or replace function public.skip_toggled_off_agent_draft()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_job text; v_mode text;
begin
  if new.source_kind <> 'agent' then return new; end if;
  v_job := case
    when new.source_ref like 'installment:%' and new.title like 'Payment failed%' then 'agent_a2'
    when new.source_ref like 'installment:%' then 'agent_a1'
    when new.source_ref like 'waiver:%' then 'agent_b1'
    when new.source_ref like 'eligibility:%' then 'agent_b2'
    when new.source_ref like 'session:%:change:%' then 'agent_c2'
    when new.source_ref like 'session:%' then 'agent_c1'
    when new.source_ref like 'reactivation:%' then 'agent_d1'
    else null end;
  if v_job is null then return new; end if;
  select mode into v_mode from public.lifecycle_message_prefs
    where provider_id = new.provider_id and event_type = v_job;
  if v_mode = 'off' then return null; end if;   -- job silenced by the director
  return new;
end; $$;
revoke all on function public.skip_toggled_off_agent_draft() from public, anon, authenticated;
drop trigger if exists trg_skip_toggled_off on public.obligations;
create trigger trg_skip_toggled_off before insert on public.obligations
  for each row execute function public.skip_toggled_off_agent_draft();

-- C ── kill Auto at the constraint: 'auto' only for the two logistics
-- templates the lifecycle worker's fixed-template path predates; NEVER an
-- agent job. (The 5-min auto-approve cron is unscheduled separately.)
alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_prefs_auto_scope;
alter table public.lifecycle_message_prefs add constraint lifecycle_prefs_auto_scope
  check (mode <> 'auto' or event_type in ('booking_confirmed','reminder_24h'));
-- agent job prefs are off|draft only from here.
alter table public.lifecycle_message_prefs drop constraint if exists lifecycle_prefs_agent_off_draft;
alter table public.lifecycle_message_prefs add constraint lifecycle_prefs_agent_off_draft
  check (event_type not like 'agent\_%' or mode in ('off','draft'));

-- D ── FINDINGS: READ output, no send path. Separate table (obligations.kind
-- is CHECK'd and every kind maps to an outbound event — a finding there would
-- be sendable). Owner-read/dismiss only; generators write under service role.
create table if not exists public.agent_findings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  kind text not null,                -- money|people|documents|schedule|clients
  code text not null,                -- stable job code, e.g. 'missing_email'
  severity text not null default 'info' check (severity in ('info','warn','urgent')),
  title text not null,
  detail text,
  source_ref text not null,          -- stable dedupe key
  member_id uuid references public.team_athletes(id) on delete set null,
  amount_cents integer,
  status text not null default 'open' check (status in ('open','dismissed')),
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_finding_ref
  on public.agent_findings (provider_id, source_ref) where status <> 'dismissed';
alter table public.agent_findings enable row level security;
drop policy if exists agent_findings_owner on public.agent_findings;
create policy agent_findings_owner on public.agent_findings
  for all to authenticated
  using (exists (select 1 from public.providers p
                 where p.id = agent_findings.provider_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers p
                 where p.id = agent_findings.provider_id and p.owner_id = auth.uid()));
grant select, update on public.agent_findings to authenticated;   -- dismiss only; inserts are definer

-- E ── the READ pass: high-value, purely-derived findings on data we hold.
-- (Gmail/Places/GBP/weather/attendance jobs are needs-integration or
-- needs-schema — parked per doc 11's own phasing.)
create or replace function public.generate_agent_findings(
  p_provider uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer := 0; v_run uuid := gen_random_uuid();
begin
  -- MONEY · overdue summary (one finding per org: who owes, how much)
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, amount_cents, run_id)
  select p.id, 'money', 'overdue_summary',
    case when sum(i.amount_cents) >= 50000 then 'urgent' else 'warn' end,
    'Outstanding dues: ' || to_char(sum(i.amount_cents)/100.0,'FM$999,999,990.00')
      || ' across ' || count(distinct i.member_id) || ' member(s)',
    'As of today, ' || count(*) || ' installment(s) are past due. Overdue is derived from due date and status — no stored flag.',
    'finding:overdue:' || p.id || ':' || current_date, sum(i.amount_cents), v_run
  from public.providers p
  join public.fee_schedules fs on fs.provider_id = p.id and fs.status = 'active'
  join public.installments i on i.fee_schedule_id = fs.id
   and i.due_date < current_date and i.status not in ('paid','waived')
  where (p_provider is null or p.id = p_provider) and (p_force or public.agent_read_on(p.id))
  group by p.id
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, detail = excluded.detail, amount_cents = excluded.amount_cents,
                severity = excluded.severity, run_id = excluded.run_id, updated_at = now();
  get diagnostics n = row_count;

  -- PEOPLE · missing guardian email (one finding per member)
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, member_id, run_id)
  select m.provider_id, 'people', 'missing_email', 'info',
    m.first_name || ' ' || coalesce(m.last_name,'') || ' has no guardian email',
    'Dues reminders and waivers can''t reach this family until a guardian email is on file.',
    'finding:missing_email:' || m.id, m.id, v_run
  from public.team_athletes m
  where m.status = 'active' and m.first_name is not null
    and (p_provider is null or m.provider_id = p_provider) and (p_force or public.agent_read_on(m.provider_id))
    and not exists (select 1 from public.guardian_links gl join public.guardians g on g.id = gl.guardian_id
                    where gl.member_id = m.id and g.email is not null and g.email <> '')
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, run_id = excluded.run_id, updated_at = now();

  -- PEOPLE · credential expiry 60/30/7 (one finding per staff cert in-window)
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id)
  select sc.organization_id, 'people', 'credential_expiry',
    case when sc.expires_at <= current_date + 7 then 'urgent'
         when sc.expires_at <= current_date + 30 then 'warn' else 'info' end,
    sc.kind || ' expires ' || to_char(sc.expires_at,'Mon DD')
      || ' (' || (sc.expires_at - current_date) || ' days)',
    'Reference ' || coalesce(sc.reference,'—') || '. A lapsed check blocks assignment at the next event.',
    'finding:cred:' || sc.id || ':' || sc.expires_at, v_run
  from public.staff_certifications sc
  where sc.expires_at is not null and sc.expires_at <= current_date + 60
    and sc.status in ('verified','attested')
    and (p_provider is null or sc.organization_id = p_provider) and (p_force or public.agent_read_on(sc.organization_id))
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, severity = excluded.severity, run_id = excluded.run_id, updated_at = now();

  -- DOCUMENTS · unsigned-waiver count (one finding per org)
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id)
  select wd.provider_id, 'documents', 'waivers_unsigned', 'warn',
    count(*) || ' member(s) have not signed a required waiver',
    'Current-version signatures are missing for these members; they can''t participate until signed.',
    'finding:waivers:' || wd.provider_id || ':' || current_date, v_run
  from public.waiver_documents wd
  join public.team_athletes m on m.provider_id = wd.provider_id and m.status = 'active'
  where wd.version = (select max(w2.version) from public.waiver_documents w2
                      where w2.provider_id = wd.provider_id and w2.title = wd.title)
    and not exists (select 1 from public.waiver_signatures ws
                    where ws.waiver_document_id = wd.id and ws.member_id = m.id)
    and (p_provider is null or wd.provider_id = p_provider) and (p_force or public.agent_read_on(wd.provider_id))
  group by wd.provider_id
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, run_id = excluded.run_id, updated_at = now();

  -- CLIENTS · lapsed members (ended-season plan, none current) — a count finding
  insert into public.agent_findings (provider_id, kind, code, severity, title, detail, source_ref, run_id)
  select p.id, 'clients', 'lapsed_members', 'info',
    count(*) || ' member(s) from last season haven''t re-enrolled',
    'First-party win-back candidates. The reactivation draft (D1) targets these when Draft mode is on.',
    'finding:lapsed:' || p.id || ':' || current_date, v_run
  from public.providers p
  join public.team_athletes m on m.provider_id = p.id and m.status = 'active' and m.first_name is not null
  where (p_provider is null or p.id = p_provider) and (p_force or public.agent_read_on(p.id))
    and exists (select 1 from public.fee_schedules f join public.seasons s on s.id = f.season_id
                where f.member_id = m.id and s.end_date < current_date)
    and not exists (select 1 from public.fee_schedules f join public.seasons s on s.id = f.season_id
                    where f.member_id = m.id and s.end_date >= current_date and f.status in ('active','complete'))
  group by p.id
  on conflict (provider_id, source_ref) where status <> 'dismissed'
  do update set title = excluded.title, run_id = excluded.run_id, updated_at = now();

  select count(*) into n from public.agent_findings where run_id = v_run;
  return n;
end; $$;
revoke all on function public.generate_agent_findings(uuid, boolean) from public, anon, authenticated;

-- owner can run the READ pass on demand
create or replace function public.run_agent_read(p_provider uuid)
returns integer language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.providers where id = p_provider and owner_id = auth.uid()) then
    raise exception 'only the org owner may run the agent';
  end if;
  return public.generate_agent_findings(p_provider, true);
end; $$;
revoke all on function public.run_agent_read(uuid) from public, anon;
grant execute on function public.run_agent_read(uuid) to authenticated;

-- F ── nightly READ pass beside the WRITE generators
do $$
begin
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-findings-daily';
    perform cron.schedule('sporv-findings-daily', '05 3 * * *',
      $job$ select public.generate_agent_findings(); $job$);
  exception when others then raise notice 'pg_cron unavailable (%)', sqlerrm; end;
end $$;

-- Applied 2026-09-01 after UI probe: drop the dead 001018 money-auto consent
-- trigger so the honest lifecycle_prefs_agent_off_draft constraint is the
-- refusal (doc 11: no consent path exists).
drop trigger if exists trg_money_auto_consent on public.lifecycle_message_prefs;
drop function if exists public.enforce_money_auto_consent();
