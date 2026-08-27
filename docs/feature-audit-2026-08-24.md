# Sporv — 87-Feature Audit → path to 10/10

Owner directive 2026-08-24: evaluate all 87 catalog features, rate each /10,
say **why it is not a 10**, then drive each to 10. Multi-day. This doc is the
resumable ledger — top to bottom, one row per feature, grounded in the ACTUAL
code, not the spec.

**Governing principle (owner 2026-08-24): chase perfection.** Every feature's
target is a real, verified 10 — built, safe, edge-cased, live — not a demo. The
score is the current truth; the job is to close the distance to 10, honestly.

## Scoring rubric (score = reality, not intention)
- **10** — built, polished, edge-cased, safe, verified live; matches the 10/10 vision.
- **7–9** — built and works end-to-end; minor gaps or polish left.
- **4–6** — core partially built; real but incomplete.
- **2–3** — stub / spec only / a draft exists / not wired.
- **0–1** — nothing in code.

Most catalog lines are `[spec'd]` = **a spec, not an implementation** → they score
low on purpose. That is the honest starting picture, and it is the point of the
exercise. "Path to 10" names the concrete work + who it's gated on (F=frontend
here, B=backend `~/SportsMan-main`, RED=owner-applied migration/secret/deploy).

Progress: **Domains 1–3 done (34/87). Domains 4–14 pending.**

---

## Domain 1 — AI Assistant (the rail)   ·   avg ≈ 2.8/10

The rail itself (chat UI → `coach-command` → approve-first proposals) is real and
studied this session. But most *named* AI capabilities are not tools yet.

