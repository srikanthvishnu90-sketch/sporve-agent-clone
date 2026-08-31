-- ============================================================================
-- Spec 02 · migration 5 — WAIVERS (2026-08-31)
-- Versioned documents, hashed at publish; signatures pin the exact version +
-- hash they covered, per member per season, signed by a GUARDIAN. A signature
-- row is immutable once written (what a board/lawyer reads later must be what
-- was signed).
-- ============================================================================
create table if not exists public.waiver_documents (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  title         text not null,
  body_md       text not null,
  version       integer not null default 1 check (version >= 1),
  content_hash  text not null,          -- sha256 of body_md, set at publish
  created_at    timestamptz not null default now(),
  unique (provider_id, title, version)
);

create table if not exists public.waiver_signatures (
  id                 uuid primary key default gen_random_uuid(),
  waiver_document_id uuid not null references public.waiver_documents(id) on delete restrict,
  document_version   integer not null,
  content_hash       text not null,
  member_id          uuid not null references public.team_athletes(id) on delete restrict,
  guardian_id        uuid not null references public.guardians(id) on delete restrict,
  season_id          uuid references public.seasons(id) on delete set null,
  signature_image    text,              -- data URI or storage path
  signed_at          timestamptz not null default now(),
  signer_ip          inet,
  rendered_pdf_path  text,
  unique (waiver_document_id, member_id, season_id)
);
comment on table public.waiver_signatures is
  'Immutable evidence: version + hash pinned at signing. The unsigned-waiver queue is DERIVED (members on a season minus signatures for the season''s required documents).';

create index if not exists idx_waiver_docs_provider on public.waiver_documents(provider_id);
create index if not exists idx_waiver_sigs_member on public.waiver_signatures(member_id);
create index if not exists idx_waiver_sigs_doc on public.waiver_signatures(waiver_document_id);

alter table public.waiver_documents enable row level security;
alter table public.waiver_signatures enable row level security;

create policy waiver_docs_all_owner on public.waiver_documents
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = waiver_documents.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = waiver_documents.provider_id and pv.owner_id = auth.uid()));
-- a claimed guardian can read a document they are asked to sign
create policy waiver_docs_select_guardian on public.waiver_documents
  for select to authenticated
  using (exists (select 1 from public.guardians g
                 where g.provider_id = waiver_documents.provider_id and g.user_id = auth.uid()));

create policy waiver_sigs_owner_read on public.waiver_signatures
  for select to authenticated
  using (exists (select 1 from public.waiver_documents wd
                 join public.providers pv on pv.id = wd.provider_id
                 where wd.id = waiver_signatures.waiver_document_id and pv.owner_id = auth.uid()));
-- a claimed guardian signs for their OWN linked members, and reads only those
create policy waiver_sigs_guardian_insert on public.waiver_signatures
  for insert to authenticated
  with check (exists (select 1 from public.guardians g
                 join public.guardian_links gl on gl.guardian_id = g.id
                 where g.id = waiver_signatures.guardian_id
                   and gl.member_id = waiver_signatures.member_id
                   and g.user_id = auth.uid()));
create policy waiver_sigs_guardian_read on public.waiver_signatures
  for select to authenticated
  using (exists (select 1 from public.guardians g
                 where g.id = waiver_signatures.guardian_id and g.user_id = auth.uid()));

grant select, insert on public.waiver_signatures to authenticated;
grant select, insert, update, delete on public.waiver_documents to authenticated;

-- Immutability + integrity: a signature can never be edited or deleted by a
-- client, and the version/hash it claims must match the document it points at.
create or replace function public.enforce_waiver_signature()
 returns trigger language plpgsql security definer set search_path to '' as $$
declare d record;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'waiver signatures are immutable evidence';
  end if;
  select version, content_hash into d
    from public.waiver_documents where id = new.waiver_document_id;
  if d.version is distinct from new.document_version
   or d.content_hash is distinct from new.content_hash then
    raise exception 'signature version/hash must match the document as published';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_waiver_signature() from public, anon, authenticated;
create trigger trg_enforce_waiver_signature
  before insert or update or delete on public.waiver_signatures
  for each row execute function public.enforce_waiver_signature();

-- published documents freeze their body (a new version is a new row)
create or replace function public.enforce_waiver_document_freeze()
 returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.waiver_signatures ws where ws.waiver_document_id = old.id) then
    raise exception 'a signed document version is frozen — publish a new version instead';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function public.enforce_waiver_document_freeze() from public, anon, authenticated;
create trigger trg_enforce_waiver_document_freeze
  before update or delete on public.waiver_documents
  for each row execute function public.enforce_waiver_document_freeze();
