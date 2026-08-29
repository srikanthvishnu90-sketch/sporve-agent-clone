# GATES.md — the only definition of progress

This file exists because this repository is capable of producing an enormous
amount of high-quality work that does not move the business. 361 commits in 26
days, six branches to choose a typeface, a fifteen-agent analytical council, and
an 87-feature audit — all real, all careful, none of it on the critical path.

Four gates. Nothing else counts as progress. Every agent, every session, and the
scheduled watcher grade against this list and nothing else.

---

## G1 — SCHEMA: production is reconstructable from a repo

**Status: FALSE.** `supabase/migrations/` contains zero files.

`SUPABASE-OWNERSHIP.md` documents the real position: 17 entries in
`supabase_migrations.schema_migrations`, 73 migration files in the app repo of
which **zero** appear in the ledger, 8 in landing. Most of production was applied
by hand in the SQL editor. Neither repo describes production and the delta
cannot be computed by any tool.

**Why it is first.** An agentic platform is a program that writes to a schema.
Autonomy over a schema that exists only inside a running instance is not a
product, it is an outage waiting for a trigger. Every gate below depends on this.

**Done looks like:** `supabase db dump --schema public` committed as a single
baseline migration, the ledger repaired to match, one repo declared owner in
`SUPABASE-OWNERSHIP.md`, and a clean clone able to stand up an equivalent
database.

---

## G2 — MONEY: one real coach is paid by one real parent

**Status: FALSE.** `src/mod-coachaccount.js` records it: of 23 approved
providers, **zero** have `stripe_charges_enabled`, so `stripe-create-checkout`
correctly refuses every booking.

The Connect onboarding call exists. The checkout call exists. No provider has
completed onboarding, so the marketplace has never transacted.

**Why it matters more than any feature.** Every screen in this repo is
downstream of a transaction that cannot occur. Until one dollar moves, the
product is a very well-built description of a business.

**Done looks like:** one provider with `stripe_charges_enabled = true`, one
completed booking, one payout, and a screenshot of the Stripe dashboard.

---

## G3 — SUPPLY: a real coach has signed and is listed

**Status: FALSE.** The catalogue is sample data behind `catalogueIsLive()`.

Credit where it is due: the gate exists and the sample data is labelled. That is
more honesty than most pre-launch products manage. But the label sits next to
eleven instances of "Real verified coaches are onboarding now", and with zero
stripe-enabled providers, *onboarding* is carrying weight it has not earned.

**Done looks like:** `catalogueIsLive()` returns true because real rows exist,
and every sample-data disclaimer has been deleted rather than reworded.

---

## G4 — GUARDS: every write has a precondition, an inverse, and a receipt

**Status: FALSE.** No inverse or receipt exists in the AI surface.

`api/ai.js` is a single-turn intent classifier: seven actions, Haiku 4.5, no
tool loop, and its own header states the model never executes anything. That is
a defensible Tier 0 and the approval plumbing behind it is real.

The reason this is a gate rather than a later phase: `create_note` once shipped
as a **silent no-op in the production client**. No dispatcher case, so an
approved note wrote nothing and reported success. Nobody noticed for weeks.

An agentic platform's risk is not that the model is wrong. It is that the system
reports success while doing nothing, and no human is watching because the whole
promise was that no human has to. Preconditions, inverses, and receipts are the
only detector. They come before more tools, not after.

**Done looks like:** every write path declares what must be true before it runs,
how to reverse it, and where its receipt is written — and a test asserts a write
that silently no-ops fails loudly.

---

## Rules for every agent working in this repo

1. Before proposing work, name which gate it advances. If none, say so and say
   it anyway — sometimes the answer is "this is cosmetic and that is fine."
   What is not fine is presenting it as progress.
2. Never describe a partially-exercised gate as passing. `smoke.sh` runs 6 of 25
   checks without a browser. Six PASS lines and a stop is not health.
3. Volume is not progress. A window with 40 commits and no gate movement gets
   reported as NOTHING MOVED.
4. Do not add a new AI tool until G4 has a mechanism. More surface area on an
   unverified write path increases the blast radius of exactly the bug that
   already happened once.
