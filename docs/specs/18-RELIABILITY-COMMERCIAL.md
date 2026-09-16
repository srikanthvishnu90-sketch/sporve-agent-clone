# 18 — RELIABILITY, SUPPORT, AND THE COMMERCIAL WRAPPER

**Gate:** blocks the first paid contract and every conversation after roughly the
tenth org. Not the first build.
**Current state:** `docs/incident-runbook.md` exists. `webhook_dead_letter`,
`edge_rate_limits`, `cron_http_audit`, `ai_observability_events` exist. No status
page, no on-call, no DPA, no insurance, no support model.

---

## 18.1 Why this is a product spec and not an afterthought

With one web surface and no native app, there is no second way in. An outage on a
Saturday morning means several hundred families have no schedule and several dozen
coaches cannot take attendance. Reliability is a feature of a single-surface
product in a way it is not for one with an offline-capable native client.

---

## 18.2 Uptime and the Saturday problem

Youth sports load is extraordinarily peaked: Saturday 07:00–13:00 local is
perhaps 40x a Tuesday afternoon.

- Load-test at 40x baseline before onboarding org number ten.
- Read replicas or aggressive caching for the schedule view specifically, which is
  the peak read.
- A static, cached, read-only schedule fallback served from the edge when the
  primary is degraded. If everything else is down, a parent and a coach can still
  see where to be. This single fallback converts most outages from a crisis into a
  complaint.
- Published SLO: 99.9% monthly, with Saturday 06:00–14:00 local treated as a
  protected window in which no deploys occur.

**DoD:** `tests/load/saturday-peak.spec.ts` in CI against a seeded 50-org fixture;
plus a game-day exercise where the primary database is deliberately failed and the
fallback is verified to serve.

---

## 18.3 Incident response for a solo founder

The honest constraint: one person cannot be on call continuously, and pretending
otherwise in a sales conversation is a liability.

- Alerting on: webhook dead-letter growth, payment reconciliation drift, delivery
  failure rate, agent error rate, p95 latency, and auth failures. Page on the first
  three; digest the rest.
- A public status page with incident history. Cheap, and it converts the worst
  support moment into a credibility moment.
- A published support model you can actually meet: business-hours response with a
  named Saturday-morning window during season. Under-promise in writing.
- Every incident produces a written postmortem in `docs/incidents/`. Clubs that
  churned from an incumbent over support will read these and stay.

**Do not sell an SLA you cannot staff.** This is the most common way an early
vertical SaaS loses its first reference customer.

---

## 18.4 Security posture

Two open items from the deployment work, both of which a buyer's questions will
reach:

1. **The implant incident.** Credentials were rotated and both repos cleaned, but
   the exposure window on the development machine was never reconstructed. Close
   it: either a clean OS reinstall with fresh keys, or a documented forensic
   review. An unresolved compromise on the machine that holds production
   credentials is not a background risk when you are asking clubs to hand over
   minors' data.
2. **Supply chain.** Keep the `scripts/no-implant-check.mjs` tripwire, add signed
   commits, pin and lockfile-audit dependencies, and enable branch protection
   requiring CI on `main`.

Then: annual third-party penetration test, a written security overview page, and
SSO readiness for the association-scale sale. Not v1, but the page is cheap and
gets asked for early.

---

## 18.5 The commercial wrapper

Nothing here is optional before the first paid org.

- **Terms of service** and **privacy policy**, COPPA-aware, naming subprocessors
  (Supabase, Stripe, Resend, the SMS provider, Anthropic).
- **Data Processing Agreement** available on request. Larger clubs and any
  association will ask.
- **Insurance:** E&O/professional liability and cyber. A club's board will ask for
  a certificate before signing. Quote it now; the premium is a real input to
  pricing.
- **Subprocessor list** published and versioned. Include the model provider
  explicitly — hiding it invites a worse conversation later.
- **Refund and cancellation terms** that are better than the incumbents'
  auto-renewing annual commitments, and say so.

---

## 18.6 Pricing implementation

Shape agreed: base fee + per-athlete + payment margin.

> **Amended 2026-09-16 (owner ruling b).** Do **not** build `org_subscription`.
> A second billing table duplicating `plan_entitlements` is how reconciliation
> drift starts, and there is nothing to bill yet. The per-athlete and margin
> components are two **nullable columns on `plan_entitlements`**, unused at
> launch (migration `20260915_001063`):
>
> ```sql
> alter table public.plan_entitlements
>   add column if not exists per_athlete_minor integer,    -- billed at registration, on a counted date
>   add column if not exists payment_margin_bps int;        -- basis points on processed volume
> ```
>
> `billed_athlete_count`, `billing_anchor`, `parent_pays_fees` and
> `contract_end` are per-org facts and belong on `billing_subscriptions`
> (which already keys on `provider_id`) when billing on them begins — not
> before. The original table sketch is kept below for lineage only.

```sql
-- LINEAGE ONLY — superseded 2026-09-16, do not build
create table if not exists public.org_subscription (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique,
  base_minor int not null,                 -- annual base
  per_athlete_minor int not null,
  payment_margin_bps int not null,         -- basis points on processed volume
  billed_athlete_count int not null default 0,
  billing_anchor date not null,
  parent_pays_fees boolean not null default true,
  contract_end date,
  created_at timestamptz not null default now()
);
```

**Implementation notes**
- Bill the annual base and per-athlete at **registration**, when the club has cash.
  Clubs are illiquid in the off-season; a January invoice to a club with no
  registrations open is a churn event.
- `parent_pays_fees` is the important switch. Most clubs pass processing to the
  family at checkout, which makes the take rate invisible to the buyer. Build both
  paths and default to parent-paid.
- Count athletes on a defined date, not continuously, so a director can predict the
  bill.
- **SMS is a COGS line.** Assume 12–20 messages per athlete per season and carry it
  into the per-athlete figure. Discovering this at 200 orgs is a margin problem
  that is hard to unwind after the price is set.

**DoD:** `tests/billing/invoice-shape.spec.ts` — asserts an org with 412 athletes
and $340k processed volume produces the expected invoice under both fee-payer
settings.

---

## 18.7 What is deliberately not built

Stated so it is a decision rather than a gap found in an audit:

- Native mobile apps (spec 11)
- Website builder (spec 14.6)
- Photo and video sharing, team chat, parent community (spec 13.8)
- League bracket and tournament management
- Official and referee assignment
- Merchandise, uniforms, fundraising
- Sanctioning-body API integration in v1 (spec 16.6)

Each fails the cut rule or exceeds the window. Each will be asked about in sales
calls. Have the answer ready, which is that they are not built and why, rather than
implying a roadmap you have not committed to.
