# Review brief — migrations 001074–001079 and the #44 row policies

For the owner, 2026-09-18. Six migrations are live that only I have read.
This says, in plain language, what each one does, what to look for in the
diff, and one query you can run in the Supabase SQL editor to see it is true
on the live project. Files are under `supabase/migrations/`. Every migration
was proven first in a disposable Postgres (`docs/red-drafts/*.test.sql`,
run by `tools/run-sql-fixtures.sh`), then applied live, then checked with
the query shown.

Two words used throughout. **RLS policy** — a rule attached to a table that
decides which rows a signed-in person may see or change; a person outside
the rule gets zero rows, not an error. **SECURITY DEFINER function** — a
database function that runs with the database's own rights, not the
caller's, so it must check who is asking itself; every one below does that
in its first lines and then refuses anonymous callers with `revoke … from
anon`.

---

## 001074 — `provider_type_backfill` (PR #43)

**What it does.** Sets `providers.provider_type` to `'organization'` for
every org that had finished setup with no type. The staff-invite check
(`enforce_org_member`) refuses to add a member to a provider whose type is
not `'organization'`, and setup never wrote the type — so a finished club
could not add a coach.

**Look for.** One `update public.providers set provider_type='organization'
where …` and nothing else. It touches rows, not rules.

**Prove it.**
```sql
select count(*) from public.providers where onboarding_completed and provider_type is null;
-- expect 0
```

---

## 001075 — `staff_workspace_access` (PR #44) — the one to read slowly

This is the migration that lets a coach work in the club that employs them.
Before it, the app only ever loaded the provider row where
`owner_id = auth.uid()`, so a trainer landed in the empty org signup made for
them and read zero rows of their real team.

**Four helper functions** (all SECURITY DEFINER, all anon-revoked):

- `is_org_member(org)` — true if you own the org or hold an active
  `organization_members` row in it.
- `my_member_id(org)` — your membership row's id in that org, or null.
- `coaches_team(org, team)` — true if you are an admin of the org, or any
  event of that team is assigned to you. **This is the whole scoping rule:**
  a coach's teams are the teams whose events name them.
- `coaches_event(event)` — true if you are an admin, the event is assigned
  to you, or you coach its team.

**One resolver function, `my_workspace()`** — returns the org a signed-in
person should open: their own org, unless it is still the untouched signup
default (name is one of the three defaults, not onboarded, no teams, no
athletes, no events) AND they hold an active membership elsewhere — then the
employer's org, with the role mapped `admin → director`, `trainer → coach`.
Anonymous gets no row. Look for: the `untouched :=` block and the `case
emp.role …` mapping. A person with a real org of their own always gets their
own org, even with a membership elsewhere.

**Eight new SELECT policies for members** (each is `for select to
authenticated`; none grants insert, update or delete — writes stay with
`is_org_admin`):

| Table | Policy | A member may read… |
|---|---|---|
| `providers` | `providers_select_member` | the org row they belong to |
| `organization_members` | `organization_members_select_self` | their own membership row only |
| `teams` | `teams_select_member` | teams they coach (`coaches_team`) |
| `team_athletes` | `team_athletes_select_member` | athletes on teams they coach; a row with no team is invisible |
| `event` | `event_select_member` | events assigned to them or on teams they coach |
| `venue` | `venue_select_member` | the org's venues |
| `attendance_record` | `attendance_select_member` | attendance on events they coach |
| `event_response` | `event_response_select_member` | responses on events they coach |

Look for: every `using (…)` clause routes through `coaches_team` /
`coaches_event` / `is_org_member`; none says `true`; none is `for all`.

**`mark_attendance` re-created** with one added line: the assigned coach may
mark attendance, not only admins. The rest of the body is 001055 verbatim.
Look for: `not (public.is_org_admin(v_provider) or public.coaches_event(p_event))`.

**Prove it.**
```sql
select tablename, policyname, cmd from pg_policies
 where policyname like '%_select_member' or policyname='organization_members_select_self'
 order by tablename;   -- expect 8 rows, all cmd = SELECT
select count(*) from information_schema.role_routine_grants
 where grantee='anon' and routine_name in ('my_workspace','is_org_member','my_member_id','coaches_team','coaches_event','mark_attendance');
-- expect 0
```

---

## 001076 — `member_conflicts` (PR #45)

**What it does.** `event_conflicts_in_range` (the "you are double-booked"
read) refused everyone but admins with a 42501 error. It now admits every
active member and returns rows only for the events that member may already
read (`coaches_event`). An admin still sees the whole org; a coach sees their
own double-bookings; everyone else gets zero rows. Detection itself is
unchanged.

**Look for.** `is_org_admin` → `is_org_member` in the guard, and the added
`and (auth.uid() is null or public.coaches_event(e.id))` in the `where`.

**Prove it.**
```sql
select position('coaches_event' in pg_get_functiondef('public.event_conflicts_in_range(uuid,timestamptz,timestamptz)'::regprocedure)) > 0;
-- expect true
```

---

