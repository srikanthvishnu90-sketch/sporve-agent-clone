-- [CRITICAL-PATH] RED DRAFT (RLS) — Treasurer role, read-only money view.
-- Launch item 12. Today organization_members.role is owner|admin|trainer and
-- every money table (fee_schedules, installments) is readable only by the
-- provider OWNER (pv.owner_id = auth.uid()) or the paying guardian. A club
-- treasurer therefore has no way to see dues without owning the org.
-- This adds a 'treasurer' role that can READ money rows for their org and
-- nothing else: no writes, no approvals, no Stripe, no is_org_admin.
-- Inverse: drop the two policies, drop the helper, restore the role check.
-- Verification (as a treasurer JWT):
--   select count(*) from fee_schedules;   -- > 0 for their org
--   update installments set status='paid' where id=<any>;  -- 0 rows / 42501
--   select is_org_admin('<org>');         -- false
begin;

alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role = any (array['owner','admin','trainer','treasurer']));

create or replace function public.is_org_money_reader(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.providers p where p.id = p_org and p.owner_id = auth.uid())
      or exists (select 1 from public.organization_members m
                 where m.organization_id = p_org and m.member_user_id = auth.uid()
                   and m.role in ('owner','admin','treasurer') and m.is_active);
$$;
revoke execute on function public.is_org_money_reader(uuid) from public, anon;
grant execute on function public.is_org_money_reader(uuid) to authenticated;

create policy fee_schedules_select_money_reader on public.fee_schedules
  for select to authenticated
  using (public.is_org_money_reader(provider_id));

create policy installments_select_money_reader on public.installments
  for select to authenticated
  using (exists (select 1 from public.fee_schedules fs
                 where fs.id = installments.fee_schedule_id
                   and public.is_org_money_reader(fs.provider_id)));

comment on function public.is_org_money_reader(uuid) is
  'Owner, admin or treasurer of the org — READ money rows only. Approvals and writes stay on is_org_admin / owner.';

commit;
