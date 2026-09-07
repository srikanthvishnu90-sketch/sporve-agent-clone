-- 20260907_001035 — import batch uniqueness (red draft 2026-09-06, owner-approved)
-- [CRITICAL-PATH] REVIEWABLE DRAFT ONLY. Not applied to a shared database.
-- S02 onboarding: identical active roster imports must be idempotent per org.
-- Preconditions: review duplicate active batches and resolve them without
-- deleting roster rows; take a schema backup; apply through the canonical owner.
-- Inverse: drop only this named index after a compare-before-restore review.

do $$
begin
  if exists (
    select 1 from public.import_batches a
    join public.import_batches b on b.provider_id=a.provider_id
      and b.content_hash=a.content_hash and b.id<>a.id
    where a.undone_at is null and b.undone_at is null
  ) then
    raise exception 'import batch preflight: duplicate active provider/content hashes require review';
  end if;
end $$;

create unique index if not exists import_batches_provider_content_hash_active_uq
  on public.import_batches(provider_id, content_hash)
  where undone_at is null;

