-- Spec 04: org-side member record (first/last/dob/external_ref/status on
-- team_athletes, athlete_id optional until a family claims), dedupe unique
-- index on (provider, lower(first), lower(last), dob), owner RLS policy, and
-- import_batches.content_hash with a partial unique index so re-uploading the
-- identical file is a database-enforced no-op. Applied to prod 2026-08-31
-- (authoritative body = applied migration spec04_member_identity).
alter table public.team_athletes alter column athlete_id drop not null;
alter table public.team_athletes
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists dob date,
  add column if not exists external_ref text,
  add column if not exists status text not null default 'active'
    check (status in ('active','inactive','withdrawn'));
create unique index if not exists uq_member_dedupe
  on public.team_athletes (provider_id, lower(first_name), lower(last_name), dob)
  where first_name is not null and dob is not null;
alter table public.team_athletes drop constraint if exists team_athletes_identity;
alter table public.team_athletes
  add constraint team_athletes_identity check (athlete_id is not null or first_name is not null);
do $$
begin
  if not exists (select 1 from pg_policies where tablename='team_athletes' and policyname='team_athletes_all_owner') then
    create policy team_athletes_all_owner on public.team_athletes
      for all to authenticated
      using (exists (select 1 from public.providers pv
                     where pv.id = team_athletes.provider_id and pv.owner_id = auth.uid()))
      with check (exists (select 1 from public.providers pv
                     where pv.id = team_athletes.provider_id and pv.owner_id = auth.uid()));
  end if;
end $$;
grant select, insert, update, delete on public.team_athletes to authenticated;
alter table public.import_batches
  add column if not exists content_hash text;
create unique index if not exists uq_import_hash
  on public.import_batches (provider_id, content_hash)
  where content_hash is not null and undone_at is null;
