-- 20260905_001027 — LAUNCH SECURITY (Codex draft, robin-reviewed 3-pass,
-- owner-approved 2026-09-05 'apply the red drafts'). Closes the live
-- cross-tenant apply_agent_proposal write, adds guardian/member org
-- integrity (composite FKs + trigger + provider-scoped RLS), locks
-- agent_proposals to read-only for clients with a receipt column, fixes
-- the generator's member_user_id/om.id FK bug, and adds the extractor's
-- rate-limit RPC. Applied verbatim from the reviewed draft (outer
-- begin/commit stripped; the migration runner supplies the transaction).
-- [CRITICAL-PATH] REVIEWABLE DRAFT ONLY. Not applied to any shared database.
-- S03/A06: close guardian/member and proposal/session cross-org boundaries.
-- S08: narrow authenticated extraction quota; no service key in the extractor.
-- Precondition: canonical baseline + migrations through 001025, clean preflight.
-- Inverse: constraints intentionally fail closed; do not restore permissive RLS.
-- Proposal receipts carry before/after and a compare-before-restore inverse.
-- Release requires review, isolated tests, production preflight and owner approval.

-- Keep the provenance preflight and privilege change atomic against old clients.
lock table public.agent_proposals in access exclusive mode;

-- Fail before backfill if old links are already unsafe; never delete/hide them.
do $$ begin
  -- Older pending rows were client-writable; changing grants cannot establish
  -- their provenance. Stop for explicit owner review/dismissal, never hide them.
  if exists(select 1 from public.agent_proposals where status='pending') then
    raise exception 'launch security preflight: review and dismiss existing pending proposals before applying';
  end if;
  if exists (
    select 1 from public.guardian_links l
    join public.guardians g on g.id=l.guardian_id
    join public.team_athletes m on m.id=l.member_id
    where g.provider_id is null or m.provider_id is null or g.provider_id<>m.provider_id
  ) then raise exception 'launch security preflight: cross-org or unscoped guardian links require review'; end if;
end $$;

alter table public.guardian_links add column if not exists provider_id uuid;
update public.guardian_links l set provider_id=g.provider_id
  from public.guardians g where l.guardian_id=g.id and l.provider_id is null;
alter table public.guardian_links alter column provider_id set not null;

