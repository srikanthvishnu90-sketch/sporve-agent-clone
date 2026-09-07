-- 20260907_001030 — outbound status reconciliation (red draft 2026-09-05, owner-approved 2026-09-06)
-- [CRITICAL-PATH] REVIEW-ONLY: canonical reconciliation, not permission to apply.
-- G1/G4: the baseline has six states; live and existing workers use eight.
-- After review/testing, promote to an unused canonical migration version.
-- Preconditions: ordinary existing table, text NOT NULL status, and exactly the
-- known six/eight-state validated constraint. Unexpected schema stops the change.
-- Receipt: validated exact eight-state constraint. No rows/defaults/grants/RLS
-- change. Inverse: transaction rollback on failure; after commit repair forward
-- (do not remove failed/needs_review while rows or workers rely on those states).
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.outbound_messages in access exclusive mode;
do $$
declare
  observed text;
  six constant text := $c$CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'drafted'::text, 'approved'::text, 'sent'::text, 'skipped'::text])))$c$;
  eight constant text := $c$CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'drafted'::text, 'approved'::text, 'sent'::text, 'skipped'::text, 'needs_review'::text, 'failed'::text])))$c$;
begin
  if not exists(select 1 from pg_class where oid='public.outbound_messages'::regclass and relkind='r')
    or not exists(select 1 from pg_attribute where attrelid='public.outbound_messages'::regclass
      and attname='status' and atttypid='text'::regtype and attnotnull and not attisdropped) then
    raise exception 'outbound status reconciliation: unexpected table or status column';
  end if;
  select pg_get_constraintdef(oid) into observed from pg_constraint
    where conrelid='public.outbound_messages'::regclass
      and conname='outbound_messages_status_check' and contype='c' and convalidated;
  if observed is null or observed not in (six,eight) then
    raise exception 'outbound status reconciliation: unrecognized constraint; inspect before changing';
  end if;
  if observed=six then
    -- Atomic replacement under the lock: no unconstrained committed interval.
    alter table public.outbound_messages drop constraint outbound_messages_status_check;
    alter table public.outbound_messages add constraint outbound_messages_status_check
      check (status = any (array['pending'::text,'processing'::text,'drafted'::text,
        'approved'::text,'sent'::text,'skipped'::text,'needs_review'::text,'failed'::text]));
  end if;
  if not exists(select 1 from pg_constraint
    where conrelid='public.outbound_messages'::regclass
      and conname='outbound_messages_status_check' and contype='c' and convalidated
      and pg_get_constraintdef(oid)=eight) then
    raise exception 'outbound status reconciliation: missing validated receipt';
  end if;
end $$;
