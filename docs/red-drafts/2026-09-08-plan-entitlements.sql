-- Prompt 1 [CRITICAL-PATH]: reviewable migration; NOT applied to production.
-- Preflight against the selected sporv branch before promoting to migrations/.
-- Source baseline uses pro/enterprise; target keys are solo/organization.
-- Rename those legacy keys without deleting customers or subscription history.
-- Exact canonical migration number is assigned only after live parity review.
-- Unlimited integer limits use -1 (never NULL); all requested fields populated.
-- This establishes the data layer; caller/cron enforcement is a separate step.
begin;

lock table public.plan_entitlements, public.providers in share row exclusive mode;

do $preflight$
begin
  if exists(select 1 from public.plan_entitlements where plan not in
      ('free','pro','enterprise','solo','organization'))
     or exists(select 1 from public.providers where plan not in
      ('free','pro','enterprise','solo','organization')) then
    raise exception 'Unexpected plan keys: inspect live rows before migration';
  end if;
  if (exists(select 1 from public.plan_entitlements where plan='pro') and
      exists(select 1 from public.plan_entitlements where plan='solo'))
     or (exists(select 1 from public.plan_entitlements where plan='enterprise') and
      exists(select 1 from public.plan_entitlements where plan='organization')) then
    raise exception 'Both legacy and target catalog keys exist: reconcile before migration';
  end if;
end;
$preflight$;

alter table public.plan_entitlements drop constraint if exists plan_entitlements_plan_check;
alter table public.providers drop constraint if exists providers_plan_check;
update public.plan_entitlements set plan=keys.target
from (values ('pro','solo'),('enterprise','organization')) as keys(legacy,target)
where plan=keys.legacy;
update public.providers set plan=keys.target
from (values ('pro','solo'),('enterprise','organization')) as keys(legacy,target)
where plan=keys.legacy;
alter table public.plan_entitlements add constraint plan_entitlements_plan_check
  check(plan in ('free','solo','organization'));
alter table public.providers add constraint providers_plan_check
  check(plan in ('free','solo','organization'));

alter table public.plan_entitlements
  add column display_name text,
  add column public_slug text,
  add column sort_order integer,
  add column member_cap integer,
  add column admin_cap integer,
  add column group_cap integer,
  add column connectors text[],
  add column jobs text[],
  add column modules text[],
  add column scan_mode text,
  add column draft_quota_month integer,
  add column send_quota_month integer,
  add column ask_quota_month integer,
  add column branding_footer boolean,
  add column camps_included boolean,
  add column price_usd_year numeric(8,2);

-- Legacy read-only columns remain projections for the staged client rollout.
-- The new columns are authoritative; a trigger keeps legacy projections aligned.
create function public.sync_entitlement_legacy_columns()
returns trigger language plpgsql set search_path='' as $$
begin
  new.ai_monthly_quota := nullif(new.ask_quota_month,-1);
  new.seat_limit := nullif(new.admin_cap,-1);
  new.workspace_enabled := 'multi_program'=any(new.modules);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.sync_entitlement_legacy_columns() from public,anon,authenticated;
create trigger sync_entitlement_legacy_columns before insert or update
on public.plan_entitlements for each row execute function public.sync_entitlement_legacy_columns();

