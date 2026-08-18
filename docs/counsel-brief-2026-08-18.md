# Sporve — Counsel Brief for Terms, Privacy & Coach Agreement

**Prepared for outside counsel · 2026-08-18 · generated from the live production system**

> **How to use this.** This is a factual pack, not a legal opinion. It exists so
> counsel does not have to reverse-engineer the product at an hourly rate. It
> states what Sporve actually collects, where it flows, what is already enforced
> in software, and — importantly — what is NOT yet built. Everything here is
> drawn from the production database and codebase as of 2026-08-18. Where a
> compliance control is *aspirational rather than implemented*, it is labelled
> **[NOT BUILT]**.

---

## 1. What Sporve is

A two-sided youth-sports marketplace (Chicago, pre-launch, launching 2026).
Families/parents find and book **background-checked** independent coaches,
trainers, camps, and teams; coaches run their booking/roster/payments through
the platform. Revenue model as of this date: a **provider subscription**
(Free / Pro $34.99 mo / Enterprise $149 mo — Enterprise not yet sold), and
Sporve takes **0% of booking payments** (coaches keep 100%; families pay the
listed price with no added fee). An "Enterprise / organization" tier for
multi-coach academies is designed but **[NOT BUILT]** and not sold.

**The three facts that drive the legal work:**
1. The platform stores **data about minors** (names, dates of birth, medical
   conditions, emergency contacts) → **COPPA** and children's-privacy exposure.
2. The platform **brokers services between adults and children** → liability,
   waiver, and safety exposure.
3. The platform's core promise is **"background-checked"** coaches → truth-in-
   advertising exposure, and **FCRA** exposure once a real check vendor runs.

## 2. Parties / user types

| Role | Who | Account |
|---|---|---|
| Searcher / Parent-Guardian | The adult who signs up, adds children, books, pays | Real auth account (email/Google) |
| Athlete / Child | The minor receiving coaching | **No login.** Exists only as a record under a guardian account |
| Provider / Coach | Independent coach or small business offering programs | Real auth account; separate `providers` record |
| Organization (Enterprise) | Multi-coach academy | **[NOT BUILT]** — schema exists (`organization_members`, roles) but no product |

## 3. Personal data collected (from the live schema)

**About children (`athletes` table):** first name, last name, **date of birth**,
gender, **medical_conditions** (free text), **emergency_contact**, profile photo,
preferred sports, skill level. Consent fields: `parent_consent` (boolean),
`consent_at` (timestamp), `consent_version`.

**About parents/coaches (`profiles`):** first name, last name, email,
phone_number, profile photo, role.

**About coaches/businesses (`providers`):** business name, location, precise
`latitude`/`longitude` **and** a rounded `public_latitude`/`public_longitude`,
Stripe account/customer ids, payout status.

**Bookings / payments:** `athlete_first_name` on the booking, Stripe checkout
session / payment intent / refund ids, provider payout amount, a
`payment_event_ledger` of Stripe events. **Sporve does not store card numbers**
— those live only with Stripe.

**Program/session location:** address line, zip, precise lat/long.

**Waitlist (pre-launch marketing):** email, name, zip; IP address is stored in a
rate-limit table.

**Not collected / not stored:** SSNs, full card numbers, bank account numbers
(payouts run through Stripe Connect; Sporve never holds bank details).

## 4. Data flows & third parties (sub-processors)

| Vendor | Role | What it touches |
|---|---|---|
| **Supabase** (hosted Postgres, US) | Primary datastore + auth (GoTrue) | All of the above |
| **Stripe** (Connect + Billing) | Payment processor + merchant rails; coach payouts via Connect | Card data, payout/bank data, subscription billing. Sporve applies a 0% booking application-fee today. |
| **Anthropic** (via a server-side AI gateway) | Powers the in-app "AI assistant" / message drafting | Coach-typed prompts; AI-drafted messages are **human-approved before send** (never auto-sent to a parent) |
| **Vercel** | Hosts the static web app + one serverless AI endpoint | No PII stored; CSP-hardened |
| Email (transactional) | Signup confirmation, receipts | Email addresses |
| **Background-check vendor** | Would run coach checks (Checkr/Sterling class) | **[NOT BUILT — see §6]** |

## 5. Compliance controls ALREADY enforced in software

These are real, server-side, and testable — counsel can rely on them as
existing facts of the system:

- **COPPA gate at the record level.** A child record **cannot be created without
  parental consent** — a database trigger (`trg_enforce_athlete_consent`) refuses
  the insert unless `parent_consent=true` with a timestamp and a consent version.
  A booking on a non-consented child is also refused
  (`trg_enforce_booking_athlete_consent`). Children have **no login and no direct
  messaging**; all child data flows through the guardian account.
