-- ============================================================================
-- 20260915_001075 — audit 2026-09-17 P1-1: a coach cannot do a coach's job.
--
-- A trainer added to an org signed in and landed in the empty org that
-- signup auto-created for them; the app only ever loaded the provider row
-- where owner_id = auth.uid(). Over the API the trainer read 0 rows of their
-- own team's roster, 0 of the events assigned to them, and mark_attendance
-- refused them ("only organisation staff"). This file gives staff a way in,
-- scoped to the teams they coach and proven by zero rows elsewhere:
--   · is_org_member / my_member_id / coaches_team / coaches_event helpers;
--   · my_workspace(): the org the caller should work in — their own org,
--     unless it is still the untouched signup default AND they hold an active
--     membership elsewhere, in which case the employer's org with their role
--     (admin → director, trainer → coach);
--   · SELECT policies for active members on providers (the row, column-locked
--     as before), their own membership row, venues, and — for the teams they
--     coach (any event assigned to them) — teams, team_athletes, events and
--     attendance; nothing about other teams (doc 22.3);
--   · mark_attendance admits the coach assigned to the event.
-- Admin-level writes stay with is_org_admin. Owners are unaffected.
-- ============================================================================
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = auth.uid())
      or exists (select 1 from public.organization_members m where m.organization_id = p_org and m.member_user_id = auth.uid() and m.is_active)
$$;
create or replace function public.my_member_id(p_org uuid) returns uuid
language sql stable security definer set search_path to '' as $$
  select m.id from public.organization_members m where m.organization_id = p_org and m.member_user_id = auth.uid() and m.is_active limit 1
$$;
-- a member coaches a team when any of that team's events is assigned to them; admins coach every team
create or replace function public.coaches_team(p_org uuid, p_team uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select public.is_org_admin(p_org)
      or (p_team is not null and exists (select 1 from public.event e where e.provider_id = p_org and e.team_id = p_team
                                            and e.assigned_member_id = public.my_member_id(p_org)))
$$;
create or replace function public.coaches_event(p_event uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.event e where e.id = p_event
                  and (public.is_org_admin(e.provider_id)
                       or e.assigned_member_id = public.my_member_id(e.provider_id)
                       or public.coaches_team(e.provider_id, e.team_id)))
$$;
revoke all on function public.is_org_member(uuid), public.my_member_id(uuid), public.coaches_team(uuid,uuid), public.coaches_event(uuid) from public, anon;
grant execute on function public.is_org_member(uuid), public.my_member_id(uuid), public.coaches_team(uuid,uuid), public.coaches_event(uuid) to authenticated, service_role;

-- ── the workspace a signed-in person should open ───────────────────────────
create or replace function public.my_workspace()
returns table (provider_id uuid, role text, member_id uuid, business_name text, bio text, sports text[], location text, provider_type text,
               status text, verification_status text, background_check_status text, background_check_completed_at timestamptz,
               onboarding_completed boolean, stripe_onboarding_started boolean, stripe_charges_enabled boolean,
               plan text, plan_status text, plan_period_end timestamptz, coach_years_coaching integer, coach_years_played integer,
               credentials text[], avatar_url text, logo_url text)
language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); own public.providers; emp record; untouched boolean;
begin
  if v_uid is null then return; end if;
  select * into own from public.providers p where p.owner_id = v_uid limit 1;
  select m.organization_id, m.id as mid, m.role into emp from public.organization_members m
   where m.member_user_id = v_uid and m.is_active order by m.created_at limit 1;
  untouched := own.id is not null
    and coalesce(own.onboarding_completed, false) = false
    and own.business_name in ('Your organization', 'My Academy', 'My coaching business')
    and not exists (select 1 from public.teams t where t.provider_id = own.id)
    and not exists (select 1 from public.team_athletes a where a.provider_id = own.id)
    and not exists (select 1 from public.event e where e.provider_id = own.id);
  if own.id is not null and (emp.organization_id is null or not untouched) then
    return query select own.id, 'owner'::text, public.my_member_id(own.id), own.business_name, own.bio, own.sports, own.location, own.provider_type,
      own.status, own.verification_status, own.background_check_status, own.background_check_completed_at, own.onboarding_completed,
      own.stripe_onboarding_started, own.stripe_charges_enabled, own.plan, own.plan_status, own.plan_period_end, own.coach_years_coaching,
      own.coach_years_played, own.credentials, own.avatar_url, own.logo_url;
    return;
  end if;
  if emp.organization_id is not null then
    return query select p.id, case emp.role when 'owner' then 'owner' when 'admin' then 'director' else 'coach' end, emp.mid, p.business_name, p.bio, p.sports, p.location, p.provider_type,
      p.status, p.verification_status, p.background_check_status, p.background_check_completed_at, p.onboarding_completed,
      p.stripe_onboarding_started, p.stripe_charges_enabled, p.plan, p.plan_status, p.plan_period_end, p.coach_years_coaching,
      p.coach_years_played, p.credentials, p.avatar_url, p.logo_url
      from public.providers p where p.id = emp.organization_id;
  end if;
