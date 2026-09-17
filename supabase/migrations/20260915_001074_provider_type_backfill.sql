-- 20260915_001074 — audit 2026-09-17 P1-7. Setup never wrote providers.provider_type,
-- and enforce_org_member() refuses staff unless it is 'organization', so every
-- org created through the current signup could not add a coach. Going forward
-- the setup flow writes it from the pack (team/camp/blank → organization,
-- private → solo). This backfills the rows that already exist: anything that
-- already behaves like an organization (staff, teams, an org-shaped setup
-- answer) becomes 'organization'; the rest stay untouched so a solo trainer
-- is never mislabelled by a guess.
update public.providers p
   set provider_type = 'organization'
 where p.provider_type is null
   and (
     exists (select 1 from public.organization_members m where m.organization_id = p.id)
     or exists (select 1 from public.teams t where t.provider_id = p.id)
     or exists (select 1 from public.provider_settings s where s.provider_id = p.id and s.key = 'onboarding'
                  and s.value ->> 'type' in ('team','camp','blank'))
   );
