# 29 — FUNCTIONALITY VERIFICATION PROTOCOL

**This is a test document, not a build document.** You execute it against the
running application and the live database. You fix what fails. You do not add
features.

Read doc 28 (Quality Bar) first. This is how 28 gets enforced.

---

## 29.1 The standard

Hold this product to the standard of software people pay for and depend on
weekly. Not a demo. Not a prototype. Not "good for a solo founder."

**The operative comparison:** a club director is choosing between Sporv and a
platform with 250 engineers and fifteen years of edge cases already found. They
will not grade on effort. Neither do you.

**Be brutal.** A finding you soften is a defect a customer finds instead. If
something is slow, say slow and give the number. If a flow is confusing, say
confusing and say where. If a feature technically works but nobody would use it
that way, that is a failure, not a pass.

**The bar for every single check below:** would this survive a Saturday morning
with 300 families depending on it?

---

## 29.2 How to run this

1. Against the **deployed application**, not a local dev server. Local hides
   latency, cold starts, and CDN behaviour.
2. Against **real-shaped data**: one org, 200 athletes, 12 teams, 400 events, a
   season of payment history. Seed it in an isolated test org, tear it down
   after. Never in a path a real signup can reach.
3. On a **real phone over cellular**, not desktop Chrome on wifi. Half these
   findings only appear there.
4. **Measure everything.** "Feels slow" is not a finding. "Schedule view: 4.2s
   to interactive, 11 round trips" is.
5. Every failure gets a severity, a reproduction, and a fix. Not a note.

**Severity**
- **P0** — data loss, a safety failure, money wrong, a privacy leak. Stop and
  fix now.
- **P1** — a core job cannot be completed. Blocks launch.
- **P2** — the job completes but badly. Fix before the second customer.
- **P3** — polish. Log it, do not fix it now.

---

## 29.3 PERFORMANCE — measured, not felt

Record actual numbers for every row. A missing number is a failed check.

| Surface | Budget | Measure |
|---|---|---|
| First contentful paint, cold | ≤ 1.5s | Mid-tier Android, 4G |
| Login → home interactive | ≤ 2.0s | Cold session |
| Home with 5 blocks | ≤ 2.5s | 200 athletes |
| Schedule, month view | ≤ 2.5s | 400 events |
| Roster, 200 athletes | ≤ 2.0s | Scrolling at 60fps |
| Money, aged balances | ≤ 2.0s | Full season history |
| Chatbox first token | ≤ 1.5s | — |
| Chatbox full answer | ≤ 6s | — |
| Cancel event → parent delivery | ≤ 15s | Stopwatch, end to end |
| Attendance mark, offline | ≤ 100ms | Local write, no spinner |
| Registration submit → confirmation | ≤ 3s | — |
| Any navigation | ≤ 300ms | Perceived |

**Round trips.** Count them on every view. More than 4 on load is a failure
regardless of total time, because it will collapse under Saturday load.

**The Saturday test.** Youth sports load is roughly 40x weekday between 07:00
and 13:00 local. Simulate 40x concurrent reads on the schedule view. If p95
exceeds 4s, the product does not work on the only morning that matters.

**Cold start.** Every edge function, timed from cold. A 3s cold start on the
cancellation path is a P1, because cancellations are always the first request
after a quiet night.

**Report the worst three numbers first.** Not the best.

---

## 29.4 THE FOUR JOBS — each must complete end to end

A season is made of four jobs. If any cannot be completed start to finish
without you touching the database, the product does not work.

### Job 1 — Get the org in
- Import a roster from a real export. Dry run first.
- Import a deliberately broken file. Every bad row quarantined, counted, shown.
- Re-run the same import. Zero duplicates.
- Import 500 athletes. Time it. Anything over 60s without progress feedback is
  a P1.
- **Fail check:** a silently dropped row is a **P0**. That is a child missing
  from a roster.

### Job 2 — Run the schedule
- Create a recurring series, 10 weeks, two teams.
- Publish it.
- Move one occurrence. Series intact.
- Cancel one occurrence. Approve. Time to parent delivery.
- Double-book a field. Conflict surfaces **on the event**, not in a report.
- Take attendance on a phone, airplane mode, 20 athletes, then reconnect.
- **Fail check:** an attendance write lost on reconnect is a **P0**.

