# 12 — SCHEDULING AND ATTENDANCE
**Gate:** G7. Blocks G9. **Priority: highest in the set.**
**Current state, verified:** `public.sessions` exists with `program_id`, `title`, `start_date date`, `end_date date`, `start_time text`, `end_time text`, `timezone text`, `address text`, `capacity int`, `assigned_member_id`. Across all 50 migrations: `rsvp` = 0, `recurr` = 0, `attendance` = 1 incidental. No recurrence, exception model, RSVP, attendance, conflict detection; times are **text**. This is not a schedule. It is a list of dated rows.

## 12.1 Object model
organization → season → program (existing) → team (existing) → event_series NEW (recurrence rule) → event NEW (materialised occurrence) → event_response NEW (availability/RSVP), attendance_record NEW (who actually came).
`sessions` is migrated into `event`, not extended. Keep a view named `sessions` for one release so existing modules do not break, then drop it.

## 12.2 Schema
```sql
-- event_series
create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  kind text not null check (kind in ('practice','game','tryout','camp_day','lesson','meeting','other')),
  title text not null,
  timezone text not null,              -- IANA
  local_start_time time not null,      -- wall-clock intent
  duration_minutes int not null check (duration_minutes between 5 and 1440),
  rrule text,                          -- RFC 5545; null = single occurrence
  series_start_date date not null,
  series_end_date date,
  facility_id uuid references public.facilities(id) on delete set null,
  location_text text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
-- event
create table if not exists public.event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  series_id uuid references public.event_series(id) on delete cascade,
  team_id uuid, kind text not null, title text not null,
  starts_at timestamptz not null, ends_at timestamptz not null, timezone text not null,
  facility_id uuid, location_text text,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','postponed','completed')),
  cancellation_reason text,
  is_exception boolean not null default false,
  opponent text, home_away text check (home_away in ('home','away','neutral')),
  arrival_offset_minutes int default 0, notes text,
  published_at timestamptz,            -- null = not visible to families
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint event_time_order check (ends_at > starts_at)
);
create index on public.event (organization_id, starts_at);
create index on public.event (team_id, starts_at) where status <> 'cancelled';
```
**Materialisation rule.** Series stores the rule; `event` stores rows. Expand RRULE forward 180 days on write and nightly. Editing one occurrence sets `is_exception=true` and detaches it from regeneration. Series edit offers this / this-and-following / all; only the first preserves exceptions.
```sql
-- event_response (availability / RSVP)
create table if not exists public.event_response (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  event_id uuid not null references public.event(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  response text not null check (response in ('yes','no','maybe','no_response')),
  responded_by uuid, source text not null check (source in ('web','sms','email','staff')),
  note text, responded_at timestamptz not null default now(), unique (event_id, athlete_id)
);
-- attendance_record (append-only)
create table if not exists public.attendance_record (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  event_id uuid not null references public.event(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  state text not null check (state in ('present','absent','late','excused')),
  marked_by uuid not null, client_id uuid not null, marked_at timestamptz not null default now(),
  unique (client_id)
);
create index on public.attendance_record (event_id, athlete_id, marked_at desc);
```
Read model = most recent row per (event_id, athlete_id). Nothing updated or deleted — offline replay safe.

## 12.3 Conflict detection
Detect and surface at publish and on every edit: facility conflict; staff conflict (same coach overlapping); athlete conflict (dual-rostered); blackout conflict. Warnings the director can override with a recorded reason (writes settings_audit), not hard blocks.
```sql
create table if not exists public.blackout_window (id uuid primary key default gen_random_uuid(), organization_id uuid not null, label text not null, starts_at timestamptz not null, ends_at timestamptz not null);
```
**DoD:** `tests/scheduling/conflicts.spec.ts` — fixture org, two teams, one shared field, one shared coach, one dual-rostered athlete; all four classes fire; override records a reason.

## 12.4 Cancellation and weather
The single most common urgent action in youth sports.

One action, `cancelEvent(event_id, reason, notify: boolean)`, which:
1. Sets `status = 'cancelled'` and the reason
2. **Drafts** a cancellation to every affected family through spec 13 channels
3. Updates the ICS feed so subscribed calendars reflect it
4. Writes an audit row
5. Releases the facility slot for conflict purposes

**Amended 2026-09-15 (ruling R5): a cancellation always drafts. No auto-send, no
exception.** The "under 15 seconds from a coach's phone to a parent's SMS" target
stands, but it is measured **approval to delivery**, not approval removal.
Draft-first is not negotiable for the one message class most likely to be sent in
a panic, from a field, in the rain.

The optimisation target is therefore **two taps from a cold home-screen launch to
a sent cancellation**, with the message already written:
- the draft is generated when `status` flips to cancelled, *before* the coach
  reaches for the phone — never on approval;
- it is first in the agent rail and is the destination of the push/SMS deep link,
  so it is never something to go and find;
- Approve is one tap, and the 8-second hold with Undo stays: it costs nothing
  against a 15-second budget and it is the only thing between a mis-tap and 60
  families being told practice is off.

**DoD:** `tests/scheduling/cancel-propagation.spec.ts` asserts all five effects,
asserts **zero sends without an approval**, measures wall-clock approve-to-
delivery-receipt, and asserts the tap count from a cold launch.

## 12.5 Calendar feed (ICS)
Per-family signed ICS URL, one per guardian, covering every athlete via `guardian_links`. VEVENT per published event, stable UID=event.id, SEQUENCE incremented on change, STATUS:CANCELLED on cancel. X-WR-CALNAME=org; LOCATION=facility address; DESCRIPTION has arrival time + RSVP link. X-PUBLISHED-TTL:PT1H; ICS is a convenience layer, never the only notification path. Token rotates on guardian removal. **DoD:** `tests/scheduling/ics-feed.spec.ts` — RFC 5545 parser; cancel emits STATUS:CANCELLED with incremented SEQUENCE.

## 12.6 Publication
Invisible until `published_at`. Publish a team or date range in one action. Unpublishing is not allowed; cancel instead.

## 12.7 Migration of existing sessions
```sql
insert into public.event (organization_id, team_id, kind, title, starts_at, ends_at, timezone, location_text, published_at)
select o.id, null, 'other', coalesce(s.title,'Session'),
  ((s.start_date::text||' '||coalesce(s.start_time,'00:00'))::timestamp at time zone coalesce(s.timezone,'America/Chicago')),
  ((s.start_date::text||' '||coalesce(s.end_time,'01:00'))::timestamp at time zone coalesce(s.timezone,'America/Chicago')),
  coalesce(s.timezone,'America/Chicago'), s.address, now()
from public.sessions s join public.programs p on p.id=s.program_id join public.organizations o on o.id=p.organization_id;
```
Rows whose start_time fails to parse go to `migration_quarantine` and are reported, never dropped. **DoD:** `tests/migration/sessions-to-event.spec.ts`.

## 12.8 Acceptance for G7
Director creates a Tue/Thu 6pm series for a team of 14 for 10 weeks, publishes, cancels one for weather, moves another to a different field; every family's calendar and phone reflects all three. Attendance taken for two sessions, one offline. No SQL-editor edits.