## 001077 — `money_aged_balances` (PR #49)

**What it does.** One read-only function behind the Money screen. It takes
an org id, asks `dashboard_caller` (001073) who you are in that org, and if
you are below treasurer — a coach, a non-member, org B, anonymous — returns
the empty shape (`totals: null`, empty lists), not an error. Otherwise it
returns, from `obligations` where `kind='fee'`, status draft or approved,
amount > 0: totals and age buckets (not yet due / 1–30 / 31–60 / 61–90 /
90+), one row per family (joined through `guardians`, athletes through
`team_athletes`), the open items (capped at 2,000, with `source_kind` and
`source_ref` so each is traceable), failed installments with their attempt
count, and what was marked done (last 50, and the 90-day total).

**Why SECURITY DEFINER.** `obligations`, `fee_schedules` and `installments`
are owner-only under RLS today; a treasurer or director must see money too.
The function does the role check itself. **It writes nothing** — look for no
`insert`, `update` or `delete` in the body, and `stable` in its header.
Money is integer cents throughout.

**Look for.** The early `return` when `dashboard_role_rank(v_role) < 2`;
the `where … kind = 'fee' and status in ('draft','approved')` filter (void
and done never count as owed); `limit 2000` with `items_truncated`.

**Prove it.**
```sql
select provolatile from pg_proc where proname='money_aged_balances';  -- expect 's' (stable)
select (public.money_aged_balances('00000000-0000-4000-8000-000000000000'))->>'role';  -- expect null: no membership, no rows
```

---

## 001078 — `dob_guard` (PR #53)

**What it does.** A trigger on `team_athletes.dob` and `athletes.date_of_birth`
(insert, and update of that column) that refuses a date in the future or
before 1920-01-01 with error 23514 and a readable message. Null stays
allowed: unknown is not impossible. Existing rows are not rewritten; a bad
row already in place is corrected the next time it is edited.

**Look for.** One function, two triggers, `before insert or update of dob`.
The `athletes` trigger is created only if that table and column exist.

**Prove it.**
```sql
select tgname from pg_trigger where tgname in ('trg_team_athletes_dob_guard','trg_athletes_dob_guard');  -- expect 2
```

---

## 001079 — `delivery_and_edit_conflicts` (PR #55)

Three functions re-created from their earlier bodies (001059, 001069, 001071)
with only the lines below changed, plus one new function.

- **`issue_guardian_token`** — the 10-per-guardian-per-hour ceiling raised
  error 53400, which the API surfaces as a 5xx. It now raises `PT429`, which
  the API turns into HTTP 429 with the message "try again in an hour". Look
  for: one `raise exception … using errcode = 'PT429'`; everything else
  identical to 001059.
- **`cancel_event`** — gains a fourth, optional argument
  `p_expected_sequence`. If the caller passes the sequence its screen loaded
  and the event has changed since, it raises `PT409` (HTTP 409, "changed
  since you loaded it") and changes nothing. Callers that pass three
  arguments behave exactly as before. Look for: the `drop function … (uuid,
  text, boolean)` (the old signature is replaced, not duplicated) and the
  one `if p_expected_sequence is not null …` block.
- **`approve_obligation_and_queue`** — catches the new `PT429` as well as
  the old `53400`, so a message still goes out without its RSVP link when
  the ceiling is hit. Look for: `when sqlstate 'PT429' or sqlstate '53400'`.
- **`edit_event(event, expected_sequence, patch)` — new.** The one write
  path for an event's family-visible fields (title, times, venue, location,
  notes, assigned coach, capacity, arrival offset). Admins only; a cancelled
  event cannot be edited; a stale or missing sequence is refused with
  `PT409`; any other field in the patch is refused with 22023. The existing
  `event_guard` trigger still bumps `sequence` on a family-visible change,
  so the second of two editors is always told.

**Prove it.**
```sql
select pg_get_function_arguments(oid) from pg_proc where proname='cancel_event';
-- expect: p_event uuid, p_reason text, p_notify boolean DEFAULT true, p_expected_sequence integer DEFAULT NULL::integer
select count(*) from pg_proc where proname='cancel_event';  -- expect 1 (no leftover overload)
select count(*) from information_schema.role_routine_grants where grantee='anon'
 and routine_name in ('edit_event','cancel_event','issue_guardian_token','approve_obligation_and_queue');  -- expect 0
```

---

## What none of these do

None grants a member any insert, update or delete. None loosens an owner
rule. None writes in a read function. None touches Stripe, the ledger,
auth, or consent. The only behaviour a family can observe: a cancellation
notice arrives sooner (the function side, `lifecycle-approve`, not a
migration), and an RSVP link may be omitted under the ceiling instead of the
message failing.

## How to read the diffs yourself

```bash
git log --oneline -- supabase/migrations/20260915_00107[4-9]_*.sql
git show <sha> -- supabase/migrations/20260915_001075_staff_workspace_access.sql
```
Each file's header comment says what it changes and why; the `Look for`
lines above are the load-bearing parts.
