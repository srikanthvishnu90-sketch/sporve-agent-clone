# 14 — REGISTRATION AND PROGRAMS

**Gate:** blocks G8, G9, G10.
**Current state:** `programs`, `program_fixtures`, `program_waitlist`,
`obligations`, `installments`, `fee_schedules` exist. `registration` = **0
matches**, `discount` = **0 matches** across all 50 migrations.

Registration is the purchase moment. It is the reason a director signs, the moment
money enters, and the moment every downstream record is created. It is currently
the least-specified part of the system.

---

## 14.1 Why this outranks parity features

A club does not switch platforms to get better rosters. It switches in the window
before registration opens, because registration is the one thing that must work.
If registration is weak, nothing else is evaluated.

---

## 14.2 Schema

```sql
-- 2026MMDD_00NNNN_registration_form.sql
create table if not exists public.registration_form (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  program_id      uuid not null references public.programs(id) on delete cascade,
  title           text not null,
  status          text not null default 'draft'
                    check (status in ('draft','open','waitlist','closed')),
  opens_at        timestamptz,
  closes_at       timestamptz,
  capacity        int,
  age_min_birthdate date,             -- eligibility by birth window, not "age"
  age_max_birthdate date,
  requires_waiver_ids uuid[] not null default '{}',
  requires_consents  text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.registration_field (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.registration_form(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null check (type in ('text','number','select','multiselect','date','file','boolean','phone','email')),
  options jsonb,
  required boolean not null default false,
  sensitive boolean not null default false,   -- medical, allergies: encrypted, restricted
  position int not null,
  unique (form_id, key)
);

create table if not exists public.registration (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  form_id         uuid not null references public.registration_form(id),
  athlete_id      uuid not null references public.athletes(id),
  guardian_id     uuid not null references public.guardians(id),
  status          text not null default 'started'
                    check (status in ('started','submitted','waitlisted','accepted','withdrawn','declined')),
  answers         jsonb not null default '{}',
  submitted_at    timestamptz,
  decided_at      timestamptz,
  decided_by      uuid,
  obligation_id   uuid references public.obligations(id),
  created_at      timestamptz not null default now(),
  unique (form_id, athlete_id)
);
```

**Sensitive fields.** Any field marked `sensitive` (allergies, medications,
conditions) is encrypted at rest, excluded from exports by default, excluded from
agent context windows, and visible only to `registrar`, `director`, and the
athlete's own coaches. Never behind a magic-link URL without a fresh token.

---

## 14.3 Pricing, discounts, and aid

```sql
create table if not exists public.discount_rule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  form_id uuid references public.registration_form(id) on delete cascade,
  kind text not null check (kind in ('early_bird','sibling','code','multi_program','custom')),
  code text,                                  -- for kind='code'
  amount_minor int,                           -- fixed
  percent numeric(5,2),                       -- or percentage
  applies_from timestamptz,
  applies_until timestamptz,
  max_redemptions int,
  redemptions int not null default 0,
  stackable boolean not null default false,
  constraint one_amount check (num_nonnulls(amount_minor, percent) = 1)
);

create table if not exists public.financial_aid_request (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  registration_id uuid not null references public.registration(id) on delete cascade,
  requested_minor int,
  status text not null default 'requested'
    check (status in ('requested','approved','partial','denied')),
  approved_minor int,
  decided_by uuid,
  decided_at timestamptz,
  private_note text
);
```

**Sibling discount** is computed across registrations sharing a `guardian_id`
within a season, applied at checkout, and recomputed if a sibling withdraws.

**Financial aid is a first-class object, not a manual invoice edit.** Club-fee
affordability is the loudest controversy in youth sports and the thing directors
are personally uncomfortable handling. Making aid private, dignified, and one
click is a differentiator the incumbents handle badly. Aid decisions are visible
only to `treasurer` and `owner`, never to coaches.

**Discount stacking** resolves deterministically: percentage discounts apply
before fixed, non-stackable rules take the single largest, and the applied set is
written onto the obligation so a treasurer can see why a family owes what they owe.

**DoD:** `tests/registration/pricing-matrix.spec.ts` — a table-driven test over
early-bird × sibling × code × aid, asserting the obligation amount and the stored
explanation for each cell.

---

## 14.4 Waitlist and capacity

`program_waitlist` exists. Extend to:
- Automatic move to `waitlist` when `capacity` is reached, with position
- Offer flow: an offer is a **time-boxed, single-use `pay` token** (default 48h)
- Expiry cascades to the next position automatically
- Capacity release on withdrawal triggers the next offer

**DoD:** `tests/registration/waitlist-cascade.spec.ts` — fill capacity, withdraw
one, assert the next family receives a 48h offer and that expiry advances the
queue exactly once.

---

## 14.5 Tryouts

Distinct from registration and required for any competitive club.

A tryout is a `registration_form` with `kind = 'tryout'`, a fee, and an evaluation
step. Evaluations are private to `director` and evaluators, are never exposed to
guardians, and placement produces a team assignment plus a second registration for
the placed program. Non-placement produces a templated message the director
approves — the agent drafts it, the human sends it, as always.

---

## 14.6 The public front door

A club's registration links and website currently live inside the incumbent.
Leaving means rebuilding their web presence mid-season, which is a real blocker.

v1 scope, deliberately minimal:
- A hosted public page per org at `sporv.ai/o/{slug}` listing open programs with
  registration links
- Embeddable button snippet so a club can keep its existing website
- Custom domain CNAME support

**Not in v1:** a website builder. It fails the cut rule. The embed plus hosted
page removes the blocker at a fraction of the cost.

---

## 14.7 Acceptance

A director builds a registration form with three custom fields, an early-bird
price, a sibling discount, a capacity of 30, and a required waiver, publishes it,
and 30 families complete registration and payment from a phone with no account.
The 31st is waitlisted and receives an offer when one withdraws. The obligations
ledger reconciles to zero drift against Stripe.
