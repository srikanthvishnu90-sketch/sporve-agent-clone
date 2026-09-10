-- Applied to production 2026-09-10 via `supabase db query --linked -f`, which
-- writes no ledger row — so this file, byte-identical to the red draft that
-- was executed, is the record. See 20260910_001042 for the same note and the
-- `supabase migration repair` command if you want the ledger to match.
-- Every statement is idempotent, so a replay reproduces the same end state.

-- [CRITICAL-PATH] RED DRAFT — agent targeting fixes found by the golden set
-- (scripts/agent-golden.mjs, 2026-09-08). Two generators addressed the wrong
-- families:
--   1. idle-capacity offers went to families ALREADY enrolled in that program
--      (an "open spots" pitch to someone who has a spot).
--   2. waiver follow-ups went to LAPSED members with no active schedule in a
--      current season (a nag about participation they are not signed up for).
-- Both are prod's verbatim definitions with ONE added predicate each.
-- Inverse: re-apply the previous definitions (kept in git history:
-- migrations 20260902_001020 bodies). No rows change; only future drafts.
-- Verification: node scripts/agent-golden.mjs → the two "quality:" checks pass.
begin;

CREATE OR REPLACE FUNCTION public.generate_idle_capacity_offers(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_run uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse, guardian_id, member_id, run_id, draft_type, why_finding_id)
  select pr.provider_id, 'message', 'draft',
    'Open spots in ' || pr.title,
    'Hi ' || coalesce(g.first_name,'there') || ' — a few spots just opened in ' || pr.title
      || '. We wanted to offer them to our current families first before opening them up. Reply if you''d like one for '
      || m.first_name || '.',
    'agent', 'capacityoffer:' || pr.id || ':' || m.id, jsonb_build_object('action','void'),
    g.id, m.id, v_run, 'idle_capacity_offer', f.id
  from public.agent_findings f
  join public.programs pr on pr.id = f.subject_id and f.code='idle_capacity' and f.status='open'
  join public.team_athletes m on m.provider_id=pr.provider_id and m.status='active'
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl join public.guardians g2 on g2.id=gl.guardian_id
                     where gl.member_id=m.id and gl.is_payer and g2.email_status='ok' limit 1) g on true
  where g.id is not null
    -- golden set 2026-09-08: never pitch open spots to a family already in the
    -- program THIS season (an alumni family from a past season is a fair target)
    and not exists (select 1 from public.fee_schedules fs
                    join public.seasons s on s.id = fs.season_id
                    where fs.member_id = m.id and fs.program_id = pr.id
                      and fs.status = 'active' and s.end_date >= current_date)
    and (p_provider is null or pr.provider_id=p_provider) and (p_force or public.agent_autodraft_on(pr.provider_id))
  on conflict (source_ref) where source_kind='agent' and status<>'void' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $function$;

CREATE OR REPLACE FUNCTION public.generate_waiver_followups(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_run uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse,
     member_id, guardian_id, run_id, draft_type)
  select wd.provider_id, 'waiver', 'draft',
    '“' || wd.title || '” unsigned — ' || m.first_name || ' ' || coalesce(m.last_name,''),
    'Hi ' || coalesce(g.first_name,'there') || ' — the ' || wd.title
      || ' still needs a signature for ' || m.first_name
      || ' before they can participate. It takes about a minute from your Sporv account.',
    'agent', 'waiver:' || wd.id || ':member:' || m.id,
    jsonb_build_object('action','void','reason','undo waiver follow-up'),
    m.id, g.id, v_run, 'waiver_followup'
  from public.waiver_documents wd
  join public.team_athletes m on m.provider_id = wd.provider_id and m.status = 'active'
  left join lateral (select g2.id, g2.first_name from public.guardian_links gl
                     join public.guardians g2 on g2.id = gl.guardian_id
                     where gl.member_id = m.id and gl.is_payer and g2.email_status='ok' limit 1) g on true
  where wd.version = (select max(w2.version) from public.waiver_documents w2
                      where w2.provider_id = wd.provider_id and w2.title = wd.title)
    and m.first_name is not null
    -- golden set 2026-09-08: only members with an active schedule in a current season
    and exists (select 1 from public.fee_schedules fs
                join public.seasons s on s.id = fs.season_id
                where fs.member_id = m.id and fs.status = 'active' and s.end_date >= current_date)
    and not exists (select 1 from public.waiver_signatures ws
                    where ws.waiver_document_id = wd.id and ws.member_id = m.id
                      and (ws.season_id is null or ws.season_id in
                           (select s.id from public.seasons s where s.provider_id = wd.provider_id and s.end_date >= current_date)))
    and (p_provider is null or wd.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(wd.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $function$;

commit;
