# 13 — PARENT SURFACE, ZERO INSTALL

**Gate:** G8. Blocks G9 and every sales conversation.
**Current state:** `guardians`, `guardian_links`, `outbound_messages`,
`delivery_events`, `email_suppressions`, `unsubscribe` function exist.
`magic_link` = 0 matches, `twilio` = 0 matches, `sms` = 3 incidental matches.
No message has ever been delivered.

---

## 13.1 The thesis

The largest single objection to replacing an incumbent is: *"I would have to make
300 families download something new."*

If the answer is that families download nothing and never create an account, that
objection disappears. TeamSnap structurally cannot match this, because their
parent app is the asset they are defending. This is a wedge, not a compromise —
sell it on the first slide.

**Rule: a guardian never installs an app and never sets a password.**

---

## 13.2 The four channels

| Job | Channel |
|---|---|
| Know when practice is | ICS subscription in their existing calendar (spec 12.5) |
| Urgent change | SMS |
| Registration, waivers, receipts, digests | Email |
| Do anything | Magic-link mobile web page |

That is the entire parent experience.

---

## 13.3 Magic links

```sql
-- 2026MMDD_00NNNN_guardian_access_token.sql
create table if not exists public.guardian_access_token (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guardian_id     uuid not null references public.guardians(id) on delete cascade,
  token_hash      text not null unique,        -- sha256 of the emitted secret
  scope           text not null check (scope in ('rsvp','pay','waiver','profile','full')),
  subject_id      uuid,                        -- event/obligation/document when scoped
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  single_use      boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on public.guardian_access_token (guardian_id, expires_at);
```

**Rules**
- Only the hash is stored. The secret exists once, in the outbound message.
- Default TTL **7 days**; `pay` and `waiver` scopes are **single use, 72 hours**.
- Scope is narrow by default. An RSVP link opens the RSVP for one event, not the
  family's whole record.
- Tokens are revoked wholesale when a guardian is removed from the org, and
  rotated when a phone number or email changes.
- **Never place medical information, emergency contacts, or another family's data
  behind a long-lived token.** Links get forwarded into group chats. Assume it.
- Rate-limit token issuance per guardian per hour. `edge_rate_limits` exists; use
  it.

**DoD:** `tests/parent/token-scope.spec.ts` — asserts an `rsvp` token for event A
returns 403 on event B, on the family profile, and after expiry.

---

## 13.4 SMS

The load-bearing channel, and the one with real setup cost.

**Requirements before a single message sends**
- A2P 10DLC brand and campaign registration. Campaign use case: *mixed /
  low-volume mixed*, with sample messages matching actual sends. Registration
  latency is weeks, so start it now regardless of gate order.
- Opt-in provenance recorded per guardian: who consented, when, how, and the exact
  language shown. This is a legal record, not a preference flag.
- STOP / HELP / START handled by the provider **and** mirrored into
  `email_suppressions`' SMS equivalent so the agent cannot re-enqueue.
- Quiet hours enforced server-side in the recipient's timezone: no non-urgent SMS
  before 8am or after 9pm local. Cancellations override; nothing else does.

```sql
create table if not exists public.sms_consent (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guardian_id uuid not null,
  phone_e164 text not null,
  state text not null check (state in ('pending','opted_in','opted_out')),
  consent_source text not null,        -- 'registration_form','import_attested','reply_start'
  consent_text text,                   -- exact language displayed
  consented_at timestamptz,
  opted_out_at timestamptz,
  unique (organization_id, guardian_id, phone_e164)
);
```

**Imported numbers are `pending`, never `opted_in`.** A club's TeamSnap export
does not carry consent that transfers to you. First contact on an imported number
is a single opt-in request; silence means that guardian is email-only. This will
feel like it weakens day one. Sending anyway is the thing that gets your number
range blocked and takes every client down with it.

**Cost.** Per-message pricing becomes a visible COGS line at a few hundred orgs.
Model it now: assume 12–20 SMS per athlete per season. Price it into spec 18's
model rather than discovering it at scale.

**DoD:** `tests/messaging/sms-compliance.spec.ts` — asserts pending numbers are
never sent to, STOP suppresses within one message, quiet hours hold, and
cancellations bypass quiet hours.

---

## 13.5 Email

`outbound_messages` and `delivery_events` exist; Resend is wired with valid SPF
and DKIM. Remaining:

- DMARC currently `p=none` for first-send measurement. Ratchet to `p=quarantine`
  once a week of clean aggregate reports is in hand. Record the date.
- Per-org sending identity with a verified subdomain, so one client's complaint
  rate cannot poison another's.
- Bounce and complaint webhooks writing to `email_suppressions`, with hard bounces
  suppressing permanently and the agent blocked from re-enqueuing.
- Every outbound carries a `List-Unsubscribe` header and a working footer link,
  except transactional receipts and safety notices.

**DoD:** `tests/messaging/email-delivery.spec.ts` — a delivered message id, a
forced bounce producing a suppression row, and a suppressed address rejected at
enqueue rather than at send.

---

## 13.6 Payment without an account

- Hosted Stripe Checkout from a `pay`-scoped magic link. Apple Pay and Google Pay
  enabled — a parent completing dues in two taps at a red light is the benchmark.
- Card stored by token against the guardian for installments. No account, no
  password.
- Installments already exist in `installments`; the parent-facing view shows the
  schedule, the next charge date, and a single "update card" link.
- Failure path: a declined installment produces a retry ladder (day 1, 3, 7), a
  parent-facing link, and an `agent_findings` row for the treasurer. Never a
  silent failure.

**DoD:** `tests/parent/checkout-no-account.spec.ts` — completes a real test-mode
charge from a magic link with no session and no signup, and asserts the ledger row.

---

## 13.7 The registration page

The only parent page with real surface area. Mobile web, fullscreen, no frame.

One flow, one scroll: athlete details → guardian details → consents and waiver
e-signature → program selection → payment. Progress saved per step against the
token so a parent can finish later on the same link.

Target: **under four minutes**, measured, on a mid-tier Android over 4G.

---

## 13.8 Known costs of this approach

State them in sales conversations rather than being caught by them.

- No push notification to parents. SMS substitutes and costs money.
- No photo sharing, no team chat, no parent-to-parent community. By the cut rule
  none of these remove work from a coach's week, but a few directors will ask.
- Inbound replies increase. Parents will answer texts and emails with questions.
  Spec 15.6 owns this and it is not optional.
- Phone number quality is a single point of failure. A stale import means a silent
  launch day. Validate every number at import and report the failure rate to the
  director before go-live.

---

## 13.9 Acceptance for G8

A person who has never heard of Sporv, using their own phone, with no app
installed and no account created, completes: registration for one athlete, a
waiver signature, a dues payment, and an RSVP to a practice. Timed and recorded.
Under ten minutes total, under four for registration alone.
