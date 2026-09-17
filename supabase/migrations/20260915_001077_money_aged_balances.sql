-- ============================================================================
-- 20260915_001077 — audit 2026-09-17 P1-3: money has a screen for dues.
--
-- The Earnings tab showed marketplace booking revenue ("GROSS $0") over an
-- org holding $60,000 of fee obligations. Doc 22.6: outstanding balances by
-- family and aggregate, aged; every obligation traceable to what created it
-- and what has been paid; failed payments with retry state. This is the ONE
-- round trip the Money screen makes. SECURITY DEFINER because obligations,
-- fee_schedules and installments are owner-only under RLS today and a
-- treasurer/director must see money too; the caller's role comes from
-- dashboard_caller (001073) and anyone below treasurer — a coach, a
-- non-member, org B — gets ZERO ROWS, not an error (doc 28 law 2). Nothing
-- here writes. Money is integer cents throughout (00-MASTER §Money).
-- ============================================================================
create or replace function public.money_aged_balances(p_provider uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_member uuid; v_now timestamptz := now(); v_out jsonb;
begin
  select role, member_id into v_role, v_member from public.dashboard_caller(p_provider);
  if v_role is null or public.dashboard_role_rank(v_role) < 2 then
    return jsonb_build_object('role', v_role, 'totals', null, 'families', '[]'::jsonb, 'items', '[]'::jsonb,
                              'items_truncated', false, 'failed', '[]'::jsonb, 'collected', '[]'::jsonb, 'collected_90d_cents', 0);
  end if;
  with open as (
    select o.id, o.guardian_id, o.member_id, o.title, o.amount_cents, o.due_at, o.status, o.source_kind, o.source_ref, o.created_at,
           case when o.due_at is null or o.due_at > v_now then 0 else floor(extract(epoch from (v_now - o.due_at)) / 86400)::int end as days_overdue
    from public.obligations o
    where o.provider_id = p_provider and o.kind = 'fee' and o.status in ('draft','approved') and coalesce(o.amount_cents, 0) > 0
  ),
  fam as (
    select o.guardian_id,
           max(nullif(trim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')), '')) as family,
           sum(o.amount_cents)::bigint as balance_cents,
           coalesce(sum(o.amount_cents) filter (where o.days_overdue > 0), 0)::bigint as overdue_cents,
           count(*)::int as open_count,
           min(o.due_at) as oldest_due_at,
           max(o.days_overdue)::int as days_overdue,
           (select string_agg(distinct nullif(trim(coalesce(a.first_name,'') || ' ' || coalesce(a.last_name,'')), ''), ', ')
              from public.team_athletes a where a.id in (select x.member_id from open x where x.guardian_id is not distinct from o.guardian_id)) as athletes
    from open o left join public.guardians g on g.id = o.guardian_id
    group by o.guardian_id
  )
  select jsonb_build_object(
    'role', v_role,
    'totals', (select jsonb_build_object(
        'outstanding_cents', coalesce(sum(amount_cents), 0), 'open_count', count(*),
        'overdue_cents', coalesce(sum(amount_cents) filter (where days_overdue > 0), 0), 'overdue_count', count(*) filter (where days_overdue > 0),
        'families_count', count(distinct guardian_id) + (case when bool_or(guardian_id is null) then 1 else 0 end),
        'buckets', jsonb_build_object(
          'current', coalesce(sum(amount_cents) filter (where days_overdue <= 0), 0),
          'd1_30',   coalesce(sum(amount_cents) filter (where days_overdue between 1 and 30), 0),
          'd31_60',  coalesce(sum(amount_cents) filter (where days_overdue between 31 and 60), 0),
          'd61_90',  coalesce(sum(amount_cents) filter (where days_overdue between 61 and 90), 0),
          'd90_plus',coalesce(sum(amount_cents) filter (where days_overdue > 90), 0)))
      from open),
    'families', (select coalesce(jsonb_agg(to_jsonb(f) order by f.overdue_cents desc, f.days_overdue desc, f.balance_cents desc, f.family nulls last), '[]'::jsonb) from fam f),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'guardian_id', o.guardian_id, 'member_id', o.member_id, 'title', o.title,
                 'amount_cents', o.amount_cents, 'due_at', o.due_at, 'days_overdue', o.days_overdue, 'status', o.status,
                 'source_kind', o.source_kind, 'source_ref', o.source_ref, 'created_at', o.created_at) order by o.due_at asc nulls last, o.amount_cents desc), '[]'::jsonb)
              from (select * from open order by due_at asc nulls last, amount_cents desc limit 2000) o),
    'items_truncated', (select count(*) > 2000 from open),
    'failed', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'member_id', i.member_id,
                 'athlete', nullif(trim(coalesce(a.first_name,'') || ' ' || coalesce(a.last_name,'')), ''),
                 'amount_cents', i.amount_cents, 'due_date', i.due_date, 'attempt_count', i.attempt_count, 'last_attempt_at', i.last_attempt_at) order by i.due_date), '[]'::jsonb)
               from public.installments i join public.fee_schedules fs on fs.id = i.fee_schedule_id
               left join public.team_athletes a on a.id = i.member_id
               where fs.provider_id = p_provider and i.status = 'failed'),
    'collected', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'amount_cents', o.amount_cents, 'done_at', o.done_at,
                 'family', nullif(trim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')), '')) order by o.done_at desc nulls last), '[]'::jsonb)
                  from (select * from public.obligations x where x.provider_id = p_provider and x.kind = 'fee' and x.status = 'done' and coalesce(x.amount_cents, 0) > 0
                        order by x.done_at desc nulls last limit 50) o left join public.guardians g on g.id = o.guardian_id),
    'collected_90d_cents', (select coalesce(sum(amount_cents), 0) from public.obligations x
                            where x.provider_id = p_provider and x.kind = 'fee' and x.status = 'done' and x.done_at >= v_now - interval '90 days')
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.money_aged_balances(uuid) from public, anon;
grant execute on function public.money_aged_balances(uuid) to authenticated, service_role;
