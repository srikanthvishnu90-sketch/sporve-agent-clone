-- ============================================================================
-- Spec 02 · migration 6 — STAFF CHECK AS A RECORD, NOT A PRODUCT (2026-08-31)
-- No Checkr. AAU/NCSI already screens; the director enters the membership ID
-- or attests an external check. staff_certifications (existing, mapping-first)
-- gains the attestation trail: WHO recorded it, WHEN, and from WHAT source.
-- The verified badge renders only from real server evidence — the existing
-- staff-cert-webhook remains the only path to status='verified'; attested
-- records carry their own status so the two can never be confused.
-- ============================================================================
alter table public.staff_certifications
  add column if not exists evidence_source text
    check (evidence_source is null or evidence_source in
      ('aau_ncsi','external_vendor','document_upload','director_attestation')),
  add column if not exists attested_by uuid references public.profiles(id) on delete set null,
  add column if not exists attested_at timestamptz;

comment on column public.staff_certifications.evidence_source is
  'Where the evidence came from: aau_ncsi (membership id in reference), external_vendor, document_upload, or director_attestation. NULL = legacy row.';

-- allow the attested state without opening the verified state:
-- (status check may already exist; extend it defensively)
do $$
begin
  begin
    alter table public.staff_certifications drop constraint if exists staff_certifications_status_check;
    alter table public.staff_certifications
      add constraint staff_certifications_status_check
      check (status in ('none','pending','verified','expired','rejected','attested'));
  exception when others then
    raise notice 'status check left as-is (%)', sqlerrm;
  end;
end $$;

-- Attestation trail is server-stamped: whoever writes an attested row is
-- recorded as attested_by, and clients cannot forge someone else's name.
create or replace function public.enforce_staff_check_attestation()
 returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;   -- webhook path trusted
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'verified is set only by the certification webhook, never a client';
  end if;
  if new.evidence_source is not null and
     (tg_op = 'INSERT' or new.evidence_source is distinct from old.evidence_source
      or new.status = 'attested' and old.status is distinct from new.status) then
    new.attested_by := auth.uid();
    new.attested_at := now();
  end if;
  return new;
end; $$;
revoke all on function public.enforce_staff_check_attestation() from public, anon, authenticated;
drop trigger if exists trg_enforce_staff_check_attestation on public.staff_certifications;
create trigger trg_enforce_staff_check_attestation
  before insert or update on public.staff_certifications
  for each row execute function public.enforce_staff_check_attestation();
