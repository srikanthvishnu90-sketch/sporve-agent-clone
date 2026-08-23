# Sporve Web — Design Rules (the system behind every page)

The single source for *how a page is composed here*, so the same defects stop
recurring. Read this before building or restyling any screen. It sits alongside
the colour/type law in `CLAUDE.md` (rules 3–5) — where they overlap, `CLAUDE.md`
wins, because it is the checked-in constitution.

**Why this file exists:** design mistakes on this repo repeat for two reasons —
(1) generic specs assume a stack this repo is not, and (2) the rules live in
people's heads instead of one referenced place. This file fixes both: Part 1 is
the composition system, Part 2 is the list of repo truths that make generic
specs wrong, Part 3 is what is mechanically enforced so a regression fails a
check instead of shipping.

---

## Part 1 — The composition rules

Numbering matches the owner's Aug-2026 "System Behind Every Page" brief.

### Layout & centring
1. **One declared content column per page.** Reading content `max-width:720px`,
   app/dashboard `max-width:1200px`, forms `max-width:480px`, always
   `margin-inline:auto`. Content never floats at an arbitrary horizontal offset.
2. **Centred = equal computed space on both sides**, measured not eyeballed. Two
   elements on one surface may not use two different centring references.
3. **The 8px grid is law.** Every spacing value is a multiple of 4, preferring 8
   (8/16/24/32/48/64/96). A 13px margin is *mathematically* wrong.
4. **Alignment creates order.** Elements in a section share edges (left edges,
   baselines, gutters). A chat thread has a fixed column with user-right /
   assistant-left *inside* it — edges consistent message to message.
5. **Whitespace is distributed, not leftover.** Vertical gaps follow 48/64/96.
   A 400px void between content and an input row means the surface has no
   vertical rhythm — chat fills upward from the input, documents flow down.

### Surfaces, borders, elevation — the white-outline rule
6. **Dark surfaces never get light borders.** Elevation on dark = a *lighter
   surface step* + shadow, never a light stroke (that reads as a rendering bug).
   If a hairline is needed on dark, it is ≤ one step lighter than the panel's
   own surface — usually shadow alone suffices.
7. **One border weight (1px), one radius scale** (8 controls / 12 cards / 16
   panels / full pills). Nested radii shrink inward; a child never exceeds its
   parent's radius.
8. **≤ two elevation levels visible at once.** Shadows from the token scale only.
9. **Nothing overlaps by accident.** An element on top of another is either a
   designed overlay (backdrop + z-index token) or a bug. No third category.

### Typography & content rendering
10. **Fixed type scale** (12/14/16/18/22/28/36+), line-height 1.5 body / 1.2
    display, one display-face moment per screen. On this repo the scale is the
    8-step CSS custom-property set — see `CLAUDE.md` rule 4 and `smoke.sh`.
11. **Reading measure 45–75 characters.** In fullscreen, messages live in a
    centred 680–720px column, never spanning the viewport.
12. **Markdown ALWAYS renders — or the model emits plain text.** Literal `**` /
    `##` on screen is a Severity-2 defect. Every AI/message surface either
    parses markdown or the model is instructed to emit plain text. Never raw
    syntax to a user. *(On this repo: AI replies are server-emitted markdown;
    the frontend renders them through `mdCoach()`. See Part 2.)*
13. **No emoji as UI iconography.** Emoji render inconsistently and read as
    unfinished. AI surfaces strip emoji client-side AND the server prompt is
    instructed to emit none — this is a prompt fix, not only CSS.
14. **Text passes 4.5:1 (3:1 large).** Muted text uses the muted token, never
    opacity. See `CLAUDE.md` rule 3 for the frozen palette + on-dark accents.
15. **Family top nav is Instrument Serif** (owner 2026-08-22, Uber/Airbnb mobile
    pass — "top tabs + hovering portion all in serif"). `--nav-face` resolves to
    Instrument Serif; the top tabs (`.tnav`), right-cluster links and the Get-started
    pill read at `--t-body`, not `--t-small`. REVERSES the earlier Inter-nav rule.
    Body/small text stays **Inter** (`--sans`). The WF-9 style freeze was lifted by
    explicit owner override on this date (NOT by a cleared charge — that is still
    stalled; see the charge report).

