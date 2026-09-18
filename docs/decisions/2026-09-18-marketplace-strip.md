# Stripping the marketplace script — measured, and the one decision it needs

Owner ruling, 2026-09-18: *"Host document: strip the inline marketplace script
entirely, don't split it. The marketplace is dead; 378KB of it on every load is
dead weight. Re-measure FCP after."*

I measured before cutting. The premise is right — the marketplace is dead — but
the number and the shape are not what the ruling assumes, and finishing the
strip requires retiring two things you have previously made law. That decision
is yours, so this file states it rather than picking.

## What the 378KB actually is

| Part of the page | On the wire (gzip) |
|---|---|
| Inline script, all of it | 383KB |
| …lines that mention any marketplace symbol | **25KB** |
| CSS | 115KB |
| Fonts (inline, a smoke invariant) | 104KB |
| Images (inline) | 123KB |
| **Document total** | **848KB** |

The marketplace is **5% of the inline script** (709 of 14,575 lines, 25KB
gzipped), not 378KB. The other 358KB is the club-ops product itself: the coach
shell, the schedule, money, roster, queue, import, settings, onboarding, the
dock, and the renderers they share.

Deleting every marketplace line saves about **25KB of 848KB — 3% of the
document.** On the measured mobile profile that is worth roughly 100–150ms of
parse time. It will not move first contentful paint from 4.7s to 1.5s, because
FCP is not paid for by the marketplace.

## Why it cannot simply be deleted

Two standing decisions of yours stand directly in front of it.

1. **The product toggle is LAW.** Every `PAGE_META` page must render forever,
   and `smoke.sh` enforces it. Those pages are the public site.
2. **The smoke gate requires fourteen visitor routes to render:** `home explore
   product trust companies pricing coachinfo map assistant saved bookings
   messages timeline setup`. Seven of those (`explore`, `product`, `map`,
   `saved`, `bookings`, `messages`, `timeline`) are the marketplace. Stripping
   it makes the gate red by design.

There is also a mechanical reason. The coach surfaces still fall back to the
seed catalogue when nobody is signed in — `teamRoster()`, `coachListings()`,
`providerSessions()` all read `SEED` for the guest view that smoke drives across
seventeen coach tabs. The seed data cannot leave before those fallbacks do.

## The decision I need from you

**Does sporv.ai keep a public marketing site, or does the domain become the
club-ops app only?**

- **Keep the public site** (landing, pricing, product pages, trust). Then the
  strip is: the booking and checkout flow, the search and map surfaces, the
  saved/wallet/family portal, and the seed catalogue behind them. `PAGE_META`
  and the law survive. Saving: most of the 25KB. Smoke's route list loses
  `explore`, `map`, `saved`, `bookings`, `messages`, `timeline` and keeps the
  rest.
- **App only.** Then landing, pricing and the product pages go too, the product
  toggle law is repealed, `smoke.sh` drops to the coach routes, and sporv.ai
  serves the workspace and a sign-in door. Saving: the 25KB plus a large share
  of the 115KB of CSS, because most of that sheet paints the family portal.

The second is the one that actually moves FCP, and it is a positioning change,
not a cleanup.

## What moves FCP, if that is the goal

Measured on the audit's profile (Pixel 5, 4× CPU, ~4G, gzip on), in order of
effect:

1. **Fonts out of the critical path — 104KB.** The faces are inlined as base64
   because the build must survive a CSP with no external font source. Checked:
   the CSP already reads `font-src 'self' data:`, so serving them from
   `/assets/` as same-origin files needs no header change and no external
   host — the inline-ness was never the security property. Two things move
   with them: `build.py` stops base64-ing the woff2 files, and `smoke.sh`'s
   "all faces inlined" check becomes "all faces served same-origin". Largest
   win available, invisible to the product.
2. **Images out — 123KB.** Thirty-four data URIs, including a 22KB logo
   inlined three times. `img-src 'self' data:` already allows same-origin
   files, so this is a build change only: emit them to `/assets/`, reference
   by path, lazy-load below the fold.
3. **CSS split.** 115KB, most of it the family portal. Follows the decision
   above.
4. **The marketplace script — 25KB.** Real, and worth doing, but fourth.

Doing 1 and 2 alone is roughly 227KB off an 848KB document — more than nine
times what the marketplace strip saves, with no product decision attached.

## Recommendation

Rule on the question above. Meanwhile I would take fonts and images out of the
critical path first, because that is where the time is, and it needs no ruling.
The marketplace strip then follows the answer, in one PR per surface, with the
smoke route list edited in the same commit that removes what it guarded.
