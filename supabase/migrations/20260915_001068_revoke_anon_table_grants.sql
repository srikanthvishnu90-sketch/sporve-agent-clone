-- ============================================================================
-- 20260915_001068 — no anonymous table grant anywhere in public (audit C1/B21;
-- owner rule 2: no unauthenticated route touches org data). Single lane.
-- Applied live (D5 reversed).
--
-- Supabase's default privileges grant anon SELECT on every table created in
-- public. That is how 41 tables — athletes, guardian_links, installments,
-- staff_certifications, settings_audit, and, after 001064, background_check —
-- carried a table-level anon grant with only RLS between anon and the rows.
-- providers leaked "Rivertown FC" through exactly this shape plus one
-- permissive policy. Revoke the class, not the instance, and stop the default
-- so the next table does not re-open it.
--
-- The single deliberate anonymous read is plan_entitlements (public pricing).
-- ============================================================================
do $$
declare r record; n int := 0;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind in ('r','v','m','p') and c.relname <> 'plan_entitlements' loop
    execute format('revoke all on public.%I from anon', r.relname);
    n := n + 1;
  end loop;
  raise notice 'revoked anon on % relations', n;
end $$;
grant select on public.plan_entitlements to anon;
-- new tables: no anon grant by default (the owning role is postgres in Supabase)
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
