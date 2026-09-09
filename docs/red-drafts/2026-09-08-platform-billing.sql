-- Prompt 1 [CRITICAL-PATH]: REVIEWABLE DRAFT ONLY. Do not apply directly.
--
-- This is the platform's subscription projection, deliberately separate from
-- connected-account dues: it neither reads nor writes payment_event_ledger,
-- booking/installment tables, Stripe Connect accounts, or the legacy
-- apply_stripe_billing_event RPC. It must be promoted only after
-- 2026-09-08-plan-entitlements.sql and the caller cutover it documents.
--
-- Preconditions (confirmed target is production tseszaprvtvqrkfpditu, no branches):
--   1. public.providers has id, plan_status and the organization exists.
--   2. public.plan_entitlements, public.billing_policy and
--      public.provider_entitlement_assignments are installed from the
--      entitlement migration.
--   3. Each actual Stripe platform customer and price has been independently
--      verified in the matching Stripe test/live account, then inserted below.
--      No price or customer identifier is seeded or inferred from metadata.
--   4. billing-webhook sends precisely the JSON contract checked by this RPC.
--   5. agent_findings matches the live Doc 11 queue schema (including evidence).
--
-- Inverse: remove the billing-webhook deployment first, then revoke execute on
-- apply_platform_billing_event. Preserve receipts for audit. Dropping the
-- projection tables is a destructive data-retention decision, not an inverse.

begin;

-- Enforce tenant identity in the receipt relation, not only in RPC code.
create unique index agent_findings_billing_receipt_identity
  on public.agent_findings(provider_id,id);