### Component composition
15. **One height rhythm per interactive row** (inputs/buttons 40px, 44px touch;
    chips 32px; icon buttons 36px hit area). Mixed heights in a row is the
    fastest unprofessional tell.
16. **Chips never clip.** A control cut mid-word needs horizontal scroll with a
    fade mask, wrapping, or fewer chips. Truncation+ellipsis is for body text,
    never for controls.
17. **Groups have equal internal gaps** — one gap value per icon cluster / chip
    row (8 or 12), never eyeballed.
18. **Empty space in a bar is intentional.** Controls huddled at 40% of a
    full-width bar means the bar is wider than its job — constrain it to the
    content column.

### Page formulation — answer before building
19. **One primary action** gets the accent; two accents = zero accents.
20. **Declare the content column** (width + centring) before placing anything.
21. **Declare the vertical anchor** — chat anchors bottom, documents top,
    dashboards top-left; everything on the page obeys it.
22. **Design all four states** — loading / empty / error / populated. An empty
    state is an invitation with one action, not a void. *(This repo's honesty
    law: a signed-in user sees real data or an honest-empty state, never
    fabricated seed — see the `hydrate*` functions.)*
23. **One density per surface** — consumer breathes (24–32px), operator
    compresses (12–16px). Never mixed.
24. **Screenshot test at 390 / 768 / 1440.** If a screenshot makes you hesitate,
    the page fails.

---

## Part 2 — Repo truths (why generic specs are wrong here)

A pasted design/dev spec is almost always written for a React/npm app. This repo
is not one. Verify these before acting on any spec (this is `CLAUDE.md` rule 9,
made concrete):

- **Zero runtime dependencies. No React, no npm, no bundler.** The site is one
  file: `python3 src/build.py` inlines `src/mod-*.js` into
  `src/sporve-web.host.html` → `index.html`. **"Add react-markdown / a library"
  is impossible** — `default-src 'self'` blocks every external module. The
  equivalent here is a small inline function (see `mdCoach()` in the host).
- **Edit the sources, never `index.html`.** It is generated.
- **Template-literal strings never appear in the served HTML.** A page name like
  `coach-insights` is built at runtime, so grepping `index.html` for it fails
  forever. Verify by a *source* marker, `wc -c`/build-hash parity, or the
  rendered DOM — never grep of the built file. (`CLAUDE.md` rule 1.)
- **The palette is frozen** (black/white/slate + sport accents only). A spec
  saying "zero new colours" is already satisfied; a spec proposing new hex is
  approximating tokens that already exist. (`CLAUDE.md` rule 3.)
- **The AI system prompt is server-side.** Coach + family assistant replies come
  from the `coach-command` / `ai-chat` edge functions (Anthropic via
  `ai-gateway`, service-role-gated) in the `sporve-app` repo, not here. The
  frontend can only **render or sanitize** what arrives; instructing the model
  to drop emoji/markdown is an edge-function change, staged there, not a
  frontend fix.
- **Two typographic registers, chosen by subject** — see `CLAUDE.md` rule 4.
  Money/safety/consent pages go "serious"; do not restyle a page's register to
  match a generic brief.

---

## Part 3 — What is mechanically enforced

`bash src/smoke.sh` must exit 0 before any commit. It already guards the
rendered font scale, the dark-ground invariant (no dark-resolving token on a
black band), horizontal overflow at three breakpoints, and the three inlined
faces. Design-rule tripwires added here:

- **No light border on a dark AI panel** (rule 6) — source check: no light hex
  stroke inside `.aidock-panel` rule blocks.
- **Markdown never renders raw** (rule 12) — a `mdCoach()` self-test asserts
  `**bold**` → `<strong>` and `- item` → `<li>`, and that a literal `**`/`##`
  cannot survive to the output.

Checks that are only reliable against the **rendered DOM** (computed style), not
a grep of the built file — because template literals are invisible in
`index.html` — run through the `ci-browse` harness:

- 8px-grid spot checks on computed margins/padding of touched components.
- One centred-column assertion (equal left/right space) for the fullscreen chat.

**When you find a new recurring defect:** add its rule here, add its tripwire to
`smoke.sh` if mechanically checkable, and reference this file — do not let the
rule live only in a chat.
