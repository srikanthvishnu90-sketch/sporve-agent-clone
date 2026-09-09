-- Prompt 1 [CRITICAL-PATH] review draft, NOT applied.
-- Requires the reviewed entitlement catalog/resolver migration in this release.
-- Deploy the API's version-2 quota response support before applying this SQL.
-- Preserves auth, per-user 12/minute burst shield, atomic monthly usage receipts.
-- Inverse: restore reviewed previous RPC; retain ai_usage and rate-limit history.
begin;
create or replace function public.consume_ai_quota(p_kind text default 'command_bar')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); provider uuid; entitlement jsonb;
  quota integer; used integer; written integer; retry_seconds integer;
  burst_allowed boolean; upgrade_slug text; current_slug text; current_order integer;
begin
  if actor is null then return jsonb_build_object('allowed',false,'reason','not_authenticated'); end if;
  select id into provider from public.providers where owner_id=actor for share;
  if not found then return jsonb_build_object('allowed',false,'reason','not_a_coach'); end if;

  -- Serialize against plan changes; resolve trial expiry using the server clock.
  -- Projection writers lock provider then assignment in the same order.
  perform 1 from public.provider_entitlement_assignments where provider_id=provider for share;
  entitlement:=public.resolve_provider_entitlements_internal(provider);
  select e.ask_quota_month,e.public_slug,e.sort_order into quota,current_slug,current_order
    from public.plan_entitlements e where e.plan=entitlement->>'effective_plan' for share;
  if not found or quota is null or quota < -1 then
    return jsonb_build_object('allowed',false,'reason','quota_unavailable');
  end if;

  burst_allowed:=public.consume_edge_rate_limit('user:'||actor,'coach-ai:minute',12,60);
  if burst_allowed is null then return jsonb_build_object('allowed',false,'reason','quota_unavailable'); end if;
  if not burst_allowed then
    retry_seconds:=60-(floor(extract(epoch from clock_timestamp()))::bigint % 60)::integer;
    return jsonb_build_object('allowed',false,'reason','rate_limited','retry_after',retry_seconds);
  end if;

  perform pg_advisory_xact_lock(hashtext(provider::text));
  select count(*) into used from public.ai_usage where provider_id=provider
    and used_at >= (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC');
  if quota <> -1 and used >= quota then
    -- The upgrade destination is catalog data, never a plan-name branch.
    select e.public_slug into upgrade_slug from public.plan_entitlements e
      where e.purchasable and e.sort_order>current_order
        and (e.ask_quota_month=-1 or e.ask_quota_month>used)
      order by e.sort_order limit 1;
    return jsonb_build_object('allowed',false,'reason','quota_exhausted',
      'plan',entitlement->>'effective_plan','used',used,'quota',quota,
      'contract_version',2,'current_plan',current_slug,'upgrade_to',upgrade_slug,
      'limit',quota,'current',used);
  end if;
  insert into public.ai_usage(provider_id,kind)
    values(provider,left(coalesce(nullif(p_kind,''),'command_bar'),40));
  get diagnostics written=row_count;
  if written<>1 then raise exception 'AI usage receipt was not written'; end if;
  return jsonb_build_object('allowed',true,'plan',entitlement->>'effective_plan',
    'used',used+1,'quota',nullif(quota,-1));
end $$;
revoke all on function public.consume_ai_quota(text) from public,anon;
grant execute on function public.consume_ai_quota(text) to authenticated;
commit;
