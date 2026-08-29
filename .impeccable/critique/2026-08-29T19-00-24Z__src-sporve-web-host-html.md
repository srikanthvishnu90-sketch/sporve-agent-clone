---
score: 45
p0: 1
p1: 5
target: src/sporve-web.host.html
timestamp: 2026-08-29T19-00-24Z
slug: src-sporve-web-host-html
---
# Sporv interface critique

## AI-slop verdict

The core visual language is intentional rather than generic: the Media-derived dark system, condensed headings, mono metrics, disciplined steel accent, and restrained card construction are coherent. The slop risk comes from product breadth and chrome, not styling: many polished surfaces imply operational depth they do not have, while the default-open AI panel competes with primary work and makes the product feel AI-first when the underlying trust and transaction rails are not yet complete.

## Nielsen review

Independent Assessment A scored the broad live experience 18/40 on its Nielsen-derived rubric.

| Heuristic | Evidence | Priority |
|---|---|---|
| Visibility of system status | Getting Started now distinguishes done, review, open, and locked states with evidence; elsewhere demo/live distinctions are still mixed. | P1 |
| Match with the real world | The onboarding phase language is strong, but Verification in progress beside booking and checkout violates the user's mental model of safety. | P0 |
| User control and freedom | The onboarding drawer supports Escape and exact focus return; the default-open AI dock compresses or covers work. | P1 |
| Consistency and standards | Shared Media components improved coach pages; family and legacy surfaces still use inconsistent targets, contrast, and routing. | P1 |
| Error prevention | The production verification gate is not visibly fail closed for every state. | P0 |
| Recognition over recall | Process drawers explain requirements, ownership, evidence, limitations, and destinations well. | Strength |
| Flexibility and efficiency | Client-side routing and mixed local/live state prevent dependable deep links and multi-session workflows. | P1 |
| Minimalist design | The coach task area is visually compressed by a mostly empty AI panel on desktop and obscured on mobile. | P1 |
| Error recovery | Local tests pass while production contradicts them; the product does not expose a clear recovery or support path for that mismatch. | P1 |
| Help and documentation | Getting Started is detailed and contextual; many demo-only surfaces still need stronger scope disclosure at the action point. | P2 |

## Cognitive load

The three-phase onboarding model materially reduces activation ambiguity: get listed, get cleared, get paid. Each step answers who acts, how long it takes, what to do, what proves completion, and what remains unavailable. The broader coach experience still presents too many peer-level destinations and an always-present AI surface before the user's core operational state is trustworthy, forcing users to distinguish product navigation, demo affordances, and AI suggestions simultaneously.

## Emotional journey

The approved onboarding begins with clarity and momentum, then builds confidence through explicit gates rather than vague completion. The production booking contradiction creates the opposite emotion on the most sensitive path: a parent sees an unresolved verification label and transactional controls at the same time, which turns uncertainty into distrust. Mobile target failures and clipped/obscured content add friction precisely when users need confidence.

## What works

- A distinctive, restrained dark coach-dashboard language with a clear type hierarchy.
- Honest onboarding gates and evidence-derived progress rather than click-derived completion.
- Detailed process drawers that explain why, requirements, ordered actions, evidence, and limitations.
- Strong drawer accessibility after regression fixes: focus trap, background isolation, Escape, exact focus restoration, and 44px mobile actions.
- Live catalogue density without horizontal document overflow at tested desktop and mobile widths.
- Explicit demo disclosure in several newer product surfaces.

## Priority findings

### P0 — Production trust gate contradicts itself

Apex Performance Club is labeled Verification in progress while an enabled session selector, Request to book, and Check out with a card are exposed. Hide or disable every transactional control for every non-cleared state and reject direct booking/checkout requests server-side; retain Apex as a production regression fixture.

### P1 — Mobile interaction targets are undersized

The independent browser review measured six of eight visible family-marketplace controls below 44px and all four visible family-detail controls below 44px. Normalize interactive heights and remeasure the real rendered controls, not only component CSS declarations.

### P1 — Small text fails contrast

The search placeholder measured approximately 3.08:1 at 12px and the basketball/private-training eyebrow approximately 3.86:1 at 10.5px. Promote both to compliant tokens and add them to the automated contrast matrix.

### P1 — AI chrome competes with primary work

The desktop AI dock consumes roughly 40% of the viewport by default, while the mobile suggestion/composer layer obscures lower content and clips a suggestion. Default to the compact bar, preserve the user's last explicit state, and ensure the expanded panel never covers the task area.

### P1 — Navigation state is not dependable enough

Several dashboard states remain client-only rather than URL-backed, weakening refresh, back/forward, direct links, and support reproducibility. Make page and tab state canonical in the URL and test round trips.

### P1 — Local and production trust assertions diverge

The local smoke gate passes while production exposes the contradictory state. Run the same verification-state matrix against local and production build stamps, including direct server calls, and fail the release on any difference.

### P2 — Layout animations create avoidable reflow

Width, height, and margin-right transitions affect the wizard, payment progress, and AI dock. Prefer transforms or opacity where motion is still useful, and respect reduced motion.

## Persona red flags

- Parent: an unresolved background-check label beside checkout makes safety policy feel cosmetic.
- Coach: the AI panel occupies prime work space before the schedule, roster, and money state are fully live.
- Club operator: polished local roster, messaging, and operations surfaces can be mistaken for durable multi-user workflows.
- Support or compliance reviewer: client-only routing and mixed demo/live state make reported incidents hard to reproduce.
- Keyboard or low-vision user: undersized targets and low-contrast small text make high-frequency navigation unnecessarily difficult.

## Minor findings and detector accounting

The deterministic detector returned 12 warnings: six clearly actionable, one ambiguous, and five false positives. Real issues included decorative side accents and layout-property animation; the Inter warning is false because Inter is an approved body face, and placeholder-image warnings matched comments rather than broken rendered assets. No detector error-level finding was produced, and no document-level horizontal overflow was measured on the sampled family or coach pages.

## Provocative questions

1. If the AI dock disappeared for a month, which underlying workflow would users miss most—and is that workflow actually live?
2. Would a parent trust the background-check promise after seeing Verification in progress beside checkout?
3. Which three dashboard pages could be removed until their data is durable without reducing real customer value?
4. Is the product optimizing for a convincing demo or for one completed, reversible, supportable transaction?
5. What evidence would justify moving any demo-only feature above 4/10?

## Confidence

High confidence on the onboarding regression result, the named production trust blocker, family target and contrast measurements, desktop AI geometry, detector accounting, and no-overflow observations. Medium confidence on the exact coach-mobile overlay severity because the final computed geometry extraction was interrupted, though the screenshot evidence is directionally clear.

## Questions skipped

No user questions were required to complete this critique. Overlay injection was skipped after production CSP correctly blocked the detector script; screenshots and computed DOM measurements were used instead, and no overlay result is claimed.
