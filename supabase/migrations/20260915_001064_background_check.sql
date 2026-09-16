-- ============================================================================
-- 20260915_001064 — SPEC 16.1 badge integrity, from the 16.2 schema only [G2]
-- Single lane. FILE ONLY — never applied (D5). Owner rulings 2026-09-16:
--   1. the person is organization_members.id (survives account deletion,
--      covers imported staff) — not member_user_id / profiles.id;
--   2. background_check_status stays as a MIRROR, strictly derived: only the
--      mirror trigger may write it, no application path, not even service_role;
--   3. provider_safety_cleared() is per PERSON: the assigned member of the
--      session or program, never "any cleared member of the org";
--   4. no vendor is configured yet (NCSI contract starting) — the webhook
--      skeleton FAILS CLOSED: no vendor means no check, no clearance, no booking.
--
-- The defect this closes (docs/incidents/2026-09-16-org-wide-clearance.md):
-- provider_safety_cleared() passed an organization when ANY ONE active member
-- was verified, so one cleared director cleared every uncleared trainer for
-- booking. Zero live rows carried a check, so nobody was exposed; the shape
-- was wrong regardless. Verified live 2026-09-16: no background_check table,
-- no vendor integration, staff_certifications empty.
-- ============================================================================

-- ── 1. the record of a check: status and dates, never report contents ─────
create table if not exists public.background_check (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.providers(id) on delete cascade,
  member_id         uuid references public.organization_members(id) on delete cascade,
  subject_kind      text not null check (subject_kind in ('solo_provider','org_member')),
  vendor            text not null default 'ncsi' check (vendor in ('ncsi')),
  vendor_reference  text,
  package           text not null default 'standard',
  status            text not null default 'ordered'
                    check (status in ('ordered','pending','clear','consider','suspended','expired','cancelled')),
  ordered_at        timestamptz not null default now(),
  completed_at      timestamptz,
  expires_at        timestamptz,
  adjudicated_by    uuid references public.profiles(id) on delete set null,
  adjudication_note text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint background_check_subject check ((subject_kind = 'org_member') = (member_id is not null)),
  constraint background_check_clear_is_dated check (status <> 'clear' or completed_at is not null)
);
create unique index if not exists background_check_vendor_ref_uq
  on public.background_check (vendor, vendor_reference) where vendor_reference is not null;
create index if not exists idx_background_check_subject on public.background_check (provider_id, member_id, status);
comment on table public.background_check is
  'Spec 16.2. One row per check ordered from the vendor. Status and dates only — never report contents (D3). Written by the vendor webhook (service_role) and by staff ordering a check; the badge and the booking gate read ONLY this table.';

alter table public.background_check enable row level security;
alter table public.background_check force row level security;
-- staff may SEE their org's checks (status/dates); nobody but the server writes
create policy background_check_select_admin on public.background_check
  for select to authenticated using (public.is_org_admin(provider_id));
grant select on public.background_check to authenticated;
grant all on public.background_check to service_role;

-- a member row must belong to the provider named on the check
create or replace function public.enforce_background_check_subject()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.member_id is not null and not exists (
    select 1 from public.organization_members m where m.id = new.member_id and m.organization_id = new.provider_id) then
    raise exception using errcode = '23514', message = 'background_check: member does not belong to that organization';
  end if;
  if new.subject_kind = 'solo_provider' and not exists (
    select 1 from public.providers p where p.id = new.provider_id and p.provider_type = 'solo') then
    raise exception using errcode = '23514', message = 'background_check: a solo_provider check needs a solo provider';
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists trg_enforce_background_check_subject on public.background_check;
create trigger trg_enforce_background_check_subject before insert or update on public.background_check
  for each row execute function public.enforce_background_check_subject();

-- ── 2. what "cleared" means, in exactly one place ─────────────────────────
create or replace function public.background_check_is_clear(p_provider uuid, p_member uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.background_check c
     where c.provider_id = p_provider
       and c.member_id is not distinct from p_member
       and c.status = 'clear'
       and c.completed_at is not null
       and (c.expires_at is null or c.expires_at > now()))
