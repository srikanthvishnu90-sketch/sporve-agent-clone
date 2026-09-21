-- 20260919_001109  reprocess_billing_ledger_event — admin repair for the money gate
-- ---------------------------------------------------------------------------
-- RED SET: NOT applied by the agent. The owner applies this by hand after review.
--
-- Why this exists
--   apply_stripe_billing_event (20260910_001040) has a single exit point: every
--   verdict — 'stale', 'ignored_bad_plan:<plan>', 'ignored_unknown_status:<s>',
--   'provider_not_found' — is still INSERTED into payment_event_ledger as
--   outcome='ignored' before the text verdict is returned. That is deliberate
--   (a seen event must be recorded), but it means a Stripe replay of the same
--   event id hits `if exists (... stripe_event_id = p_event_id) then return
--   'duplicate'` and is a no-op forever. Once the underlying cause is fixed
--   (subscription metadata.plan corrected, the provider row created, ...)
--   there is otherwise NO way to get the projection applied. This RPC is that
--   way, and it DELIBERATELY BYPASSES the duplicate check for exactly that
--   reason.
--
-- How the bypass works
--   Inside one transaction: the ledger row for p_stripe_event_id is deleted,
--   then apply_stripe_billing_event is called again with the same event id.
--   Its duplicate check now finds nothing, it re-projects, and it re-inserts
--   the ledger row with the NEW outcome. The advisory lock inside it is
--   transaction-scoped, so a concurrent live delivery of the same event id
--   serialises behind this call. If the re-run raises, the whole thing rolls
--   back and the original 'ignored' row survives untouched.
--
-- What it can and cannot reconstruct
--   The ledger stores event_type, stripe_object_id (= subscription id),
--   amount, currency, payload hash and occurred_at. It does NOT store the
--   plan, status, provider or period: those come from the billing_subscriptions
--   mirror row for that subscription (provider_id, status, price, periods,
--   cancel flag, coupon). The PLAN is not stored anywhere in the database — it
--   rides only on Stripe subscription metadata — so a bad-plan repair MUST be
--   given the corrected plan explicitly via p_plan. Calling with the single
--   mandated argument reprocesses with the mirror's status and NO plan, which
--   is correct for provider_not_found / unknown-status repairs but will return
--   'ignored_bad_plan:null' for an active subscription (safe: nothing changes).
--   p_status lets the operator override the mirror's status when Stripe has
--   since moved on (e.g. the mirror still says 'paused').
--
-- Admin-only
--   service_role execute only; anon/authenticated revoked. A defensive check
--   inside also refuses any JWT role other than service_role (a direct psql
--   session has no JWT and passes). Never expose this through PostgREST to
--   a client.
--
-- Returns the verdict text of the re-run (e.g. 'applied:pro/active'). On an
-- 'applied:*' verdict the matching webhook_dead_letter row (if any) is marked
-- resolved so the no-stale-dead-letters invariant clears.

create or replace function public.reprocess_billing_ledger_event(
  p_stripe_event_id text,
  p_plan text default null,
  p_status text default null)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_row public.payment_event_ledger%rowtype;
  v_sub public.billing_subscriptions%rowtype;
  v_result text;
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_jwt_role <> '' and v_jwt_role <> 'service_role' then
    raise exception 'reprocess_billing_ledger_event is admin-only' using errcode = '42501';
  end if;
  if p_stripe_event_id is null or p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$' then
    raise exception 'invalid stripe event id' using errcode = '22023';
  end if;

  -- Same lock the live RPC takes, so a concurrent delivery cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended(p_stripe_event_id, 0));

  select * into v_row from public.payment_event_ledger
    where stripe_event_id = p_stripe_event_id for update;
  if not found then
    raise exception 'no ledger row for event %', p_stripe_event_id using errcode = 'P0002';
  end if;
  if v_row.booking_id is not null then
    raise exception 'event % is a booking event, not a billing event', p_stripe_event_id
      using errcode = '22023';
  end if;
  if v_row.stripe_object_id is null then
    raise exception 'event % carries no subscription id; cannot reconstruct', p_stripe_event_id
      using errcode = '22023';
  end if;

  select * into v_sub from public.billing_subscriptions
    where stripe_subscription_id = v_row.stripe_object_id;
  if not found then
    -- The mirror upsert runs BEFORE the plan/status branch in the live RPC, so
    -- a mirror row exists for every non-duplicate verdict except when the
    -- original delivery raised. Nothing to reconstruct from.
    raise exception 'no billing_subscriptions mirror for %', v_row.stripe_object_id
      using errcode = 'P0002';
  end if;

  -- THE BYPASS: remove the seen-marker so the duplicate gate does not fire.
  delete from public.payment_event_ledger where id = v_row.id;

  v_result := public.apply_stripe_billing_event(
    p_event_id            => p_stripe_event_id,
    p_event_type          => v_row.event_type,
    p_provider_id         => v_sub.provider_id,
    p_subscription_id     => v_sub.stripe_subscription_id,
    p_price_id            => v_sub.stripe_price_id,
    p_status              => coalesce(p_status, v_sub.status),
    p_plan                => p_plan,
    p_period_start        => v_sub.current_period_start,
    p_period_end          => v_sub.current_period_end,
    p_cancel_at_period_end=> v_sub.cancel_at_period_end,
    p_coupon              => v_sub.coupon,
    p_amount_minor        => v_row.amount_minor,
    p_currency            => v_row.currency,
    p_payload_sha256      => v_row.payload_sha256,
    -- The mirror's updated_at IS this event's occurred_at when it was the
    -- last writer; passing the mirror timestamp keeps the `<=` out-of-order
    -- guard satisfied instead of reporting 'stale' against itself.
    p_occurred_at         => greatest(v_row.occurred_at, v_sub.updated_at));

  if v_result like 'applied:%' then
    update public.webhook_dead_letter
      set resolved_at = now()
      where stripe_event_id = p_stripe_event_id and resolved_at is null;
  end if;
  return v_result;
end $$;

comment on function public.reprocess_billing_ledger_event(text, text, text) is
  'Admin repair for the money gate: re-runs apply_stripe_billing_event for a ledger row by stripe_event_id, deliberately bypassing its duplicate check (ignored verdicts are recorded as seen, so a plain replay is a permanent no-op). Pass p_plan for ignored_bad_plan repairs — the plan is not stored anywhere in the DB.';

revoke all on function public.reprocess_billing_ledger_event(text, text, text)
  from public, anon, authenticated;
grant execute on function public.reprocess_billing_ledger_event(text, text, text)
  to service_role;
