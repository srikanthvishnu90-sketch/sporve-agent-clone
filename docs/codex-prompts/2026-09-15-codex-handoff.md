# Codex handoff — 2026-09-15

Read this with `AGENTS.md` (agent lane rules) and `docs/decisions/2026-09-15-decisions.md`.

## The only repo

`srikanthvishnu90-sketch/sporve-agent-clone`, and the page it deploys,
`sporv.ai`. Nothing else. Not `sporve-web`, not `sporve-app`, not
`sporve-marketplace`. If a task seems to need another repo, stop and report
instead of reaching for it.

## Lanes

| | Fable (Claude) | Codex |
|---|---|---|
| migrations | `20260915_001050–001099` (001050–001058 **used**, spec 12) | `20260915_001100–001149` |
| never edit | `GATES.md`, `docs/specs/00-MASTER.md`, `docs/specs/README.md` | same |
| scope | one spec, one branch, one PR; nothing outside that spec's surface | same |

Every PR produces the migrations **and** every test file named in the spec's
DoD. A write that returns success without a receipt proving a row changed is a
CI failure, not a bug. Rebase onto `main` before opening a PR.

## What is already open (do not duplicate)

| PR | branch | what it holds |
|---|---|---|
| #5 | `feat/spec12-scheduling` | spec 12 — `event`, `event_series`, `event_response`, `attendance_record`, `venue`, `blackout_window`, `migration_quarantine`, `calendar_feed_tokens`, the materializer/publish/conflict RPCs, `cancel_event`, the ICS edge function. Migrations `001050–001058`. |
| #6 | `feat/spec11-agent-rail` | spec 11.2 agent rail + 11.3 installable manifest. |
| #7 | `chore/retire-flutter-push` | D1 — deletes the dead FCM push fan-out. |
| #8 | `docs/rulings-2026-09-15` | rulings R1–R5, and the `GATES.md` lane-rule collision they expose. |

## Facts that will save you a wrong migration

These are verified against the **live** database, not inferred from files.

1. **There is no `organizations` table.** `providers` IS the organisation root
   (ruling R1). Every table carries `provider_id → providers(id)`. Any spec that
   writes `organization_id uuid not null references public.organizations(id)`
   is wrong and will fail at plan time. `organization_members.organization_id`
   is the one legacy exception and it references `providers(id)` too.
2. **Roster identity is `team_athletes.id`**, which is what `guardian_links.member_id`
   points at. `public.athletes` has **0 rows** and belongs to the retired
   marketplace product. Do not key new tables on it.
3. **`sessions` cannot become a view.** `bookings.session_id` and
   `disputes.proposed_session_id` are real foreign keys, and a foreign key
   cannot reference a view. Spec 12 lands `event` *alongside* `sessions` and
   copies rows across; `sessions` stays a table until every writer is
   re-pointed.
4. **`sessions.start_time` is `text` and holds two formats in the wild** —
   `"18:00"` (the app) and `"05:00 PM"` (the documented display form). A naive
   `(date || ' ' || time)::timestamp` quarantines every AM/PM row.
5. **Draft-first is enforced in the database, not the UI.**
   `trg_outbound_freeze` on `outbound_messages` stops a non-service-role client
   setting `sent`/`pending`/`processing` and server-stamps `approved_by`/`_at`;
   `trg_enforce_obligation_lifecycle` governs `obligations`. **Never create a
   second send path.** Anything that reaches a family goes: generator →
   `obligations` draft → human approve → `outbound_messages`.
   The freeze trigger is `BEFORE UPDATE` **only** — granting `authenticated` an
   INSERT policy on `outbound_messages` would immediately let a client stamp
   `sent_at`. Do not add one.
6. **Migrations are FILES ONLY.** D5 moves the agent product to its own Supabase
   project, which does not exist yet. Nothing in the `001050–001149` range has
   been applied anywhere. Never apply to `tseszaprvtvqrkfpditu`.
7. **A cancellation always drafts** (ruling R5). No auto-send, no flag, no
   exception. The 15-second target is approval→delivery.

## New spec filed: 13 — PARENT SURFACE, ZERO INSTALL (gate G8)

`docs/specs/13-PARENT-ZERO-INSTALL.md`. The rule that drives everything:
**a guardian never installs an app and never sets a password.** Four channels —
ICS for the schedule, SMS for urgent change, email for registration/receipts,
and a magic-link mobile page to do anything.

Two things to know before building it:

- **The RSVP write path already exists.** Spec 12 ships
  `set_event_response(p_event, p_member, p_response, p_source, p_note)` as a
  SECURITY DEFINER RPC deliberately shaped so staff, a logged-in guardian, and a
  token-authenticated edge function can share one path — `p_source` takes
  `'sms'` and `'email'` for exactly this. Call it. Do not write a second one.
- **A per-guardian token table already exists** for the calendar feed
  (`calendar_feed_tokens`, 256-bit, revocable, returns nothing when unknown or
  revoked). Spec 13's `guardian_access_token` should be consistent with it, and
  the two should not drift into different revocation semantics.

**Start A2P 10DLC registration immediately** — brand *and* campaign, plus a
toll-free number in parallel. Carrier review is measured in weeks and it gates
every SMS in the spec, so it is the long pole regardless of build order.

## Owner rulings in force (`docs/decisions/2026-09-15-rulings.md`)

R1 `providers` stays the org root (rename is recorded debt, paid after G9) ·
R2 `GATES.md` is canonical and should hold the v2 G1–G10 ladder, G3 SUPPLY
deleted — **currently blocked by the lane rule; GATES.md still shows four gates
while everything else cites G1–G10** · R3 Flutter retirement is client-only ·
R4 the narrow launch **cuts migration (17), keeps registration (14)**; G10 is
not a launch gate · R5 cancellation always drafts.
