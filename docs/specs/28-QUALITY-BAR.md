# 28 — THE QUALITY BAR

How we prove Sporv is excellent, not merely working. This document is the
standard every other spec is measured against.

**The distinction it enforces:** "the tests pass" and "this is good software"
are different claims. Most of what follows exists because the first has already
been true at moments when the second was not.

---

## 28.1 Why this document exists

Every defect this product has shipped shared one shape: **something rendered a
claim the system could not back.**

- The verified badge rendered for providers with zero checks run
- The safety gate cleared an entire org from one cleared director
- The Queue rendered four fabricated drafts with live Approve buttons that
  toasted success against rows that did not exist
- A write path reported success while changing nothing
- An anon-surface guard reported "no anonymous read path" while an org was
  readable

None of these were caught by "does it work." All of them would have been caught
by "prove it."

The bar is therefore not *does the feature function*. It is **can every claim
the software makes be traced to a row, and does the system fail loudly when it
cannot.**

---

## 28.2 The five laws

Every feature, every PR, without exception.

### Law 1 — Nothing renders that the server cannot back
Every number, badge, status, name, and count traces to a row returned by that
component's own query. No literals. No placeholders. No sample data. No fallback
values. No "reasonable default" standing in for an absent row.

*Test:* an empty org renders every surface in its empty state and produces zero
fabricated values in the DOM.

### Law 2 — Permission is proven by zero rows, not by a hidden element
Scoping happens in RLS. A component that filters for permission is a component
whose permission can be bypassed. The correct evidence that a coach cannot see
money is that the query returns nothing.

*Test:* every (role × table × operation) cell asserted, denials as zero rows
rather than thrown errors.

### Law 3 — Every write returns a receipt
A write that reports success without proof that a row changed is a CI failure.
Every write path declares precondition, effect, inverse, and receipt.

*Test:* a mocked zero-row write throws.

### Law 4 — Failure is loud, local, and legible
One failure never takes down a page. Every error state says what happened and
what to do. No generic failures. No silent degradation. Nothing swallowed.

*Test:* inject a failure into each dependency in turn and assert the page still
renders with a specific, actionable message.

### Law 5 — The product works with the agent off
A model outage degrades Sporv to a manual tool that still runs a season.
Schedule, roster, attendance, registration, and payment all function with the
agent entirely unavailable.

*Test:* provider mocked to fail; every core flow completes.

---

## 28.3 Definition of done

A feature is done when **all** of these hold. Not most.

- [ ] Every DoD test file named in its spec exists at that path and is green
- [ ] The test suite went RED before the change and GREEN after — demonstrated,
      not asserted
- [ ] Permission proven by zero rows for every role that should not see it
- [ ] Empty state written and shown, naming what the surface watches
- [ ] Error state written and shown, saying what to do
- [ ] Every write has a receipt
- [ ] Works on a real phone, fullscreen, not a squeezed desktop layout
- [ ] Inside the performance budget, and adding it did not add a round trip
- [ ] Nothing left in scratch, no stubs, no mocks standing in for real
      dependencies
- [ ] Migration applied live and verified, repo and production reconciled
- [ ] External review actually happened, or its absence is stated in the report

That last line is not decoration. CodeRabbit has now been rate-limited across
six PRs in two sessions. Unreviewed code merged on CI alone is a fact the report
must carry every time until it stops being true.

---

## 28.4 Excellence beyond correctness

Correct software that nobody can use is not excellent. These are the standards
that separate the two, and each has a check.

### Legibility
A director who has never seen Sporv opens their home screen and, unaided, names
what needs their attention today.

*Check:* three real people, one from each customer shape in doc 20.2. If they
cannot, the defaults are wrong — fix the defaults, not the test.

### Speed where it is felt
FCP under 1.5s on a mid-tier Android over 4G. Schedule interactive under 2.5s at
500 athletes and 400 events. No view exceeding 4 round trips on load.

Saturday 07:00–13:00 carries roughly 40x weekday load. Design for the peak, not
the average.

*Check:* CI budget test against a seeded org; regressions fail the build.

### Forgiveness
Every destructive action is reversible or confirmed. Progress persists across a
closed tab. Offline writes queue and sync with a visible indicator. A user is
never trapped on a screen.

*Check:* abandon every multi-step flow midway and resume; nothing is lost.

### Honesty in absence
An empty state says what the surface is watching. A disconnected integration
says so and offers the fix. A blank panel reads as broken and erodes trust in
everything next to it.

*Check:* every surface on an empty org shows its declared string.

### Consistency
The shell, navigation, and agent rail never move. Two surfaces showing the same
data never disagree — the audit found two approval inboxes contradicting each
other, and that must not recur.

*Check:* a test asserting the home block and the agent rail read the same rows.

### Restraint
No feature that fails the cut rule in 00-MASTER §0.1. No setting that could have
been derived. No question asked twice. Every added element earns its place.

---

## 28.5 Verification hierarchy

Ordered by how much they prove. Each layer is necessary and none is sufficient
alone.

**Level 1 — unit and integration.** The code does what the spec says. Proves
nothing about whether the spec was right.

**Level 2 — permission and integrity.** RLS matrix, cross-tenant isolation, the
no-fabrication suite, the write registry. This is the layer that catches the
defect class in 28.1.

**Level 3 — connector integration against real accounts.** Gmail, Stripe,
Places, Calendar, each with a test account and a test that fails loudly when a
token expires or a scope changes. **This is the layer that breaks silently in
production**, because nothing in CI notices an expired credential.

**Level 4 — agent evaluation.** The golden set, scored on draft acceptance.
Ship gate ≥85%, false-finding rate below 5%. A director who dismisses most
findings stops reading the rail, and an unread rail is the whole product dead.

**Level 5 — shadow mode.** The agent on the reference customer's real inbox,
observe-only, two weeks, drafting everything and sending nothing. You and the
coach read every draft together.

**Level 5 is the only one that proves the product works**, because it is the
only one where a real person with a real org judges real output. Everything
above it is necessary and insufficient.

**Level 6 — a season.** One org, four consecutive weeks, founder never touches
the database. That is launch, and 28 days is 28 days.

---

## 28.6 What we refuse to ship

- A badge, status, or count with no backing row
- A permission enforced only in the UI
- A write with no receipt
- A generic error
- A blank panel where an empty state belongs
- A flow a user can be trapped in, except the two declared hard blocks
- Demo, seed, or sample data reachable by a real signup
- An agent that sends, charges, or publishes without a human click
- A stub or mock standing in for a real dependency on main
- A migration applied live but absent from the repo
- A PR missing the test files its spec names

---

## 28.7 The honesty clause

Reports state what was **not** done as prominently as what was.

- Unreviewed merges say so
- Todo clauses name their blocking dependency
- Self-caught mistakes are reported, not quietly fixed
- Unverified claims are labelled unverified
- A test that was weakened to pass is a finding, not a fix

The audit that named its own three defects and corrected three sub-auditor
claims before publishing is the standard. An agent that reports its own errors
is worth more than one that appears never to make any, because only one of those
is real.

---

## 28.8 The single question

Before any PR merges:

> **If a real club ran a real season on this tomorrow, what would it get wrong,
> and would anyone notice?**

If the answer to the second half is no, that is the finding. Silent wrongness is
the failure mode this entire document exists to prevent.