| # | Feature | Score | Why not 10 (grounded) | Path to 10 |
|---|---|---|---|---|
| 1 | Gym finder | **9** | 08-25 REALITY CHECK (2 scouts): the "smart rental" stack is mostly **scaffolding**. Google Places returns only name/address/coords — **no rate, no indoor/outdoor, no capacity**. The `facilities` enrichment columns (known_hourly_rate, rental_contact, court_types, hours) exist but **no code ever populates them**, and the table may not be applied to prod. No client result CARD (reads render as prose), no inquiry/booking lifecycle writer, **no email provider** (only Twilio SMS + Stripe). SHIPPED toward 10 (app PRs, pending merge+deploy): **#40** slot-fill — the finder now requires location + indoor/outdoor + surface + headcount before searching, asks one crisp question when any is missing (never the old indoor+outdoor mix), builds a targeted query from those slots, keeps rate honest ("not on file"), and a new `draft_facility_inquiry` drafts the rate/availability outreach (copy-to-send; no auto-send). **#41** a real facilities RESULT CARD in the dock (name/address/honest-rate + a Contact "Draft inquiry" action) — replaces prose-only rendering. eval 119/119; dock UI 4/4. | A TRUE 10 is now gated on INFRA, not prompt-tuning: **(RED)** apply the facilities migration + add `indoor`/`capacity` columns + richer rate tiers; **(RED/decision)** pick an email provider (Resend/SendGrid) so the inquiry can SEND; **(B)** a data POPULATOR for rates (community-flywheel: log the rate every inquiry returns → `facility_notes`); **(F/Flutter)** a real facilities result card + Contact action; **(B)** the rental booking lifecycle (`facility_notes.rental_status` writer). Then one live dock test. |
| 2 | Gym scheduling | **1** | Nothing built; depends on #1 + a resource model | B: facilities as calendar resources, conflict detection, rental-status lifecycle, stale-inquiry AI follow-up |
| 3 | AI emailing | **1** | No email provider, no `send_email` tool | RED: Resend + verified domain → B: `send_email` proposal tool → F: approve card |
| 4 | AI in-app message sending | **4** | `draft_message` proposal tool exists + a booking-message send rail; but bulk/broadcast dispatch is "queue until wired" and scheduled pre-approved auto-sends don't exist | B: wire all dispatch rails; add scheduled reminder engine with pre-approval |
| 5 | AI notes | **4 → building (all-in 2026-08-25)** | Root-cause found + fixed: `create_note` was a **silent no-op in the production Flutter client** (no dispatcher case → `_unknown`); an approved note wrote nothing. Now wired to the real `createSessionNote` rail (app PR #43, 116/116 evals + dock test). NEW attendance capability (app PR #44): `mark_attendance` (present/absent/late/excused, approve-first) + `get_attendance` read, on a lightweight PII-free `session_attendance` table (RED migration drafted — `docs/red-drafts/2026-08-25-attendance-migration.md`; NOT reusing camp_checkins). 117/117 evals + dock test. Remaining for 10: apply the migration + deploy; voice capture (client) is the last polish. | Owner: apply attendance migration + merge #43/#44 + app deploy. Then voice capture → 10 |
| 6 | AI drafting suite | **7** | Real tools: `draft_message/_bulk_message/_recap`, `camp_broadcast`, `draft_waitlist_offer`, grounded in roster/schedule, approval-gated. Gap: bulk/broadcast lack a live dispatch rail (paste-only today); no campaign scheduler | B: wire bulk/broadcast dispatch through the Approvals queue; add campaign scheduling |
| 7 | AI operations Q&A | **8** ↑ | 08-25: `get_earnings` is now a REAL query (paid-booking gross + payout-after-fee + this-month, through the session chain) ✓, `get_reviews` added ✓ (deployed), and `get_waitlist` is now a REAL FIFO read (app PR #42, pending merge+deploy) — families waiting on the coach's full sessions, COPPA-safe (denormalized name/age-band/note only). Remaining gaps: no org/compliance reads, single-coach only | B: org-scoped + compliance-state reads (ties to #64/#67) |
| 8 | AI voice calibration | **1** | Onboarding step B8 is spec only; no tone profile stored or injected into generations | F+B: tone-pair UI + drafting-profile persisted + injected into every `coach-command` generation |
| 9 | AI onboarding concierge | **4** | Coach AI empty state + "Get set up" module + weighted next-step shipped this session; but no guided flow and no AI "what's left" tool reading `onboarding_state` | RED: apply `onboarding_state` → B: `whats_left` read-tool → F: guided flow |
| 10 | AI reorder lists | **1** | No inventory model, no tool | B: org inventory table (#274–276) + `draft_reorder` read/draft tool |
| 11 | AI review responses | **2** | No `draft_review_reply` tool; reviews exist but the AI can't draft a reply. **SCOUTED 2026-08-25 (two agents) — code-only, NO migration.** DB is ready & live: `reviews.response_body`/`response_at` columns, RLS `reviews_update_provider_response` (coach may UPDATE only reviews on a booking they own), and the `enforce_review_update` trigger all applied to prod (migration `20260728_000200_reviews.sql`). Two constraints: legacy reviews with `booking_id IS NULL` are un-repliable by policy; only `author_role='searcher'` reviews qualify. `get_reviews` already selects `response_body` but does NOT return `id`/`booking_id`, so the model has no legal id to reply against — that's the first fix. | **YELLOW, no RED.** Edit checklist (all `~/SportsMan-main`): (1) coach-command/index.ts — add `draft_review_reply` to `WRITE_TOOLS` (:118), `review_id` to `ID_ARG_KEYS` (:133) + build `ownedReviewIds` set and union into the scrub allowlist, a SYSTEM bullet (:178), and return `id`+`can_reply:!!booking_id` from `get_reviews` (:455). (2) Flutter client: `coach_turn_dispatcher.dart` new `case 'draft_review_reply'` (:50) + `respondToReview()` on app/supabase/mock repositories, using the USER session (RLS+trigger enforce everything; service-role would BYPASS the guards — don't). (3) `coach_command_mock.dart` + `coach_command_fixtures.dart` eval cases (eval test asserts ≥100 cases/≥90% pass). Deploy: `supabase functions deploy coach-command` + Flutter web rebuild/rsync (GO-LIVE-RUNBOOK). Note: web repo (the-sporve-web) mod-reviews.js is seed-only with no reply UI — this feature lives in the Flutter app, not here. |
| 12 | AI translation layer | **1** | No translation on parent-facing drafts; no view-original | B: translate step in the draft pipeline via ai-gateway (ES/PL first) + view-original toggle |

**Domain-1 read:** the *plumbing* is a genuine strength (proposal/approval contract,
ownership-scrub, one-write-per-turn — all real in `coach-command`). The *capabilities*
are mostly unbuilt. Highest-leverage next: #6 dispatch rails and #7 real reads (they
lift the whole rail), then the gated tools (#1/#3) once secrets land.

---

## Chatbox comprehensiveness — 20 gaps (owner 2026-08-25: "underline 10–20 large features the AI chatbox is still incomprehensive towards and fix them")

Grounded in the real `coach-command` toolset. **FIXED THIS TURN** = shipped +
deployed 08-25. The single biggest fix was structural: the chatbox was running a
GENERIC prompt (secret unset), so it looked "incomprehensive" across the board —
that is now corrected, which lifts several rows at once.

| # | Gap (coach asks…) | Was | Now |
|---|---|---|---|
| 1 | "find/rent a gym" behaves right (asks location, doesn't refuse) | broken — generic prompt | **FIXED** — `INTERNAL_CALL_SECRET` set; real prompt honored |
| 2 | "how much have I earned / my payout this month?" | stub note | **FIXED** — real `get_earnings` (gross + payout-after-fee + month) |
| 3 | "what's my rating / what did parents say?" | no tool | **FIXED** — new `get_reviews` (reviews + average) |
| 4 | rental / gym follow-up questions answered, not refused | refused | **FIXED** — prompt now scopes facility help in |
| 5 | concise, proactive ChatGPT/Claude voice | verbose/off | **FIXED** — reply_text voice rule now applied |
| 6 | "who's on my waitlist?" | stub note | OPEN — B: real per-session waitlist read (client repo today) |
| 7 | "draft a reply to this review" | no tool | OPEN — B: `draft_review_reply` write proposal (reviews.response_body) |
| 8 | "email this parent" from the org's own address | no tool | OPEN — Feature 3; GMAIL creds set, needs `send_email` proposal tool |
| 9 | "text/SMS this parent" | partial | OPEN — Feature 4; needs SMS provider + dispatch rail |
| 10 | "when's my next free slot?" (availability reasoning) | schedule only | OPEN — B: open-slot query + reasoning |
| 11 | "mark John present/absent today" (attendance) | no tool | OPEN — B: attendance model + `mark_attendance` |
| 12 | "reply to this parent in Spanish" (translation) | none | OPEN — Feature 12; translate step in draft pipeline |
| 13 | "book / hold that gym for Tuesday" (rental booking) | none | OPEN — Feature 2; facility-as-resource + lifecycle |
| 14 | "is my background check current?" | blocked by rule | OPEN — deliberately walled (safety); decide if a self-status read is allowed |
| 15 | "what do I still need to set up?" (onboarding) | none | OPEN — needs `onboarding_state` migration (RED, drafted) + `whats_left` read |
| 16 | "send this reminder every Monday" (scheduling) | none | OPEN — B: campaign scheduler + pre-approval |
| 17 | "reorder cones/jerseys" (inventory) | none | OPEN — Feature 10; inventory model |
| 18 | "how's this month vs last?" (trend analytics) | none | OPEN — B: period-over-period earnings/bookings |
| 19 | bulk/broadcast messages actually SEND (not paste-only) | queue-until-wired | OPEN — B: wire dispatch through Approvals queue |
| 20 | multi-coach / staff-scoped reads (org view) | single-coach | OPEN — B: org-scoped reads (enterprise domain) |

**Fixed 08-25: 1–5 (5 of 20).** The rest are the Domain-1/2 build backlog —
mostly new tools + a couple RED migrations, sequenced below. Highest next: #7
draft_review_reply (cheap, pairs with the new get_reviews) and #8 email
(the owner has asked for it twice; creds are already set).

## Domain 2 — Messaging & Communication (13–23)   ·   avg ≈ 4.1/10

The backend draft→approve→send pipeline and the RLS-scoped conversations model are
genuinely real; the **web coach inbox is a seed mock** (compose writes only to local
`S.messages`, never the DB), the org routing layer is authored-not-applied, and the
**M1 child-binding hole** is live (RED — `docs/security/RED-2026-08-25-parent-update-binding.md`).

| # | Feature | Score | Why not 10 (grounded) | Path to 10 |
|---|---|---|---|---|
| 13 | Coach↔parent direct messaging | **7** | Backend real (conversations/messages tables, participants-only RLS, realtime publication, `ensure_provider_conversation` RPC); web `sendParentMessage` writes real rows (mod-coachaccount.js:428). BUT the web coach INBOX is a SEED MOCK — `S.conversations` from SEED (host:6372), compose pushes to a local array (host:14162), no API read. Real product is the Flutter realtime subscriber. | F(web): hydrate S.conversations/S.messages from the DB + route coachCompose through sendParentMessage. B: typing/presence. |
| 14 | Group / broadcast messaging | **3** | Web group threads (host:10814) are fully local mock — no group table, no send. Backend `camp-broadcast` is real (bulk DRAFT, never auto-sends) but rides shared_inbox migration marked "AUTHORED, NOT APPLIED". `draft_bulk_message`/`camp_broadcast` NOT in web PROP_DISPATCH → paste-only. | RED: apply ai_drafts + shared_inbox. B: wire bulk dispatch via Approvals. F: real group model + camp_broadcast rail. |
| 15 | AI-drafted messages | **6** | Real + guardrailed: `message-draft` (reply options, guardrail strips forbidden claims) + `draft-reply` (auto grounded coach-only draft). Web `draft_message` rail sends real (host:15667). Gaps: draft-reply trigger prod-applied state UNCONFIRMED; bulk paste-only; no scheduling. | RED/verify: confirm ai_drafts + draft-reply trigger live. B: bulk dispatch + scheduling. Ties Domain-1 #6. |
| 16 | Parent session updates / recaps | **6** | Real backend: session_notes→parent_updates→approve→`parent-update-send` (deterministic, idempotent, FCM push). **M1 LIVE**: `parent_updates_insert_coach` (20260629) checks only provider ownership, not that child_id was coached → IDOR / cross-child spam. Web `draft_recap` is DEMO-only (sendRecapToParentDemo, host:15662), not wired to the real send. | RED (M1): WITH CHECK binding child_id to a booking on this provider (drafted). F: point web recap at the real send. |
| 17 | Two-deep / COPPA-safe structure | **5** | Youth isolation real (guardian-only reads, invisible-to-parent drafts, org_inbox first-name-only). But "two-deep" is marketing, NOT enforced — a 1:1 thread has no second-adult witness / archival gate. | B: decide + enforce the two-deep policy (auto-CC guardian or immutable audit copy) in the messages write path + RLS. |
| 18 | Message notifications (push/email) | **5** | Push real (`_shared/push.ts` FCM v1, token pruning) fanned by parent-update-send; in-app notifications rows too. Gated on `FCM_SERVICE_ACCOUNT` secret (UNCONFIRMED in prod). Email channel does NOT exist (Domain-1 #3). | RED: confirm FCM secret set. RED/decision: pick email provider → B: email in the send step. |
| 19 | Automated / scheduled messages | **5** | Event-driven drafts real + approval-gated (web Approvals tab renders outbound_messages: booking_confirmed/reminder_24h/post_session/no_show/rebook; only `drafted` sendable, 409-safe). No recurring/time-scheduled campaign engine. | B: a campaign scheduler (pg_cron) drafting into the Approvals queue with pre-approval. |
| 20 | Shared team inbox (org routing) | **2** | `20260729_000620_shared_inbox.sql` fully designed (service_id/assigned_member routing, enforce_conversation_routing anti-forge, org_inbox()) but "AUTHORED, NOT APPLIED". Nothing live. Sub-trainer send-as-self is a documented follow-on. | RED: apply shared_inbox (routing only, no money). F: org-inbox surface. B: sub-trainer send identity. |
| 21 | Message templates | **1** | No template store/picker/interpolation anywhere. The AI drafting suite is the intended replacement by design. | Decision: confirm AI-draft supersedes templates; if saved snippets wanted, B: message_templates table + F: compose picker. |
| 22 | Read receipts / unread | **3** | Web unread badge (S.unread, host:10845) is LOCAL/cosmetic — no server read-state; messages has no surfaced read_at, conversations tracks only last_message. No delivered/seen. | B: read_at / message_reads + RLS-safe write, realtime it. F: derive badge from it. |
| 23 | In-thread booking / consent actions | **2** | Threads text-only; draft-reply grounds on slots/policies but emits prose, never a structured book/consent action card. | B: typed in-thread action messages (booking_offer/consent_request kind) → F: actionable card deep-linking the real flow. |

**Domain-2 read:** the backend draft→approve→send discipline (parent_updates + parent-update-send + guardrailed AI drafts + FCM push + RLS conversations) is genuinely built and safe, which is why messaging *looks* further along than it is. Highest-leverage next: **(1) close the live M1 child-binding hole (#16, RED — drafted)**, **(2) wire the web coach inbox to the real conversations table (#13, F — it's a seed mock today)**, **(3) apply shared_inbox routing (#20, RED)** — these convert "looks built" into "is built". Two verification caveats (confirm against live prod): ai_drafts + draft-reply trigger applied (gates #15); FCM_SERVICE_ACCOUNT set (gates #18).

---

## Domain 3 — Booking & Marketplace (24–34)   ·   avg ≈ 6.2/10

The money/safety spine (server-derived price, unbypassable bg-check booking gate,
signature-verified idempotent webhook, refund quote) is genuinely built and verified
live — the hard part. The **demand side is over seed data**: web browse/filter/AI-search
never touch the live `programs`/`search_listings` backend, and the capacity/waitlist/
availability layer is authored-not-applied.

| # | Feature | Score | Why not 10 (grounded) | Path to 10 |
|---|---|---|---|---|
| 24 | Browse / listing grid | **7** | Backend browse RLS real+safe (`providers_select_public`/`programs_select_public` gate on status AND `provider_safety_cleared()`, bgcheck_gate:96). But WEB grid renders from **seed PROGRAMS** (host K array :6053, DEMO_CATALOGUE), never a live fetch — and prod has 0 bg-verified providers → 0 bookable listings. | F: hydrate web grid from live `programs` select (respecting the RLS gate) + honest-empty. RED/data: real verified supply. |
| 25 | Filtered search (sport/age/price/location) | **7** | Rich client-side UI (mod-search.js: sport/age/price/haversine-distance filter :51, sort, saved searches, compare; dual-handle price histogram). Correct — but pure client-side over seed; never calls `search_listings`. verifiedOnly deliberately un-surfaced (smoke BGFILTER). | F: route filters through backend `search_listings` when a live catalogue is wired (rides on 24). |
| 26 | AI natural-language search / match | **4** | Backend sophisticated + real (`search-execute`: market-gate→embed→search_listings→relax→grounded "why matched" with claim-scrub; search-parse, ai-match, program_embeddings). BUT **not wired to web** — hero search is `applyHeroSearch()`, a local parse (host:14533); zero search-execute calls in src. `isMarketReady()` gates it off in a sparse market. | B: confirm market-ready thresholds; F: wire query UI to search-execute instead of the local parser. |
| 27 | Listing detail + booking flow | **7** | Real e2e for a verified coach's LIVE listing: `detailHTML(id)` .bk-* layout, `data-book`→`SporveBooking.create()` (real bookings insert, mod-booking.js:150)→checkout→deployed stripe-create-checkout. Sim-button trap closed (non-live only). Gap: seed listings still render local sim; it's inventory, not a code defect. | F: live-listing detail hydration (rides on 24). |
| 28 | Real-time availability / open slots | **3** | Presentational only. Web slot picker (host:1711, .sib-slot) renders fixed demo times; no live availability query. Backend `services_availability` NOT applied (services absent from prod). | RED: apply the services/availability model. B: open-slot query. F: render real slots. |
| 29 | Booking write + hold-while-paying | **6** | Write path real + money-safe: `trg_set_booking_price` recomputes final_price server-side (client price discarded — $1-for-$1500 closed). But the **hold isn't enforced in prod**: the seat-reserving capacity trigger (000103) is authored-not-applied (needs services); pending bookings have no TTL → a hold holds nothing and never releases. | RED: apply the capacity trigger (or session-level equivalent). B: pending-booking expiry job. |
| 30 | Stripe checkout / payment | **8** | Built + safe: amount from booking.final_price (never client), omits application_fee at fee=0 (v30 fix), webhook verifies raw-body signature before parse → `apply_stripe_booking_event` (service_role-only) idempotent via payment_event_ledger. Verified live (Connect enabled, cs_test_ sessions). **Not 10: ZERO charges have ever cleared** (4 checkouts, 0 paid). | RED/owner: land ONE cleared test-mode charge — the freeze-lift atom, lifts 30/33/34. |
| 31 | Booking capacity + waitlist | **2** | Domain's weakest. Family "Join the waitlist" writes only local S.waitlist (host:14914). `program_waitlist` table+RLS+FIFO guard fully designed but **AUTHORED-NOT-APPLIED**. Coach waitlist UI is seed mock. enrolled_count/max_capacity frozen server-owned but **no live trigger increments them** → no oversell guard in prod. | RED: apply `program_waitlist` + a live per-program session-capacity trigger. B: real joinWaitlist/offer rail. F: point web waitlist + coach board at the DB. |
| 32 | Background-check safety gate on booking | **9** | The wedge invariant, and it HOLDS. `provider_safety_cleared()` gates browse + search_candidates + the booking INSERT trigger, fail-closed, applied live, monitored green (33–34 checks PASS/0 FAIL). Not 10 only because 0 verified supply exercises it + org path leans on org_members correctness. | B/data: seed a verified provider to prove the gate e2e; keep the invariant board green. |
| 33 | Refunds / cancellation policy | **8** | Real + safe: stripe-refund takes booking id only, amount from `booking_refund_quote()` off the policy snapshotted AT BOOKING TIME, JWT-authz to the booking's searcher, DB write only via the idempotent charge.refunded webhook (one money-writer). cancel/refund copy honest. Not 10: never exercised (0 charges); `000104` applied-state unconfirmed. | RED/owner: exercise one real refund post-charge; confirm 000104 applied. |
| 34 | Coach payout (Connect) + review-gating | **7** | Supply money rail real: stripe-connect-onboarding + provider-payouts deployed, 409 until stripe_charges_enabled (verified: a coach Connect-enabled). Review-gating backend-real (reviews require booking_id). Not 10: 1 coach onboarded, payouts never run, "instant payout" unproven, web reviews seed-only. | RED/owner: run one real payout post-charge. B: payout status surface; wire web reviews to live table. |

**Domain-3 read:** the strength is the money/safety spine — server-derived price, the unbypassable bg-check booking gate, and a signature-verified idempotent webhook are genuinely built and verified live (the hard part), which is why booking *looks* done. Highest-leverage next is NOT more marketplace surface but **landing one cleared test-mode charge (#30 → lifts 30/33/34, clears the style freeze)**, then **applying `program_waitlist` + a live session-capacity trigger (#31, the one real 2/10 hole)**. **Money/safety invariants RE-VERIFIED (all HOLD):** payment RPC lockdown, booking safety gate, $0-pay closure, geo privacy, cancelled-checkout-claims-no-payment. Open verification (classifier-blocked live query): whether prod quietly applied program_waitlist / a session-capacity trigger (migration precondition guards suggest NOT).

---

## Domains 4–14 — PENDING
3. ✅ Booking & Marketplace (24–34) — scored above ·
4. Payments & Money (35–47) · 5. Scheduling & Calendar (48–55) ·
6. Client & Roster (56–63) · 7. Coach/Staff Ops (64–71) ·
8. Video & Development (72–77) · 9. Commerce & Gear (78–80) ·
10. Analytics & Growth (81–84) · 11. Onboarding & Migration (85–87).

Each will be scored in the same grounded table, top to bottom.

---

## Competitor gap — Sprocket Sports (org-ops teardown, 2026-08-24)

Sprocket (Chicago, club-management, annual releases, no marketplace/AI/solo-coach)
is the strongest club-ops competitor. It beats us today on **financial-admin depth
+ club websites**; it cannot flank us (no coach entry, no marketplace, no trust
layer). These are their features we lack — scored as candidates (0–2, since we
don't have them), with the honest priority. **Rule holds: a candidate becomes a
roadmap line only when a paying director asks by name — except S21, promoted.**

| Ref | Sprocket feature | Our score | Priority / our counter |
|---|---|---|---|
| S21 | Third-party schedule import/API | **0** | **PROMOTE TO V1** — cheap, high-value; syncs league/facility schedules |
| S6 | Financial-aid *determination* workflow | **1** | Org table stakes for treasurer buyers; we have scholarship rails spec'd, not determination |
| S29 | QuickBooks sync + monthly/annual financial reports | **0** | Org table stakes; already "LATER" in enterprise spec — Sprocket makes it a demo checkbox |
| S9/S10 | Club public websites + native CMS | **0** | Don't chase-build; **script the answer** — the marketplace listing IS the club's discovery surface |
| S30 | Custom report builder | **0** | Later; behind analytics domain |
| S7 | Bad-debt/collections beyond dunning | **2** | Smart dunning is spec'd; deeper collections later |
| S13 | Quick Promote (one-click cross-channel) | **3** | Our AI drafting + open-spot syndication is the *superior* version — name it as such in sales, don't rebuild |
| S24 | League management (scores/standings) | **0** | **HOLD THE LINE** — deliberately LATER; do not chase their strength |
| S4 | Donations | **0** | Low priority; add if a club asks |

**Our moats (they lack entirely):** consumer marketplace + demand generation · the
AI rail/drafting/gym-finding · 0%-of-bookings + flat pricing as a weapon ·
solo-coach product + client import (the coach→org flanking route) · background-check
orchestration + verified-trust layer · two-deep safe messaging as *structure* ·
cash-hybrid deposits + instant payouts · video & athlete-development.

**Strategic actions (from the teardown):** (1) add Sprocket as a column in the
Competitive Efficiency Matrix — it wins several org-ops rows, and that honesty is
the point; (2) **S21 → V1 candidate**; script the website-question answer; (3) treat
**S6 + S29 as org-tier table stakes** for any treasurer-led buying committee. The
warning: their CPO has publicly named generative AI as a next build area — the AI
window over the strongest local club-ops competitor is open and announced-closing.
