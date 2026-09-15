-- 20260915_001053 — spec 12 · migration_quarantine: rows a data copy could not
-- convert are parked here and REPORTED, never dropped. A silent drop in 001054
-- is a lost practice.
create table if not exists public.migration_quarantine (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid references public.providers(id) on delete cascade,
  source_table text not null,
  source_id    uuid,
  reason       text not null,
  payload      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists migration_quarantine_source_idx on public.migration_quarantine (source_table, source_id);
alter table public.migration_quarantine enable row level security;
alter table public.migration_quarantine force row level security;
revoke all on public.migration_quarantine from public, anon;
drop policy if exists migration_quarantine_admin_read on public.migration_quarantine;
create policy migration_quarantine_admin_read on public.migration_quarantine for select to authenticated
  using (provider_id is not null and public.is_org_admin(provider_id));
grant select on public.migration_quarantine to authenticated;
