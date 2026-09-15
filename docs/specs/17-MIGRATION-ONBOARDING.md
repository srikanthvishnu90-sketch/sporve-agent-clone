# 17 — MIGRATION AND ONBOARDING

**Gate:** G10. This is the distribution gate.
**Current state:** `import_batches`, `import_batch_uniqueness`,
`club-site-extract`, `setup-interview`, `coach_invites`,
`invite_creates_guardian` exist. No importer targets a named competitor export.

---

## 17.1 Why this is the distribution gate

Orgs do not leave an incumbent because a competitor has more features. They leave
when someone moves their roster, schedule, and payment history for them, and the
volunteer doing it does not lose a weekend.

Migration is therefore not a service you offer after the sale. It is the product
demo, the objection handler, and the reason the deal closes in one meeting.

**Target: 60 minutes of staff time from signup to a fully loaded org.**
**Stretch target, and the one that actually wins deals: 15 minutes.**

---

## 17.2 Sources, in priority order

1. **TeamSnap** — CSV roster export, schedule export, member list
2. **Sports Connect** — the forced-migration pool ahead of the 2027 sunset; the
   largest concentration of in-market buyers that will exist for years
3. **SportsEngine** — CSV exports
4. **Google Sheets** — the real incumbent for a large share of small orgs
5. **A club's public website** — `club-site-extract` already exists; use it to
   pre-fill programs and team names before the director uploads anything

---

## 17.3 The importer

```sql
-- extend import_batches
alter table public.import_batches
  add column if not exists source text
    check (source in ('teamsnap','sports_connect','sportsengine','sheets','csv_generic','website')),
  add column if not exists mapping jsonb,
  add column if not exists stats jsonb;

create table if not exists public.import_row (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  organization_id uuid not null,
  raw jsonb not null,
  target text not null check (target in ('athlete','guardian','team','event','obligation')),
  resolved_id uuid,
  state text not null default 'pending'
    check (state in ('pending','mapped','conflict','imported','quarantined','skipped')),
  problem text
);
```

**Pipeline**
1. **Upload** — drag a file or connect a source. Accept messy exports; do not
   demand a template.
2. **Detect** — fingerprint the header row and auto-select a known mapping. A
   recognised TeamSnap export requires zero mapping clicks.
3. **Map** — show the mapping, let the director correct it. Remember corrections
   per org.
4. **Dry run** — every row resolved to an object, with conflicts and problems
   listed **before** anything is written. The director sees "312 athletes, 287
   guardians, 41 phone numbers unusable, 3 duplicate athletes" and decides.
5. **Commit** — transactional per target type, idempotent by
   `(batch_id, source_row_hash)`. Re-running an import creates zero duplicates.
6. **Reconcile** — outstanding balances imported as `obligations` with a
   `source = 'migrated'` marker so the ledger distinguishes historical debt from
   Sporv-originated charges.

**Never silently drop a row.** Every unimported row is quarantined, counted, and
shown. A silently dropped athlete is a child who does not appear on a roster.

**DoD:** `tests/migration/teamsnap-import.spec.ts` against a real anonymised
export; asserts idempotency on re-run, a non-zero quarantine count on a
deliberately corrupted fixture, and a wall-clock measurement recorded in CI.

---

## 17.4 Phone and email validation at import

Consequence of the zero-install parent channel: if imported contact data is bad,
launch day is silent and the club blames you.

- Every phone normalised to E.164 and checked for line type. Landlines cannot
  receive SMS and must be flagged.
- Every email syntax-checked and domain-verified.
- **The director sees the failure rate before go-live**, with a one-click "request
  updated contact details" campaign for the broken set.
- All imported numbers enter `sms_consent` as `pending` per spec 13.4.

---

## 17.5 Onboarding sequence

Fifteen minutes, in this order, because each step unblocks the next:

1. Create org, set timezone, set sport
2. Import roster (17.3)
3. Connect email (spec 15.4) — the agent starts observing immediately
4. Connect Stripe (KYC starts now; it takes days, so start it first)
5. Import or build the schedule
6. Upload waiver templates
7. Invite staff and assign roles
8. Publish and send the first parent message

The agent should be visibly working by step 3. A director who sees real findings
about their own org before they have finished setup is a director who has already
decided.

**DoD:** `tests/onboarding/cold-start.spec.ts` — a scripted run from empty account
to first parent message, measured, under 15 minutes of interaction time.

---

## 17.6 The parallel-season offer

The commercial mechanism that removes the remaining risk:

> Run Sporv alongside your current platform for one season, free. If Sporv is not
> running your org by the end of it, walk away and take a full export.

This concedes nothing on the system-of-record goal. It removes the switching-cost
objection at the moment it is raised, and it puts real orgs in the product during
the exact window the readiness gates need them.

Pair it with contract buyout for annual-commitment incumbents: paying out the
remainder of a club's term is a few hundred dollars against a decade-long account.

---

## 17.7 Export, and saying so

Publish a one-click full export: roster, guardians, schedule, obligations, ledger,
documents, in open formats. Say it on the pricing page.

The clubs you are selling to were locked in by an incumbent and remember it.
Promising they can leave is a closing argument, and it costs you nothing you should
want to keep.

**DoD:** `tests/export/full-org.spec.ts` — asserts every table with
`organization_id` appears in the export and that the export re-imports cleanly into
a fresh org.

---

## 17.8 Acceptance for G10

A real club's roster, schedule, and outstanding balances move from a TeamSnap or
Sports Connect export into a working Sporv org in under 60 minutes of staff time,
timed with a stopwatch, with zero rows silently dropped and a re-run producing zero
duplicates.
