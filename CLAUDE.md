# the-sporve-web — standing rules

## 0. Coordinate with Codex before editing

Codex may edit this repository concurrently. Read `.clo-sync/activity.md` when
it exists, then claim the task and files before writing:

```bash
python3 .claude/hooks/clo-sync.py begin claude "TASK" FILE...
```

After verification, close the claim with `end` and include the check performed.
Claude write tools are also observed automatically by the `PostToolUse` hook.
If Codex has an unfinished claim on the same file, re-read it immediately before
editing and narrow or hand off the work. The ledger contains observable actions,
not private reasoning, and must never contain prompts, secrets, or raw tool output.

Derived from 170 of the owner's own messages across the last 7 days. Each rule
below is here because he had to say it more than five times.

## 1. A task is not done until it is deployed and verified live

The most repeated instruction in the corpus, ~10 times: *"update everything to
sporve.vercel aswell as the github repo"*, *"make sure these are all implemented
then make sure it's live updated in vercel"*.

After any user-visible change: build, commit, push, wait for the Vercel deploy,
then **verify against the production URL** and end the turn with that URL.
Never report "done" from a local build.

This is the shared Claude/Codex release contract, enforced through Clo. Use
`MODE: release` after the implementation and audit are complete. The release
report must name the pushed commit SHA, successful Vercel production result,
verification method, and `https://the-sporve-web.vercel.app`. A failed push,
deployment, or live check means the task is incomplete; never silently leave
changes local.

**Verify the right way.** This page renders from template literals, so a string
like `coach-insights` is generated at runtime and **never appears in the served
HTML**. Grepping for it will fail forever and look like a broken deploy — that
happened, and cost two timeouts. Verify by either:

- grepping a **source** marker (`bizVerified`, `data-sporttoggle`, `mqpause`), or
- comparing `wc -c` of the live response against local `index.html`, or
- driving the live page and asserting on the rendered DOM.

## 2. Change only what was asked

~7 times: *"do not change too much with the app"*, *"keep much all the
information the same but rearrange"*.

Do not restructure, rename, reword or improve adjacent code, copy or layout. If
the change appears to require touching something outside its scope, stop and
ask. List every file touched at the end of the turn.

## Design system

The full composition system — layout, spacing/8px grid, the white-outline rule,
type scale, AI-surface rendering, and the repo truths that make generic specs
wrong here — lives in **`src/design-rules.md`**. Rules 3–5 below are the frozen
subset that `smoke.sh` enforces; read `design-rules.md` before building or
restyling any screen.