### Job 3 — Collect the money
- Build a registration form with a discount and a capacity.
- Complete it on a phone as a stranger. Time it. Over 4 minutes is a P1.
- Pay. Refund. Reconcile the ledger to zero.
- Force a declined card. Retry ladder fires, treasurer sees it.
- Fill capacity, withdraw one, confirm the waitlist offer.
- **Fail check:** any ledger drift is a **P0**.

### Job 4 — Answer the humans
- Connect a real inbox. Confirm scoping.
- Agent drafts a dues chase, a reply, a cancellation notice.
- Approve one. It arrives at a real address.
- Reply to it. The reply is received and threaded.
- **Fail check:** anything sent without a human click is a **P0**.

---

## 29.5 ADVERSARIAL — try to break it on purpose

This section is where real products separate from demos. Be hostile.

### Data
- Athlete named `O'Brien-Smith`. Then `李明`. Then a 200-character name.
- Emoji in a team name. Emoji in a message.
- An athlete with two guardians at the same email.
- A guardian with an international phone number.
- A birthdate in 1899. A birthdate tomorrow.
- A $0 obligation. A negative one. One of $999,999.
- An event at 2am. An event on 29 February. An event crossing a DST boundary.
- **DST specifically:** a recurring 6pm practice across the November change.
  Does every occurrence stay at 6pm local? This is the most common scheduling
  bug in the entire category.

### Concurrency
- Two staff editing the same event simultaneously.
- Two coaches marking the same athlete's attendance.
- The same import submitted twice, fast.
- A parent paying twice by double-tapping.
- A registration submitted as capacity fills from another device.

### Hostile input
- A magic-link token altered by one character.
- An expired token. A token for a deleted guardian. A foreign org's token.
- `'; DROP TABLE athletes;--` in every text field.
- `<script>alert(1)</script>` in a team name, then view it everywhere it renders.
- A 50MB file into every upload.
- A registration form POSTed directly, bypassing the UI.

### Network
- Kill wifi mid-payment.
- Kill wifi mid-import.
- Kill wifi mid-attendance, reconnect after an hour.
- Throttle to 2G and complete registration.
- Load the app in airplane mode from cold.

### Time
- Leave a session 91 days. Does it fail gracefully?
- An event that started 5 minutes ago — can you still RSVP?
- A waiver template edited after signing.
- A certification expiring at midnight tonight.

**Every one of these is a real thing that will happen.** A crash, a silent
failure, or wrong data on any of them is a finding.

---

## 29.6 PERMISSION — assume someone is trying

- Coach account: attempt to read money data via the API directly, not the UI.
- Coach account: attempt to read another team's roster.
- Org A member: attempt every table against org B's ids.
- Log out, hit every route, confirm nothing returns.
- Take a valid session token, alter the org id, replay it.
- Redeem a staff invite from a different email than invited.
- Take a `pay`-scoped magic link and attempt an RSVP with it.
- Revoke a role mid-session. Does the next request fail closed?

**Every denial must be zero rows, not a thrown error.** An error tells an
attacker the row exists.

**Any leak is a P0 and stops everything.**

---

## 29.7 INTEGRITY — the recurring defect class

Four defects have shipped with the same shape: something rendered a claim the
system could not back. The badge. The org-wide safety gate. The fabricated
Queue with live Approve buttons. The write that returned success while changing
nothing.

Check, on a **completely empty org**:
- Every surface shows a real empty state naming what it watches
- **Zero fabricated values anywhere in the DOM** — no athlete name, no amount,
  no date that did not come from a query
- No button acts on a row that does not exist
- Every badge traces to a backing record
- Two surfaces showing the same data agree exactly

Then with data:
- Every number drills through to its rows
- Change a row in SQL, refresh, the UI reflects it
- Delete a row in SQL, refresh, the UI does not show a stale cache

**A fabricated value is a P0.** Not because it breaks, but because it teaches a
director to trust something that is not true.

---

## 29.8 FAILURE BEHAVIOUR — break each dependency in turn

