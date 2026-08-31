-- ============================================================================
-- Spec 02 · migration 2 — GUARDIANS (applied 2026-08-31, owner-directed)
-- Many-to-many guardian_link with is_payer ON THE LINK: two parents, separated
-- households, a grandparent who pays. The link references team_athletes (the
-- ORG-side member record, no child PII beyond what the org already holds) —
-- the family-owned, consent-gated athletes table remains the sole child
-- identity source, untouched.
-- ============================================================================
create table if not exists public.guardians (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null, -- optional portal login
  first_name  text not null,
  last_name   text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now()
);
comment on table public.guardians is
  'Org-side guardian contact record. user_id links to a real login when the guardian claims it; billing and waivers address guardians, never athletes.';

create table if not exists public.guardian_links (
  id            uuid primary key default gen_random_uuid(),
  guardian_id   uuid not null references public.guardians(id) on delete cascade,
  member_id     uuid not null references public.team_athletes(id) on delete cascade,
  is_payer      boolean not null default false,
  relationship  text,
  created_at    timestamptz not null default now(),
  unique (guardian_id, member_id)
);
comment on table public.guardian_links is
  'Many-to-many member↔guardian. is_payer lives HERE: who pays is a property of the relationship, not of either person.';

create index if not exists idx_guardians_provider on public.guardians(provider_id);
create index if not exists idx_guardian_links_member on public.guardian_links(member_id);
create index if not exists idx_guardian_links_guardian on public.guardian_links(guardian_id);

alter table public.guardians enable row level security;
alter table public.guardian_links enable row level security;

-- org owner: full control of their org's guardians
create policy guardians_all_owner on public.guardians
  for all to authenticated
  using (exists (select 1 from public.providers pv
                 where pv.id = guardians.provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv
                 where pv.id = guardians.provider_id and pv.owner_id = auth.uid()));
-- a guardian with a claimed login: read own record only
create policy guardians_select_self on public.guardians
  for select to authenticated
  using (user_id = auth.uid());

create policy guardian_links_all_owner on public.guardian_links
  for all to authenticated
  using (exists (select 1 from public.guardians g
                 join public.providers pv on pv.id = g.provider_id
                 where g.id = guardian_links.guardian_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.guardians g
                 join public.providers pv on pv.id = g.provider_id
                 where g.id = guardian_links.guardian_id and pv.owner_id = auth.uid()));
-- a claimed guardian: read own links (the scope every family query flows through)
create policy guardian_links_select_self on public.guardian_links
  for select to authenticated
  using (exists (select 1 from public.guardians g
                 where g.id = guardian_links.guardian_id and g.user_id = auth.uid()));

grant select, insert, update, delete on public.guardians, public.guardian_links to authenticated;
