# Functionality audit — 2026-09-17

Executed per `docs/specs/29-FUNCTIONALITY-VERIFICATION.md` against the deployed
app (https://sporv.ai, build `bfa06ddf…`, main at `2b43a25`) and the live
project `tseszaprvtvqrkfpditu`, as three seeded users in an isolated org that
no real signup can reach (`ZZ AUDIT ORG 2026-09-17`, owner
`ad170000-…0001`; a trainer member `…0002`; an unrelated org B owner `…0003`).
Seeded: 12 teams, 200 athletes, 200 guardians, 400 events, 600 fee
obligations across a season (400 paid, 40 overdue, 160 due), 180 waiver
signatures, one background check and one certification expiring, two open
findings, hostile strings in a team, an athlete and an event. Torn down after
this report merged (see "Teardown").

Every number below was measured. Where a surface does not exist, the row says
so and fails. Where a check could not be run from this session, it is listed
under "What I could not test" with the access it needs.

## Verdict

No. A real club running a real season on this tomorrow would lose an import
without anyone noticing, would have coaches who cannot see their own roster or
take attendance, and would run its 400 events and $90,000 of dues on screens
that do not exist yet. The single thing most in the way is that the four core
jobs are built as database functions and drafts, and only one of them (get the
org in) has a screen a director can actually use; the other three exist below
the UI. Second is the fabricated-content class the quality bar was written
against: it is still on two real-org surfaces.

## P0 — stop everything

**P0-1 · Import reports success while writing nothing.** Reproduction: roster
› Import › choose a 10-row CSV › map › Preview › Commit, with the network cut
during the commit (route-aborted the three POSTs). Evidence: the modal shows
"IMPORT COMMITTED — 10 shadow records added to your roster", `teamRoster()`
holds 10 rows, an `import_batches` row was written with `row_count = 10`, and
`team_athletes` holds **0** of them on the server; no toast, no error, no
retry. Blast radius: a director on a sideline with one bar imports a team,
sees success, and the roster is gone on the next reload. The batch row also
poisons re-upload: the same file is now "already imported" by content hash,
so the retry path is blocked too. This is the "write returned success while
changing nothing" class (doc 28 law 3). `src/sporve-web.host.html`
`[data-imp-commit]` handler: the local push and the "committed" step happen
before the server writes, and the async writes swallow failures.

**P0-2 · Fabricated seed content on real-org surfaces.** Reproduction: sign in
as the audit owner (or as the empty org B), open Roster; open Inbox.
Evidence: the Roster table header reads **"NORTHSIDE FLIGHT 14U"** and the
sport line reads the seed team's sport — for an org whose teams are "8U
Storm…🔥 Fire 18U" (`src/sporve-web.host.html:12911,12918` read
`SEED.teams[0]`). The Inbox on the **empty** org B shows a conversation with
"Northside Flight Basketball" and "Julian is registered for the sample 14U
tryout" (seed conversations survive for a real account). Blast radius: a
director trusts a screen that names a team they do not have; the exact defect
class of the badge and the fabricated queue (doc 29.7: "a fabricated value is
a P0"). Every other tab on the empty org was clean: zero names, zero amounts
except computed `$0`, zero dates, zero blank panels, zero generic errors.

## P1 — blocks launch

**P1-1 · A coach cannot do a coach's job.** The trainer member of the audit org
signs in and lands in their own auto-created empty org ("ZZ AUDIT COACH OWN
ORG"), never the org that employs them; the app only ever loads the provider
row where `owner_id = auth.uid()`. Over the API the trainer reads **0** rows
of their own team's roster, **0** of the events assigned to them, and
`mark_attendance` answers `42501 only organisation staff may mark attendance`
(`is_org_admin` excludes trainers). Evidence in `.audit/more.mjs` output:
`coach_reads_team1_roster: 0`, `coach_marks_attendance_own_event: 403`.
Reproduction: sign in as `audit-coach-…`. Fix direction: membership-aware
workspace selection + RLS/RPC policies that admit `trainer` for their own
team's rows.

**P1-2 · The events schedule has no screen.** 400 events exist; the Schedule
tab renders the marketplace "sessions" model: "CALENDAR 0 · AVAILABILITY 0 ·
No sessions scheduled". The only place events appear is the home block (next
48h, 10 rows). There is no month view, no cancel affordance ("cancel an event
in two taps from home" is impossible), no attendance UI, therefore no offline
attendance. `mark_attendance` exists only as an RPC. Performance rows for
schedule, attendance and "cancel in two taps" fail by absence.

**P1-3 · Money has no screen for dues.** 600 fee obligations exist ($60,000
outstanding across 40 overdue and 160 due). The Earnings tab shows marketplace
booking revenue: "GROSS $0 · PLATFORM FEE $0 · NET $0". Aged balances exist
only as the home block (25 rows, no drill-through target that shows the rest).
"Money, aged balances ≤ 2.0s" fails by absence.

**P1-4 · The chatbox is dead in production.** `/api/ai` answers
`503 {"error":"ai_not_configured"}` to every question (10/10, 150–275ms);
`vercel env ls production` shows no `ANTHROPIC_API_KEY`. Separately, pressing
Enter in the dock input on production sent no request at all (0 calls
observed). The "dumb question" test could not be run; the surface is not
functioning. Owner action: set the key on the Vercel project. Then re-test the
dock's submit.

**P1-5 · Mobile performance is 3× over budget.** Pixel 5 emulation, 4× CPU
throttle, ~4G (150ms RTT, 1.6 Mbps): FCP **4,404ms** (budget 1,500), session
restore → org loaded **5,084ms** (budget 2,000), home with blocks **5,422ms**
(budget 2,500). The page is one 806KB HTML document with every module and font
inlined; boot issues **13** requests (budget 4). Desktop numbers are fine
(792 / 1,676 / 2,025ms), which is why this has not been felt.

**P1-6 · Registration and payment (Job 3) do not exist.** No registration
form, no hosted checkout from a magic link, no refund path a parent can reach,
no declined-card ladder. Spec 13.6/13.7 are unbuilt; Stripe is in live
context with no sandbox. Every Job 3 row is untestable, not failing —
listed here because it blocks launch regardless.

**P1-7 · An org that finishes setup cannot add staff.** `organization_members`
insert raises `organization_id must reference a provider_type =
'organization' row` (`enforce_org_member`); setup never writes
`provider_type`. Reproduced during seeding; every real org created through
the current signup has `provider_type = null`.

## P2 — works badly

- **P2-1 · A broken row becomes an athlete.** Broken file (5 bad DOBs, an empty
  row, an unterminated quote): the 5 bad DOBs were rejected and shown ✓, the
  empty row dropped ✓, but `"Unterminated,quote,x,y,z` was **created as an
  athlete named exactly that**. Not silently dropped (the P0 case), but
  silently accepted.
- **P2-2 · No date-of-birth validation.** A birthdate of 1899-01-01 and one of
  tomorrow are stored without complaint (no CHECK, no client check).
- **P2-3 · Backend unreachable → the signed-in user becomes a guest on the
  marketing page.** With `/rest/**` blocked, session restore fails and the app
  renders the landing page as a guest, no message. Edge functions blocked: the
  dashboard renders normally ✓. AI blocked: no visible failure text in the
  dock.
- **P2-4 · Airplane mode from cold: nothing.** No service worker; the manifest
  exists but the app cannot open offline at all.
- **P2-5 · 320px: the Queue overflows horizontally (335px).** Roster at 320px:
  511 of 530 tap targets are under 40px (rows of tiny controls); one-handed
  sideline use fails.
- **P2-6 · Delivery depends on a one-minute cron.** Cancel → approve (the real
  path: approve RPC + `lifecycle-approve`) → Resend receipt measured at
  **15s** this run (`lifecycle-approve` 1,987ms; the cron tick picked it up
  at 00:xx:00). The budget is met on this run and will not be met on the runs
  where the click lands just after a tick (up to ~62s). Approving through the
  RPC alone leaves an `outbound_messages` row in `drafted` that nothing ever
  sends (verified: still `drafted` after 246s).
- **P2-7 · `event_conflicts_in_range` errors for a coach** (`42501`) instead
  of returning zero rows; `issue_guardian_token` past its ceiling answers HTTP
  **500** (`53400`) with a message.
- **P2-8 · Concurrent edits of one event: last write wins**, sequence bumps
  twice, no conflict shown to either editor.
- **P2-9 · Import commit has no progress feedback**, though 475 rows committed
  in 136ms locally and reached the server within 2.5s.

## Performance table

Worst three first. Profile: Pixel 5 emulation, 4× CPU throttle, 4G-class
network; desktop in parentheses. Round trips are Supabase/API requests.

| Surface | Measured | Budget | Result |
|---|---|---|---|
| Home with blocks (200 athletes) | **5,422ms** (2,025) | ≤ 2.5s | FAIL |
| Login → home interactive (session restore → org loaded) | **5,084ms** (1,676) | ≤ 2.0s | FAIL |
| First contentful paint, cold | **4,404ms** (792) | ≤ 1.5s | FAIL |
| Round trips on boot | **13** | ≤ 4 | FAIL |
| Schedule, month view (400 events) | no such view; tab shows 0 sessions | ≤ 2.5s | FAIL (absent) |
| Money, aged balances (season history) | no such view; home block only | ≤ 2.0s | FAIL (absent) |
| Attendance mark, offline | no UI; RPC only | ≤ 100ms | FAIL (absent) |
| Registration submit → confirmation | not built | ≤ 3s | FAIL (absent) |
| Chatbox first token / full answer | 503 `ai_not_configured` (150–275ms) | ≤ 1.5s / 6s | FAIL (dead) |
| Cancel event → parent delivery (real address) | **15s** click→Resend receipt | ≤ 15s | PASS (this run; cron variance up to ~62s) |
| Roster, 200 athletes | tab 224–294ms nav, 1 request, **62 fps** scrolling | ≤ 2.0s, 60fps | PASS |
| Any navigation (perceived) | 165–224ms desktop, 172–294ms mobile | ≤ 300ms | PASS |
| Home round trips (the block RPC alone) | 1 | ≤ 4 | PASS |
| Saturday test: 40× concurrent schedule reads (127 events, 31 days) | p50 699 / **p95 831** / max 838ms, 0 errors (1× baseline 204ms) | p95 ≤ 4s | PASS |
| Saturday test: 40× `dashboard_home` | p50 651 / p95 855 / max 863ms | — | PASS |
| Edge cold starts (first call vs 2s later) | lifecycle-process 1,549→184; stripe-create-checkout 1,430→445; lifecycle-approve 1,141→406; guardian-link 792→466; connectors-available 798→576; calendar-feed 281→194 | cancel path < 3s | PASS |
| 50MB CSV into the importer | parsed 2,000,000 rows in 1,713ms, no crash | — | PASS |
| 500-athlete import | parse 77ms, commit 136ms local, 475 rows on server ≤2.5s, no progress indicator | ≤ 60s with feedback | PASS (feedback missing: P2-9) |

## Adversarial results (29.5 / 29.6)

**Data.** `O'Brien-Smith`, `李明`, a 200-character name, an emoji team and
venue, two guardians on one email, `+44 7700 900123` and `+81 90-1234-5678`:
all stored, all render inert and complete (the 200-char name wraps the roster
row). Birthdate 1899 and tomorrow: **accepted (P2-2)**. $0 obligation: stored,
excluded from the overdue block by `amount_cents > 0` ✓. Negative: refused by
CHECK ✓. $999,999: stored and shown ✓. Event at 02:00 and on 29 Feb 2028:
stored ✓. **DST:** a Tue/Thu 18:00 series across 1 Nov 2026 materialised 10
occurrences, every one at 18:00 local, UTC hours 23 then 00 — correct.

**Concurrency.** Same draft approved twice at once: one succeeds, the second
is refused ("only a draft can be approved"), one outbound row ✓. Two
attendance writes for one athlete at once (different client ids): both
appended, latest wins by design ✓; the same client id twice: one row ✓. RSVP
double-tap (`no` and `maybe` at once): both accepted, last wins — acceptable
for an answer, but the receipt does not say which won. Two edits of one
event at once: last wins, no signal (P2-8). Same import twice fast: the second
is "25 already here", zero duplicates ✓. Paying twice: untestable (no
payment).

**Hostile input.** Magic-link token altered by one character → 404; expired
(1s TTL) → 404; token for a deleted guardian → 404 (cascade); a `pay`-scoped
token used for RSVP → 404; contact change (phone) → every live token revoked ✓
(a first run looked like a failure; it was my re-run patching an unchanged
value). Token for an event that already started: refused at issue ✓. Issuance
ceiling: 10/hour enforced (as an HTTP 500 — P2-7). `'; DROP TABLE athletes;--`
as an athlete name, `<script>alert(1)</script><img onerror>` as a team, a
`<script>` event title and finding, and a hostile cancellation reason: **zero
dialogs, zero script or handler nodes in the DOM** across home, queue, roster,
schedule, finances; the strings render as text. The same string in a REST
filter is intercepted by the CDN with an HTML block page (not a leak, but
opaque). Registration POST bypass: nothing to bypass.

**Network.** Wifi mid-import: **P0-1**. Wifi mid-payment: no payment. Wifi
mid-attendance: no attendance UI. 2G registration: no registration. Airplane
mode from cold: **P2-4**.

**Time.** 91-day session: not measurable in session (refresh tokens are
GoTrue-managed; no client expiry logic to fail gracefully — untested). RSVP 5
minutes after start: the link refuses at issue and existing tokens expire at
start ✓. Waiver edited after signing: refused ("a signed document version is
frozen — publish a new version instead") ✓. Certification expiring at
midnight: appears in the roster-gaps block ✓.

**Permission (29.6).** 26 tables × {owner, coach, org B owner, anon}: owner
reads own rows; **coach reads 0 rows of every org table** except their own
membership and certification; org B reads **0** rows of org A everywhere;
anon gets `401 42501` everywhere. Tampered and garbage bearers: `401 PGRST301`,
no rows. Coach calling `dashboard_home`: their coach-shaped home, no money
block; org B calling it for org A: empty home, no error ✓. Coach calling
`run_agent_drafts` / `approve_obligation_and_queue`: refused with an error
message (not zero rows — P2-7 class). Role revoked mid-session: the very next
`dashboard_home` is empty ✓. Invite redeemed from a different email: `42501`
with a clear message ✓. Four RPC-only tables answer `403` to any client read
rather than zero rows (they hold no row a client may see; noted, not a leak).
`select=*` on `installments` and `waiver_signatures` answers `400 42703` for
everyone including the owner (column-level lockdown; the app must name
columns — P3). **No leak found.**

**Integrity (29.7).** Empty org: every tab shows a real empty state, zero
fabricated names/amounts/dates — **except the Inbox (P0-2)**. With data: the
home's numbers are the rows the RPC returned (25-row cap per block; the money
block's "Open" drills to Earnings, which shows bookings, not dues — P1-3).
SQL-side change → refresh reflects it (verified for cancel → sequence/status);
deleted row → gone on refresh ✓.

**Failure behaviour (29.8).** Supabase REST down: **P2-3**. Functions down:
home fine ✓. AI down: no message (P2-3). Resend/Stripe/Places/inbox: not
disconnectable from this session (see below).

**Mobile (29.9).** Emulation only. 320px: **P2-5**. Rotation, sunlight, one
bar, walking: not testable here.

## Where a real person got lost

Not run. The five-second, stranger, Saturday, abandonment and dumb-question
tests need real people and a working chatbox; the chatbox is dead (P1-4). My
own proxy observation on the five-second test: the audit owner's home shows
"Needs you" with 25 rows, "Outstanding balances" with 25 of 40 overdue
families, "Today and tomorrow" with the double-booked practice flagged
`CONFLICT: venue, staff` on the event, and "Roster gaps" with 20 unsigned
waivers plus the expiring check — it does name what needs attention. What a
director cannot do from there is act: no cancel, no attendance, no money
page.

## What I could not test

- A real phone on cellular, outdoors, one-handed, rotated, in sunlight —
  needs a human with the device.
- Job 3 end to end — needs registration (13.7) and checkout (13.6) built,
  and the Stripe CLI switched to a sandbox (`! stripe switch context`).
- Job 4 inbox scoping and threaded replies — needs a Google account connected
  through the OAuth consent screen by a human. Drafts and delivery were tested
  (one real cancellation email went to sporve123@gmail.com at 21:07 UTC —
  please confirm receipt; that is the delivery receipt).
- Dependency outages of Resend, Stripe, Google Places, the connected inbox —
  no switch to flip from here; only client-side blocking was possible.
- The 91-day session.
- The chatbox — dead until the key exists.

## Fix order

By consequence.

1. **P0-1** Import commit must be server-conditional with a receipt: write the
   batch and rows first, show "committed" only from the returned rows, show a
   specific failure otherwise, and never leave a batch row without its rows.
2. **P0-2** Remove the seed literals from the roster header and the inbox for
   real accounts (same gate as C4: `queueIsLive()`).
3. **P1-7** Setup writes `provider_type = 'organization'` for team/club/camp
   orgs (and the People page must not dead-end).
4. **P1-1** Staff membership: a member lands in the org that employs them;
   trainers can read their team's roster and events and mark attendance for
   them (RLS + `mark_attendance` admit `trainer` scoped to `assigned_member_id`
   / their teams).
5. **P1-2** A real Schedule screen over `event`: list/month, conflicts on the
   event, cancel in two taps (draft-first), attendance with an offline queue.
6. **P1-3** A real Money screen over `obligations`: aged balances by family
   with drill-through from the home block.
7. **P1-4** Owner: `ANTHROPIC_API_KEY` on Vercel production; then fix the
   dock's Enter-to-send.
8. **P1-5** Mobile budget: split the 806KB document (fonts and inactive modules
   out of the critical path), collapse the 13 boot requests into the home RPC.
9. **P2-3 / P2-4** Backend-unreachable state and an offline shell.
10. **P2-1 / P2-2** Reject garbage rows and impossible birthdates at import.
11. **P2-5** 320px layouts and 40px tap targets on Roster and Queue.
12. **P2-6 / P2-7 / P2-8** Delivery tick, error-vs-zero-rows on the two RPCs,
    event edit conflicts.
13. **P1-6** Registration and payment (spec 13.6/13.7) — the largest item, last
    only because everything above it is broken for orgs that already have the
    data.

## The governing question

If a real club ran a real season on this tomorrow, it would get the roster
wrong (an import that says it worked and did not), and nobody would notice
until a child was missing from a list on a Saturday. That is the finding.

## Method and evidence

Scripts (not committed; they hold nothing secret beyond the audit users'
throwaway passwords): `.audit/perf.mjs`, `saturday.mjs`, `coldstart.mjs`,
`permission.mjs`, `links.mjs`, `ui.mjs`, `job1.mjs`, `job2.mjs`,
`deliver.mjs`, `chat.mjs`, `coachview.mjs`, `net.mjs`, `more.mjs`, all under
Playwright 1.62 Chromium against https://sporv.ai and the live REST/RPC
surface with the audit users' own JWTs. External review of this report:
none (CodeRabbit has been rate-limited on every PR this week).

## Teardown

All audit rows carry ids derived from `md5('ad17-…')` and belong to the three
`ad170000-…` users; deleting the three `auth.users` rows cascades through
profiles → providers → every org table. Done after this PR merged; verified
with a count of `ad170000-%` users = 0 and providers named `ZZ AUDIT%` = 0.