**STYLE FREEZE (WF-9, owner decision 2026-08-21 — active until the first
test-mode booking charge clears).** Typography, nav, logo, and colour commits are
capped at **zero** until then, except defects (contrast failures, overflow,
broken rendering). The last sprint ran ≈20 styling commits and 0 payment commits;
this freeze is how the next sprint inverts that. **D7 (revised 2026-08-21 by owner
directive "sporty but professional; main header a mix of Times New Roman +
athletic feeling; small text athletic, paired with Inter"): a THREE-TIER canon —
`--serif` **Instrument Serif** for MAIN hero headers only (`.hero .display`,
`.pg-h1`, `.greet` — the Times/editorial half); `--display` **Archivo** for all
secondary headers/stats/wordmark (the athletic half); `--sans`/`--nav-face`
**Inter** for body/nav/UI. JetBrains Mono numerals. Coach dashboard keeps Inter
body + Archivo `.cw-h1` (smoke H1_NOT_ATHLETIC guards it as Archivo). All embedded
faces — token swaps, no Google Fonts load. Lineage: Syne → Archivo → this. No
further type churn is in scope; lift the freeze only when WF-7's first charge is
proven.

**COMPACT-SERIF SWEEP (owner decision 2026-08-22 — WF-9 lifted for THIS sweep
only; the freeze otherwise stands until WF-7's first charge).** On the
FAMILY / non-coach surfaces, every header is now **Instrument Serif 400** —
hierarchy is size + colour, the serif is NEVER bolded. Archivo is RETIRED as the
"athletic secondary" face on family headers (the old `#app.reg-tabs` Archivo rule
was flipped to serif). Compact scale, retuned inside `#app:not(.coachdark)` so
custom-property inheritance shrinks the family tree only:

| role | token | size (desktop→mobile) |
|---|---|---|
| display hero (stages only) | `--text-hero` | 56 → 36 |
| in-app page title (bare `h1`) | `--text-h1` | 28 → 24 |
| section header `h2` | `--text-2xl` | 22 → 20 |
| card/module `h3` | `--text-lg` | 17 → 16 |
| product stat readout `.pg-stat .n` | — | serif, ≤56 |
| body | `--text-base` | 14.5 (kept — already compact) |

**The coach portal is EXCLUDED and must stay so.** Anything under
`#app.coachdark` / `body.reg-coach` keeps Archivo headers + Inter body at the
`:root` sizes. This is enforced ONLY by selector scoping (`:not(.coachdark)`) —
smoke CANNOT catch a coach-font leak (its coach gate accepts 21–54px), so never
edit a shared bare-`h1`/`h2`/`h3` rule without the `:not(.coachdark)` guard.
Verify any header change by rendered-DOM `getComputedStyle`, never by reading the
rule. Smoke scale gate widened for the compact sizes (20/16px, ceiling 56).
Still open (optional polish): per-page `.pg-*` hero clamps, dead inline
`font-size` on template heads, Flutter TextTheme parity (separate `~/SportsMan-main`).

## 3. Colour law

~6 times, and stated as an absolute: *"DO NOT CHANGE the brand color palette"*,
*"black background always have white or slate text"*.

**ORANGE RETIRED FOR SLATE (owner decision 2026-08-22, overrides the frozen
persimmon accent).** The whole orange/amber chrome is gone: `--accent` #C2410C →
`#475569`, `--accent-ink` → `#334155`, `--accent-tint` → `#EEF2F6`,
`--accent-on-dark` #F08A62 → `#94A3B8`, and the amber status token `--warn`
#B87800 → `#4F6A85` (slate-ink) / `--warn-tint` → `#EEF2F6` (light) with a light
`--warn` #B6C6D8 / dark `--warn-tint` #1A212B on the coach/dark blocks for
contrast. Coach persimmon (`#app.coachdark .dash --accent`, `.cmdgo`) → slate too.
KEPT (deliberately, owner scope "chrome + status badges"): **sport-identity
colours** (basketball etc. still paint their hue — `sportColor()`/`sportInk()`
unchanged) and the **`--gold` "Background-checked" earned badge** (the one warm
trust cue; flag for the owner if he wants it slated too). The `#C2410C`/`#F08A62`
lines below are historical — the tokens now resolve to slate.

- Black, white and slate are frozen. They carry all chrome and are never restyled.
- **Text on a black ground is white or slate. Never a token that can resolve
  dark** — `--paper` inverts under `data-theme="dark"` and has produced
  near-black-on-black. Use literals in `.band.dark`.
- `--accent #C2410C` measures **4.06:1 on black** and is banned there for
  anything but large display text. Use `--accent-on-dark #F08A62` (8.52:1).
- Sport colours are **accent-only**: tag, glyph, dot, 3px identity bar. Never a
  card background, never generic chrome, never body text — the ramp measures
  3.35–3.95:1 as label type. Use `sportInk()` when a sport colour must be text.

The reference site `sporve.vercel.app` uses this same system: its slate
`#F7F9FF` is ΔE 2.1 from `--raise`, its black `#0A0C0F` is ΔE 3.6 from `--ink`,
and every chromatic colour on it is a sport token. Briefs proposing
`#E05A47`/`#38BDF8`/`#10B981` are approximating what is already here.

## 4. Two typographic registers, chosen by subject

- **Expressive (default) — Instrument Serif (display) + Inter (body).** Landing,
  dashboard, and most product-toggle pages. Instrument Serif carries the editorial
  hero voice; Inter carries all body/UI text; JetBrains Mono is **numerals only**.
- **Per-page product accents.** Product-toggle pages may set a distinct display
  face via the `--pg-display` custom property keyed off their `pg-<id>` root class:
  **Archivo** for data/AI/ops pages (ai-coach, insights, scheduling, roster,
  payments, instant-booking), **Syne** for discovery/aspiration pages (search,
  map-search, saved, athlete-progress). Trust/consent/money/human pages keep the
  Instrument Serif default.
- **Serious — Hanken Grotesk alone**, weight doing all the work (800 headline /
  700 label / 400 body). For pages whose subject is **money, safety, consent or
  law**, where a quirky display face reads as levity about something the reader
  is being asked to trust.

_Updated 2026-08-09 (owner decision): the earlier Syne + Plus-Jakarta default was
superseded by Instrument Serif + Inter, and the per-page Archivo/Syne accents are
blessed. Embedded, CSP-safe families: Instrument Serif, Inter, Archivo, Syne, Hanken
Grotesk, JetBrains Mono (numerals), and Plus Jakarta Sans (legacy)._

_**CURRENT 2026-08-20 (owner typography directive, rev.3) — matches the reference
site sporve.vercel.app:** **Syne** (the athletic display voice from the logo) for
LARGE HEADERS (`--display`, incl. `.greet` and every family `.display`/h1), and
**PLUS JAKARTA SANS** for body / smaller text / nav tabs (`--sans` + `--nav-face`)
on the FAMILY/marketing side. rev.3 reverts rev.2's Inter body back to Plus Jakarta
(the "Nike-level" smaller font the reference renders). Retired on family routes:
Archivo per-page accents + Hanken `reg-serious` (slate ground kept) + literal
Instrument Serif in `.pg-serif`/`.pg-stat` → all resolve to Syne via `var(--display)`.
The **coach dashboard keeps Inter body** (`body.reg-coach --sans` pin) with Syne
headers (smoke guards the onboarding h1 as `H1_NOT_ATHLETIC` = Syne, flipped from the
old serif rule). A `:root` token swap on already-embedded faces — NOT a Google Fonts
load (CSP `default-src 'self'`, no Google `font-src`). Material Symbols NOT adopted
(CSP-blocked network font; inline SVGs kept). Sizes stayed on the 8-step scale; no
reflow. Lineage of the 08-20 whipsaws: rev.1 Syne+Jakarta everywhere → rev.2 Inter
body → rev.3 Plus-Jakarta body on family (this), Inter body on coach._

Currently serious: `trust`, `bookings`, `pricing`, `info`, `wallet`, and the
coach `finances` and `media` tabs. Four of the sixteen product-toggle pages —
the 25% asked for.

Switch by adding `reg-serious` to `#app`; `render()` decides. The class
re-declares `--display` and `--sans` **and sets `font-family` on itself** — the
second part is required, because a custom property only changes an element that
actually evaluates it. Headings do (`font-family:var(--display)`); a `<p>` does
not, it inherits the computed family from `<body>`, which is outside the
wrapper. Without that line you get Hanken headings over Plus Jakarta body.

## 5. Section rhythm — chapters, not a checkerboard

Do not alternate mechanically. Runs of two are wanted: white / black / black /
white, or black / black / white / black / white / white. Two blocks of the same
ground read as one **chapter**, which is the point — group sections that belong
together and let the ground say so.

Two constraints when doubling up: keep the hairline join between them
(`.band.dark` carries `border-bottom-color:#1C222B`) so the pair still has
internal structure, and never double up two *white* blocks without a divider —
148px of unbroken white padding reads as one over-long run, which has already
happened once.

## 6. Fan out to subagents

~8 times: *"have the agents hekp you run through the remainder"*. For any
multi-part task, run subagents in parallel rather than serially, and say which
agent produced which finding.

Two operational notes learned the hard way: **pin a snapshot** of the source
before launching read-only auditors, because editing files while they read
stalls them; and **tell them to `rg -l` then read line ranges**, because
pointing an agent at a 208-file repo without that reliably times it out.

## 7. Owner comprehension protocol

The owner is a business-side founder learning engineering through this
codebase. He is the only person accountable for it. Assume he knows the
product cold and the implementation not at all — explain at that level,
neither talking down nor assuming.

**Founder Learning Protocol (owner, 2026-08-13). SUPERSEDES the five-sentence
reading and the end-of-turn recap.** Any turn that creates or modifies code
ends with a section titled **`WHAT I DID — PLAIN ENGLISH`**, with these five
parts in this order:

1. **The change in one sentence** — no jargon, as if to a smart friend who has
   never coded.
2. **File-by-file** — for each file touched: one line on what that file's job
   is in the app overall, one line on what changed in it.
3. **One concept worth learning** — exactly ONE per session, 3–4 sentences,
   explained with an analogy from sports, lifting or business.
4. **The risk** — one sentence on what a USER would actually experience if the
   change is wrong ("a parent could be charged twice", "the page loads blank").
5. **What comes next** (owner decision 2026-08-20, SUPERSEDES the quiz) — the
   immediate handoff: what this change now unblocks, what still needs the owner
   (a deploy, a migration apply, a decision), and what I will pick up next.
   Concrete and short — the next move, not a comprehension test.

Plain language, first person, concise. Never "refactored the logic" — say what
the logic actually does. Never skip the section, even for a small change; for
trivial ones (typos, renames) parts 3 and 5 may be one line each.

**Quiz-and-grading loop retired 2026-08-20** with the quiz (part 5 above). The
`LEARNING_DEBT.md` mechanism was fed by graded quiz answers; with no quiz there
is nothing to grade, so it no longer runs. If the owner asks a direct question,
answer it honestly and plainly — but do not manufacture a test at turn's end.

The old five-sentence reading is retired as a separate deliverable, but its
habits still apply INSIDE part 2: use the real names — selector specificity,
cascade, custom property inheritance, render cycle, RLS policy, idempotency
key — and gloss each one in a short "which just means…" clause. Short and
dense beats long and gentle.

**Predict-then-correct on anything non-trivial.** Before showing a diff on a
CRITICAL-PATH change, ask him to state what he thinks it requires — which
files, which tables, which failure modes — then correct the prediction
explicitly. Prediction error is where the learning happens; a clean summary
read cold produces the feeling of understanding without the thing itself.

**Mark `[CRITICAL-PATH]`** on any change touching RLS, Stripe, auth, booking
capacity, or consent. Those are the surfaces where a silent bug costs money,
safety, or the company.

**Log gaps.** `docs/gaps.md` holds what he has not closed, tiered by blast
radius. Reference it, weave those topics into explanations, and when a debrief
exposes a new gap, add a row. When he answers one cold, move it to Closed with
the date.

**Do not let this slow shipping.** The PLAIN ENGLISH section costs seconds.
The predict step costs two minutes and only applies to critical-path work.
If pressure forces a cut, keep the section — it runs inside the existing
workflow rather than beside it.

## 8. Teach as you go — explain every edit

Stated directly: *"Make sure that the agent helps me learn exactly what is
going on after each edit."*

After each change, say in plain language: **what changed, why, and what it
means for the page.** Not a diff summary — the reasoning. If a judgement call
was made (a value held back, a spec item interpreted rather than followed
literally), say which and why, so the owner can overrule it.

The owner did not write this code. A change he cannot follow is a change he
cannot review, and an unreviewable change is how the wrong thing ships twice.

## 9. Check a spec's premises before building on them

Pasted briefs have repeatedly asserted things that are not true of this repo —
fonts that are not embedded, reference files that do not exist, a package
manager that is not installed, hex values approximating tokens already here.
Verify every load-bearing claim against the repo BEFORE writing code, and
report the mismatch rather than silently building on it or silently ignoring
it. A spec that reverses a decision the owner made earlier is the most
important case: surface it, do not just pick one.

## 10. When the owner has to act, give click-level steps

~7 times: *"this still to vauge, tell me exactly where to go, what to click"*.
Exact URL, exact button label, full copy-paste-ready values. No "navigate to
your project settings".

## 11. Branch and PR — do not push to main

CodeRabbit reviews **pull requests**, so a change pushed straight to `main`
gets no review. Route every substantive change through a branch and a PR:

```bash
git checkout -b <kind>/<short-name>      # feat/ fix/ chore/ style/
# ...edit, then:
bash src/smoke.sh                        # must exit 0
git commit -am "<message>"
git push -u origin HEAD
gh pr create --fill
```

CodeRabbit comments within a minute or two; the `pr-checks` workflow runs the
smoke test on the same PR. Read both before merging. Merge with
`gh pr merge --squash` once green. This also gives the Claude/Codex split a
real review gate instead of two actors pushing to `main` in parallel.

Trivial, non-code changes (a doc typo, a comment) may still go direct — the
gate is for anything that touches behaviour, style tokens, or the build.

---

## 13. Prompt intake — every prompt becomes a folder

Owner decision 2026-08-14. Each substantive prompt is captured in `prompts/`
(gitignored, internal) as a folder: `PROMPT.md` verbatim, `BREAKDOWN.md` with
the discrete asks numbered, `STATUS.md` with one evidenced row per ask —
done / open / blocked / declined, never a bare "done". A prompt is finished
only when every ask has a row. Mid-turn additions append to the open folder's
BREAKDOWN rather than living in the model's head. Born from a real failure:
a two-issue prompt that got one fix (2026-08-14).

## Before you commit

```bash
bash src/smoke.sh
```

Exit 0 = safe. It checks: the build emits, all three faces inline, the host script
boots, no JS errors on 13 visitor-reachable routes, the dark-ground invariant
holds, no horizontal overflow at three breakpoints, and every rendered font
size is on the 8-step scale. Every one of those is a defect this repo has
actually shipped.

## The build

`python3 src/build.py` inlines `src/mod-*.js` into `src/sporve-web.host.html`
and writes `index.html`. **Edit the sources, never `index.html`.** Fonts and
hero images are base64'd in, because the built page must survive a CSP that
blocks every external request.

The build also stamps a content hash into `<meta name="sporve-build">`. That is
what lets `src/verify-prod.sh` ask production which build it is serving and get
an exact answer — comparing `wc -c` against a local file depends on transfer
encoding and cannot see a byte that changes without changing length.

**Corrected 2026-08-11.** Two claims that used to live here were false:

- *"`mod-companies.js` still fetches `picsum.photos`"* — it does not. There is
  no `picsum` reference anywhere in `src/`, and `smoke.sh` has a static
  tripwire asserting the built page is free of it.
- *"the built page must survive a CSP"* was aspirational, not enforced.
  Production served **no** CSP at all until `vercel.json` landed on
  2026-08-11. It now sends a real one — `default-src 'self'`,
  `frame-ancestors 'none'` — plus HSTS, nosniff, Referrer-Policy and
  Permissions-Policy, and `src/verify-prod.sh` fails the build if any of them
  goes missing from production.

  One honest limit: `script-src` carries `'unsafe-inline'`, because the build
  inlines twelve `<script>` blocks. This CSP therefore does **not** stop XSS.
  What it does buy is clickjacking, object, base-uri and form-action
  protection. Emitting per-script sha256 hashes from `build.py` is the change
  that would make `script-src` meaningful.

---

## 12. Autonomy mandate — form a thesis, ship the safe work, don't ask

Stated directly: *"never ask for approval in things needed to be done… develop
a thinking brain through our messages and formulate a thesis on what needs to be
done and simply just push it."*

Default to acting. Read the context, decide what needs doing, do it, and report
**after** — do not ask permission for safe, automatable, reversible work. The
brain is the in-session agent (accountable, owner reachable), not an unattended
auto-pusher: standing up a scheduled agent that writes and pushes code without
review is out of bounds (the harness blocks it, and the 2026-08-07 pentest showed
why — an unreviewed change to a sensitive surface can go live and cause harm).

Act by tier:

- **GREEN — do it, no ask:** docs, tests, comments, styling within the colour &
  type law, build/format, tooling, dead-code, a11y, non-critical copy/logic,
  bug fixes with a clear repro. Branch → `smoke.sh`/`dart analyze` → PR →
  auto-merge once CodeRabbit + checks are green → deploy → verify live.
- **YELLOW — implement + PR, no ask, but a human merges:** app logic, features,
  routes not in the frozen set. Branch → checks → PR, then stop.
- **RED — draft only, never auto-apply or auto-merge:** RLS, Stripe, auth,
  migrations, booking capacity, consent/COPPA, secrets. Stage the exact steps,
  surface them loudly, the owner applies by hand.

The rails that make "just push it" safe and are never removed: never push to
`main` (branch + PR + CodeRabbit, rule 11); never commit red (checks pass or the
change is reverted); never apply a RED-set change unattended; always end with the
verified live URL (rule 1); always end with `WHAT I DID — PLAIN ENGLISH` (rule 7).
Unattended scheduled agents remain **read-only** — they think and report; the
in-session brain executes.

## Copy law — superseded 2026-08-16 (owner decision, third text-first spec)

The product-pages rebuild spec (LAW 1: 300–500 words of real explanatory prose
per product page) SUPERSEDES the anti-slop constitution's ≤180-words-per-page
cap for `page:*` routes, and resolves rule B's open word-count ruling as
**text-first wins**. Still standing: card bodies stay terse (≤16 words — that
law was always about product cards), and every claim in the prose must be
mechanically true of the shipped product. Enforcement: slop-audit rule G
(pageWords ≥300, composition fingerprint, editorial accent ≤2, zero
the deprecated product-page filler label) — WARN during the rebuild slices, FAIL once pages land.