end $$;
revoke all on function public.my_workspace() from public, anon;
grant execute on function public.my_workspace() to authenticated, service_role;

-- ── read policies for active members, scoped to the teams they coach ───────
drop policy if exists providers_select_member on public.providers;
create policy providers_select_member on public.providers for select to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = providers.id and m.member_user_id = auth.uid() and m.is_active));
drop policy if exists organization_members_select_self on public.organization_members;
create policy organization_members_select_self on public.organization_members for select to authenticated
  using (member_user_id = auth.uid());
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams for select to authenticated
  using (public.coaches_team(provider_id, id));
drop policy if exists team_athletes_select_member on public.team_athletes;
create policy team_athletes_select_member on public.team_athletes for select to authenticated
  using (team_id is not null and public.coaches_team(provider_id, team_id));
drop policy if exists event_select_member on public.event;
create policy event_select_member on public.event for select to authenticated
  using (public.is_org_member(provider_id) and (assigned_member_id = public.my_member_id(provider_id) or public.coaches_team(provider_id, team_id)));
drop policy if exists venue_select_member on public.venue;
create policy venue_select_member on public.venue for select to authenticated
  using (public.is_org_member(provider_id));
do $$ begin
  if to_regclass('public.attendance_record') is not null then
    execute 'drop policy if exists attendance_select_member on public.attendance_record';
    execute 'create policy attendance_select_member on public.attendance_record for select to authenticated using (public.coaches_event(event_id))';
  end if;
  if to_regclass('public.event_response') is not null then
    execute 'drop policy if exists event_response_select_member on public.event_response';
    execute 'create policy event_response_select_member on public.event_response for select to authenticated using (public.coaches_event(event_id))';
  end if;
end $$;

-- ── attendance: the assigned coach may mark it ─────────────────────────────
create or replace function public.mark_attendance(
  p_event uuid, p_member uuid, p_state text, p_client_id uuid)
returns public.attendance_record language plpgsql security definer set search_path to '' as $$
declare v_row public.attendance_record; v_provider uuid;
begin
  select provider_id into v_provider from public.event where id = p_event;
  if v_provider is null then raise exception 'event not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not (public.is_org_admin(v_provider) or public.coaches_event(p_event)) then
    raise exception 'only organisation staff may mark attendance' using errcode = '42501';
  end if;
  select * into v_row from public.attendance_record where client_id = p_client_id;
  if found then return v_row; end if;
  insert into public.attendance_record (provider_id, event_id, member_id, state, marked_by, client_id)
  values (v_provider, p_event, p_member, p_state, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'), p_client_id)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.mark_attendance(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.mark_attendance(uuid,uuid,text,uuid) to authenticated, service_role;
