-- 20260902_001021 — DELIVERY (doc 08): bounce bookkeeping + send columns.
-- Originally applied to prod via execute_sql on 2026-09-02 with only a
-- comment file left in git. Backfilled 2026-09-03 (pentest finding 1) from
-- prod's information_schema / pg_policies. Idempotent.
--
-- delivery_events RLS: org owners may READ events for their own guardians;
-- there is deliberately NO insert/update/delete policy for authenticated —
-- only the service-role resend-webhook writes rows.

create table if not exists public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  message_id uuid references public.outbound_messages(id) on delete set null,
  guardian_id uuid references public.guardians(id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now()
);

alter table public.delivery_events enable row level security;
drop policy if exists delivery_events_owner_read on public.delivery_events;
create policy delivery_events_owner_read on public.delivery_events
  for select to authenticated
  using (exists (select 1 from public.guardians g
                 join public.providers p on p.id = g.provider_id
                 where g.id = delivery_events.guardian_id and p.owner_id = auth.uid()));

alter table public.outbound_messages add column if not exists send_after timestamptz;
alter table public.outbound_messages add column if not exists attempt_count integer default 0;
alter table public.outbound_messages add column if not exists last_error text;
alter table public.outbound_messages add column if not exists provider text;

alter table public.guardians add column if not exists email_status text default 'ok';
alter table public.guardians add column if not exists email_bounced_at timestamptz;
