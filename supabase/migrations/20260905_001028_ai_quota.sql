-- 20260905_001028 — AI quota hardening (Codex draft, robin-reviewed 3-pass,
-- owner-approved 2026-09-05 'apply'). Monthly metering unchanged; adds the
-- 12/60s per-user burst cap (fixed window, retry_after 1-60s) and closes
-- missing-entitlement-as-unlimited. Applied verbatim from the reviewed
-- draft (outer begin/commit stripped). Probes: unauth -> not_authenticated;
-- free coach -> allowed:true with usage receipt (rolled back).
-- [CRITICAL-PATH] REVIEW DRAFT ONLY; not a canonical migration or applied SQL.
-- Preserves consume_ai_quota(text) callers and monthly metering; adds a shared
-- per-authenticated-actor 12/fixed-minute burst cap for ALL metered AI kinds.
-- Preconditions: canonical schema/RPC/grants verified; isolated + concurrent
-- tests pass; API understands rate_limited; owner approves exact DB target.
-- Receipt: ai_usage for admitted calls, edge_rate_limits for burst attempts.
-- Inverse: retain metering history; rollback function only after review, never
-- restore the missing-entitlement-as-unlimited bug or delete usage rows.

create or replace function public.consume_ai_quota(p_kind text default 'command_bar')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); v_provider uuid; v_plan text; v_quota integer; v_used integer;
  retry_seconds integer; burst_allowed boolean; written integer;
begin
  if actor is null then return jsonb_build_object('allowed',false,'reason','not_authenticated'); end if;
  select id,plan into v_provider,v_plan from public.providers where owner_id=actor for share;
  if not found then return jsonb_build_object('allowed',false,'reason','not_a_coach'); end if;

  select ai_monthly_quota into v_quota from public.plan_entitlements where plan=v_plan for share;
  -- A missing row is NOT an explicitly configured unlimited plan.
  if not found or v_quota<0 then
    return jsonb_build_object('allowed',false,'reason','quota_unavailable');
  end if;

  burst_allowed:=public.consume_edge_rate_limit('user:'||actor,'coach-ai:minute',12,60);
  if burst_allowed is null then return jsonb_build_object('allowed',false,'reason','quota_unavailable'); end if;
  if not burst_allowed then
    retry_seconds:=60-(floor(extract(epoch from clock_timestamp()))::bigint % 60)::integer;
    return jsonb_build_object('allowed',false,'reason','rate_limited','retry_after',retry_seconds);
  end if;

  -- Null quota means unlimited only when the entitlement row actually exists;
  -- even that plan passes the shared burst cap and writes a usage receipt.
  if v_quota is null then
    insert into public.ai_usage(provider_id,kind)
      values(v_provider,left(coalesce(nullif(p_kind,''),'command_bar'),40));
    get diagnostics written=row_count;
    if written<>1 then raise exception 'AI usage receipt was not written'; end if;
    return jsonb_build_object('allowed',true,'plan',v_plan,'quota',null);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_provider::text));
  select count(*) into v_used from public.ai_usage
    where provider_id=v_provider and used_at>=date_trunc('month',now());
  if v_used>=v_quota then
    return jsonb_build_object('allowed',false,'reason','quota_exhausted',
      'plan',v_plan,'used',v_used,'quota',v_quota);
  end if;
  insert into public.ai_usage(provider_id,kind)
    values(v_provider,left(coalesce(nullif(p_kind,''),'command_bar'),40));
  get diagnostics written=row_count;
  if written<>1 then raise exception 'AI usage receipt was not written'; end if;
  return jsonb_build_object('allowed',true,'plan',v_plan,'used',v_used+1,'quota',v_quota);
end $$;
revoke all on function public.consume_ai_quota(text) from public,anon;
grant execute on function public.consume_ai_quota(text) to authenticated;