with all_jobs as (
  select array[
    'overdue_summary','missing_email','credential_expiry','waivers_unsigned',
    'lapsed_members','reconciliation_drift','refund_exposure','staffing_gap',
    'booking_unconfirmed','schedule_conflict','roster_gap','missing_data',
    'waiver_drift','idle_capacity','waitlist_match','camp_to_program',
    'collection_trend','org_structure','discovery_lead','dues_chase',
    'installment_followups','waiver_followups','practice_reminders',
    'eligibility_report','reactivation','treasurer_summary','missing_info_requests',
    'idle_capacity_offers','proposals','proposal_apply','records'
  ]::text[] as jobs
), catalog as (
  select 'free'::text as plan, 'Sporv Free'::text as display_name,
    'free'::text as public_slug, 0 as sort_order, 15 as member_cap,
    1 as admin_cap, 1 as group_cap,
    array['website','csv']::text[] as connectors,
    array['overdue_summary','waivers_unsigned','reconciliation_drift',
      'refund_exposure','waiver_drift','collection_trend','dues_chase',
      'installment_followups','waiver_followups','treasurer_summary']::text[] as jobs,
    array['roster','groups','schedule','review_queue','money','documents',
      'settings','ask','stripe_connect','dues_collection','export','camps']::text[] as modules,
    'nightly'::text as scan_mode, 20 as draft_quota_month,
    20 as send_quota_month, 25 as ask_quota_month,
    true as branding_footer, false as camps_included,
    false as purchasable, 0::numeric as monthly, 0::numeric as annual
  union all
  select 'solo','Sporv Individual','individual',1,100,1,-1,
    array['website','csv','google_calendar','gmail','sms'],all_jobs.jobs,
    array['roster','groups','schedule','review_queue','money','documents',
      'settings','ask','stripe_connect','dues_collection','export','camps',
      'booking_page','packages_credits','notes','progress_tracker','records',
      'proposals','client_sourcing'],
    'triggered',-1,500,500,false,false,true,39,390 from all_jobs
  union all
  select 'organization','Sporv Enterprise','enterprise',2,-1,-1,-1,
    array['website','csv','google_calendar','gmail','sms','outlook',
      'microsoft_calendar','google_sheets','google_drive','quickbooks',
      'google_business_profile','migration_sportsengine','migration_teamsnap',
      'migration_leagueapps','migration_spond','migration_jersey_watch','migration_sheets'],
    all_jobs.jobs,
    array['roster','groups','schedule','review_queue','money','documents',
      'settings','ask','stripe_connect','dues_collection','export','camps',
      'booking_page','packages_credits','notes','progress_tracker','records',
      'proposals','client_sourcing','installments','rsvp','team_chat','invite_link',
      'eligibility','memberships','capacity_checkin','multi_program',
      'staff_roles','migration_service'],
    'ondemand',-1,-1,-1,false,true,true,449,4490 from all_jobs
)
insert into public.plan_entitlements(plan,display_name,public_slug,sort_order,
  member_cap,admin_cap,group_cap,connectors,jobs,modules,scan_mode,
  draft_quota_month,send_quota_month,ask_quota_month,branding_footer,camps_included,
  purchasable,price_usd_month,price_usd_year)
select * from catalog
on conflict(plan) do update set
  display_name=excluded.display_name,public_slug=excluded.public_slug,
  sort_order=excluded.sort_order,member_cap=excluded.member_cap,
  admin_cap=excluded.admin_cap,group_cap=excluded.group_cap,
  connectors=excluded.connectors,jobs=excluded.jobs,modules=excluded.modules,
  scan_mode=excluded.scan_mode,draft_quota_month=excluded.draft_quota_month,
  send_quota_month=excluded.send_quota_month,ask_quota_month=excluded.ask_quota_month,
  branding_footer=excluded.branding_footer,camps_included=excluded.camps_included,
  purchasable=excluded.purchasable,price_usd_month=excluded.price_usd_month,
  price_usd_year=excluded.price_usd_year;

alter table public.plan_entitlements
  alter column display_name set not null, alter column public_slug set not null,
  alter column sort_order set not null, alter column member_cap set not null,
  alter column admin_cap set not null, alter column group_cap set not null,
  alter column connectors set not null, alter column jobs set not null,
  alter column modules set not null, alter column scan_mode set not null,
  alter column draft_quota_month set not null, alter column send_quota_month set not null,
  alter column ask_quota_month set not null, alter column branding_footer set not null,
  alter column camps_included set not null, alter column price_usd_year set not null,
  add constraint entitlement_caps_valid check(member_cap>=-1 and admin_cap>=-1 and group_cap>=-1
    and draft_quota_month>=-1 and send_quota_month>=-1 and ask_quota_month>=-1),
  add constraint entitlement_scan_mode_valid check(scan_mode in ('nightly','triggered','ondemand')),
  add constraint entitlement_prices_valid check(price_usd_month>=0 and price_usd_year>=0),
  add constraint entitlement_public_slug_unique unique(public_slug),
  add constraint entitlement_sort_order_unique unique(sort_order);

