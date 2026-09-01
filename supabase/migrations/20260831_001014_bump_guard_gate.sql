-- Spec 05 follow-up: the retry-counter trigger runs inside a user transaction,
-- so enforce_installment_money (auth.uid() set) refused the bump. Gate it with
-- a transaction-local GUC only the definer bump fn sets — set_config lives in
-- pg_catalog, which PostgREST never exposes as RPC, so no client can raise it.
-- Applied to prod 2026-08-31 as spec05_bump_guard_gate (identical body there).
create or replace function public.bump_installment_attempt()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform set_config('sporv.internal_installment_bump', '1', true);
  update public.installments
     set attempt_count = attempt_count + 1, last_attempt_at = now()
   where id = nullif(split_part(new.source_ref, ':', 2), '')::uuid;
  perform set_config('sporv.internal_installment_bump', '', true);
  return new;
end; $$;
revoke all on function public.bump_installment_attempt() from public, anon, authenticated;

create or replace function public.enforce_installment_money()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('sporv.internal_installment_bump', true), '') = '1' then
    return new;   -- the agent's counter bump, raised only by the definer fn above
  end if;
  if tg_op = 'UPDATE' then
    if new.status in ('paid','processing') and new.status is distinct from old.status then
      raise exception 'installment payment states are set by the payment path, not a client';
    end if;
    if new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
     or new.attempt_count is distinct from old.attempt_count
     or new.last_attempt_at is distinct from old.last_attempt_at then
      raise exception 'installment payment fields are server-owned';
    end if;
    if new.amount_cents is distinct from old.amount_cents and old.status = 'paid' then
      raise exception 'a paid installment''s amount is immutable';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.enforce_installment_money() from public, anon, authenticated;