-- Composite keys protect concurrent parent-org changes as well as child inserts.
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.guardians'::regclass and conname='guardians_id_provider_key') then
    alter table public.guardians add constraint guardians_id_provider_key unique(id,provider_id);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.team_athletes'::regclass and conname='members_id_provider_key') then
    alter table public.team_athletes add constraint members_id_provider_key unique(id,provider_id);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.guardian_links'::regclass and conname='guardian_links_guardian_org_fk') then
    alter table public.guardian_links add constraint guardian_links_guardian_org_fk
      foreign key(guardian_id,provider_id) references public.guardians(id,provider_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.guardian_links'::regclass and conname='guardian_links_member_org_fk') then
    alter table public.guardian_links add constraint guardian_links_member_org_fk
      foreign key(member_id,provider_id) references public.team_athletes(id,provider_id) on delete cascade;
  end if;
end $$;

create or replace function public.guard_guardian_link_org()
returns trigger language plpgsql security definer set search_path='' as $$
declare g_org uuid; m_org uuid;
begin
  select provider_id into g_org from public.guardians where id=new.guardian_id;
  select provider_id into m_org from public.team_athletes where id=new.member_id;
  if g_org is null or m_org is null or g_org<>m_org then
    raise exception using errcode='23514', message='guardian and member must belong to the same organization';
  end if;
  if new.provider_id is not null and new.provider_id<>g_org then
    raise exception using errcode='23514', message='guardian link organization mismatch';
  end if;
  new.provider_id:=g_org;
  return new;
end $$;
revoke all on function public.guard_guardian_link_org() from public,anon,authenticated;
drop trigger if exists guardian_link_org_guard on public.guardian_links;
create trigger guardian_link_org_guard before insert or update on public.guardian_links
for each row execute function public.guard_guardian_link_org();

drop policy if exists guardian_links_all_owner on public.guardian_links;
create policy guardian_links_all_owner on public.guardian_links for all to authenticated
using(exists(select 1 from public.providers p where p.id=guardian_links.provider_id and p.owner_id=auth.uid()))
with check(exists(select 1 from public.providers p where p.id=guardian_links.provider_id and p.owner_id=auth.uid()));

-- Users may inspect proposals, not forge targets, status, actors or receipts.
alter table public.agent_proposals add column if not exists receipt jsonb;
revoke insert,update,delete,truncate,references,trigger on public.agent_proposals from anon,authenticated;
revoke select on public.agent_proposals from anon;
grant select on public.agent_proposals to authenticated;

create or replace function public.apply_agent_proposal(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pr public.agent_proposals%rowtype; target public.sessions%rowtype;
  target_org uuid; actor uuid:=auth.uid(); member_id uuid; new_date date;
  before_value jsonb; after_value jsonb; result jsonb; written integer;
begin
  if actor is null then raise exception using errcode='42501',message='sign in to apply a proposal'; end if;
  select a.* into pr from public.agent_proposals a
    join public.providers p on p.id=a.provider_id
    where a.id=p_proposal_id and p.owner_id=actor for update of a;
  if not found then raise exception using errcode='42501',message='proposal not available to this account'; end if;
  perform 1 from public.providers where id=pr.provider_id and owner_id=actor for share;
  if not found then raise exception using errcode='42501',message='only the organization owner may apply'; end if;
  if pr.status<>'pending' then raise exception 'proposal is not pending'; end if;
  if pr.kind='payment_plan' then raise exception 'apply money changes explicitly in the Money screen'; end if;
  if pr.kind not in ('staff_assignment','schedule_adjustment') then raise exception 'unsupported proposal'; end if;

  select s.* into target from public.sessions s
    join public.programs p on p.id=s.program_id
    where s.id=(pr.proposed->>'session_id')::uuid and p.provider_id=pr.provider_id for update of s;
  if not found then raise exception using errcode='42501',message='proposal target not available in this organization'; end if;
  select provider_id into target_org from public.programs where id=target.program_id for share;
  if target_org is distinct from pr.provider_id then
    raise exception using errcode='42501',message='proposal target must belong to this organization';
  end if;
  perform 1 from public.agent_findings f where f.id=pr.why_finding_id and f.provider_id=pr.provider_id
    and f.status='open' and (
      (pr.kind='staff_assignment' and f.code='staffing_gap' and f.subject_id=target.id)
      -- Existing schedule_conflict findings group a slot, not a subject_id.
      -- Bind that exact slot to this target and require a real conflict now.
      -- This guards the existing apply type; it does not invent a generator.
      or (pr.kind='schedule_adjustment' and f.code='schedule_conflict'
        and f.evidence->>'address'=target.address
        and f.evidence->>'date'=target.start_date::text
        and coalesce(f.evidence->>'time','')=coalesce(target.start_time,'')
        and exists(select 1 from public.sessions other
          join public.programs op on op.id=other.program_id
          where op.provider_id=pr.provider_id and other.id<>target.id
            and other.address=target.address and other.start_date=target.start_date
            and coalesce(other.start_time,'')=coalesce(target.start_time,''))))
    for share;
  if not found then raise exception 'proposal requires an open matching finding for this session'; end if;

  before_value:=jsonb_build_object('assigned_member_id',target.assigned_member_id,'start_date',target.start_date);
  if pr.kind='staff_assignment' then
    if target.assigned_member_id is not null then raise exception 'staff assignment changed; review a new proposal'; end if;
    member_id:=(pr.proposed->>'assign_member')::uuid;
    -- assigned_member_id references organization_members.id, NOT member_user_id.
    perform 1 from public.organization_members m where m.id=member_id and m.organization_id=pr.provider_id
      and m.is_active and m.background_check_status='verified' and m.background_check_completed_at is not null for share;
    if not found then raise exception 'staff member is not active and verified in this organization'; end if;
    update public.sessions set assigned_member_id=member_id where id=target.id and assigned_member_id is null;
  else
    if not(pr.proposed ? 'expected_start_date') or
      (pr.proposed->>'expected_start_date')::date is distinct from target.start_date then
      raise exception 'schedule changed or snapshot missing; review a new proposal';
    end if;
    new_date:=(pr.proposed->>'new_date')::date;
    if new_date is null or new_date=target.start_date or (target.end_date is not null and new_date>target.end_date) then
      raise exception 'proposal must make a valid schedule change';
    end if;
    update public.sessions set start_date=new_date where id=target.id and start_date=target.start_date;
  end if;
  get diagnostics written=row_count;
  if written<>1 then raise exception 'proposal wrote no row; nothing was applied'; end if;
  select jsonb_build_object('assigned_member_id',s.assigned_member_id,'start_date',s.start_date)
    into after_value from public.sessions s where s.id=target.id;
  result:=jsonb_build_object('applied',pr.kind,'rows_written',written,'session_id',target.id,
    'actor',actor,'at',clock_timestamp(),'before',before_value,'after',after_value,
    'inverse',jsonb_build_object('action','restore_session','session_id',target.id,'expected',after_value,'value',before_value));
  update public.agent_proposals set status='applied',applied_by=actor,applied_at=now(),receipt=result where id=pr.id;
  return result;
end $$;
revoke all on function public.apply_agent_proposal(uuid) from public,anon;
grant execute on function public.apply_agent_proposal(uuid) to authenticated;

create or replace function public.dismiss_agent_proposal(p_proposal_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.agent_proposals pr set status='dismissed'
    where pr.id=p_proposal_id and pr.status='pending' and exists (
      select 1 from public.providers p where p.id=pr.provider_id and p.owner_id=auth.uid());
  if not found then raise exception 'no pending proposal owned by this account'; end if;
end $$;
revoke all on function public.dismiss_agent_proposal(uuid) from public,anon;
grant execute on function public.dismiss_agent_proposal(uuid) to authenticated;

-- Correct the existing generator's user-id/member-id mismatch. Existing pending
-- drafts are not rewritten silently: obsolete ones must be dismissed/regenerated.
-- p_force is retained for caller-signature compatibility only. It intentionally
-- cannot bypass Draft mode: Off and Observe must never generate a draft.
create or replace function public.generate_agent_proposals(p_provider uuid default null,p_force boolean default false)
returns integer language plpgsql security definer set search_path='' as $$
declare run uuid:=gen_random_uuid(); n integer;
begin
  insert into public.agent_proposals(provider_id,kind,title,detail,proposed,why_finding_id,run_id)
  select f.provider_id,'staff_assignment','Assign staff to '||f.title,
    'An active staff member with recorded verification is available for review.',
    jsonb_build_object('ref','staffassign:'||s.id,'session_id',s.id,'assign_member',m.id),f.id,run
  from public.agent_findings f
  join public.providers p on p.id=f.provider_id and p.onboarding_completed
  join public.sessions s on s.id=f.subject_id and s.assigned_member_id is null
  join public.programs pr on pr.id=s.program_id and pr.provider_id=p.id
  join lateral(select om.id from public.organization_members om where om.organization_id=p.id
    and om.is_active and om.background_check_status='verified' and om.background_check_completed_at is not null
    order by om.id limit 1) m on true
  where f.code='staffing_gap' and f.status='open' and (p_provider is null or p.id=p_provider)
    and public.agent_autodraft_on(p.id)
  on conflict(provider_id,kind,(proposed->>'ref')) where status='pending' do nothing;

  insert into public.agent_proposals(provider_id,kind,title,detail,proposed,why_finding_id,run_id)
  select f.provider_id,'payment_plan','Payment plan for '||f.title,
    'Review a three-installment plan in Money; this proposal cannot move money.',
    jsonb_build_object('ref','payplan:'||f.member_id,'member_id',f.member_id,'total_cents',f.amount_cents,
      'installments',3,'schedule',jsonb_build_array(current_date+7,current_date+37,current_date+67)),f.id,run
  from public.agent_findings f join public.providers p on p.id=f.provider_id and p.onboarding_completed
  where f.code='refund_exposure' and f.status='open' and f.amount_cents>0
    and (p_provider is null or p.id=p_provider) and public.agent_autodraft_on(p.id)
  on conflict(provider_id,kind,(proposed->>'ref')) where status='pending' do nothing;
  select count(*) into n from public.agent_proposals where run_id=run;
  return n;
end $$;
revoke all on function public.generate_agent_proposals(uuid,boolean) from public,anon,authenticated;

-- No actor/scope/limit arguments: a user cannot spend another user's quota or
-- raise their own limit. Both fixed windows must allow the call (5/min,30/hour).
create or replace function public.consume_club_extract_rate_limit()
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); minute_ok boolean; hour_ok boolean;
begin
  if actor is null then raise exception using errcode='42501',message='sign in to extract'; end if;
  minute_ok:=public.consume_edge_rate_limit('user:'||actor,'club-extract:minute',5,60);
  -- Denied/unknown minute verdicts must not spend the hour allowance.
  if minute_ok is distinct from true then return false; end if;
  hour_ok:=public.consume_edge_rate_limit('user:'||actor,'club-extract:hour',30,3600);
  return hour_ok is true;
end $$;
revoke all on function public.consume_club_extract_rate_limit() from public,anon;
grant execute on function public.consume_club_extract_rate_limit() to authenticated;


