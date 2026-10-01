# GATES.md — the only definition of progress

This file exists because this repository is capable of producing an enormous
amount of high-quality work that does not move the business. 361 commits in 26
days, six branches to choose a typeface, a fifteen-agent analytical council, and
an 87-feature audit — all real, all careful, none of it on the critical path.

**Ten gates, ordered. Nothing else counts as progress.** Every agent, every
session, and the scheduled watcher grade against this list and nothing else.

> **Canonical, 2026-09-15 (owner ruling R2).** This file is the *only* place gate
> numbers are defined. CONTEXT.md, CLAUDE.md, AGENTS.md and every spec point here
> by name and carry no numbering of their own. The previous four-gate ladder
> (G1 SCHEMA / G2 MONEY / G3 SUPPLY / G4 GUARDS) is superseded by the v2 ladder
> below; the mapping is recorded at the foot of this file.

Work below an open gate is off the critical path and must say so in its PR
description.

---

## G1 — SCHEMA RECONSTRUCTABLE

A clean clone stands up an equivalent database. The ledger matches the repo; no
hand-applied production object is missing.

An agentic platform is a program that writes to a schema. Autonomy over a schema
that exists only inside a running instance is not a product, it is an outage
waiting for a trigger. Every gate below depends on this.

**Evidence:** a fresh project built from supabase/migrations/ passes the smoke
suite.

## G2 — TRUST INTEGRITY

Every claim the UI makes renders from verified server state.

**Evidence:** a claim register in which every row cites the column it reads.

## G3 — MONEY MOVES LIVE

One live acct_, one live ch_, one live re_, one decline, and a ledger reconciled
to zero drift. A webhook that answers 200 for a payment it did not apply is a
**gate failure**, not a bug near one.

Every screen in this repo is downstream of a transaction that cannot yet occur.
Until one real dollar moves, the product is a very well-built description of a
business. (Test-mode cleared 2026-08-31: booking 9afca6d5, evt_1UAa8E4…, $50 on
a connected account. The live half remains.)

**Evidence:** the Stripe dashboard plus a reconciliation query returning zero
rows.

## G4 — MINORS' DATA

RLS proof, guardian consent, an enforceable waiver signature, export and
deletion.

**Evidence:** a cross-tenant read suite that fails closed — denials assert zero
rows, not errors.

## G5 — A MESSAGE REACHES A HUMAN

One delivered email with a provider message id, mail-tester >= 9, a proven bounce
path, and one delivered SMS with a delivery receipt.

**Evidence:** provider ids and a delivery_events row per channel.

## G6 — WRITES ARE SAFE

Every agent write path declares a precondition, an inverse, and a receipt. A
silent no-op write fails loudly.

This is a gate rather than a later phase because create_note once shipped as a
silent no-op in the production client: no dispatcher case, so an approved note
wrote nothing and reported success, and nobody noticed for weeks. An agentic
platform's risk is not that the model is wrong. It is that the system reports
success while doing nothing, and no human is watching because the whole promise
was that no human has to.

**Evidence:** the write registry is complete and CI enforces it.

## G7 — THE SCHEDULE EXISTS

Recurring events, availability, attendance, conflicts, cancellation, ICS.

**Evidence:** the spec 12 acceptance suite is green.

## G8 — A PARENT SUCCEEDS WITH ZERO INSTALLS

A parent who has never heard of Sporv completes registration, payment, waiver
and an RSVP on a phone, with no app and no account.

**Evidence:** a timed, recorded run with a real stranger.

## G9 — THE LOOP RUNS  *(launch)*

One real org, four consecutive weeks: schedule published, availability
collected, attendance taken, reminders delivered, dues collected — and the
founder does not touch the database.

**Evidence:** a four-week activity export.

## G10 — MIGRATION UNDER AN HOUR  *(distribution)*

Roster, schedule and outstanding balances move from TeamSnap, SportsEngine or
Sports Connect in under 60 minutes of staff time.

**Evidence:** a timed run against a real export. **Not a launch gate** (ruling
R4): the first ten migrations are performed by hand, and what they teach is the
specification for the importer.

---

## What happened to the old ladder

| old | v2 |
|---|---|
| G1 SCHEMA | G1 SCHEMA RECONSTRUCTABLE — unchanged in substance |
| G2 MONEY | G3 MONEY MOVES LIVE |
| G3 SUPPLY | **deleted** |
| G4 GUARDS | G6 WRITES ARE SAFE |

**Why G3 SUPPLY was deleted.** It asked for "a real coach has signed and is
listed" — a *marketplace* gate. It measured catalogue liquidity: sample data
behind catalogueIsLive(), disclaimers to delete, coaches to recruit onto a
two-sided network. The product pivoted to B2B club operations, where the buyer
is an organisation that arrives with its own coaches and its own roster. There
is no supply side to fill. The demand it really tested — *does a real
organisation run on this?* — is now G9, which is strictly harder: not one signed
coach, but one org whose whole week runs here for a month. Keeping SUPPLY would
have meant grading against a business we no longer operate.

## Rules for every agent working in this repo

1. Before proposing work, name which gate it advances. If none, say so and say
   it anyway — sometimes the answer is "this is cosmetic and that is fine."
   What is not fine is presenting it as progress.
2. Never describe a partially-exercised gate as passing. smoke.sh runs 6 of 25
   checks without a browser. Six PASS lines and a stop is not health.
3. Volume is not progress. A window with 40 commits and no gate movement gets
   reported as NOTHING MOVED.
4. Do not add a new AI tool until G6 has a mechanism. More surface area on an
   unverified write path increases the blast radius of exactly the bug that
   already happened once.
5. Gate numbers live here and nowhere else. A spec or doc that wants to cite a
   gate cites it by number *from this file*.
