# 22 — THE DASHBOARD
The single web surface staff log into. One URL, one application, role-scoped.
## 22.1 The shape
Two regions, both always present above 900px. **Canvas (primary):** real org state as inspectable objects; every number clickable through to the rows behind it. **Agent rail (persistent, right):** what the agent noticed, drafted, and is waiting on; below 900px a bottom sheet; never removed. The agent proposes; the canvas proves. **Invariant:** nothing in the rail sends, charges, or publishes on its own.
## 22.2 Agent rail
Three stacked sections: **Noticed** (findings, newest first, each citing its source), **Drafted** (messages/proposals awaiting approval, showing recipient, trigger, full text), **Waiting on you** (blocked on a human decision, reason stated). Every item: approve, edit then approve, dismiss with reason (recorded — the eval signal). An empty rail says what the agent is watching, never a blank panel.
## 22.3 Home
Answers "what needs me today" in under five seconds, and differs by role.
**Director / owner:** Money (collected this period, outstanding, overdue count and total) · Today and tomorrow's events with unresolved conflicts flagged · Roster (new registrations, withdrawals, waitlist depth) · Risk (expiring certifications, missing waivers, failed payments) · the agent rail.
**Coach:** My next event with one-tap attendance · My teams and rosters · Availability responses for my upcoming events · Nothing about money. Nothing about other teams.
**Treasurer:** Outstanding balances by family, sortable by amount and age · Failed payments needing action · Payout status and ledger drift · Financial aid requests pending.
**Registrar:** Incomplete registrations · Missing documents by athlete · Import status and quarantined rows · Eligibility failures.
**Amended 2026-09-17 (doc 25, slice 1):** the role home screens above are now
**seeded data**, not code. `dashboard_role_default` (migration
`20260915_001073`) holds each role's ordered block list; `dashboard_block` is
the registry of the five CORE blocks (doc 26.2); `dashboard_home(p_provider)`
resolves default → derived capability flags → stored layout → permission
filter and returns every block's rows in one round trip. Repo roles map
owner → owner, admin → director, trainer → coach; treasurer and registrar
defaults are seeded for when those roles exist. Nobody can rearrange blocks
yet, deliberately (25.1).

## 22.4 Schedule
Month, week, list views (list = mobile default). Filter by team, program, staff, facility. Conflicts render inline on the event. Draft vs published visually unmistakable; publishing deliberate, scoped to a team or date range. Create supports single event or recurring series in one flow. Editing an occurrence asks: this event / this and following / all. **Cancel is two taps from home on a phone**, with a pre-written draft attached. Every event shows attendance state and availability responses.
## 22.5 People
**Roster:** athletes with team, program, payment state, document state, eligibility; filterable, sortable, exportable; bulk actions. **Athlete record:** guardians and contacts, team/program history, attendance, payments, documents with signature evidence, registration answers; sensitive fields visible only to registrar, director, that athlete's own coaches, never in agent context. **Staff:** role, teams, background check status with expiry, certifications with expiry, pay rate if employee management enabled. **Status shows the real row or it shows nothing.** **Guardians:** contacts, consent per channel, athletes linked, payment history. No login, ever.
## 22.6 Money
Outstanding balances by family and aggregate, aged · every obligation traceable to what created it and what has been paid · discounts/aid explained on the obligation · failed payments with retry state and a one-click parent link · refunds/credits ledger-recorded · payout status and reconciliation drift surfaced · export to CSV and accounting.
## 22.7 Registration
Forms with status, capacity, count, waitlist depth, revenue · builder (custom fields, pricing, discounts, required documents, eligibility) · submissions decidable in bulk · waitlist with position and offer expiry · the public link and embed snippet.
## 22.8 Messages
Threaded **by person, not by channel** · drafts awaiting approval shared with the rail · delivery state per message (queued, sent, delivered, bounced, suppressed) · consent state visible before composing · compose to a segment (team, program, unpaid, non-responders).
## 22.9 Facilities
Facilities in use (rate, contact, windows, upcoming bookings) · agent search results with rank rationale · drafted inquiries awaiting approval · cost per facility over the season.
## 22.10 Settings
Org profile and timezone · staff and roles · connected accounts with scopes visible and revocable · waiver templates and versions · fee and payout configuration incl. who bears processing · agent mode per job: off, observe, draft · billing · full export · audit log filterable by actor and date, exportable.
## 22.11 Non-negotiable behaviours
Never render a claim the server cannot back · empty states teach · every destructive action reversible or confirmed and audit-logged · loading states never blank · errors say what happened and what to do · real fullscreen mobile · offline: attendance, cancellation, notes queue locally with a visible "N changes waiting" · works with the agent off.
## 22.12 Performance budget
FCP < 1.5s on mid-tier Android over 4G · schedule interactive < 2.5s at 500 athletes / 400 events · no view > 4 network round trips on load · Saturday 07:00–13:00 local ≈ 40x weekday load.
