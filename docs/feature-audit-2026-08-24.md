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

Progress: **Domain 1 done (12/87). Domains 2–14 pending.**

---

## Domain 1 — AI Assistant (the rail)   ·   avg ≈ 2.8/10

The rail itself (chat UI → `coach-command` → approve-first proposals) is real and
studied this session. But most *named* AI capabilities are not tools yet.

| # | Feature | Score | Why not 10 (grounded) | Path to 10 |
|---|---|---|---|---|
| 1 | Gym finder | **4** ↑ | Backend now CODE-COMPLETE (migration + `find_facilities` tool in coach-command: Places(New) call + shared-facilities enrichment + model guidance). Still not a working 10: not deployed, no `GOOGLE_PLACES_KEY` set, migration not applied, no frontend shortlist card, UNTESTED (can't deploy/run from here) | RED (owner): set `GOOGLE_PLACES_KEY`, apply `facilities` migration, deploy `coach-command`. Then F: shortlist card + "draft inquiry". Then JOINT: test a real query → verify → fix to 10 |
| 2 | Gym scheduling | **1** | Nothing built; depends on #1 + a resource model | B: facilities as calendar resources, conflict detection, rental-status lifecycle, stale-inquiry AI follow-up |
| 3 | AI emailing | **1** | No email provider, no `send_email` tool | RED: Resend + verified domain → B: `send_email` proposal tool → F: approve card |
| 4 | AI in-app message sending | **4** | `draft_message` proposal tool exists + a booking-message send rail; but bulk/broadcast dispatch is "queue until wired" and scheduled pre-approved auto-sends don't exist | B: wire all dispatch rails; add scheduled reminder engine with pre-approval |
| 5 | AI notes | **4** | `create_note` proposal tool exists (→ MOD_NOTES writes a row); voice input and attendance-context generation don't | B/F: voice capture, attendance→note, organization/search |
| 6 | AI drafting suite | **7** | Real tools: `draft_message/_bulk_message/_recap`, `camp_broadcast`, `draft_waitlist_offer`, grounded in roster/schedule, approval-gated. Gap: bulk/broadcast lack a live dispatch rail (paste-only today); no campaign scheduler | B: wire bulk/broadcast dispatch through the Approvals queue; add campaign scheduling |
| 7 | AI operations Q&A | **6** | Reads work: `get_schedule/_bookings/_roster/_waitlist/whos_booked`. Gaps: `get_earnings` returns a note (not a real query), no org/compliance reads, single-coach only | B: real earnings read; org-scoped + compliance-state reads (ties to #64/#67) |
| 8 | AI voice calibration | **1** | Onboarding step B8 is spec only; no tone profile stored or injected into generations | F+B: tone-pair UI + drafting-profile persisted + injected into every `coach-command` generation |
| 9 | AI onboarding concierge | **4** | Coach AI empty state + "Get set up" module + weighted next-step shipped this session; but no guided flow and no AI "what's left" tool reading `onboarding_state` | RED: apply `onboarding_state` → B: `whats_left` read-tool → F: guided flow |
| 10 | AI reorder lists | **1** | No inventory model, no tool | B: org inventory table (#274–276) + `draft_reorder` read/draft tool |
| 11 | AI review responses | **2** | No `draft_review_reply` tool; reviews exist but the AI can't draft a reply | B: `draft_review_reply` proposal tool over the reviews table (which is live) |
| 12 | AI translation layer | **1** | No translation on parent-facing drafts; no view-original | B: translate step in the draft pipeline via ai-gateway (ES/PL first) + view-original toggle |

**Domain-1 read:** the *plumbing* is a genuine strength (proposal/approval contract,
ownership-scrub, one-write-per-turn — all real in `coach-command`). The *capabilities*
are mostly unbuilt. Highest-leverage next: #6 dispatch rails and #7 real reads (they
lift the whole rail), then the gated tools (#1/#3) once secrets land.

---

## Domains 2–14 — PENDING
2. Messaging & Communication (13–23) · 3. Booking & Marketplace (24–34) ·
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