create table public.platform_billing_customers (
  provider_id uuid not null references public.providers(id) on delete restrict,
  livemode boolean not null,
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  verified_at timestamptz not null,
  verified_by text not null check (length(trim(verified_by)) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (provider_id, livemode),
  unique (livemode, stripe_customer_id)
);

-- A provider is bound to exactly one Stripe mode. This prevents a test event
-- from changing a live provider's single entitlement assignment (or vice versa).
-- Test and live exercises use distinct fixture/staging providers. This binding
-- is inserted only after the mode is verified, never derived from an event.
create table public.platform_billing_provider_bindings (
  provider_id uuid primary key references public.providers(id) on delete restrict,
  livemode boolean not null,
  verified_at timestamptz not null,
  verified_by text not null check (length(trim(verified_by)) between 1 and 120),
  projection_revision bigint not null default 0 check (projection_revision >= 0),
  created_at timestamptz not null default now(),
  unique (provider_id, livemode)
);

-- Checkout/activation writes this trusted reservation before any webhook can
-- affect an org. Webhook metadata is never an authorization source. Replacing a
-- subscription is an explicit activation transaction that retires the old row
-- and inserts the new pending row; it is not implemented by this draft.
create table public.platform_billing_subscription_authorizations (
  provider_id uuid not null references public.providers(id) on delete restrict,
  livemode boolean not null,
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  state text not null check (state in ('pending','active')),
  verified_at timestamptz not null,
  verified_by text not null check (length(trim(verified_by)) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (provider_id, livemode),
  unique (livemode, stripe_subscription_id),
  unique (livemode, stripe_customer_id, stripe_subscription_id)
);

create table public.platform_billing_prices (
  livemode boolean not null,
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  plan_key text not null references public.plan_entitlements(plan),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  verified_at timestamptz not null,
  verified_by text not null check (length(trim(verified_by)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (livemode, stripe_price_id)
);
-- Retain retired verified prices for receipt interpretation while ensuring one
-- checkout-eligible price per plan/interval/mode.
create unique index platform_billing_prices_one_active_plan_interval
  on public.platform_billing_prices(livemode, plan_key, billing_interval)
  where active;

-- One immutable receipt per Stripe event. Unlike the dues ledger, this table
-- is not an accounting balance and never uses an insert-then-promote update.
create table public.platform_billing_receipts (
  receipt_id bigint generated always as identity primary key,
  livemode boolean not null,
  stripe_event_id text not null check (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null check (event_type in (
    'checkout.session.completed', 'customer.subscription.created',
    'customer.subscription.updated', 'customer.subscription.deleted',
    'invoice.payment_failed'
  )),
  occurred_at timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  provider_id uuid not null references public.providers(id) on delete restrict,
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  subscription_snapshot jsonb not null,
  projection_revision bigint not null check (projection_revision > 0),
  assignment_revision bigint not null check (assignment_revision > 0),
  effective_plan text not null references public.plan_entitlements(plan),
  finding_id uuid,
  foreign key(provider_id,finding_id) references public.agent_findings(provider_id,id) on delete restrict,
  outcome text not null check (outcome in ('applied', 'superseded')),
  check ((event_type='invoice.payment_failed') = (finding_id is not null)),
  created_at timestamptz not null default now(),
  unique (livemode, stripe_event_id)
);

create table public.platform_billing_subscriptions (
  livemode boolean not null,
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  provider_id uuid not null references public.providers(id) on delete restrict,
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  stripe_status text not null,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null,
  source_event_id text not null check (source_event_id ~ '^evt_[A-Za-z0-9]+$'),
  source_occurred_at timestamptz not null,
  snapshot jsonb not null,
  projected_at timestamptz not null default now(),
  primary key (livemode, stripe_subscription_id),
  check (current_period_end > current_period_start)
);

-- This per-provider cursor stops an older event for a canceled prior
-- subscription from reverting a newer subscription for the same customer.
create table public.platform_billing_provider_projection (
  provider_id uuid not null references public.providers(id) on delete restrict,
  livemode boolean not null,
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  source_event_id text not null check (source_event_id ~ '^evt_[A-Za-z0-9]+$'),
  source_occurred_at timestamptz not null,
  projected_at timestamptz not null default now(),
  primary key (provider_id, livemode)
);

create function public.prevent_platform_billing_receipt_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'platform_billing_receipts is append-only'
    using errcode='55000';
end;
$$;
revoke all on function public.prevent_platform_billing_receipt_mutation()
  from public, anon, authenticated, service_role;
create trigger platform_billing_receipts_append_only
before update or delete on public.platform_billing_receipts
for each row execute function public.prevent_platform_billing_receipt_mutation();

-- p_event is server-generated after Stripe signature verification and a fresh
-- PLATFORM-account subscription fetch. It intentionally has no provider or
-- plan input: customer and price mappings are the only identity/plan sources.
create function public.apply_platform_billing_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_event_id text;
  v_event_type text;
  v_occurred_at timestamptz;
  v_livemode boolean;
  v_hash text;
  v_subscription jsonb;
  v_subscription_id text;
  v_customer_id text;
  v_price_id text;
  v_status text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_cancel_at_period_end boolean;
  v_provider_id uuid;
  v_plan_key text;
  v_receipt public.platform_billing_receipts%rowtype;
  v_cursor public.platform_billing_provider_projection%rowtype;
  v_assignment public.provider_entitlement_assignments%rowtype;
  v_effective_plan text;
  v_assignment_source text;
  v_assignment_end timestamptz;
  v_provider_status text;
  v_is_paid boolean;
  v_stale boolean := false;
  v_rows integer;
  v_finding_id uuid;
  v_binding public.platform_billing_provider_bindings%rowtype;
  v_authorization public.platform_billing_subscription_authorizations%rowtype;
  v_expected_projection_revision bigint;
begin
  if not coalesce(jsonb_typeof(p_event) = 'object',false)
    or not coalesce(jsonb_typeof(p_event->'subscription') = 'object',false)
    or not coalesce(jsonb_typeof(p_event->'event_id') = 'string',false)
    or not coalesce(jsonb_typeof(p_event->'event_type') = 'string',false)
    or not coalesce(jsonb_typeof(p_event->'occurred_at') = 'number',false)
    or not coalesce(jsonb_typeof(p_event->'livemode') = 'boolean',false)
    or not coalesce(jsonb_typeof(p_event->'payload_sha256') = 'string',false)
    or not coalesce(jsonb_typeof(p_event->'expected_projection_revision') = 'number',false) then
    raise exception 'Invalid platform billing event' using errcode='22023';
  end if;
  v_event_id := p_event->>'event_id';
  v_event_type := p_event->>'event_type';
  v_hash := p_event->>'payload_sha256';
  v_livemode := (p_event->>'livemode')::boolean;
  v_subscription := p_event->'subscription';
  v_expected_projection_revision := (p_event->>'expected_projection_revision')::bigint;
  if not coalesce(v_event_id ~ '^evt_[A-Za-z0-9]+$',false)
    or not coalesce(v_event_type in ('checkout.session.completed','customer.subscription.created',
      'customer.subscription.updated','customer.subscription.deleted','invoice.payment_failed')
      ,false)
    or not coalesce(v_hash ~ '^[0-9a-f]{64}$',false)
    or v_expected_projection_revision < 0
    or not coalesce((p_event->>'occurred_at') ~ '^[1-9][0-9]{0,12}$',false) then
    raise exception 'Invalid platform billing event' using errcode='22023';
  end if;
  v_occurred_at := to_timestamp((p_event->>'occurred_at')::numeric);
  v_subscription_id := v_subscription->>'subscription_id';
  v_customer_id := v_subscription->>'customer_id';
  v_price_id := v_subscription->>'price_id';
  v_status := v_subscription->>'status';
  if not coalesce(jsonb_typeof(v_subscription->'subscription_id') = 'string',false)
    or not coalesce(jsonb_typeof(v_subscription->'customer_id') = 'string',false)
    or not coalesce(jsonb_typeof(v_subscription->'price_id') = 'string',false)
    or not coalesce(jsonb_typeof(v_subscription->'status') = 'string',false)
    or not coalesce(jsonb_typeof(v_subscription->'current_period_start') = 'number',false)
    or not coalesce(jsonb_typeof(v_subscription->'current_period_end') = 'number',false)
    or not coalesce(v_subscription_id ~ '^sub_[A-Za-z0-9]+$',false)
    or not coalesce(v_customer_id ~ '^cus_[A-Za-z0-9]+$',false)
    or not coalesce(v_price_id ~ '^price_[A-Za-z0-9]+$',false)
    or not coalesce(v_status in ('active','trialing','past_due','unpaid','canceled',
      'incomplete','incomplete_expired','paused')
      ,false)
    or not coalesce((v_subscription->>'current_period_start') ~ '^[1-9][0-9]{0,12}$',false)
    or not coalesce((v_subscription->>'current_period_end') ~ '^[1-9][0-9]{0,12}$',false)
    or not coalesce(jsonb_typeof(v_subscription->'cancel_at_period_end') = 'boolean',false) then
    raise exception 'Invalid platform subscription snapshot' using errcode='22023';
  end if;
  v_period_start := to_timestamp((v_subscription->>'current_period_start')::numeric);
  v_period_end := to_timestamp((v_subscription->>'current_period_end')::numeric);
  v_cancel_at_period_end := (v_subscription->>'cancel_at_period_end')::boolean;
  if v_period_end <= v_period_start then
    raise exception 'Invalid platform subscription period' using errcode='22023';
  end if;

  -- Event-id idempotency is checked before any mutable projection. A reused
  -- event id with a different body is an integrity incident, never a no-op.
  select * into v_receipt from public.platform_billing_receipts
    where livemode=v_livemode and stripe_event_id=v_event_id;
  if found then
    if v_receipt.payload_sha256 <> v_hash
      or v_receipt.stripe_subscription_id <> v_subscription_id
      or v_receipt.stripe_customer_id <> v_customer_id then
      raise exception 'Platform billing event id/hash mismatch' using errcode='22023';
    end if;
    return jsonb_build_object('receipt_id',v_receipt.receipt_id::text,
      'event_id',v_event_id,'outcome','duplicate','payload_sha256',v_hash,
      'livemode',v_receipt.livemode,
      'provider_id',v_receipt.provider_id::text,'subscription_id',v_receipt.stripe_subscription_id,
      'customer_id',v_receipt.stripe_customer_id,'effective_plan',v_receipt.effective_plan,
      'assignment_revision',v_receipt.assignment_revision,'projection_revision',v_receipt.projection_revision,
      'subscription',v_receipt.subscription_snapshot,
      'finding_id',v_receipt.finding_id);
  end if;

  select p.id into strict v_provider_id from public.platform_billing_customers c
    join public.providers p on p.id=c.provider_id
    join public.platform_billing_provider_bindings b on b.provider_id=p.id
      and b.livemode=c.livemode
    where c.livemode=v_livemode and c.stripe_customer_id=v_customer_id
    for update of p;
  select * into strict v_binding from public.platform_billing_provider_bindings
    where provider_id=v_provider_id and livemode=v_livemode for update;
  if v_binding.projection_revision <> v_expected_projection_revision then
    return jsonb_build_object('outcome','conflict','event_id',v_event_id,
      'expected_projection_revision',v_expected_projection_revision,
      'projection_revision',v_binding.projection_revision);
  end if;
  -- This is the authoritative-subscription check. A valid customer mapping is
  -- insufficient: an old cancelled subscription must not replace the current
  -- one, and a first event is accepted only for an activation-created pending
  -- reservation, never for webhook metadata.
  select * into strict v_authorization
    from public.platform_billing_subscription_authorizations
    where provider_id=v_provider_id and livemode=v_livemode
      and stripe_subscription_id=v_subscription_id and stripe_customer_id=v_customer_id
    for update;
  -- Lock hierarchy is provider -> entitlement assignment -> catalog/projection.
  -- This matches the entitlement resolver and serializes all subscriptions for
  -- one provider without a cross-provider lock.
  select * into v_assignment from public.provider_entitlement_assignments
    where provider_id=v_provider_id for update;
  if not found then raise exception 'Provider entitlement assignment is missing' using errcode='55000'; end if;
  -- Recheck after taking the provider mutex: two concurrent deliveries of the
  -- same event can both miss the optimistic check above, but only one may write.
  select * into v_receipt from public.platform_billing_receipts
    where livemode=v_livemode and stripe_event_id=v_event_id;
  if found then
    if v_receipt.payload_sha256 <> v_hash
      or v_receipt.stripe_subscription_id <> v_subscription_id
      or v_receipt.stripe_customer_id <> v_customer_id then
      raise exception 'Platform billing event id/hash mismatch' using errcode='22023';
    end if;
    return jsonb_build_object('receipt_id',v_receipt.receipt_id::text,
      'event_id',v_event_id,'outcome','duplicate','payload_sha256',v_hash,
      'livemode',v_receipt.livemode,
      'provider_id',v_receipt.provider_id::text,'subscription_id',v_receipt.stripe_subscription_id,
      'customer_id',v_receipt.stripe_customer_id,'effective_plan',v_receipt.effective_plan,
      'assignment_revision',v_receipt.assignment_revision,'projection_revision',v_receipt.projection_revision,
      'subscription',v_receipt.subscription_snapshot,
      'finding_id',v_receipt.finding_id);
  end if;
  -- A retired price remains a verified mapping for existing subscriptions;
  -- `active` gates new Checkout creation, not webhook projection.
  select plan_key into strict v_plan_key from public.platform_billing_prices
    where livemode=v_livemode and stripe_price_id=v_price_id for share;

  -- Revision CAS replaces timestamp ordering. No write happens on conflict;
  -- the handler refetches the current Stripe subscription and prepares again.
  v_stale := false;

  v_is_paid := v_status in ('active','trialing','past_due');
  select case when v_is_paid then v_plan_key else bp.free_plan_key end,
    case when v_is_paid then 'subscription' else 'free' end,
    case when v_status in ('active','trialing') and v_cancel_at_period_end then v_period_end else null end,
    case v_status when 'active' then 'active' when 'trialing' then 'trialing'
      when 'past_due' then 'past_due' when 'incomplete' then 'incomplete' else 'canceled' end
  into strict v_effective_plan,v_assignment_source,v_assignment_end,v_provider_status
  from public.billing_policy bp where bp.singleton;

  if not v_stale then
    insert into public.platform_billing_subscriptions(livemode,stripe_subscription_id,provider_id,
      stripe_customer_id,stripe_price_id,stripe_status,current_period_start,current_period_end,
      cancel_at_period_end,source_event_id,source_occurred_at,snapshot)
    values(v_livemode,v_subscription_id,v_provider_id,v_customer_id,v_price_id,v_status,
      v_period_start,v_period_end,v_cancel_at_period_end,v_event_id,v_occurred_at,v_subscription)
    on conflict(livemode,stripe_subscription_id) do update set
      provider_id=excluded.provider_id,stripe_customer_id=excluded.stripe_customer_id,
      stripe_price_id=excluded.stripe_price_id,stripe_status=excluded.stripe_status,
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
      cancel_at_period_end=excluded.cancel_at_period_end,source_event_id=excluded.source_event_id,
      source_occurred_at=excluded.source_occurred_at,snapshot=excluded.snapshot,projected_at=now()
    returning stripe_subscription_id into v_subscription_id;
    if not found then raise exception 'Subscription projection was not written' using errcode='55000'; end if;
    insert into public.platform_billing_provider_projection(provider_id,livemode,stripe_subscription_id,
      source_event_id,source_occurred_at)
    values(v_provider_id,v_livemode,v_subscription_id,v_event_id,v_occurred_at)
    on conflict(provider_id,livemode) do update set stripe_subscription_id=excluded.stripe_subscription_id,
      source_event_id=excluded.source_event_id,source_occurred_at=excluded.source_occurred_at,projected_at=now()
    returning stripe_subscription_id into v_subscription_id;
    if not found then raise exception 'Provider projection cursor was not written' using errcode='55000'; end if;
    insert into public.provider_entitlement_assignments(provider_id,plan_key,source,starts_at,ends_at,
      fallback_plan_key,revision,updated_at)
    select v_provider_id,v_effective_plan,v_assignment_source,v_period_start,v_assignment_end,
      bp.free_plan_key,1,now() from public.billing_policy bp where bp.singleton
    on conflict(provider_id) do update set plan_key=excluded.plan_key,source=excluded.source,
      starts_at=excluded.starts_at,ends_at=excluded.ends_at,fallback_plan_key=excluded.fallback_plan_key,
      revision=public.provider_entitlement_assignments.revision+1,updated_at=now()
    returning * into v_assignment;
    if not found then raise exception 'Entitlement projection was not written' using errcode='55000'; end if;
    update public.providers set plan_status=v_provider_status where id=v_provider_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'Provider status projection was not written' using errcode='55000'; end if;
    update public.platform_billing_provider_bindings
      set projection_revision=projection_revision+1
      where provider_id=v_provider_id and livemode=v_livemode
        and projection_revision=v_expected_projection_revision
      returning * into v_binding;
    if not found then raise exception 'Projection CAS lost after provider lock' using errcode='55000'; end if;
    update public.platform_billing_subscription_authorizations set state='active'
      where provider_id=v_provider_id and livemode=v_livemode
        and stripe_subscription_id=v_subscription_id and state in ('pending','active');
    if not found then raise exception 'Subscription authorization was not activated' using errcode='55000'; end if;
    -- The projection stores a paid assignment until the cancellation boundary,
    -- but a late event may already be beyond that boundary. Return the resolved
    -- access tier, never the stale assigned paid tier.
    if v_assignment.ends_at is not null and v_assignment.ends_at<=now() then
      v_effective_plan := v_assignment.fallback_plan_key;
    end if;
  end if;

  -- Billing-system alert, not an AI-generated outbound draft: no approval/send
  -- fields, recipient, money amount or action is invented. Even a late failure
  -- event is historical evidence; its text does not claim the invoice is still
  -- unpaid. The immutable receipt prevents a retry reopening a dismissed alert.
  if v_event_type='invoice.payment_failed' then
    insert into public.agent_findings(provider_id,kind,code,severity,title,detail,
      source_ref,subject_type,evidence)
    values(v_provider_id,'money','subscription_payment_failed','warn',
      'Sporv subscription payment failed',
      'Stripe reported a failed subscription payment. Review Billing for the current status. Dues collection is unaffected.',
      'billing:invoice_failure:' || v_livemode::text || ':' || v_event_id,
      'subscription',jsonb_build_object('stripe_event_id',v_event_id,
        'stripe_subscription_id',v_subscription_id,'occurred_at',v_occurred_at,
        'observed_subscription_status',v_status,'livemode',v_livemode))
    returning id into v_finding_id;
    if not found or v_finding_id is null then
      raise exception 'Subscription failure finding was not written' using errcode='55000';
    end if;
  end if;

  insert into public.platform_billing_receipts(livemode,stripe_event_id,event_type,occurred_at,
    payload_sha256,provider_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,
    subscription_snapshot,outcome,finding_id,projection_revision,assignment_revision,effective_plan)
  values(v_livemode,v_event_id,v_event_type,v_occurred_at,v_hash,v_provider_id,v_customer_id,
    v_subscription_id,v_price_id,v_subscription,case when v_stale then 'superseded' else 'applied' end,v_finding_id,
    v_binding.projection_revision,v_assignment.revision,v_effective_plan)
  returning * into v_receipt;
  if not found then raise exception 'Platform billing receipt was not written' using errcode='55000'; end if;
  if v_stale then
    select * into strict v_assignment from public.provider_entitlement_assignments where provider_id=v_provider_id;
    select coalesce(case when v_assignment.ends_at is not null and v_assignment.ends_at<=now()
      then v_assignment.fallback_plan_key else v_assignment.plan_key end,bp.free_plan_key)
      into strict v_effective_plan from public.billing_policy bp where bp.singleton;
  end if;
  return jsonb_build_object('receipt_id',v_receipt.receipt_id::text,'event_id',v_event_id,
    'outcome',v_receipt.outcome,'payload_sha256',v_hash,'provider_id',v_provider_id::text,
    'subscription_id',v_subscription_id,'customer_id',v_customer_id,
    'livemode',v_livemode,'effective_plan',v_effective_plan,'assignment_revision',v_assignment.revision,
    'projection_revision',v_binding.projection_revision,
    'subscription',v_subscription,'finding_id',v_receipt.finding_id);
end;
$$;
-- Phase one of the webhook protocol: validate immutable event identity and
-- trusted subscription authorization before the external Stripe read. It has
-- no writes and is service-only; a duplicate returns its immutable receipt.
create function public.prepare_platform_billing_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event_id text:=p_event->>'event_id'; v_hash text:=p_event->>'payload_sha256';
  v_sub text:=p_event->>'subscription_id'; v_customer text:=p_event->>'customer_id';
  v_mode boolean; v_provider uuid; v_receipt public.platform_billing_receipts%rowtype;
  v_binding public.platform_billing_provider_bindings%rowtype;
begin
  if not coalesce(jsonb_typeof(p_event)='object',false)
    or not coalesce(jsonb_typeof(p_event->'livemode')='boolean',false)
    or not coalesce(v_event_id ~ '^evt_[A-Za-z0-9]+$',false)
    or not coalesce(v_hash ~ '^[0-9a-f]{64}$',false)
    or not coalesce(v_sub ~ '^sub_[A-Za-z0-9]+$',false)
    or not coalesce(v_customer ~ '^cus_[A-Za-z0-9]+$',false) then
    raise exception 'Invalid platform billing prepare event' using errcode='22023';
  end if;
  v_mode := (p_event->>'livemode')::boolean;
  select * into v_receipt from public.platform_billing_receipts
    where livemode=v_mode and stripe_event_id=v_event_id;
  if found then
    if v_receipt.payload_sha256<>v_hash or v_receipt.stripe_subscription_id<>v_sub
      or v_receipt.stripe_customer_id<>v_customer then
      raise exception 'Platform billing event id/hash mismatch' using errcode='22023';
    end if;
    return jsonb_build_object('outcome','duplicate','receipt_id',v_receipt.receipt_id::text,
      'event_id',v_event_id,'livemode',v_receipt.livemode,'payload_sha256',v_hash,
      'provider_id',v_receipt.provider_id::text,'subscription_id',v_receipt.stripe_subscription_id,
      'customer_id',v_receipt.stripe_customer_id,'projection_revision',v_receipt.projection_revision,
      'assignment_revision',v_receipt.assignment_revision,'effective_plan',v_receipt.effective_plan,
      'subscription',v_receipt.subscription_snapshot,'finding_id',v_receipt.finding_id);
  end if;
  select c.provider_id into strict v_provider from public.platform_billing_customers c
    where c.livemode=v_mode and c.stripe_customer_id=v_customer;
  select * into strict v_binding from public.platform_billing_provider_bindings
    where provider_id=v_provider and livemode=v_mode;
  perform 1 from public.platform_billing_subscription_authorizations a
    where a.provider_id=v_provider and a.livemode=v_mode
      and a.stripe_subscription_id=v_sub and a.stripe_customer_id=v_customer
      and a.state in ('pending','active');
  if not found then raise exception 'Subscription is not authorized for this provider' using errcode='42501'; end if;
  return jsonb_build_object('outcome','ready','provider_id',v_provider::text,
    'expected_projection_revision',v_binding.projection_revision);
end;
$$;
revoke all on function public.prepare_platform_billing_event(jsonb) from public,anon,authenticated;
grant execute on function public.prepare_platform_billing_event(jsonb) to service_role;
revoke all on function public.apply_platform_billing_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_platform_billing_event(jsonb) to service_role;

alter table public.platform_billing_customers enable row level security;
alter table public.platform_billing_provider_bindings enable row level security;
alter table public.platform_billing_subscription_authorizations enable row level security;
alter table public.platform_billing_prices enable row level security;
alter table public.platform_billing_receipts enable row level security;
alter table public.platform_billing_subscriptions enable row level security;
alter table public.platform_billing_provider_projection enable row level security;
revoke all on public.platform_billing_customers, public.platform_billing_provider_bindings,
  public.platform_billing_subscription_authorizations,
  public.platform_billing_prices,
  public.platform_billing_receipts, public.platform_billing_subscriptions,
  public.platform_billing_provider_projection from public, anon, authenticated;
grant select,insert,update on public.platform_billing_customers,
  public.platform_billing_provider_bindings, public.platform_billing_prices,
  public.platform_billing_subscription_authorizations,
  public.platform_billing_subscriptions, public.platform_billing_provider_projection to service_role;
-- Only the SECURITY DEFINER projection may create a receipt; direct service
-- INSERT would bypass mapping, finding and projection preconditions.
revoke insert,update,delete,truncate,references,trigger on public.platform_billing_receipts from service_role;
grant select on public.platform_billing_receipts to service_role;

-- UNREADY / caller contract: Stripe's retrieved subscription has no monotonic
-- update version tied to the event. This draft serializes provider projections
-- and prevents older event timestamps from overwriting newer ones, but equal-
-- timestamp events are deliberately first-writer-wins rather than falsely
-- ordered by event id. It cannot prove a fetched snapshot was caused by that
-- event. DEPLOYMENT HOLD: replace timestamp ordering with a pre-fetch revision
-- read + atomic compare-and-set, refetch on conflict, and immutable revision
-- receipts. Prove current-subscription identity across subscription replacement.
-- Reconciliation must use its own observed-snapshot receipt, never fabricate a
-- newer Stripe event timestamp. This existing cursor is not convergence proof.
-- Also deploy only after billing-webhook checks the returned snapshot for an
-- applied receipt (already implemented) and after live/test mapping rows exist.
-- Invoice failures now insert a tenant-bound queue finding in the receipt
-- transaction. Its SQL fixture and live queue rendering must still be verified.

commit;