$$;
revoke all on function public.background_check_is_clear(uuid, uuid) from public, anon;
grant execute on function public.background_check_is_clear(uuid, uuid) to authenticated, service_role;

-- ── 3. the mirror: strictly derived, one writer ───────────────────────────
-- providers.background_check_status / organization_members.background_check_status
-- are kept for the existing reads (SPA, RLS policies), but from here only
-- refresh_background_check_mirror() may change them. Any other UPDATE or
-- INSERT carrying a non-default value — authenticated OR service_role — raises.
create or replace function public.refresh_background_check_mirror(p_provider uuid, p_member uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_status text; v_at timestamptz;
begin
  select case
           when public.background_check_is_clear(p_provider, p_member) then 'verified'
           when exists (select 1 from public.background_check c where c.provider_id = p_provider
                          and c.member_id is not distinct from p_member and c.status in ('ordered','pending')) then 'pending'
           else 'none' end,
         (select max(c.completed_at) from public.background_check c
           where c.provider_id = p_provider and c.member_id is not distinct from p_member
             and c.status = 'clear' and (c.expires_at is null or c.expires_at > now()))
    into v_status, v_at;
  perform set_config('sporv.bgcheck_mirror', 'on', true);
  if p_member is null then
    update public.providers set background_check_status = v_status, background_check_completed_at = v_at where id = p_provider;
  else
    update public.organization_members set background_check_status = v_status, background_check_completed_at = v_at where id = p_member;
  end if;
  perform set_config('sporv.bgcheck_mirror', 'off', true);
end; $$;
revoke all on function public.refresh_background_check_mirror(uuid, uuid) from public, anon, authenticated;

create or replace function public.background_check_mirror_trigger()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'DELETE' then perform public.refresh_background_check_mirror(old.provider_id, old.member_id); return old; end if;
  perform public.refresh_background_check_mirror(new.provider_id, new.member_id);
  if tg_op = 'UPDATE' and (new.provider_id <> old.provider_id or new.member_id is distinct from old.member_id) then
    perform public.refresh_background_check_mirror(old.provider_id, old.member_id);
  end if;
  return new;
end; $$;
drop trigger if exists trg_background_check_mirror on public.background_check;
create trigger trg_background_check_mirror after insert or update or delete on public.background_check
  for each row execute function public.background_check_mirror_trigger();

create or replace function public.guard_background_check_mirror()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('sporv.bgcheck_mirror', true), 'off') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.background_check_status is distinct from 'none' or new.background_check_completed_at is not null then
      raise exception using errcode = '42501',
        message = 'background_check_status is derived from public.background_check — nothing else may write it';
    end if;
  elsif new.background_check_status is distinct from old.background_check_status
     or new.background_check_completed_at is distinct from old.background_check_completed_at then
    raise exception using errcode = '42501',
      message = 'background_check_status is derived from public.background_check — nothing else may write it';
  end if;
  return new;
end; $$;
-- runs FIRST (alphabetical: "aaa_") so the existing enforce_* triggers see the guard's verdict
drop trigger if exists aaa_guard_background_check_mirror on public.providers;
create trigger aaa_guard_background_check_mirror before insert or update on public.providers
  for each row execute function public.guard_background_check_mirror();
drop trigger if exists aaa_guard_background_check_mirror on public.organization_members;
create trigger aaa_guard_background_check_mirror before insert or update on public.organization_members
  for each row execute function public.guard_background_check_mirror();

-- ── 4. the safety gate is per person ──────────────────────────────────────
-- Solo provider: the provider's own clear row. Organization: the named member's
-- clear row — an organization as such is never "cleared". No member named = no
-- clearance (fail closed).
create or replace function public.provider_safety_cleared(p_provider_id uuid, p_member_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.providers pv
     where pv.id = p_provider_id and pv.account_status = 'active'
       and ((pv.provider_type = 'solo' and p_member_id is null
               and public.background_check_is_clear(pv.id, null))
         or (pv.provider_type = 'organization' and p_member_id is not null
               and exists (select 1 from public.organization_members m
                            where m.id = p_member_id and m.organization_id = pv.id and m.is_active)
               and public.background_check_is_clear(pv.id, p_member_id))))
