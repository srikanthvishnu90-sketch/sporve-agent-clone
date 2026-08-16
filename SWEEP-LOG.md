# SWEEP-LOG — enforcement sweep, icon purge + copy depth

The instrument is `scripts/slop-audit.js`, injected into the BUILT page by
`src/smoke.sh` and evaluated on all 19 product pages (16 PAGE_META mini-pages
plus trust, pricing, coachinfo). It runs on every PR via the smoke step in
`.github/workflows/pr-checks.yml`. Rules A (icons), C (stranded grids) and
D (emoji) fail the build; rule B (copy depth) and `.psdot` report as
warnings pending two owner rulings recorded at the bottom.

## Backfill — the purge that had already shipped (PR #132, commit 931f324)

The bulk of STEP 1–2 landed before this log existed: the trust icon-card grid
became the hairline definition list (`src/mod-safety.js` cites the owner's
screenshot), the 16 product pages were converted to the B-grammar
(statement / stat row / comparison table / prose pair / full-bleed break /
definition list), and smoke has asserted zero emoji + zero decorative
in-band svg on those 16 pages since. This log exists because none of that
was visible as an audit artifact — the instrument is what was missing.

## Page-by-page — audited 2026-08-14 with slop-audit.js

| Page | Icons removed | Stubs expanded | Grids restructured | Audit |
|---|---|---|---|---|
| what-is | 11 (3 `.lcheck` ticks, 8 `.dlist` bullets — deleted, not replaced) | 0 (rule B advisory only) | 0 | CLEAN |
| trust | 0 (2 `.sf-badge` pills = the verified-badge state legend, allowlist #1) | 0 | 0 | CLEAN |
| background-checks | 0 | 0 | 0 | CLEAN |
| search | 0 | 0 | 0 | CLEAN |
| map-search | 0 | 0 | 0 | CLEAN |
| instant-booking | 0 | 0 | 0 | CLEAN |
| messaging | 0 | 0 | 0 | CLEAN |
| bookings-receipts | 0 | 0 | 0 | CLEAN |
| saved | 0 | 0 | 0 | CLEAN |
| athlete-progress | 0 | 0 | 0 | CLEAN |
| scheduling | 0 | 0 | 0 | CLEAN |
| payments | 0 | 0 | 0 | CLEAN |
| roster | 0 | 0 | 0 | CLEAN |
| session-notes | 0 | 0 | 0 | CLEAN |
| media-consent | 0 | 0 | 0 | CLEAN |
| insights | 0 | 0 | 0 | CLEAN |
| ai-coach | 0 | 0 | 0 | CLEAN |
| pricing | 0 | 0 | 0 | CLEAN |
| coachinfo | 0 | 0 | 0 | CLEAN |

Aggregate: **0 failing violations across 19 pages** (icons, grids, emoji).
Advisories held open: 40 copy-depth notes, 30 `.psdot` instances.

## Open rulings (owner)

1. **Copy depth (rule B).** The spec's 40–80-word floor per item contradicts
   the standing law from the anti-slop constitution (card bodies ≤16 words,
   ≤180 words per page) and its own 8-word exemplar. Current `.pg-rproof`
   bodies run 19–31 words. Enforcing the floor roughly doubles every page's
   word count. Until one law is chosen, rule B warns instead of failing.
2. **`.psdot`** — 30 CSS dots beside headings on 10 pages. The spec's prose
   names dots-beside-headings a violation, but its svg-only detector cannot
   see a CSS span; they are slate, so legal under colour law. Delete or keep
   is a one-line ruling either way.

## Overlap sweep — 2026-08-16 (owner spec: text-collision elimination)

Instrument: `scripts/overlap-audit.js` (same-anchor stacked-siblings check,
injected by smoke.sh on every PR; map pins excluded by the same-anchor
discriminator, designed inset:0 covers excluded structurally).

| Page/surface | Collisions found | Fix | Audit after |
|---|---|---|---|
| Listing cards (browse/search/saved/map rails) | 30/30 demo cards: .sporttag vs .demochip, both absolute top:10px left:10px, overlap 46x26px @390 | .cardchips flex overlay row — chips in flow, wrap not stack, heart corner reserved; global classes untouched for solo uses | CLEAN at 390/768/1440 |
| home / explore / saved / map / companies / coachinfo | 0 further same-anchor collisions | — | CLEAN (smoke sweeps 6 routes) |

Before/after (worst offender): Demo pill fully burying the sport dot + first
characters on every non-live card at 390px → chips side-by-side with 6px gap,
wrapping to a second row when narrow. Parked per thesis: general >2px bbox
sweep (needs allowlist), 60-char name seeds, 200% zoom pass.