create table public.billing_policy (
  singleton boolean primary key default true check(singleton),
  free_plan_key text not null references public.plan_entitlements(plan),
  trial_plan_key text not null references public.plan_entitlements(plan),
  trial_days integer not null check(trial_days>0),
  camp_price_cents integer not null check(camp_price_cents>=0),
  currency text not null check(currency ~ '^[a-z]{3}$'),
  branding_text text not null
);
insert into public.billing_policy values(true,'free','organization',14,4900,'usd','Sent via Sporv');

create table public.provider_entitlement_assignments (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  plan_key text not null references public.plan_entitlements(plan),
  source text not null check(source in ('legacy','free','trial','subscription')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  fallback_plan_key text not null references public.plan_entitlements(plan),
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  check(ends_at is null or ends_at>starts_at)
);

-- Preserve existing access; no retroactive free trials and no removal of data.
insert into public.provider_entitlement_assignments(provider_id,plan_key,source,fallback_plan_key)
select p.id,p.plan,'legacy',bp.free_plan_key from public.providers p cross join public.billing_policy bp;

create function public.initialize_provider_trial()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy public.billing_policy%rowtype;
begin
  select * into strict policy from public.billing_policy where singleton;
  insert into public.provider_entitlement_assignments
    (provider_id,plan_key,source,starts_at,ends_at,fallback_plan_key)
  values(new.id,policy.trial_plan_key,'trial',now(),
    now()+make_interval(days=>policy.trial_days),policy.free_plan_key);
  return new;
end;
$$;
revoke all on function public.initialize_provider_trial() from public,anon,authenticated;
create trigger initialize_provider_trial after insert on public.providers
for each row execute function public.initialize_provider_trial();

-- Resolve expiry at request time, even if a scheduled expiry worker is late.
-- No client-supplied clock; no key-name-dependent capability decisions.
create function public.resolve_provider_entitlements_internal(p_provider uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment public.provider_entitlement_assignments%rowtype; result jsonb;
begin
  select * into strict assignment from public.provider_entitlement_assignments
    where provider_id=p_provider;
  select to_jsonb(e) into strict result from public.plan_entitlements e
    where e.plan=case when assignment.ends_at is not null and assignment.ends_at<=now()
      then assignment.fallback_plan_key else assignment.plan_key end;
  return result || jsonb_build_object('provider_id',p_provider,
    'assignment_revision',assignment.revision,'entitlement_source',assignment.source,
    'assigned_plan',assignment.plan_key,'effective_plan',result->>'plan',
    'assignment_expired',assignment.ends_at is not null and assignment.ends_at<=now(),
    'entitlement_ends_at',assignment.ends_at);
end;
$$;
-- Cron/generator functions owned by the migration owner can resolve without a
-- user JWT; the internal helper is never exposed as a client-callable RPC.
revoke all on function public.resolve_provider_entitlements_internal(uuid)
  from public,anon,authenticated,service_role;

create function public.get_provider_entitlements(p_provider uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not exists(
    select 1 from public.providers p where p.id=p_provider and p.owner_id=auth.uid()
    union all
    select 1 from public.organization_members m where m.organization_id=p_provider
      and m.member_user_id=auth.uid() and m.is_active
  ) then raise insufficient_privilege using message='Organization access required'; end if;
  return public.resolve_provider_entitlements_internal(p_provider);
end;
$$;
revoke all on function public.get_provider_entitlements(uuid) from public,anon;
grant execute on function public.get_provider_entitlements(uuid) to authenticated,service_role;

alter table public.billing_policy enable row level security;
alter table public.provider_entitlement_assignments enable row level security;
revoke all on public.billing_policy,public.provider_entitlement_assignments from public,anon,authenticated;
grant select on public.billing_policy to anon,authenticated;
create policy billing_policy_public_read on public.billing_policy for select to anon,authenticated using(true);
grant select,insert,update on public.billing_policy,public.provider_entitlement_assignments to service_role;

-- A data-only change immediately updates resolved limits; no per-org JSON copy.
-- Deliberately no Stripe price IDs are invented or seeded. Add verified platform
-- price mappings only after test/live Stripe inventory is available.
commit;
