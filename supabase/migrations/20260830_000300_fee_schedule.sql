-- ============================================================================
-- Step 3 (mechanism) — fee_schedule: per-org / per-team take rate
-- Drafted 2026-08-30. RED: owner-applied. Prod project tseszaprvtvqrkfpditu.
--
-- ⚠️ BUSINESS-MODEL REVERSAL — READ BEFORE APPLYING.
-- The shipped model is subscription / 0% booking fee (FEE_PCT=0, owner-confirmed
-- 2026-08-20, host:6255). The B2B pivot's "restore FEE_PCT to a take rate" REVERSES
-- that. This migration provides the MECHANISM (a per-scope rate table) but sets NO
-- non-zero rate — the actual rate and the decision to charge a take rate at all
-- remain the owner's, exactly like the merchant-of-record decision. Applying this
-- file alone changes nothing families pay: with no rows, fee_bps_for() returns 0.
--
-- Pairs with the Connect direct-charges work in ~/SportsMan-main (Codex): the
-- resolved rate here becomes the Stripe application_fee_amount on a direct charge.
--
-- SAFETY: fee_schedule is SERVICE-ROLE / admin controlled. A coach must NEVER set
-- their own rate (a self-set 0 is the $0-pay exploit class). Clients may only READ
-- their own resolved rate; all writes are service-role.
-- ============================================================================

create table if not exists public.fee_schedule (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid references public.providers(id) on delete cascade,  -- NULL = platform default
  team_id        uuid references public.teams(id) on delete cascade,       -- NULL = whole org/provider
  kind           text not null default 'booking' check (kind in ('booking','dues','subscription')),
  rate_bps       integer not null check (rate_bps between 0 and 5000),     -- basis points, capped 50%
  note           text,
  effective_from timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  -- one active rate per (scope, kind); a null provider_id is the single platform default
  constraint fee_schedule_scope_unique unique (provider_id, team_id, kind)
);

comment on table public.fee_schedule is
  'Per-scope platform take rate in basis points. Resolution is most-specific-wins: team match > provider match > platform default (provider_id IS NULL). Service-role write only; clients read their own resolved rate via fee_bps_for(). rate_bps=0 (or no row) means Sporv takes nothing — the current live model.';

-- A team_id only makes sense together with its provider_id.
alter table public.fee_schedule
  add constraint fee_schedule_team_needs_provider
  check (team_id is null or provider_id is not null);

create index if not exists idx_fee_schedule_provider on public.fee_schedule (provider_id, kind);

-- ── Resolver: most-specific-wins, defaults to 0 (never surprises with a fee) ──
create or replace function public.fee_bps_for(p_provider_id uuid, p_team_id uuid default null, p_kind text default 'booking')
 returns integer
 language sql stable security definer set search_path to ''
as $$
  select coalesce(
    (select rate_bps from public.fee_schedule
      where kind = p_kind
        and (
          (team_id = p_team_id and provider_id = p_provider_id) or
          (team_id is null and provider_id = p_provider_id) or
          (provider_id is null and team_id is null)
        )
        and effective_from <= now()
      order by (team_id is not null and team_id = p_team_id) desc,  -- team match first
               (provider_id is not null) desc,                       -- then provider match
               effective_from desc
      limit 1),
    0);   -- no matching schedule => Sporv takes nothing
$$;

comment on function public.fee_bps_for is
  'Resolve the take rate (bps) for a provider/team/kind. Most-specific wins; returns 0 when no schedule applies. The Stripe checkout multiplies the charge by this / 10000 to set application_fee_amount on the connected (club) account.';

-- ── RLS: owner READS their resolved rows; writes are service-role only ──────
alter table public.fee_schedule enable row level security;

-- A provider owner may SELECT rows that apply to them (their own + the platform default).
create policy fee_schedule_select_owner on public.fee_schedule
  for select to authenticated
  using (
    provider_id is null
    or exists (select 1 from public.providers pv
               where pv.id = fee_schedule.provider_id and pv.owner_id = auth.uid())
  );
-- NO insert/update/delete policy for authenticated => clients cannot write a rate.
-- The service role (admin/back-office) bypasses RLS to set rates.

grant select on public.fee_schedule to authenticated;
revoke insert, update, delete on public.fee_schedule from authenticated, anon;
revoke all on function public.fee_bps_for(uuid, uuid, text) from public, anon;
grant execute on function public.fee_bps_for(uuid, uuid, text) to authenticated, service_role;

-- ============================================================================
-- VERIFY BEFORE APPLYING (needs a shell):
--   supabase db reset
--   assert: fee_bps_for(any) = 0 with no rows;
--     insert a platform default (provider_id null) 1200 -> fee_bps_for = 1200;
--     insert a provider override 800 -> that provider resolves 800, others 1200;
--     insert a team override 500 -> that team resolves 500, sibling teams 800;
--     a coach INSERT into fee_schedule is denied (no write policy);
--     a coach SELECT sees only their own rows + the null-provider default.
-- DRAFT — do not db push until local RLS + resolver assertions pass. Setting any
-- non-zero rate is a BUSINESS DECISION that reverses the 2026-08-20 subscription
-- model; leave the table empty until the owner decides the rate.
-- ============================================================================
