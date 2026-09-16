-- Disposable-database fixture for spec 16.1 / 16.2, migration 20260915_001064.
-- Never runs against production.
--     bash tools/run-sql-fixtures.sh 2026-09-16-spec16
-- RED-FIRST: with the \ir line removed, assertion A fails (no background_check
-- table) and the org-wide defect is reproducible in the stand-in gate below.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'sporv_spec_badge' then
    raise exception 'refusing to run outside the disposable sporv_spec_badge database (got %)', current_database();
  end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.profiles (id uuid primary key);
create table public.providers (id uuid primary key default gen_random_uuid(), owner_id uuid, business_name text, provider_type text not null default 'organization',
  account_status text not null default 'active', background_check_status text not null default 'none', background_check_completed_at timestamptz);
create table public.organization_members (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.providers(id),
  member_user_id uuid, role text not null default 'trainer', background_check_status text not null default 'none', background_check_completed_at timestamptz,
  is_active boolean not null default true);
create table public.programs (id uuid primary key default gen_random_uuid(), provider_id uuid references public.providers(id), title text, assigned_member_id uuid);
create table public.sessions (id uuid primary key default gen_random_uuid(), program_id uuid references public.programs(id), assigned_member_id uuid);
create table public.bookings (id uuid primary key default gen_random_uuid(), program_id uuid, session_id uuid);
create or replace function public.is_org_admin(p_org uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = auth.uid()) $$;
-- the baseline gate, verbatim: the org-wide pass that 16.1 removes
create or replace function public.provider_safety_cleared(p_provider_id uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.providers pv where pv.id = p_provider_id and pv.account_status = 'active'
    and ((pv.provider_type = 'solo' and pv.background_check_status = 'verified' and pv.background_check_completed_at is not null)
      or (pv.provider_type = 'organization' and exists (select 1 from public.organization_members m where m.organization_id = pv.id
            and m.background_check_status = 'verified' and m.background_check_completed_at is not null and m.is_active)))) $$;
create or replace function public.enforce_booking_provider_verified() returns trigger language plpgsql security definer set search_path to '' as $$
declare v_provider uuid;
begin
  if new.program_id is not null then select pr.provider_id into v_provider from public.programs pr where pr.id = new.program_id;
  elsif new.session_id is not null then select pr.provider_id into v_provider from public.sessions s join public.programs pr on pr.id = s.program_id where s.id = new.session_id; end if;
  if not public.provider_safety_cleared(v_provider) then raise exception 'cannot book: provider is not background-check verified and active'; end if;
  return new;
end $$;
create trigger trg_enforce_booking_provider_verified before insert on public.bookings for each row execute function public.enforce_booking_provider_verified();
grant select, insert, update on public.providers, public.organization_members, public.programs, public.sessions, public.bookings to authenticated;

-- fixture: org A (owner a), director D (cleared the old way), trainer T (never checked), solo coach S
insert into public.providers (id, owner_id, business_name, provider_type) values
  ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Org A', 'organization'),
  ('10000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-00000000000c', 'Solo S', 'solo');
insert into public.organization_members (id, organization_id, role, background_check_status, background_check_completed_at) values
  ('20000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-00000000000a', 'owner', 'verified', now() - interval '30 days'),
  ('20000000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-00000000000a', 'trainer', 'none', null);
insert into public.programs (id, provider_id, title) values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '14U');
insert into public.sessions (id, program_id, assigned_member_id) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000e'),  -- run by the UNCHECKED trainer
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000d'),  -- run by the director
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', null);                                    -- nobody assigned

-- ── the defect, reproduced BEFORE the migration (this is the incident) ─────
do $$ begin
  insert into public.bookings (session_id) values ('40000000-0000-4000-8000-000000000001');
  raise notice 'DEFECT REPRODUCED: a booking with the unchecked trainer was accepted because the director is verified';
  delete from public.bookings;
end $$;