$$;
create or replace function public.provider_safety_cleared(p_provider_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  -- one-argument form: only a solo provider can be cleared as a whole; an
  -- organization is cleared per person (two-argument form) or not at all.
  select public.provider_safety_cleared(p_provider_id, null)
$$;
revoke all on function public.provider_safety_cleared(uuid, uuid) from public, anon;
grant execute on function public.provider_safety_cleared(uuid, uuid) to authenticated, service_role;

create or replace function public.enforce_booking_provider_verified()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; v_member uuid; v_type text;
begin
  if new.session_id is not null then
    select pr.provider_id, coalesce(s.assigned_member_id, pr.assigned_member_id) into v_provider, v_member
      from public.sessions s join public.programs pr on pr.id = s.program_id where s.id = new.session_id;
  elsif new.program_id is not null then
    select pr.provider_id, pr.assigned_member_id into v_provider, v_member from public.programs pr where pr.id = new.program_id;
  end if;
  if v_provider is null then
    raise exception 'booking has no resolvable program/provider to verify against';
  end if;
  select provider_type into v_type from public.providers where id = v_provider;
  if v_type = 'solo' then v_member := null; end if;
  if not public.provider_safety_cleared(v_provider, v_member) then
    raise exception 'cannot book: the person running this session has no current background check';
  end if;
  return new;
end; $$;

-- ── 5. staff order a check; the vendor (webhook) resolves it ──────────────
create or replace function public.order_background_check(p_provider uuid, p_member uuid default null, p_package text default 'standard')
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_type text; n integer;
begin
  if not public.is_org_admin(p_provider) then
    raise exception using errcode = '42501', message = 'only organisation staff may order a background check';
  end if;
  select provider_type into v_type from public.providers where id = p_provider;
  insert into public.background_check (provider_id, member_id, subject_kind, package, status)
  values (p_provider, p_member, case when p_member is null then 'solo_provider' else 'org_member' end, p_package, 'ordered')
  returning id into v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception using errcode = 'P0002', message = 'order wrote no row'; end if;
  return v_id;
end; $$;
revoke all on function public.order_background_check(uuid, uuid, text) from public, anon;
grant execute on function public.order_background_check(uuid, uuid, text) to authenticated, service_role;

-- the vendor result: matched by reference, never creates a subject, 'consider' is never clearance
create or replace function public.record_background_check_result(
  p_vendor text, p_vendor_reference text, p_status text, p_completed_at timestamptz, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid; n integer;
begin
  if p_status not in ('pending','clear','consider','suspended','expired','cancelled') then
    raise exception using errcode = '22023', message = 'unknown background check status';
  end if;
  update public.background_check
     set status = p_status,
         completed_at = case when p_status = 'clear' then coalesce(p_completed_at, now()) else completed_at end,
         expires_at = coalesce(p_expires_at, expires_at)
   where vendor = p_vendor and vendor_reference = p_vendor_reference
  returning id into v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception using errcode = 'P0002', message = 'no ordered check carries that vendor reference'; end if;
  return v_id;
end; $$;
revoke all on function public.record_background_check_result(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.record_background_check_result(text, text, text, timestamptz, timestamptz) to service_role;

-- staff attach the vendor's reference once the vendor assigns it (the order step, when NCSI exists)
create or replace function public.attach_background_check_reference(p_check uuid, p_vendor_reference text)
returns void language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  update public.background_check c set vendor_reference = p_vendor_reference
   where c.id = p_check and c.status = 'ordered' and c.vendor_reference is null and public.is_org_admin(c.provider_id);
  get diagnostics n = row_count;
  if n <> 1 then raise exception using errcode = 'P0002', message = 'no ordered check of yours without a reference'; end if;
end; $$;
revoke all on function public.attach_background_check_reference(uuid, text) from public, anon;
grant execute on function public.attach_background_check_reference(uuid, text) to authenticated, service_role;
