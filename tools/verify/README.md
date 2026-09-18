# The verification agent

    node tools/verify/run.mjs              # ~250 checks, report to docs/verification/
    node tools/verify/run.mjs --list       # what it would run, grouped by standard
    node tools/verify/run.mjs --law 4      # one standard
    node tools/verify/run.mjs --only mob.  # ids matching a prefix
    node tools/verify/run.mjs --json x.json --out report.md

It runs the built page in Chromium, served from a local http origin, against
the same in-memory Supabase double the browser suites use. **No live project,
no live model, no API key, no money.** That is the point: a standard you can
only check by spending is a standard that stops being checked.

## What it holds the product to

`docs/specs/28-QUALITY-BAR.md` and `docs/specs/29-FUNCTIONALITY-VERIFICATION.md`,
turned into checks that are generated rather than hand-written — a matrix over
ten surfaces, three org scales (empty · a week of a small club · a 200-athlete
season), four roles, and three viewports.

| Standard | What it asks |
|---|---|
| Law 1 | Nothing renders the server cannot back: no seeded person, no invented figure, on any surface at any scale |
| Law 2 | Permission is zero rows, never an error screen and never a hidden element |
| Law 3 | Every write returns a receipt worded from the server |
| Law 4 | Every dependency cut **before boot**, on every surface that reads it: the page still renders, says what failed, offers a way back |
| Law 5 | The product works with the agent off |
| Performance (29.3) | A number for every row, against budgets, or the check fails |
| Adversarial (29.5) | Thirteen hostile payloads on every text field, plus nine malformed row shapes on four surfaces |
| The field (29.9) | No sideways scroll and 40px touch targets at 320/390px with a season loaded |
| Integrity (29.7) | Empty states name what they watch; two surfaces never disagree; no screen is a trap |

## Adding a check

Each module exports `plan()` returning descriptors:

```js
{ id, law, severity, title,
  ctx: { org, role, width, surface, cut?, mutate? },
  isolate?: true,
  async run({ page, db, log, errors, requests }) { /* return a string to fail */ } }
```

Return a string to fail, `{ skip }` to declare not-applicable, `{ value, fail }`
to record a measurement. Checks that do not set `isolate` share one page per
(org · role · width) — that is the difference between a five-minute run and a
thirty-three-minute one.

## What it cannot tell you

It checks the **client**. RLS is proven by the SQL fixtures in
`docs/red-drafts/`; delivery latency, cold starts and anything with a real
recipient need the live audit of doc 29. A green run means the screens behave,
not that production agrees.

## Its own mistakes, kept on the record

The first run reported nine failures. Four were real and are fixed. Five were
the agent being wrong, and each correction is a comment in the file that made
it — a check that cut the network *after* the page had loaded and then graded
stale rows; a dependency map that blamed edge functions for a screen that reads
REST; a route registered before the backend double, so the "cut" never cut
anything; a string match that read a correctly escaped `&quot;onerror=` as an
injection; a measurement that timed a DOM node the re-render had already
detached. A test that is wrong about the product is worse than no test, so
those are documented where the next person will trip over them.
