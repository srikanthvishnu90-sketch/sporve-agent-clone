-- Prompt 1 [CRITICAL-PATH] review draft. NOT applied to production.
--
-- Preconditions:
--   * 2026-09-08-plan-entitlements.sql (or its reviewed migration) has created
--     public.resolve_provider_entitlements_internal(uuid), public.plan_entitlements,
--     and public.provider_entitlement_assignments.
--   * Existing table shapes are the repository baseline plus member identity:
--     team_athletes(provider_id), teams(provider_id), and
--     organization_members(organization_id,member_user_id,is_active).
--
-- This is deliberately a database guard, not a UI hint. RLS/grants still decide
-- who may write. It only rejects a capacity-increasing write with SQLSTATE PT402.
-- It does not block reads, exports, deletes, dues, or reductions in usage.
-- Deployment must be coupled to callers that translate PT402 to HTTP 402.
-- Limitation: the browser-role precheck is intentionally owner-only because the
-- current roster RLS policy is owner-only. If staff write policies are widened,
-- extend that check in the same reviewed migration; do not remove RLS.

begin;

-- A stable, deliberately small contract for every caller. The public names in
-- this receipt come from the catalog, never from a plan-name branch in code.
create or replace function public.raise_entitlement_limit(
  p_provider uuid,
  p_reason text,
  p_limit integer,
  p_current integer
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_entitlement jsonb;
  v_current_slug text;
  v_current_order integer;
  v_upgrade_slug text;
begin
  v_entitlement := public.resolve_provider_entitlements_internal(p_provider);
  select e.public_slug,e.sort_order into strict v_current_slug,v_current_order
    from public.plan_entitlements e
   where e.plan=v_entitlement->>'effective_plan'
   for share;

  select e.public_slug into v_upgrade_slug
    from public.plan_entitlements e
   where e.purchasable
     and e.sort_order>v_current_order
     and case p_reason
       when 'member_cap' then e.member_cap=-1 or e.member_cap>p_current
       when 'admin_cap' then e.admin_cap=-1 or e.admin_cap>p_current
       when 'group_cap' then e.group_cap=-1 or e.group_cap>p_current
       else false
     end
   order by e.sort_order
   limit 1
   for share;

  raise exception using
    errcode='PT402',
    message='Entitlement limit reached',
    detail=jsonb_build_object(
      'reason',p_reason,
      'current_plan',v_current_slug,
      'upgrade_to',v_upgrade_slug,
      'limit',p_limit,
      'current',p_current
    )::text;
end;
$$;
revoke all on function public.raise_entitlement_limit(uuid,text,integer,integer)
  from public,anon,authenticated,service_role;

-- Serialize capacity checks with billing projections. Projection writers lock a
-- provider then its assignment; guards retain that order and then take a
-- provider-keyed advisory transaction lock so two concurrent inserts cannot
-- both observe the final free-tier slot.
create or replace function public.guard_entitlement_member_cap()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_provider uuid := new.provider_id;
  v_cap integer;
  v_current integer;
  v_grows boolean;
begin
  -- A roster slot is a stored member, not merely an active-season member.
  -- Otherwise an import could insert an inactive sixteenth row and activate or
  -- reassign it later without ever consuming a cap. Status changes never free
  -- capacity; explicit deletion remains allowed.
  v_grows := tg_op='INSERT' or old.provider_id is distinct from new.provider_id;
  if not v_grows then return new; end if;

  perform 1 from public.providers where id=v_provider for share;
  if not found then return new; end if; -- the FK remains the authoritative rejection.
  -- BEFORE triggers can precede a table's WITH CHECK policy. For browser roles,
  -- reject an inaccessible provider before resolving/cataloguing its plan. This
  -- is a leak guard only; RLS/grants remain the authoritative permission gate.
  if coalesce(auth.role(),'') in ('anon','authenticated') and not exists (
    select 1 from public.providers p where p.id=v_provider and p.owner_id=auth.uid()
  ) then raise insufficient_privilege using message='Organization access required'; end if;
  perform 1 from public.provider_entitlement_assignments
    where provider_id=v_provider for share;
  perform pg_advisory_xact_lock(hashtextextended(v_provider::text, 41202));

  select e.member_cap into strict v_cap
    from public.plan_entitlements e
   where e.plan=(public.resolve_provider_entitlements_internal(v_provider)->>'effective_plan')
   for share;
  if v_cap=-1 then return new; end if;
  select count(*) into v_current from public.team_athletes where provider_id=v_provider;
  if v_current>=v_cap then
    perform public.raise_entitlement_limit(v_provider,'member_cap',v_cap,v_current);
  end if;
  return new;
end;
$$;
revoke all on function public.guard_entitlement_member_cap() from public,anon,authenticated;

create or replace function public.guard_entitlement_group_cap()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_provider uuid := new.provider_id;
  v_cap integer;
  v_current integer;
begin
  if tg_op='UPDATE' and old.provider_id is not distinct from new.provider_id then
    return new;
  end if;
  perform 1 from public.providers where id=v_provider for share;
  if not found then return new; end if;
  if coalesce(auth.role(),'') in ('anon','authenticated') and not exists (
    select 1 from public.providers p where p.id=v_provider and p.owner_id=auth.uid()
  ) then raise insufficient_privilege using message='Organization access required'; end if;
  perform 1 from public.provider_entitlement_assignments
    where provider_id=v_provider for share;
  perform pg_advisory_xact_lock(hashtextextended(v_provider::text, 41202));
  select e.group_cap into strict v_cap from public.plan_entitlements e
    where e.plan=(public.resolve_provider_entitlements_internal(v_provider)->>'effective_plan')
    for share;
  if v_cap=-1 then return new; end if;
  select count(*) into v_current from public.teams where provider_id=v_provider;
  if v_current>=v_cap then
    perform public.raise_entitlement_limit(v_provider,'group_cap',v_cap,v_current);
  end if;
  return new;
end;
$$;
revoke all on function public.guard_entitlement_group_cap() from public,anon,authenticated;

create or replace function public.guard_entitlement_admin_cap()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_provider uuid := new.organization_id;
  v_owner uuid;
  v_cap integer;
  v_current integer;
  v_grows boolean;
begin
  select owner_id into v_owner from public.providers where id=v_provider for share;
  if not found then return new; end if;
  -- Seats are administrative roles only. Trainers do not consume an admin
  -- seat. The provider owner is the implicit first seat, and its explicit
  -- membership record is allowed without consuming a duplicate seat.
  v_grows := new.is_active and new.role in ('owner','admin')
    and new.member_user_id is distinct from v_owner and (
      tg_op='INSERT' or old.organization_id is distinct from new.organization_id
      or not (old.is_active and old.role in ('owner','admin')
              and old.member_user_id is distinct from v_owner)
    );
  if not v_grows then return new; end if;
  if coalesce(auth.role(),'') in ('anon','authenticated') and not exists (
    select 1 from public.providers p where p.id=v_provider and p.owner_id=auth.uid()
  ) then raise insufficient_privilege using message='Organization access required'; end if;
  perform 1 from public.provider_entitlement_assignments
    where provider_id=v_provider for share;
  perform pg_advisory_xact_lock(hashtextextended(v_provider::text, 41202));
  select e.admin_cap into strict v_cap from public.plan_entitlements e
    where e.plan=(public.resolve_provider_entitlements_internal(v_provider)->>'effective_plan')
    for share;
  if v_cap=-1 then return new; end if;

  -- Pending admin invites (null user) reserve an admin seat. An owner row does
  -- not; a later owner→non-owner member_user_id update is caught by v_grows.
  select 1+count(*) into v_current from public.organization_members
    where organization_id=v_provider and is_active
      and role in ('owner','admin')
      and member_user_id is distinct from v_owner;
  if v_current>=v_cap then
    perform public.raise_entitlement_limit(v_provider,'admin_cap',v_cap,v_current);
  end if;
  return new;
end;
$$;
revoke all on function public.guard_entitlement_admin_cap() from public,anon,authenticated;

drop trigger if exists entitlement_member_cap_guard on public.team_athletes;
create trigger entitlement_member_cap_guard
before insert or update of provider_id on public.team_athletes
for each row execute function public.guard_entitlement_member_cap();

drop trigger if exists entitlement_group_cap_guard on public.teams;
create trigger entitlement_group_cap_guard
before insert or update of provider_id on public.teams
for each row execute function public.guard_entitlement_group_cap();

drop trigger if exists entitlement_admin_cap_guard on public.organization_members;
create trigger entitlement_admin_cap_guard
before insert or update of organization_id,is_active,member_user_id,role on public.organization_members
for each row execute function public.guard_entitlement_admin_cap();

commit;
