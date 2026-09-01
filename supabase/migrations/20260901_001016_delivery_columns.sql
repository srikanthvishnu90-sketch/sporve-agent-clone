-- Doc 08: delivery bookkeeping — outbound_messages.provider_message_id +
-- delivery_error, guardians.email_bounced_at, and Job 1 regenerated so the
-- payer lookup skips a bounced address (the member still drafts, recipient
-- empty, so the director sees it and nothing can send to the dead address).
-- Applied to prod 2026-09-01 as spec08_delivery_columns (identical body,
-- including the full generate_installment_followups replacement).
alter table public.outbound_messages
  add column if not exists provider_message_id text,
  add column if not exists delivery_error text;
alter table public.guardians
  add column if not exists email_bounced_at timestamptz;
-- (generate_installment_followups v3 body lives in the applied migration; the
-- only delta from 001015 §I is `and g2.email_bounced_at is null` in the payer
-- lateral.)
