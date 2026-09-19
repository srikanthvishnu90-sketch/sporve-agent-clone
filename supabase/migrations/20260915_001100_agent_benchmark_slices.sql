-- ============================================================================
-- 2026-09-19 · Agent benchmark slices (C2 / E1 / F1 / F2)
-- REVIEWABLE DRAFT — not applied. Owner authorization required before apply
-- (RLS/auth touch [CRITICAL-PATH] rules). Safe to review, unsafe to assume live.
-- ============================================================================

-- ── E1 · org_memory — durable cross-session facts the coach teaches the agent.
-- Read into coach-command's CONTEXT every turn; written via remember_fact,
-- listed via list_memory, removed via forget_fact. Owner-only, like findings.
create table if not exists public.org_memory (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  fact text not null check (char_length(fact) between 3 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_org_memory_provider on public.org_memory(provider_id);
alter table public.org_memory enable row level security;
drop policy if exists org_memory_owner on public.org_memory;
create policy org_memory_owner on public.org_memory
  for all to authenticated
  using (exists (select 1 from public.providers p
                 where p.id = org_memory.provider_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers p
                 where p.id = org_memory.provider_id and p.owner_id = auth.uid()));

-- ── F2 · coach_documents — real downloadable artifacts (handouts, letters).
-- coach-command's create_document inserts here deterministically (READ-shaped,
-- like agent_findings); the document-download edge function serves the file.
create table if not exists public.coach_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  format text not null default 'handout'
    check (format in ('handout', 'letter', 'note')),
  body_markdown text not null check (char_length(body_markdown) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index if not exists idx_coach_documents_provider on public.coach_documents(provider_id);
alter table public.coach_documents enable row level security;
drop policy if exists coach_documents_owner on public.coach_documents;
create policy coach_documents_owner on public.coach_documents
  for all to authenticated
  using (exists (select 1 from public.providers p
                 where p.id = coach_documents.provider_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers p
                 where p.id = coach_documents.provider_id and p.owner_id = auth.uid()));

-- ── F1 · let the coach's own agent queue rebooking drafts.
-- outbound_messages previously had SELECT + UPDATE owner policies but no
-- INSERT: only security-definer paths could create rows. This policy lets the
-- authenticated org owner insert DRAFTED rows only — inert until the coach
-- presses Send per row in the Approvals tab (lifecycle-approve, service role,
-- still the sole delivery path). No new send capability is created.
drop policy if exists om_insert_coach_drafted on public.outbound_messages;
create policy om_insert_coach_drafted on public.outbound_messages
  for insert to authenticated
  with check (
    status = 'drafted'
    and exists (select 1 from public.providers p
                 where p.id = outbound_messages.provider_id and p.owner_id = auth.uid())
  );

-- ── C2 · venue prospects share the findings review queue (kind = 'venues').
-- No schema change: agent_findings.kind is free text; the 'venues' kind is
-- documented here for the queue UI. Saving stays owner-scoped via the
-- existing agent_findings_owner policy.
comment on table public.agent_findings is
  'Owner review queue. kind: money|people|documents|schedule|clients|venues. Generators write under the owner''s own RLS; nothing here sends.';