\ir ../../supabase/migrations/20260915_001064_background_check.sql

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', false);
do $$
declare v uuid; n integer;
begin
  -- A ── table exists with RLS forced; a clear row must be dated
  if not exists (select 1 from pg_class where relname = 'background_check' and relrowsecurity and relforcerowsecurity) then
    raise exception 'FAIL A: background_check missing or RLS not forced'; end if;
  begin insert into public.background_check (provider_id, member_id, subject_kind, status) values ('10000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000e','org_member','clear');
    raise exception 'FAIL A: undated clear accepted';
  exception when check_violation then null; end;
  raise notice 'PASS A: background_check exists, RLS forced, clear must carry completed_at';

  -- B ── the legacy mirror value is NOT clearance: the director's old 'verified' column counts for nothing
  if public.background_check_is_clear('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000d') then
    raise exception 'FAIL B: a column value without a check row counted as clear'; end if;
  begin insert into public.bookings (session_id) values ('40000000-0000-4000-8000-000000000002'); raise exception 'FAIL B: booked on a column value';
  exception when others then if sqlerrm not like '%no current background check%' then raise; end if; end;
  raise notice 'PASS B: only a background_check row clears anyone; the old column is not evidence';

  -- C ── order → vendor reference → result 'clear' → mirror flips → booking with THAT person works
  v := public.order_background_check('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000d');
  if (select background_check_status from public.organization_members where id = '20000000-0000-4000-8000-00000000000d') <> 'pending' then
    raise exception 'FAIL C: ordered check did not mirror as pending'; end if;
  perform public.attach_background_check_reference(v, 'NCSI-0001');
  perform public.record_background_check_result('ncsi', 'NCSI-0001', 'clear', now(), now() + interval '2 years');
  if (select background_check_status from public.organization_members where id = '20000000-0000-4000-8000-00000000000d') <> 'verified'
     or (select background_check_completed_at from public.organization_members where id = '20000000-0000-4000-8000-00000000000d') is null then
    raise exception 'FAIL C: clear result did not mirror as verified'; end if;
  insert into public.bookings (session_id) values ('40000000-0000-4000-8000-000000000002');
  raise notice 'PASS C: order → reference → clear result → mirror verified → the cleared person can be booked';

  -- D ── the org-wide pass is gone: the unchecked trainer''s session is refused even though the director is clear
  begin insert into public.bookings (session_id) values ('40000000-0000-4000-8000-000000000001'); raise exception 'FAIL D: org-wide clearance still passes';
  exception when others then if sqlerrm not like '%no current background check%' then raise; end if; end;
  begin insert into public.bookings (session_id) values ('40000000-0000-4000-8000-000000000003'); raise exception 'FAIL D: a session with nobody assigned was bookable';
  exception when others then if sqlerrm not like '%no current background check%' then raise; end if; end;
  if public.provider_safety_cleared('10000000-0000-4000-8000-00000000000a') then raise exception 'FAIL D: one-arg form clears an organization'; end if;
  raise notice 'PASS D: clearance is per person — an unchecked trainer, or no one assigned, cannot be booked';

  -- E ── the mirror is strictly derived: nobody else may write the column — not the owner, not service_role
  begin update public.organization_members set background_check_status = 'verified', background_check_completed_at = now() where id = '20000000-0000-4000-8000-00000000000e';
    raise exception 'FAIL E: owner wrote the mirror';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', '', true);   -- service_role: no jwt
  begin update public.organization_members set background_check_status = 'verified' where id = '20000000-0000-4000-8000-00000000000e';
    raise exception 'FAIL E: service_role wrote the mirror';
  exception when insufficient_privilege then null; end;
  begin update public.providers set background_check_status = 'verified', background_check_completed_at = now() where id = '10000000-0000-4000-8000-00000000000c';
    raise exception 'FAIL E: service_role wrote the provider mirror';
  exception when insufficient_privilege then null; end;
  begin insert into public.organization_members (organization_id, background_check_status) values ('10000000-0000-4000-8000-00000000000a', 'verified');
    raise exception 'FAIL E: insert with a verified mirror accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true);
  raise notice 'PASS E: background_check_status has exactly one writer — the mirror trigger';

  -- F ── consider is never clearance; expiry revokes; suspension revokes
  v := public.order_background_check('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000e');
  perform public.attach_background_check_reference(v, 'NCSI-0002');
  perform public.record_background_check_result('ncsi', 'NCSI-0002', 'consider', now());
  if (select background_check_status from public.organization_members where id = '20000000-0000-4000-8000-00000000000e') <> 'none' then
    raise exception 'FAIL F: consider mirrored as something other than none'; end if;
  perform public.record_background_check_result('ncsi', 'NCSI-0001', 'clear', now() - interval '3 years', now() - interval '1 day');
  if (select background_check_status from public.organization_members where id = '20000000-0000-4000-8000-00000000000d') <> 'none' then
    raise exception 'FAIL F: expired check still mirrors verified'; end if;
  begin insert into public.bookings (session_id) values ('40000000-0000-4000-8000-000000000002'); raise exception 'FAIL F: booked on an expired check';
  exception when others then if sqlerrm not like '%no current background check%' then raise; end if; end;
  raise notice 'PASS F: consider is not clearance; an expired check clears nobody';

  -- G ── an unknown vendor reference writes nothing (a stray webhook cannot clear anyone)
  begin perform public.record_background_check_result('ncsi', 'NCSI-9999', 'clear', now()); raise exception 'FAIL G: unknown reference accepted';
  exception when no_data_found then null; end;
  raise notice 'PASS G: a result must match an ordered check by reference';

  -- H ── solo provider path: cleared by its own row only
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  if public.provider_safety_cleared('10000000-0000-4000-8000-00000000000c') then raise exception 'FAIL H: solo cleared with no check'; end if;
  v := public.order_background_check('10000000-0000-4000-8000-00000000000c');
  perform public.attach_background_check_reference(v, 'NCSI-0003');
  perform public.record_background_check_result('ncsi', 'NCSI-0003', 'clear', now());
  if not public.provider_safety_cleared('10000000-0000-4000-8000-00000000000c') then raise exception 'FAIL H: solo not cleared after clear row'; end if;
  if (select background_check_status from public.providers where id = '10000000-0000-4000-8000-00000000000c') <> 'verified' then raise exception 'FAIL H: solo mirror not verified'; end if;
  raise notice 'PASS H: a solo provider is cleared by its own check row and nothing else';

  -- I ── clients cannot write the check table; another org''s owner cannot order for org A
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true);
  begin perform public.order_background_check('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000e'); raise exception 'FAIL I: cross-org order accepted';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated', 'public.background_check', 'insert') or has_table_privilege('authenticated', 'public.background_check', 'update') then
    raise exception 'FAIL I: authenticated can write background_check'; end if;
  if has_function_privilege('authenticated', 'public.record_background_check_result(text,text,text,timestamptz,timestamptz)', 'execute') then
    raise exception 'FAIL I: a client can record a vendor result'; end if;
  raise notice 'PASS I: only staff of the org order; only the server records results; clients never write the table';
end $$;
