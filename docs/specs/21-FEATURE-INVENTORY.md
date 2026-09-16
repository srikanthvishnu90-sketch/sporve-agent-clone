# 21 — FEATURE INVENTORY
MUST = an org cannot run a season without it. SHOULD = strongly wanted, deferrable one cycle. LATER = agreed direction, not now. OUT = decided against. State is verified against the repo, not assumed. Corrected 2026-09-16 per docs/audit-2026-09-15.md (A6, B4, D8).
## 21.1 Identity and access
A1 Staff signup, login, password reset — MUST — Exists, buggy (name will not save, unadvanceable steps)
A2 Session persistence, 90 days, silent refresh — MUST — Unverified
A3 No unauthenticated route touching org data — MUST — Unaudited, assume broken until proven
A4 New account starts EMPTY, zero auto-attachment — MUST — Unaudited, highest-risk unknown
A5 Staff invitation and acceptance — MUST — coach_invites, invite_creates_guardian exist
A6 Roles: owner, director, treasurer, registrar, coach — MUST — **No treasurer-role migration exists** (corrected 2026-09-16, audit): the live CHECK is `role IN ('owner','admin','trainer')`; the only `treasurer` symbol is the `generate_treasurer_summary` generator. Director, treasurer and registrar cannot be represented until the CHECK changes
A7 Role enforcement in RLS, not UI — MUST — Partial
A8 Audit log of every consequential mutation — MUST — settings_audit exists, coverage incomplete
A9 Onboarding: every step advanceable, progress persists — MUST — Broken
Hard blocks in onboarding, and only these two: legal consent, and identity required for payment.
## 21.2 People and roster
B1 Athletes, guardians, guardian links — MUST — Tables exist
B2 Teams, programs, team membership — MUST — Tables exist
B3 Staff records incl. imported staff with no account — MUST — organization_members
B4 Import with dry run before any write — MUST — **A dry run exists** (corrected 2026-09-16, audit): `importDryRun()` classifies every row create/matched/review/rejected and the wizard shows a preview before commit — client-side only, un-persisted; the gap is B6 (persist the quarantine), not the dry run
B5 Import idempotency — MUST — import_batch_uniqueness exists
B6 Quarantine unparseable rows, count and show them — MUST — Missing
B7 Phone normalisation + line-type check at import — MUST — Missing
B8 Sprocket importer — SHOULD — Missing; reference customer is on Sprocket
B9 TeamSnap / Sports Connect / SportsEngine importers — LATER
B10 Full org export, one click, open formats — MUST — Missing
Never silently drop a row.
## 21.3 Scheduling
C1 Events: practice, game, tryout, camp, lesson — MUST — Green-field; sessions stores time as TEXT
C2 Recurring series with RRULE, 180-day materialisation — MUST — Zero recurr matches
C3 Single-occurrence exception without breaking series — MUST — Missing
C4 Publication — invisible until published — MUST — Missing
C5 Cancellation propagated everywhere in seconds — MUST — Missing
C6 Conflict detection: facility, staff, athlete, blackout — MUST — Missing
C7 Availability / RSVP collection — MUST — Zero rsvp matches
C8 Attendance, append-only, works offline — MUST — Missing
C9 ICS calendar feed per family — MUST — Missing
C10 Facility and resource assignment — SHOULD — facilities partial
C11 League scheduling — LATER · C12 Brackets and standings — LATER
Largest gap in the product. Nothing downstream works without C1–C3.
## 21.4 Registration and money
D1 Registration form builder with custom fields — MUST — Zero registration matches
D2 Eligibility by birth window — MUST — Missing
D3 Capacity + waitlist with timed offers — MUST — program_waitlist partial
D4 Discounts: early-bird, sibling, code, multi-program — MUST — Zero discount matches
D5 Financial aid as first-class private object — SHOULD — Missing
D6 Tryouts with private evaluations — SHOULD — Missing
D7 Checkout with no account, Apple/Google Pay — MUST — Partial
D8 Installment plans — MUST — installments exists; a UI write path exists (`create_member_fee_schedule` RPC from the Money screen — corrected 2026-09-16, audit); no parent can pay without an account (D7)
D9 Failed payment retry ladder + treasurer flag — MUST — Missing
D10 Refunds and credits, ledger-recorded — MUST — Partial
D11 Ledger reconciling to zero drift — MUST — payment_event_ledger exists; webhook silent-200 breaks it
D12 Stripe Connect payouts — MUST — Partial, no live KYC
D13 Sensitive fields encrypted, excluded from exports and agent context — MUST — Missing
## 21.5 Communication
E1 Transactional + bulk email on separate subdomains — MUST — Resend wired; one domain
E2 Inbound email route — MUST — Missing; parents reply into a void
E3 SMS with per-person consent tracking — MUST — No provider exists at all
E4 A2P 10DLC brand + campaign — MUST — Not started
E5 Quiet hours, timezone-correct; cancellations override — MUST — Missing
E6 STOP/HELP handled and mirrored to suppression — MUST — Missing
E7 Bounce and complaint suppression blocked at enqueue — MUST — email_suppressions exists
E8 One-time scoped expiring links for parent actions — MUST — Zero magic_link matches
E9 Delivery receipts per channel — MUST — delivery_events exists, zero rows
E10 Conversation threading by person, not channel — SHOULD — Missing
Zero messages have ever been delivered to a human.
## 21.6 Compliance
F1 Background check status per person — MUST — Table does not exist
F2 Badge cannot render without a backing cleared row — MUST — Defect, renders with zero checks
F3 Per-person booking gate — MUST — Defect, org-wide
F4 Vendor integration, fail-closed when unconfigured — MUST — Webhook NOT DEPLOYED
F5 Certifications with expiry — MUST — staff_certifications exists, zero rows
F6 Waivers with content-hash evidence records — MUST — Partial, no evidence fields
F7 COPPA: no minor authenticates, ever — MUST — Structural, unproven
F8 Cross-tenant isolation proven by test — MUST — Unproven
F9 Deletion and export requests with receipts — MUST — privacy_requests exists, unwired
F10 Sanctioning body export formats — SHOULD — Missing
F2 and F3 are the two most serious open items in the product.
## 21.7 The agent
G1 Email ingestion, read-only, scoped, provenance-cited — MUST — gmail-scan exists
G2 Dues chasing — MUST — Partial
G3 Inbound triage — MUST — Missing
G4 Safety escalation — injury/welfare never auto-drafted — MUST — Missing
G5 Schedule change propagation drafts — MUST — Blocked on scheduling
G6 Availability chasing — MUST — Blocked on scheduling
G7 Document and certification chasing — MUST — Partial
G8 Weekly director digest — SHOULD — draft-recap exists
G9 Conflict surfacing as findings — MUST — Blocked on scheduling
G10 Payment failure recovery — MUST — Missing
G11 Roster hygiene findings — SHOULD — Missing
G12 Facility finding — search, rank, draft inquiry — SHOULD — Unspecced; Places key exists
G13 Organisation prospecting — SHOULD — Unspecced
G14 Lapsed-client re-engagement — SHOULD — Unspecced
G15 Write safety registry — MUST — create_note silently no-ops
G16 Eval harness ≥85% draft acceptance — MUST — evals/ exists, not load-bearing
G17 Degraded mode — MUST — Untested
## 21.8 Unspecced, named by the reference customer
H1 Employee management — staff, hours, rate cards, payouts, 1099 — SHOULD — No spec
H2 Facility relationships — rates, contacts, windows, history — SHOULD
H3 Client acquisition for solo trainers — SHOULD — prospect ORGANISATIONS only; never scrape individuals or families, never auto-email a person who did not ask.
## 21.9 OUT
Team chat / parent-to-parent; photo and video sharing; native mobile apps; website builder; merchandise/uniforms/fundraising; referee assignment; auto-send of anything; individual/family scraping and cold email.
