-- 20260907_001031 — finance view isolation (red draft 2026-09-05, owner-approved 2026-09-06)
-- [CRITICAL-PATH] REVIEW-ONLY DRAFT: do not apply to a shared DB without review.
-- S03/G4: finance views must honor caller RLS; preserve names, columns and data.
-- Precondition: PostgreSQL15+, canonical billing views, underlying RLS enabled,
-- and existing authenticated/service-role SELECT grants. No broader grants added.
-- Receipt: catalog assertions below plus role tests in the companion fixture.
-- Recovery: fix grants/policies forward; never restore public definer access.
-- No rows are changed or removed. Application/release approval remains required.
do $$ declare relation_name text; principal text; begin
  if current_setting('server_version_num')::integer<150000 then
    raise exception 'finance isolation requires PostgreSQL15+';
  end if;
  foreach relation_name in array array['org_ar','org_overdue_list'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=relation_name and c.relkind='v') then
      raise exception 'finance isolation requires existing view %',relation_name;
    end if;
  end loop;
  foreach relation_name in array array['installments','fee_schedules'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=relation_name and c.relrowsecurity) then
      raise exception 'finance isolation requires RLS on %',relation_name;
    end if;
  end loop;
  foreach principal in array array['authenticated','service_role'] loop
    foreach relation_name in array array['org_ar','org_overdue_list','installments','fee_schedules'] loop
      if not has_table_privilege(principal,format('public.%I',relation_name),'SELECT') then
        raise exception 'finance isolation requires existing SELECT for % on %',principal,relation_name;
      end if;
    end loop;
  end loop;
end $$;

alter view public.org_ar set (security_invoker=true);
alter view public.org_overdue_list set (security_invoker=true);
revoke all privileges on public.org_ar,public.org_overdue_list from public,anon;

do $$ declare relation_name text; begin
  foreach relation_name in array array['org_ar','org_overdue_list'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=relation_name
        and c.reloptions @> array['security_invoker=true']) then
      raise exception 'finance isolation receipt missing for %',relation_name;
    end if;
    if has_table_privilege('anon',format('public.%I',relation_name),'SELECT') then
      raise exception 'finance isolation anonymous SELECT remains on %',relation_name;
    end if;
    if not has_table_privilege('authenticated',format('public.%I',relation_name),'SELECT')
      or not has_table_privilege('service_role',format('public.%I',relation_name),'SELECT') then
      raise exception 'finance isolation lost an existing authorized SELECT on %',relation_name;
    end if;
  end loop;
end $$;