- **Consent is versioned and timestamped** (`consent_version`, `consent_at`) — so
  a policy update can force re-consent and the record proves which version a
  guardian agreed to.
- **Row-level security everywhere.** Every table enforces access at the database:
  a parent sees only their own children; a coach sees only their own data;
  precise coordinates and Stripe ids are not readable by anonymous users.
- **Coaches cannot self-verify.** Trust columns (background-check status,
  verification, payout enablement, plan) are **server-controlled** — a trigger
  refuses any attempt by a coach to mark themselves verified/paid
  (`trg_enforce_provider_trust`).
- **The "background-checked" badge is data-gated and fails closed.** A coach is
  shown as checked only if the status is `verified` **and** a completion date
  exists; a production invariant alarms if any row claims verified without a
  date. (This was hardened specifically to prevent a false safety claim.)
- **AI messages to families are human-in-the-loop** — drafted, coach must approve,
  and clients cannot mark a message "sent" (`trg_outbound_freeze`).
- **AI data retention** runs daily (`run_ai_data_retention`) purging AI feedback
  and observability logs on a schedule.
- Payment security posture: no card data stored; Stripe webhook is
  signature-verified and idempotent; refunds and fees are server-computed.

## 6. Known gaps / open questions FOR COUNSEL (be honest with them)

- **No background-check vendor is integrated. [NOT BUILT]** Today the platform
  has the *gate* (unverified coaches can't be booked) but **no CRA actually runs
  a check** — verification is presently manual/absent, and pre-launch sample
  coaches were explicitly set to "unverified." Before launch, a real vendor
  (Checkr/Sterling class) must run checks, which brings **FCRA** obligations
  (permissible-purpose, standalone disclosure + consent, adverse-action notices).
  Counsel should specify the FCRA consent + adverse-action language.
- **The live Terms of Service and Privacy Policy are labelled "interim"** and were
  authored as placeholders pending counsel. They are not final.
- **No general data-retention/deletion policy for athlete/parent PII. [NOT BUILT]**
  Only AI logs are auto-purged. Counsel should advise a retention schedule and a
  parent-facing deletion path (esp. for a child's record — COPPA gives parents
  deletion rights).
- **`medical_conditions` is collected as free text** on minors. Counsel should
  confirm whether this is necessary, how it must be disclosed in the Privacy
  Policy, and whether it triggers any heightened handling.
- **No coach Independent-Contractor Agreement exists.** The wizard collects a
  background-check consent only; there is no IC agreement, no acceptance record.
  This is one of the requested documents.
- **No acceptance-tracking table for ToS/Privacy.** Signup shows a combined
  Privacy+Terms checkbox but nothing records *which version* a user accepted.
  (We can build a `terms_accepted(user, version, timestamp)` table once counsel
  sets the versioning model.)
- **Precise geolocation** of coaches and session addresses is stored; a rounded
  public coordinate is what's exposed. Counsel should confirm disclosure.

## 7. Documents requested

1. **Terms of Service** — two-sided (family obligations + coach obligations),
   covering: marketplace-not-employer framing, no guarantee of coach conduct,
   assumption of risk, dispute/arbitration, limitation of liability, the
   "background-checked" claim scoped to what the vendor actually certifies.
2. **Privacy Policy** — naming children's data (DOB, medical, emergency
   contacts) explicitly, the COPPA under-13 posture (guardian-gated, no child
   login), sub-processors (§4), retention, and parental access/deletion rights.
3. **Coach Independent-Contractor Agreement** — worker-classification
   protection, background-check consent, code of conduct / SafeSport alignment,
   payout terms (Stripe Connect), IP/likeness, termination.
4. **FCRA background-check disclosure + consent + adverse-action** language,
   coordinated with the chosen vendor's flow.

**Key questions to put to counsel up front:** (a) our COPPA posture — is
guardian-gated record creation + no child login sufficient, and what must the
Privacy Policy say about `medical_conditions`? (b) how to phrase the
"background-checked" promise truthfully given checks are per-coach and
vendor-run; (c) the coach classification analysis for our model; (d) a
retention + parental-deletion policy; (e) whether Illinois youth-sports
return-to-play / any state waiver requirements bear on our waiver text.

## 8. What kind of counsel this needs

A **technology/privacy attorney** with **COPPA / children's-privacy** experience
and **consumer marketplace** experience; sports/youth-org exposure is a plus.
This is not a generalist small-business engagement — the COPPA and FCRA pieces
are specialized.

---

*This brief is a factual system description for counsel, not legal advice, and
not a substitute for counsel's own review. Generated from the Sporve production
system (Supabase project, edge functions, and web app) on 2026-08-18.*
