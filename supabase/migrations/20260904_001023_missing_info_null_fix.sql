-- 20260904_001023 — sporv-missing-info crashed 3 nights running (launch
-- audit risk 1): a guardian linked only to members with NULL first_name
-- makes string_agg return NULL, the obligations.title NOT NULL constraint
-- fires, and because the generator is one insert..select across ALL
-- tenants, one bad row killed the job for every org. Coalesce the two
-- aggregate-derived fields; a nameless member still gets a draft, worded
-- generically. (The per-name gap text also skips NULL names now.)
create or replace function public.generate_missing_info_requests(p_provider uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_run uuid DEFAULT NULL::uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, source_kind, source_ref, inverse, guardian_id, member_id, run_id, draft_type)
  select gm.provider_id, 'message', 'draft',
    'Missing details for ' || coalesce(gm.member_names, 'your athletes'),
    'Hi ' || coalesce(gm.gfirst,'there') || ' — to finish setting up '
      || coalesce(gm.member_names, 'your athletes') || ', we still need: '
      || coalesce(gm.gaps, 'a date of birth')
      || '. You can add these from your ' || public.agent_vocab(gm.provider_id,'member','account') || ' page anytime.',
    'agent', 'missinginfo:' || gm.guardian_id || ':' || current_date,
    jsonb_build_object('action','void'), gm.guardian_id, gm.first_member, v_run, 'missing_info_request'
  from (
    select fs.provider_id, g.id as guardian_id, g.first_name as gfirst,
      string_agg(distinct m.first_name, ', ') as member_names,
      (array_agg(m.id))[1] as first_member,
      string_agg(distinct 'date of birth for '||m.first_name, '; ') as gaps
    from public.guardian_links gl
    join public.guardians g on g.id=gl.guardian_id
    join public.team_athletes m on m.id=gl.member_id and m.status='active' and m.dob is null
    join public.fee_schedules fs on fs.member_id=m.id
    where g.email is not null
    group by fs.provider_id, g.id, g.first_name
  ) gm
  where (p_provider is null or gm.provider_id=p_provider) and (p_force or public.agent_autodraft_on(gm.provider_id))
  on conflict (source_ref) where source_kind='agent' and status<>'void' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $function$;
