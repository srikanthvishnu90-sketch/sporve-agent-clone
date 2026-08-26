# RED — durable media persistence (owner-applied). Drafted 2026-08-25.

You chose "real & durable" for coach media. Today media is in-memory only
(`mod-media.js` state + `mediaItems.concat`, reset on reload) — even in the
Flutter app. Durable saves that survive reload and reach production need a
`media` table + a per-athlete tag table + a Storage bucket for the files, with
consent enforced. This is the backend half; the web re-skin (the visible part)
ships separately and appends to demo state until this lands.

Prod Supabase project: **tseszaprvtvqrkfpditu**.

## 1. Migration — `~/SportsMan-main/supabase/migrations/20260826_000200_media.sql`
```sql
-- Coach media library. Files live in a Storage bucket; this table is the index.
create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  kind         text not null check (kind in ('photo','video')),
  storage_key  text not null,                 -- path in the 'coach-media' bucket
  title        text,
  session_id   uuid references public.sessions(id) on delete set null,
  on_profile   boolean not null default false,
  created_at   timestamptz not null default now()
);
-- Per-athlete tags — consent is checked per tagged athlete (Publishable vs Held).
create table if not exists public.media_athletes (
  media_id   uuid not null references public.media(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  primary key (media_id, athlete_id)
);
alter table public.media enable row level security;
alter table public.media_athletes enable row level security;

-- Coach owns their media (mirror session_notes).
create policy media_all_coach on public.media for all to authenticated
  using (exists (select 1 from public.providers pv where pv.id = provider_id and pv.owner_id = auth.uid()))
  with check (exists (select 1 from public.providers pv where pv.id = provider_id and pv.owner_id = auth.uid()));
-- Tags: writable only for media the coach owns, and the athlete must be on one
-- of the coach's bookings (no tagging a child you never coached).
create policy media_athletes_coach on public.media_athletes for all to authenticated
  using (exists (select 1 from public.media m join public.providers pv on pv.id = m.provider_id
                 where m.id = media_id and pv.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.media m join public.providers pv on pv.id = m.provider_id
    where m.id = media_id and pv.owner_id = auth.uid()
    and exists (select 1 from public.bookings b join public.sessions s on s.id = b.session_id
                join public.programs pr on pr.id = coalesce(b.program_id, s.program_id)
                where pr.provider_id = m.provider_id and b.athlete_id = media_athletes.athlete_id)));
grant select, insert, update, delete on public.media, public.media_athletes to authenticated;
```

## 2. Storage bucket (Supabase dashboard → Storage)
Create a **private** bucket `coach-media`. Policy: a coach may write/read only
under a `provider_id/` prefix they own (mirror the `provider-media` bucket's
`(storage.foldername(name))[1] = auth.uid()` pattern already in the repo).
Photos of minors must NOT be a public bucket.

## 3. Consent gating (already modeled)
A media item is Publishable only if every tagged athlete has the required
consent; else Held. The consent source is the family's own setting (a coach can
never self-grant). The web already models this client-side; production reads it
from the real consent rows. Wire the publish/attach path to check consent server-
side before a media item can be attached to a listing/recap/profile.

## Apply
1. https://supabase.com/dashboard/project/tseszaprvtvqrkfpditu/sql/new → paste §1 → Run.
2. Storage → New bucket `coach-media` (private) → add the owner-prefix policy (§2).
3. Tell me — I wire the web add-media flow + the Flutter client to upload to the
   bucket and insert the `media` + `media_athletes` rows (replacing the in-memory
   `mediaItems.concat`), so an added photo survives reload and reaches production.

Until applied, the web re-skin's "Save to library" appends to demo state (clearly
a demo) — never claim durable persistence for a child's photo it can't back.