For each: disconnect it, then use the app.

| Dependency | Expected |
|---|---|
| Model provider | Everything works, agent surfaces say why |
| Stripe | Schedule and roster work, payment says what happened |
| Resend | Drafts queue, UI states delivery is delayed |
| Supabase | Cached schedule still viewable, writes queue or refuse clearly |
| Google Places | Facility search says unavailable, nothing else breaks |
| Connected inbox | Agent says the connection failed, offers reconnect |

**Rules:** one dependency failing never blanks a page. Every error says what
happened and what to do. Nothing is swallowed. Nothing retries forever.

**A generic "something went wrong" anywhere is a P2 minimum.**

---

## 29.9 MOBILE AND FIELD

Real phone, real cellular, outdoors.

- Every staff flow, fullscreen, no squeezed desktop layout
- Attendance on a field with one bar
- Cancel an event in two taps from home
- Registration on a phone, timed
- Add to home screen, close, reopen a day later, still logged in
- Rotate the device mid-flow, nothing lost
- A 320px-wide screen, an older Android, a slow one
- In direct sunlight — is the contrast usable?
- With one hand, walking

**Anything requiring two hands or a table to complete is a P2.** Coaches use
this standing on a sideline.

---

## 29.10 THE HUMAN TESTS — no automation replaces these

**The five-second test.** A director opens home. Within five seconds, unaided,
can they name what needs their attention today? If not, the defaults are wrong.

**The stranger test.** Someone who has never heard of Sporv registers a child,
pays, signs a waiver, and RSVPs — installing nothing, creating no account.
Timed, recorded, unassisted.

**The Saturday test.** Your coach, on a real field, cancels a real session on
their real phone, and a real parent receives it. Watch them do it. Note every
hesitation.

**The abandonment test.** Start every multi-step flow, leave mid-way, return an
hour later. Nothing lost, no re-entry.

**The dumb question test.** Ask the chatbox ten things a real director would
ask, phrased badly. Every answer traces to rows or says plainly what is missing.
A confident wrong answer is a **P0** — worse than no answer.

---

## 29.11 What counts as a pass

Not "it worked when I tried it." A check passes when:

- It was run against deployed, with real-shaped data
- A number was recorded where a number applies
- It was tried once hostile and once naive
- The failure mode was tested, not only the happy path
- Someone other than you could follow the reproduction

**A check with no number, no adversarial attempt, and no failure case is not a
check. It is an assertion.**

---

## 29.12 The report

`docs/functionality-audit-<date>.md`. One PR, no code changes in it.

```
## Verdict
Three sentences. Would this survive a Saturday with 300 families depending on
it, and what is the single thing most in the way.

## P0 — stop everything
Each: what, reproduction, evidence, blast radius.

## P1 — blocks launch
Same.

## P2 — works badly
Same.

## Performance table
Every surface, measured number, budget, pass or fail. Worst three first.

## Adversarial results
Every case in 29.5 and 29.6. What broke, what held.

## Where a real person got lost
The human tests. Verbatim hesitations, not paraphrase.

## What I could not test
And what access would be needed.

## Fix order
By consequence, not effort. A one-line safety fix outranks a week of features.
```

**Then fix, in that order, one at a time, each merged before the next starts.**

---

## 29.13 The refusal list

Do not report these as passing. They are failures regardless of whether the
feature "works":

- Any surface over its performance budget
- Any view over 4 round trips
- Any generic error message
- Any blank panel where an empty state belongs
- Any fabricated value on an empty org
- Any permission denial that errors instead of returning zero rows
- Any flow a user can be trapped in
- Any silent data loss, of any size
- Any confident wrong answer from the agent
- Any two-handed operation on a mobile flow a coach uses on a sideline
- Any dependency failure that blanks a page
- Any DST or timezone mishandling
- Any check you ran only on the happy path

---

## 29.14 The question that governs everything

> **If a real club ran a real season on this tomorrow, what would it get wrong,
> and would anyone notice?**

If the answer to the second half is no, that is the most important finding in
your report. Silent wrongness is the failure mode that ends this company, and
loud failure is the one that merely annoys people.

Report it first.
