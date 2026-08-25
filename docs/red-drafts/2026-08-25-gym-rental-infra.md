# RED — gym-rental infrastructure (owner-applied). Drafted 2026-08-25.

These unblock the gym-rental cluster: **Feature 1** (finder knows pricing/indoor/
capacity), **Feature 3** (send the inquiry email), and set up **Feature 2**
(booking lifecycle). Nothing here is auto-applied — you run each step. Once
Part A + Part B are done, tell me and I build the populator, the result card,
and the send/booking path (the non-RED half).

Prod Supabase project ref: **tseszaprvtvqrkfpditu**.

---

## Part A — Facilities data table (Feature 1 data)  ·  ~10 min

Two problems to fix together: the drafted `facilities` migration was never
applied, AND as drafted its row-security is `USING (true)` — every signed-in
account (any parent) could read every coach's rental notes, which also trips the
production "no authenticated policy uses USING(true)" alarm (security finding F2).
So we apply a corrected version, and add the missing `indoor`/`capacity` columns.

### A1. Apply the corrected facilities migration
1. Open https://supabase.com/dashboard/project/tseszaprvtvqrkfpditu/sql/new
2. Paste and **Run** this (it creates the tables scoped to real providers, not
   all authenticated users):

```sql
-- Facilities directory (community-enriched) + rental notes.
create table if not exists public.facilities (
  place_id text primary key,               -- Google Places id
  name text not null,
  neighborhood text, city text,
  latitude double precision, longitude double precision,
  court_types text[] not null default '{}',
  indoor boolean,                          -- NEW: null=unknown, true=indoor, false=outdoor
  capacity int,                            -- NEW: max players the space fits
  hours jsonb,
  rental_contact text,
  known_hourly_rate numeric(8,2),          -- single scalar hourly rate (community-sourced)
  added_by uuid references public.providers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.facility_notes (
  id uuid primary key default gen_random_uuid(),
  facility_id text not null references public.facilities(place_id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  note text,
  rental_status text check (rental_status in ('inquired','confirmed','paid_external')),
  created_at timestamptz not null default now()
);
alter table public.facilities enable row level security;
alter table public.facility_notes enable row level security;

-- READ: only real coaches (a provider row owned by the caller) — NOT every
-- authenticated account. This closes finding F2 and keeps the invariant green.
create policy facilities_select_providers on public.facilities for select to authenticated
  using (exists (select 1 from public.providers p where p.owner_id = auth.uid()));
create policy facilities_upsert_providers on public.facilities for insert to authenticated
  with check (exists (select 1 from public.providers p where p.owner_id = auth.uid()));
create policy facilities_update_providers on public.facilities for update to authenticated
  using (exists (select 1 from public.providers p where p.owner_id = auth.uid()));

-- facility_notes: a coach reads/writes the community history; scoped to real providers.
create policy facility_notes_select_providers on public.facility_notes for select to authenticated
  using (exists (select 1 from public.providers p where p.owner_id = auth.uid()));
create policy facility_notes_write_own on public.facility_notes for insert to authenticated
  with check (provider_id in (select id from public.providers where owner_id = auth.uid()));
grant select, insert, update on public.facilities to authenticated;
grant select, insert on public.facility_notes to authenticated;
```

3. Save the same SQL into the repo as a real migration file so repo + prod
   converge: `~/SportsMan-main/supabase/migrations/20260825_000200_facilities_applied.sql`
   (I can generate this file for you — say the word).

### A2. Verify
Run in the SQL editor:
```sql
select tablename, policyname, qual from pg_policies
 where tablename in ('facilities','facility_notes');
```
Every `qual` must reference `providers` / `auth.uid()` — **none** may be `true`.

---

## Part B — Email provider (Feature 3: send the inquiry)  ·  ~15 min

Recommended: **Resend** (simple API, generous free tier, clean domain
verification). This is the single missing channel that lets the AI *send* the
inquiry it drafts — and later, coach→parent emails.

### B1. Create the account + get a key
1. Go to https://resend.com and sign up (use sporve123@gmail.com).
2. Left nav → **API Keys** → **Create API Key** → name it `sporve-prod`,
   permission **Sending access** → **Add**. Copy the key (`re_...`) — shown once.

### B2. Verify the sending domain (so mail isn't spam)
1. Left nav → **Domains** → **Add Domain** → enter the domain you send from
   (e.g. `sporve.com`, or a subdomain like `mail.sporve.com`).
2. Resend shows 3 DNS records (an MX + two TXT: SPF and DKIM). Add each at your
   domain registrar (where you bought the domain): copy the exact **Type**,
   **Name/Host**, and **Value** for each record.
3. Back in Resend, click **Verify** (DNS can take a few minutes to an hour).
   Wait for all three to show **Verified**.

### B3. Give Supabase the key (so the edge function can send)
1. Open https://supabase.com/dashboard/project/tseszaprvtvqrkfpditu/settings/functions
2. Under **Edge Function Secrets** → **Add new secret**:
   - Name: `RESEND_API_KEY`   Value: the `re_...` key from B1
   - Name: `EMAIL_FROM`       Value: `Sporve <coach@your-verified-domain>`
3. **Save**.

### B4. Tell me when B1–B3 are done
Then I build (non-RED): a `send-email` edge function + a `send_facility_inquiry`
dispatch rail so the coach's approved inquiry actually sends (still approve-first;
the coach taps once, it goes). This also becomes the base for Feature 3's
`send_email` across the product.

---

## Part C — Booking lifecycle (Feature 2)  ·  after A + B

Not a RED step you run — it's build work I do once A + B exist: write
`facility_notes.rental_status` as the coach moves a facility through
inquired → confirmed → paid_external, plus the client facilities result card
with a Contact/Book action. Flagged here so the cluster is visible end to end.

---

## What I build once you finish A + B (no more owner steps)
1. Rate/indoor **populator** — the community flywheel: every inquiry that returns
   a rate logs it to `facilities` + a `facility_notes` row, so the next coach
   sees real pricing. This is how the finder "knows pricing" over time.
2. `send-email` edge function + `send_facility_inquiry` rail (needs Part B).
3. Flutter **facilities result card** + Contact/Book action (today reads render
   as prose only).
4. `facility_notes` lifecycle writer (Feature 2).
Then one live dock test drives Feature 1 → a real 10, with 2 and 3 well underway.
