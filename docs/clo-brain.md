# Clo brain — hard-won repo truths (read before every thesis/ground)

This file is Clo's growing memory: facts about *these repos* that specs keep
getting wrong and that Clo keeps re-deriving from scratch. Every entry was paid
for by a real thesis or a real failure. **Read it first; append to it whenever a
thesis surfaces a durable truth or corrects a stale one.** The goal is that the
same mistake is never re-litigated twice — a spec's false premise is caught by
recall, not re-investigation.

Format: one bold claim + one line of evidence (file:line or query). Newest wins
when two conflict; strike the loser, don't delete the history.

## Founder thesis — where the labor is (owner, 2026-08-24). THE governing lens; read before any thesis/sequencing call.
- **The payable labor is NOT the solo coach.** A private coach's pain is an empty
  calendar + parents who pay late — that is *demand generation*, i.e. the
  marketplace problem in a coach costume. Automating solo admin saves ~1hr/week;
  nobody expenses that. "AI agent for coaches" = a thing people like, don't pay
  for, and that loops straight back to needing supply + demand.
- **The labor with a check-signer is the club/org director.** Registration,
  roster across dozens of families, scheduling, background-check tracking,
  tournament logistics, invoice-chasing, parent comms — a drowning volunteer /
  part-time admin on spreadsheets + a Sports Connect instance that **sunsets
  2027**. Quantifiable, painful, currently-PAID-FOR labor with a buyer who signs.
- **The 530-issue AAU inventory is the tell — the code already drifts org-ward.**
  `org_members` + messaging LIVE; a compliance-board slice shipped (see
  staff_certifications). The product's own gravity agrees with the thesis.
- **The wedge = a done-for-you agent that takes ONE painful workflow fully off a
  director's plate.** Bet: *payment collection + roster/waiver compliance* —
  "collect every family's payment, chase the stragglers, keep roster + waivers
  current, draft the weekly parent email for the director to approve." Cognition-
  shaped. The **draft-first invariant IS the product** for a director (verified in
  the coach AI: every write returns as an Approve-first review card, does nothing
  until tapped).
- **Flip the story, don't re-architect the company.** The mistake is treating the
  marketplace as the product and the OS as a feature. The marketplace is the
  *eventual distribution layer* clubs/coaches pour their families into; the wedge
  is the workflow you take off a plate. Stacked thesis (coach OS → clubs →
  marketplace) is right on paper — invert which end is the product.
- **"Is this a bad product" is unknowable — nobody uses it.** 4 launch blockers,
  0 signed coaches, 0 real payments. Re-architecting around "agentic" is
  high-status procrastination: it feels like progress and delays the only thing
  that produces information — a real club director paying to make one thing vanish.
- **What this means for Clo's hands (do not re-litigate):**
  (1) The first real charge is **atom #1 of the collections agent**, not a launch
  checkbox — you cannot sell "collect + chase" on a rail that has never moved a
  dollar. Prove the charge first.
  (2) "Build end-to-end for one org" is gated on a **committed** org, not a built
  agent; building the loop for a hypothetical director is the same procrastination
  in a suit. Sequence: working payment rail → one signed director → build the
  collections+compliance loop for THEM → let their next ask decide platform-vs-agent.
  (3) Do **not** scaffold a "club agent" speculatively. Hold this as the lens;
  when the charge clears, the next honest unit of work is the org collections+
  compliance loop for a specific buyer — not more marketplace/design surface.

## Stack & build (the-sporve-web)
- **Zero runtime deps. No React/npm/bundler.** "Add react-markdown / any library"
  is impossible under CSP `default-src 'self'`; the equivalent is a small inline
  function. Build: `python3 src/build.py` inlines `src/mod-*.js` → `index.html`.
- **Template-literal strings never appear in served HTML.** Verify a deploy by a
  *source* marker, `wc -c`/build-hash parity, or the rendered DOM — never `grep`
  of `index.html`. (This has cost real timeouts.)
- **No inline event-handler attributes** (`onclick=`, `onsubmit=`, …). The CSP
  hashes cover inlined `<script>` blocks only; an inline handler attribute is
  blocked and `smoke.sh` fails it. Use a `data-*` attribute + a `$("[data-x]")`
  handler in the wiring function. (A form needing no submit → use a `<div>`, not
  `<form onsubmit=...>`.)
- **Inlined modules share NO lexical scope.** `mod-*.js` talk to the host only
  through `window.*`; the host's `const S` (state) and `const esc` are NOT visible
  to modules. Bridge data via a `window.SporveX` global (e.g. `window.SporveOrgCompliance`).
- **Fonts: only already-embedded faces are usable.** `build.py` maps
  `assets/fonts/<prefix>-Variable.woff2` → a family (archivo→"Archivo" 400-800,
  etc.). No Google Fonts load. A new face needs a real woff2 dropped in that dir.

## Design law
- **Product pages render under `#app.reg-tabs`, and `#app.reg-tabs h1/.pg-serif`
  (id-level, 1,x,0) forces the display face.** Any type change to a product hero
  MUST out-specify it — a class rule (0,2,0) silently loses and reads as "dead CSS."
  Product h1s carry `class="pg-serif pg-h1"`; the winning selector is
  `#app.reg-tabs .pg-serif.pg-h1` (1,3,0). Verify a type change with a rendered-DOM
  `getComputedStyle(h1).fontFamily`, never by reading the rule you added.
- **Palette is frozen** (black/white/slate + sport accents). A spec proposing new
  hex is approximating tokens already here. See `src/design-rules.md`, CLAUDE.md 3-5.
- **The product-page rhythm gate lives in TWO files, not one.** `scripts/slop-audit.js`
  pins each page's `expectedRhythm`/`expectedComposition` (D/L string, slate=L) and
  COMPUTES `out.warn.fingerprint`; the "no two pages alike" FAIL is in `src/smoke.sh`
  (`DUPLICATE_RENDERED_SILHOUETTE` + `ADJACENT_FINGERPRINT`, ~L1378-1387) comparing
  those fingerprints. To let pages share a rhythm without touching smoke.sh, prefix
  the fingerprint with the page id — every fp becomes unique, the comparison can't
  fire (owner 2026-08-23, `feat/product-pages-5band-rhythm`).
- **`.pg-mono-ui{background:var(--paper)}` is a WHITE card (family app isn't
  `data-theme=dark`), so every `.pg-flat-figure` is ground-agnostic** — a demo figure
  renders fine on a dark, white, or slate band. But `.pg-search-match .pg-mono-ui`
  is overridden to transparent+white text, so it ONLY works on dark; don't move that
  section to slate.
- **On `.pgband.dark`, ONLY `h2/.pg-serif/p/.pg-eyebrow/.pg-sub` + `.rebuild-page
  .pgband.dark [data-prose]` get light text.** A `dt`/`dd` (question/definition
  ledger), `.pg-rail-value`, or `.pg-hero-orgboard b{color:var(--ink)}` inherit DARK
  text → invisible on a dark ground. So question-ledgers, stat-rails, and the
  enterprise orgboard must stay on white/slate; `.pg-hero-compliance` (uses #94A3B8/
  #343A43) is the one board that IS dark-native.
- **`.pg-instant-product .pg-r4-copy{color:#fff}` forces the copy white** (was on a
  dark band). Moving that copy to a light band means dropping the `.pg-instant-product`
  class from the copy wrapper (rename to `.pg-instant-copy`), not deleting the rule.
- **The booking/listing detail is `detailHTML(id)` (host), reached via `data-open`
  → `go("detail",id)`.** It is the "professional booking" layout (`.bk-*` classes),
  branched on `ptypeOf(p)` (solo/camp/org): solo = per-session + price ladder, NO
  roster meter; team/camp = capacity meter (`.bk-meter`, real enrolled/cap) +
  per-month/season pricing. Any booking-page restyle edits this ONE function; keep
  the priceLadder + weeklyAvail sections (smoke `coach profile` enforces them). No
  fabricated fixtures/roster names (data GAP).
- **The booking detail (`.bk-*`) is intentionally ONE clean sans (Inter) at SMALL
  sizes** — NOT Instrument Serif, NOT Archivo (owner 2026-08-22 ref-image directive:
  "too big / too many fonts"). `.bk-h1`=Inter ~21px, section h2=Inter, facts=Inter;
  mono only on price/total/session-times. This is a deliberate per-surface exception
  to the Instrument-Serif-main-header canon — do NOT "restore" the serif here.
- **Type canon (owner, evolving):** currently Instrument Serif (main hero) / Archivo
  (secondary/athletic) / Inter (body) / JetBrains Mono (numerals). A STYLE FREEZE is
  on until the first real charge (CLAUDE.md design-system). All embedded token swaps.

## Backend / Supabase (prod tseszaprvtvqrkfpditu)
- **"Existing module" in a spec usually means one of three things — verify which:**
  (a) live in prod, (b) authored-not-applied on `~/SportsMan-main`, (c) web
  marketing prose (`data-prose`, zero CRUD). Never trust a coverage map; query prod.
- **Memory can be stale — verify live.** D3 said `organization_members` wasn't in
  prod; a 2026-08-21 query proved it IS (RLS on, 7 policies, bg-check columns).
- **LIVE in prod (2026-08-21):** `providers` (bg-check spine), `organization_members`,
  `conversations`/`messages`, `billing_subscriptions`. **NOT live (authored):**
  camp_roster, team_blocks, split_pay_links, org_services, shared_inbox,
  coach_invoices, commission_rates, recurring_bookings.
- **`staff_certifications` (2026-08-22) + `program_fixtures` (2026-08-22) are LIVE.**
  `program_fixtures` = team season schedule (games/trainings), FK→programs, RLS
  mirrors programs (public reads a PUBLISHED program's fixtures, provider-owner via
  `providers.owner_id=auth.uid()` manages; no USING(true)). Web read = a NOT-YET-BUILT
  frontend slice (fetch on team detail open, honest-empty). `programs` ownership path:
  `programs.provider_id → providers.owner_id = auth.uid()` (mirror this for any child table).
- **The AI system prompt is server-side** (`ai-chat`/`coach-command` edge fns →
  ai-gateway, Anthropic-only, service-role-gated). The frontend can only render or
  sanitize model output, never instruct it. Emoji/format fixes belong server-side.
- **Fee model = 0% (subscription).** `platform_fees` table = retired flat-12%, NOT
  applied. Stripe rejects `application_fee_amount:0` — omit the field when fee is 0
  (learned on invoice PR #30 and checkout PR #33).
- **Never `supabase db push` against prod** (gaps.md #1): the divergent lineage
  replays a `USING(true)` baseline IDOR. Reconcile per-object in the SQL editor.

## Edge-function deploys (Supabase MCP)
- **`deploy_edge_function` is classifier-BLOCKED unless the owner explicitly
  authorizes a deploy in-turn.** With his explicit go-ahead it succeeds. Deployed
  live 2026-08-22: `staff-cert-webhook` (verify_jwt=false, shared-secret), `ai-chat`
  (verify_jwt=true, +PR#31 prompt).
- **Match the LIVE `verify_jwt`** (check via `list_edge_functions`) and preserve the
  repo path in `files` names so relative imports resolve: e.g. ai-chat needs
  `supabase/functions/ai-chat/index.ts` + `supabase/functions/_shared/http.ts`,
  entrypoint = the former, so `../_shared/http.ts` resolves. coach-command inlines
  its http (single file).
- **Do NOT hand-transcribe a large security-critical function to redeploy** (e.g.
  coach-command, 464 lines with ownership-scrub + injection hardening) — the
  transcription risk outweighs a cosmetic change. Use `supabase functions deploy`
  (exact repo source). A failed MCP deploy keeps the old version ACTIVE (safe).

## Trust invariants (the wedge — never weaken)
- **Fail closed everywhere trust is displayed.** bg-check "cleared" = verified AND a
  dated completion AND within validity. Marketplace + org compliance board both use
  this; smoke tripwires guard them as S0. `check_production_invariants()` on prod is
  the fastest evidence (33 checks, last 33 PASS / 0 FAIL).

## staff_certifications (compliance slice, 2026-08-22)
- **The staff_certifications table + RLS lives on `origin/feat/staff-certifications-table`,
  NOT on `main`** — applied to prod BY HAND per the migration/commit text, so branch
  state ≠ prod state. The self-verify control is the with_check in `20260822_000200`
  (`is_org_admin(org) and status in ('none','pending')`); `000100` alone has NO status
  clause and would let an org admin self-set `verified`. **VERIFIED LIVE 2026-08-22:**
  prod `with_check` = `is_org_admin(organization_id) AND status = ANY(ARRAY['none','pending'])`
  — `000200` IS applied; the self-verify lock holds (pentest F1 CLOSED). Also verified:
  `20260822 staff_certifications` PRs #34 merged to `main` (branch ≠ prod concern resolved).
- **The cert self-verify lock is now MONITORED (2026-08-22).** `check_production_invariants()`
  gained a `safety` check `'org cannot self-verify a staff cert'` (asserts the admin
  `with_check` caps status at none/pending). Board = **34 checks, 0 FAIL**, cert check PASS.
  (Earlier note that it was unmonitored is superseded.) N/A-guarded if the table is absent.
- **`is_org_admin(uuid)` is `security definer`, `stable`, `set search_path=''`, scoped to
  `auth.uid()`** (providers.owner_id OR active owner/admin org_member). Correctly caller-bound;
  forging another org's `organization_id` in a client write is rejected by RLS.
- **`staff-cert-webhook` is the only path to `verified`** — service_role, matches by `cert_id`
  only, `verify_jwt=false`, shared-secret in `x-cert-webhook-secret` (empty secret ⇒ 401).
  NOT deployed. Its sole control is the secret; a leaked secret + a known cert_id verifies
  any org's cert (cert ids are RLS-scoped so not cross-org enumerable).

## Pentest / backend verification
- **Prod pg_policies + the invariant board are queryable read-only WITHOUT an MCP binding.**
  `POST https://api.supabase.com/v1/projects/tseszaprvtvqrkfpditu/database/query`
  with `Authorization: Bearer $(cat ~/.supabase/access-token)` runs any SELECT
  (e.g. `select * from public.check_production_invariants()`). Fastest live evidence.
- **Board is 34 checks; healthy state is 33 PASS / 1 N/A / 0 FAIL** (2026-08-22).
  The lone N/A is `money: platform_fees row is 1200 bps` — table not applied to prod;
  fee=0 shipped via subscription tiers, the flat-12% fees table never landed. Not a regression.
- **The Management-API curl is NOT always available: the auto-mode classifier can block
  any `curl` carrying `~/.supabase/access-token`** (observed 2026-08-22 pass 4/4 — the
  token in the request body tripped the secret guard). Do not try to bypass it. When the
  MCP `execute_sql` tool is also absent from the callable set, a pass falls back to the
  last-verified board state above; say so and mark static-only findings SUSPECTED.
- **Money path is sound (static, 2026-08-22):** `stripe-webhook` verifies the raw-body
  signature via `constructEventAsync` BEFORE parsing (400 on missing/invalid), routes to
  service-role RPCs, and dead-letters failures; `stripe-create-checkout` derives amount
  from `booking.final_price` (never client-sent) and OMITS `application_fee_amount` when
  it computes to 0 (index.ts:207) — **gap #18 is code-fixed** (prod-deploy of checkout
  unverified this session). `apply_stripe_booking_event` is `revoke ... from public` +
  `grant execute ... to service_role` (20260814_000100:165-170).
- **ai-gateway model routing gates correctly (v-current, static):** `USER_MODELS =
  {haiku, sonnet, opus-4.8}` — gpt-4o / Opus-5 / Fable-5 are NOT reachable by a user
  JWT (index.ts:143). Untrusted `system` is discarded and replaced by `SYSTEM_REGISTRY`
  (trusted = isService || internalOk; index.ts:483-493). Rate limit via
  `consume_edge_rate_limit` RPC. STALE COMMENT: index.ts:8 says "A user JWT can never
  escalate to Opus" — false since Opus-4.8 joined USER_MODELS; harmless (intended) but
  misleads a future auditor, and users forcing opus is a 25x-output cost lane (rate-
  limited, not gated).

## Process
- **clo never resolves a D-item; the owner writes the decision, dated.**
- **Verify a spec's load-bearing claims against the repo BEFORE building** (rule 9).
  Most pasted specs assume a React app; this is not one.

## Pricing / honesty (2026-08-22)
- **The Enterprise plan is `buyable:false` — "multi-player workspace, in development"**
  (`mod-coachaccount.js` PLANS, the honesty source of truth; `billing-create-checkout`
  rejects it server-side). Its pricing-card feature bullets are hardcoded in
  `pricingHTML()` and BYPASS that flag, so they must carry a VISIBLE early-access
  marker. `.pp-dev` ("In development — early access only", `dev`-flag → Enterprise
  only) must never be `display:none` — hiding it (which the motion.dev image omits)
  overclaims an unbuilt product and drops it from the a11y tree too. Honesty law
  outranks pixel-exactness to a reference image. (Caught by clo audit on PR #211.)
- **`.cmp-*` (comparison table) is NOT pricing-only** — shared at host `:7052`/`:7299`
  too. Safe to leave untouched; do not restyle it inside a pricing-scoped change.

## First-charge gate (ground pass 2026-08-22)
- **the-sporve-web has a REAL checkout path — it is NOT a pure client sim.** Host
  `:13265` book-modal confirm, gated on `isLive=p.live&&s.live`, calls
  `SporveBooking.create()` (`mod-booking.js:150`, inserts a real `bookings` row) →
  `SporveBooking.checkout(b.id)` (`mod-booking.js:213`) → deployed `stripe-create-checkout`
  → `window.location.href = r.url`. The SEPARATE `mod-payments.js confirmCheckout()`
  (`:512`, 0 backend refs) is a simulated wallet modal (`type:"checkout"`, injected
  "Check out with a card" button) that writes local state only — do not mistake it
  for the money path. Flutter app path is `booking_flow_screen.dart:_handleConfirmAndPay` (`:859`).
- **Booking amount is server-derived, client price ignored.** Trigger in
  `20260630_000003_booking_payment_security.sql:18-26` sets `final_price = programs.price
  × tier-multiplier` on insert; `stripe-create-checkout` reads `booking.final_price`
  (never a client figure). Money integrity is sound — say so.
- **PLATFORM_FEE_BPS secret on prod = "0"** (secrets-list hash `5feceb66…` == SHA-256 of
  the string "0"). `stripe-create-checkout` OMITS `application_fee_amount` when fee=0
  (`index.ts` payment_intent_data), so the fee=0 502 is FIXED on the deployed v30. All
  Stripe/checkout secrets are set (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
  CHECKOUT_ORIGINS, CONNECT_RETURN_ORIGINS). Test-vs-live mode NOT determinable from
  hashed secrets — owner must confirm in Stripe dashboard.
- **Prod (2026-08-22) has 23 anon-visible providers, ALL solo `background_check_status=
  'none'` → ZERO bg-verified → ZERO bookable.** Confirmed via anon REST
  `providers?background_check_status=eq.verified` = `*/0`. This corrects the stale "0
  bookable" only in that coaches now EXIST but none clear the gate. Also: browse RLS
  gates on `status='approved'` (a `none` provider is publicly visible) — the bg-check
  gate binds the BOOKING trigger, not browse visibility. Anon has COLUMN-level grants:
  `id/status/provider_type/background_check_status/business_name` readable;
  `stripe_account_id/stripe_charges_enabled/account_status/owner_id` denied (42501) —
  Connect-enabled count is NOT anon-verifiable, needs service-role.
- **The two hard first-charge blockers are DATA, not code:** (1) no provider is
  bg-check verified → booking trigger `20260728_000000_universal_bgcheck_gate` blocks
  the insert; (2) no provider has completed Stripe Connect onboarding
  (`stripe_charges_enabled=true`) → `stripe-create-checkout` returns 409 "coach can't
  accept payments yet". Both are RED (service-role/Stripe) — owner-applied only.

## Checkout: the sim-button trap (2026-08-22, launch-critical)
- **`mod-payments.js confirmCheckout()` is a PURE LOCAL SIMULATION** — it writes a
  `status:'confirmed', paymentStatus:'paid'` booking to `S.bookings` with ZERO
  Stripe/backend calls (mod-payments.js:512-579). `injectDetailCheckout()` (~1148)
  used to add its "Check out with a card" button on EVERY detail page, identical in
  label to the REAL one, so on a live coach the owner clicked the sim, saw "paid",
  and NO prod booking/charge existed. This is the exact fabricated-paid lie the host
  book-modal comment (host ~13242) condemns. FIX shipped: gate injectDetailCheckout
  with `if (prog && prog.live) return;` — live listings use ONLY the real data-book
  → SporveBooking.create → .checkout → stripe-create-checkout path; the sim stays for
  demo/seed listings. **When verifying a real charge, ignore the UI "paid" state —
  the DB (`bookings.payment_status`) and the webhook are the only authorities.**
- **First-charge readiness (verified live 2026-08-22):** coach "Vish s"
  (e82cf7c8-…) is bg-verified + Stripe-Connect-enabled; Stripe is TEST mode
  (`cs_test_`); 10 bookings all `unpaid`, 4 reached a checkout session, 0 ever paid.
  The gate to the freeze lifting is one COMPLETED test payment on the real button.

## Pricing / plans (verified 2026-08-22, prod REST read)
- **`plan_entitlements` has exactly THREE rows: free ($0), pro ($34.99/mo,
  purchasable), enterprise ($149/mo, purchasable=false).** No "Grow"/"Max" tier
  exists; enterprise is $149 not "Custom". Column is `price_usd_month` only — no
  annual/yearly price source anywhere, so any "$X/yr −20%" toggle is fabricated.
  A spec proposing 5 buyable tiers is proposing 2 tiers + a yearly price that the
  backend cannot charge. Verify: `GET /rest/v1/plan_entitlements` w/ anon key.
- **Only `plan==="pro"` does a real `startCheckout`** (host ~12421). enterprise
  toasts "in development"; any unknown plan id falls through to the coach-onboard
  auth sheet — a dead CTA, not a purchase. billing-create-checkout rejects any
  non-purchasable/unknown plan server-side. So a "START GROWING" button is an
  overclaim of the same class as the Enterprise "in development" issue.

## Browse filter bar (verified 2026-08-23, PR #231 prototype)
- **The browse filter bar is ALREADY a pill-chip popover system in the host, not
  a set of native `<select>`s.** `toolbarHTML()` (host ~6825) renders `.tbd`
  pill triggers → `.tbd-pop` popovers: `tbSportPop()` (sport-colour `.tbd-dot` +
  real catalogue counts), `tbPricePop()` (dual-handle `.tbd-range` slider + 24-bar
  `tbHistogram()` over real prices, `TB_SLO=20`/`TB_SHI=1000`), `tbAgePop()`
  (`AGE_BANDS`). Open state = `S.tbMenu`; every pick writes the same state
  `visiblePrograms()` reads (`S.sports`/`S.priceMin`/`S.priceMax`/`S.ageBands`/
  `S.filters`/`S.sortBy`). A spec asking to "build a filter bar from scratch /
  add a dual-range slider / add sport dots" is asking for what exists — extend it.
- **A "background-checked / verified-only" filter toggle is BANNED here** — smoke
  `BGFILTER` tripwire fails on the text "Background-checked only", and it violates
  the wedge (every coach is background-checked, so the filter implies unvetted ones
  exist). `S.filters.verifiedOnly` exists in code but must not be surfaced as a UI
  control. Honest overflow filters instead: `S.filters.model` (pricing model,
  wired host ~6356), `S.filters.hasReviews` (added PR #231), `S.sortBy`.
- **The `.tb-seg` type tabs (All coaches/Private/Camps/Team) are scroll-NAVIGATION,
  not a filter** — `data-kindjump` scrolls to a `.kind-band` section, an
  IntersectionObserver scroll-spy (host ~14153) toggles `.on`. They set nothing on
  `S`; `S.kind` is a separate, now-dead mechanism (only `data-kindfilter` from the
  removed kindShowcase set it). smoke requires `.tb-seg` present (`NO_SEGMENTS`),
  so don't fold them into a filter menu. Bar blends with slate because `.tb-bar`
  is transparent; only the chips are white (`--paper`) pills.

## Family top-nav (verified 2026-08-23, rendered-DOM getComputedStyle)
- **`.navcenter .tnav{font-size:16.5px}` and `.navcenter .tnav:not(.on)` (host
  ~652-653) are DEAD rules — no element in the DOM ever carries `navcenter`.**
  The live top-tab rule is `.tnav-row .tnav` (specificity 0,2,0), which beats the
  base `.tnav` (0,1,0). Editing `.navcenter .tnav` changes nothing; change
  `.tnav-row .tnav`. Verify: `getComputedStyle(document.querySelector('.tnav-row .tnav'))`.
- **The family top nav switched from Instrument Serif (`--nav-face`) to Inter
  (`--sans`) at 16px on 2026-08-23 (FIX 4, freeze lifted by owner).** This REVERSES
  design-rules #15 (2026-08-22 "top tabs + hover portion in serif"). `--nav-face`
  still resolves to Instrument Serif and is retained by the mega-menu label rows +
  coach-portal `.navlink` container; only `.tnav-row .tnav`, `.topnav .navlink`,
  `.acct-name`, and `.acct-sheet` were repointed to `--sans`.
- **Nav logo crop math: crop-width = 3.625 × logo-height** (host ~394 comment).
  24px→87, 22px→80. The `<img>` carries `width="99" height="24"` attributes but CSS
  `.navlogo{height;width:auto}` governs; attributes are inert intrinsic hints.

## Coach dashboard shell architecture (thesis 2026-08-25)
- **The coach view is NOT a single 3-col CSS grid.** It is a hybrid: `.dash` is a
  2-track grid `236px minmax(0,1fr)` (host ~L3243) but the rail is
  `position:fixed;left:0;top:126px;bottom:0` (~L3244) — a fixed sidebar, not a real
  track. Main is `.dash>div{grid-column:2;width:min(1240px,100%);margin:0 auto;
  padding:0 34px}` (~L3255), i.e. a CENTERED max-1240 column, not a flush `1fr`.
- **The AI dock lives in the `#layer` sibling of `#app`, not inside the coach grid.**
  It is `.aipill.aidock-col` (fixed, right:0, `width:var(--aidock-w)`, host ~L2284);
  the page reflows by `@media(min-width:1280px){#app{margin-right:var(--aidock-w)}}`
  (~L2325). `--aidock-w` = `clamp(420, innerWidth*0.40, 760)` recomputed each render
  (~L13101, owner 60-40 split 2026-08-25). So converting to a literal
  `grid 232px 1fr 400px` would mean pulling a GLOBAL overlay out of `#layer` into the
  coach subtree — do not; the margin-right reflow is deliberate and safer.
- **Metrics strip is 5 borderless cells** (`.metrics` repeat(5), ~L3257, Stripe-scale,
  commit #248) — NOT the reference's 3 stat cards. Decided; don't downgrade.
- **Composer is intentionally slate rounded-26 with a slate glow** (`.aidock-compose`
  ~L2560); owner named the glow as "the one deliberate difference from the reference"
  (~L2558). Don't restyle it toward the reference's flat #232A31 rounded-16.

## Reference-HTML premises that are already shipped (thesis 2026-08-25)
- **Roboto Condensed IS an embedded face and IS the global display voice.**
  `assets/fonts/RobotoCondensed-Variable.woff2` exists; host ~L186 sets
  `--display`/`--serif` to it, and host L4482-4489 forces
  `h1..h4/.greet/.cw-h1/.eyebrow` to Roboto Condensed **uppercase weight 500
  !important app-wide, coach portal included**. Any brief proposing a Google
  Fonts load of Roboto Condensed is asking for what is already inlined.
- **Archivo is gone.** It is absent from `assets/fonts/` (only Inter, JetBrains
  Mono, RobotoCondensed remain), so CLAUDE.md's D7 "coach = Archivo headers" and
  the "COMPACT-SERIF / Instrument Serif" blocks are STALE lineage, not current law.
- **The coach H1 smoke gate is `H1_NOT_DISPLAY` and asserts Roboto Condensed**
  (`src/smoke.sh:2314`), not Archivo. A reference-matching header cannot trip it.
- **The coach rail groups already equal the reference's nav** (host L9845-9850:
  ungrouped Home/Search, Clients{Clients,Messages,Schedule}, Catalog{Listings,
  Media}, Business{Earnings,Approvals,Operations}); Billing + Session notes arrive
  as `modCoachTabs()` extras from the modules (host L11466). Tab count is not a delta.
- **CORRECTION to "metrics strip is 5 borderless cells — don't downgrade":** the
  owner overrode it 2026-08-25; `.metrics` is now 3 boxed stat cards (host
  L10059-10065, commit d50165a). The 5-cell line above is superseded.
- **The AI dock already has 4 states** — docked column, `aiCollapsed`, `aiMax`,
  `aiFull` fullscreen (host L9449, L13096, L14105, L15397). The reference's
  `.collapsed`/`.full` mechanics are implemented. UPDATED (PR #265, 2026-08-25):
  the two formerly-missing affordances are now shipped — the closed state renders
  the vertical "Sporv AI" reopen tab (`.aidock-reopen`, replacing the round
  `.aidock-fab` when closed; the FAB survives only as the open-state toggle at
  <1280), and `aiFull` renders a persistent 260px history rail (`histRailHTML()`)
  beside the conversation, with `histDropHTML()` kept as the narrow-width dropdown.
  Do not restore the round-FAB closed state.

**`#layer` is a SIBLING of `#app`, so every `var(--text-*)` inside the AI dock resolves to the `:root` FAMILY compact scale, never `#app.coachdark`.** `.aidock-input` = `var(--text-md)` → 13.5px, `.aidock-suggbtn`/`.aidock-aihint` = `var(--text-sm)` → 10px (host.html:2617, 2698, 2534), while `.aidock-panel .bub` is a 16px literal (host.html:2409) — the composer is 2.5px smaller than the message it writes. Sizes in the aidock must be px literals.

**The signed-in coach role is `"provider"`, not `"coach"`, and it already comes from the database.** `sporve-web.host.html:6642-6649` reads `profiles.role` and flips `S.portal="coach"` when `p.role==="provider"`; `S.auth.status` only ever holds `guest`/`verified`.

**The family topbar was deliberately shrunk 16px → 13px twice in two days (owner 2026-08-23 "top bar too large, meet in the middle", then 08-24).** `sporve-web.host.html:703` and `:701` carry both notes — any brief asking for a 16px nav is reversing a live owner decision, not filling a gap.

**CSP is no longer `script-src 'unsafe-inline'` — it is per-script `sha256` allowlisting.** `vercel.json:9` pins 18 `sha256-…` hashes for the inlined `<script>` blocks (CLAUDE.md's "one honest limit: script-src carries 'unsafe-inline'" is stale). Consequence: you cannot hand-add or hand-edit an inline script and ship it — `build.py` must regenerate the hash set, and no CDN/external `<script>` can ever load (`default-src 'self'`). `img-src 'self' data:` — any new marketing screenshot must be base64-inlined, not linked.

**The `<ScrollReveal>` primitive already exists as `.js-rev [data-rev]` + `wireLanding()`'s IntersectionObserver.** host.html:4258 (CSS) and :14808 (JS): the hidden state (`opacity:0;translateY(18px)`) is added by JS only after the observer is confirmed, elements already on-screen at bind get `.in.now` (no entrance, no replay on re-render), and `prefers-reduced-motion`/no-JS both fall through to the fully-visible end state. A Framer-Motion scroll-reveal brief is asking for something shipped 132 times over on the family surface.

**The "Media & Bio" coach page is ~70% already built in `mod-media.js` — the consent spine is not new.** The module defines the exact 3-value consent model (`public_profile`/`private_share`/`none`, lines 63–73), a seeded roster + frozen `mediaConsent` map (`Object.freeze`, line 224 — a coach can never self-grant), a "What the library enforces" held-by-consent panel (line 725), a Consent-roster modal (`data-modal="consent"`, lines 712/979), an Add-media modal that tags athletes → runs `evaluate()` gate → saves, and a Send-to-family share flow. A pasted "media prototype" describing per-athlete Held/Publishable gating is re-describing shipped code; genuinely NEW vs it are only: an Org-Bio "Write it for me" drafter and an explicit "Ask family" *consent-request* modal (the `consentRequests = {}` stub at line 228 is unused).

**Media never persists to Supabase — even in production it is local `state.mediaItems.concat(...)` (mod-media.js:1195).** There is no media table write anywhere; the library resets on reload for everyone, guest or signed-in. This is the demo-save pattern (like `S.sessionNotes`/`S.attendance`), but for media it is the ONLY path, so "it saves" for media = append to module state, full stop, unless a real `media` table + RLS is built first (RED-set, backend).

**Coach listings create is REAL and already writes `programs`: `SporveCoach.createListing` (mod-coachaccount.js:513) POSTs to the `programs` table for a signed-in coach; the guest demo coach is blocked by `guard()`.** The `+ New listing` modal (host.html:11404, `data-newlisting`) and its handler (host.html:14729) call it. So for a signed-in verified coach a listing "saves" to the DB today; a GUEST demo coach's create currently REJECTS and does not append to `S.listings`/`DEMO_CATALOGUE` (mod-coachops.js:79 `myListings()`), so nothing shows — that guest demo-save path is the actual gap.

**An org/coach CANNOT create an athlete row in prod — two independent locks.** `athletes.parent_id uuid NOT NULL` + RLS `athletes_insert_parent ... WITH CHECK (parent_id = auth.uid())` (baseline.sql:110, :4468) means only the guardian's own session can insert, and `trg_enforce_athlete_consent` (baseline.sql:4342 → fn :1646) raises unless `parent_consent = true` AND `consent_version` is non-empty. Any spec proposing "org-scoped athlete records" is proposing either a service_role/SECURITY DEFINER bypass or a second identity table — and satisfying the trigger from an org import means a director attesting COPPA consent for a family. Never rate that as a schema detail.

**A client-import wizard ALREADY SHIPS in the coach dashboard and its terminal action SENDS EMAIL.** `Clients → Import` tab (host.html:10749, body :10803), three `data-import` entry points (:10162, :10569, :10807), 2-step modal (:12165–12199), handler writes one real `coach_invites` row per family for a signed-in coach (:14616). Owner decision 2026-08-18, copy says "send everyone a branded invite from you" (:12178) — a spec asserting "import never sends email/SMS" is REVERSING that, not adding a guard.

**There is no `seasons` table and no `season` column anywhere in prod.** The only occurrence of the string in `supabase/migrations/00000000000000_baseline.sql` is `programs_pricing_model_check ... 'seasonal'` (:827). The roster-entry row that exists is `team_athletes(team_id, athlete_id, jersey_number, is_available, is_paid)` (:630-638), scoped by team, never by season.

**The shipped font stack is Roboto Condensed + Inter + JetBrains Mono — Syne, Instrument Serif, Plus Jakarta and Hanken are GONE.** `assets/fonts/` holds exactly three files (`RobotoCondensed-Variable.woff2`, `Inter-Variable.woff2`, `JetBrainsMono-Variable.woff2`) and built `index.html` emits exactly three `@font-face` blocks; host.html:186-191 has `--display`/`--serif` both `"Roboto Condensed"`, `--sans`/`--nav-face` `Inter`. CLAUDE.md rule 4 (Instrument Serif / Syne / Hanken `reg-serious`) is STALE — a brief asking for "Roboto Condensed uppercase headers" is asking for what already ships, and only its Google-Fonts delivery is impossible.

**The landing's demo camps/team rails were already deleted on 2026-08-30, not pending.** `landingHTML()` (host.html:8210) is now hero → `.band alt` comparison table → `.band dark` prose-pair + bare stats → `.band` definition list → `.band dark` CTA → `.band dark` FAQ; the company rail and the pinned scrolly are empty `${""}` slots at :8253-8257 with the markup archived in `docs/archive/landing-sections-2026-08-30.md`.

**Scroll reveal already exists and needs no new observer.** `[data-rev]` + `.js-rev` (host.html:4281-4291, wiring :15872-15890) is an IntersectionObserver with `.in` toggle, `data-rev-d="1|2"` stagger delays (.08s/.16s), and a `prefers-reduced-motion` opt-out at :4603 — any spec proposing a fresh `.rv` observer is duplicating it.

**Spec 05's "review-queue agent" Jobs 1 is ALREADY BUILT AND SCHEDULED IN THE DATABASE — two pg_cron jobs, not zero.** `generate_dues_obligations()` (`supabase/migrations/20260831_000400_dues_reconciler.sql:23`, cron `sporv-dues-nightly` 03:10 UTC) and `generate_installment_followups()` (`20260831_001009_installment_events.sql:38`, cron `sporv-installment-followups` 03:15 UTC) already INSERT draft `obligations` with `source_kind='agent'`, a `source_ref` dedupe key, an `inverse` jsonb, the 1/3/7 escalation ladder, and the payer guardian's first name pulled through `guardian_links.is_payer`. Any spec that says the repo only has `api/ai.js` is stale by one day.

**A Vercel cron cannot write obligations in this deployment — there is no service-role key, by design.** `api/ai.js:44-50` states it explicitly ("No service-role key exists in this deployment, by design") and only forwards the CALLER'S JWT; a 6am serverless cron has no caller, and `obligations_all_owner` RLS requires `providers.owner_id = auth.uid()`. Adding a Vercel cron therefore means adding a service-role secret to Vercel — a new exfiltration surface — to duplicate a pg_cron job that already runs inside the database where RLS is bypassed natively.

**The obligations queue's "Approve" SENDS NOTHING — it is a PATCH of `status` and the loop dead-ends there.** host.html:15475 `SporveAPI.from("obligations","id=eq."+o.id,{method:"PATCH",body:{status:status}})`. The only code that actually delivers a drafted message is the `lifecycle-approve` edge function reading `outbound_messages` (mod-coachaccount.js:387-397), a SEPARATE queue in the Approvals tab. The two queues are not connected.

**`outbound_messages` cannot carry a dues chase without a migration.** `outbound_messages_event_type_check` (baseline.sql:804) allows exactly `booking_confirmed | reminder_24h | post_session | no_show_followup | rebook_nudge`, and `lifecycle_prefs_auto_only_logistics` (:795) already encodes the rule that only `booking_confirmed`/`reminder_24h` may ever be `mode='auto'`. `lifecycle_message_prefs(provider_id, event_type, mode off|draft|auto)` IS the per-org auto-draft toggle the spec asks to invent — it exists, has RLS, and has zero UI in `src/`.

**The 1/3/7 retry ladder is double-incremented and therefore wrong.** `apply_installment_event` bumps `installments.attempt_count` on `async_payment_failed` (`20260831_001009:29-32`) and `generate_installment_followups` bumps the SAME counter after drafting (:71-76). A real card failure advances the ladder without producing a draft, so the first chase lands on day 3, not day 1.

**`obligations` has no recipient column — `athlete_id`/`team_id` only, no `guardian_id`/`member_id`.** (`20260830_000200_obligations.sql`, table body.) The installment follow-up embeds the payer's name in `detail` prose and drops the identity; nothing downstream can address the message. Any "the agent drafts to the payer guardian, approve sends it" story needs that column before delivery is even expressible.

## The agent (spec 05/06) — verified 2026-08-31
- **The agent's migrations live in `the-sporve-web/supabase/migrations/`, NOT `~/SportsMan-main`.** `20260831_001013_agent_v1.sql` + `001014` are here; `~/SportsMan-main/supabase/migrations/` stops at `20260822_000400`. The edge functions are the reverse — `lifecycle-approve`, `stripe-webhook` etc. only exist under `~/SportsMan-main/supabase/functions/`. Any "read the agent code" brief spans both trees.
- **Every agent dedupe key is ADVISORY — there is no unique constraint on `obligations.source_ref`.** Each generator guards with `not exists (... where o.source_ref = ... and o.status <> 'void')`, evaluated against the pre-statement snapshot, so one `insert…select` that produces the same key twice (e.g. a member with two `active` fee_schedules on one program — `fee_schedules` has no unique on (program_id, member_id)) inserts both. A partial unique index `on obligations(source_ref) where status <> 'void'` is the one-line fix that makes every current and future job idempotent.
- **`payment_intent.payment_failed` is NOT handled anywhere in `stripe-webhook`.** The only failure branch is `case "checkout.session.async_payment_failed"` (`~/SportsMan-main/supabase/functions/stripe-webhook/index.ts:361`), which fires only for delayed-notification methods (ACH). A plain card decline never completes the Checkout Session, emits no routed event, and is caught only by the nightly cron at day 1 — so "A2 drafts within seconds" is true for ACH only.
- **`lifecycle-approve` is event_type-agnostic** (`index.ts` has no switch on it; it resolves the recipient from `child_id` else `content.guardian_id`, and 422s on an unclaimed guardian at `:96`). Adding a new agent message type is a DB check-constraint change on `outbound_messages`, not an edge-function change.
- **`approve_obligation_and_queue` maps obligation kind → event_type with a catch-all `else 'practice_reminder'`** (001013 §I), so any future non-fee/non-waiver draft (a schedule broadcast, a reactivation note) is filed to families as a practice reminder. Fix the mapping before shipping a fourth job.
- **`generate_waiver_followups` ignores season entirely.** `waiver_signatures` is `unique (waiver_document_id, member_id, season_id)` (001005:31) but the job's `not exists` matches on doc+member only, so a signature from last season permanently suppresses this season's chase.
- **The generators never set `obligations.import_batch_id`**, so the "an agent run groups its drafts so a bad sweep is undoable as one unit" contract written on the table itself (`20260830_000200_obligations.sql:51-53`) is unimplemented.
- **There is no inquiries/leads table anywhere in the schema** — spec 06's D1 "unconverted inquiries" source does not exist; only lapsed members and camp non-rebookers are derivable.
- **`sessions` has no `provider_id` and no updated_at** (baseline:604-617: program_id, title, start_date, end_date, start_time, end_time, timezone, address, capacity, assigned_member_id). Org scope for any session-driven job must come through `programs`.

- **The marketplace kill is already structural, not flag-gated — a `MARKETPLACE=false` const would restore nothing.** `const RAW = [];` (host:6230) means `PROGRAMS` is empty at parse time, and the router already collapses eight routes (`explore, map, saved, assistant, companies, bookings, coachinfo, detail`) to `home` (host:14450). A spec proposing "flip the flag true to restore" is proposing to restore a seed array that was deleted at tag `pre-pivot-2026-08`.
- **The nav brand logo routes through a dead marketplace route.** `host:7912` is `<button class="brand" data-nav="explore">` — it only lands on the landing page because of the router redirect. Deleting `data-nav="explore"` occurrences wholesale breaks the logo click.
- **`lifecycle-process` already ships a real `auto` mode, template-only.** `~/SportsMan-main/supabase/functions/lifecycle-process/index.ts:11-18` — auto never calls the model, fills a fixed logistics template, and falls back to draft if it can't. The `lifecycle_prefs_auto_only_logistics` CHECK (baseline.sql:795) confines it to `booking_confirmed`/`reminder_24h`. Any "should we allow auto?" debate is about widening an existing mechanism, not inventing one.
- **The cron→edge tick is fully wired and applied.** `invoke_lifecycle_process()` (baseline.sql:2594) reads `vault.decrypted_secrets` for `project_url` + `cron_secret`, calls `net.http_post`, and logs-and-skips if the secrets are unset; `verify_cron_secret()` (baseline.sql:3979) is the receiving check. No new plumbing is needed to run a delivery worker.
- **`lifecycle-approve` refuses to deliver to an UNCLAIMED guardian — that 422 is the exact gap email closes.** `lifecycle-approve/index.ts:90-96` resolves `guardians.user_id` and returns "This guardian hasn't joined Sporv yet" when null; delivery is `notifications` insert + `deliverPush` (:142-146). `approve_obligation_and_queue` already stamps `content.to_email` from `guardians.email` (agent_v2:314-319), so the address is present and unused.
- **`outbound_messages` has no provider-side idempotency column.** Baseline:324-336 — `id, provider_id, child_id, booking_id, event_type, status, scheduled_for, content, approved_by, approved_at, sent_at, created_at`. No `provider_message_id`, no bounce state anywhere; `guardians` (20260831_001002:9-18) has `email` but no `email_bounced_at`.

- **There is no profile/settings icon button in the coach top bar — `.coachtop-in` holds exactly two navlinks.** host.html:10341-10344 renders only `data-import="1"` ("⇄ Import clients") and `data-info="help"` ("? Support"); the workspace/account affordance is the RAIL `railhead`/`railmenu` (host.html:10352-10370). Any brief saying "the settings button goes where the profile icon lives in coachtop" is describing a control that does not exist.
- **"Settings" already exists twice in the coach rail and both route to `data-ctab="profile"`.** host.html:10367 (railmenu item) and host.html:10389 (rail button labelled Settings, icon `rIcon("profile")`). A settings build is a REBUILD of the `profile` coach tab, not a new route.
- **`agent_autodraft` is deliberately a binary off|draft master with NO auto state, and per-job pref keys do not exist.** `20260831_001013_agent_v1.sql:31-35` widened `lifecycle_message_prefs_event_type_check` to add `agent_autodraft` but left `lifecycle_prefs_auto_only_logistics` (baseline.sql:795) untouched, with the comment "'agent_autodraft' can be off|draft, NEVER auto". Per-job auto (A1/B1/C2…) requires new event_type values AND widening the auto-only-logistics CHECK — two constraint changes, both RED.
- **Cron cannot reuse `approve_obligation_and_queue` for an auto path — it hard-requires `auth.uid()`.** agent_v2:296-299 raises 'only the org owner may approve' against `providers.owner_id = auth.uid()`, which is null in a pg_cron tick. An auto-approver must be a separate service-role definer that stamps `approved_by` from the consenting user recorded at setting time, because `lifecycle-process` only emails rows with `approved_by is not null` (lifecycle-process/index.ts:199).
- **`providers` has no settings jsonb, and column-level GRANTs are the provider security model.** Baseline `providers` (baseline.sql:~120) has no generic settings column; `20260831_001011_provider_grants.sql:10-12` shows the pattern — every readable/writable provider column is granted explicitly to `authenticated` after the 2026-08-20 privacy lockdown. A new settings column is invisible to the client until it is named in a GRANT.

**There is no supabase-js in this repo and no polling loop either — `setInterval` appears zero times in all of `src/`.** `mod-api.js:6-17` states the fetch-wrapper decision explicitly ("Revisit only if realtime subscriptions are needed"), and the queue refreshes exactly once, on tab entry (`host.html:15698 → loadLiveObligations()`). Any "realtime on every list screen" brief is asking for a first runtime dependency plus a new CSP sha256, when refresh-on-focus is a ten-line change. `vercel.json:9` `connect-src 'self' https://tseszaprvtvqrkfpditu.supabase.co` would probably permit `wss://` to that host (CSP3 matches an `https` source expression against a `wss` URL) — but that is a browser behaviour to verify, never to assume.

**`monthly_recurring` is not expressible as a fourth `offering_type`.** `20260830_000100:39` pins `check (offering_type in ('private','camp','team'))`, and `create_member_fee_schedule` (`20260831_001008:23-55`) branches on that value to pick a finite installment count, then materialises rows with `generate_series(0, v_count - 1)`. An open-ended monthly plan has no N, so it needs a `fee_schedules.billing_shape` column plus a rolling top-up job — a money-path migration, not a check-constraint edit.

**Every spec-02/03 table is owner-only: there is no staff, director or treasurer role in any new policy.** `guardians_all_owner`, `guardian_links_all_owner`, `provider_settings_all_owner` all key off `providers.owner_id = auth.uid()` (`20260831_001002`, `20260901_001017:26-31`); `organization_members` exists in baseline but nothing from spec 02 or 03 joins it. A verification battery asserting "staff gets 403 on admin writes" passes vacuously — staff get 403 on everything, because staff are not a subject in these policies at all.

**CORRECTS the earlier claim that there is no `seasons` table** — `20260831_001001_seasons.sql` created it, and `fee_schedules.season_id` and `waiver_signatures.season_id` both key off it (used inside `generate_eligibility_report`, `20260901_001015:184-189`). **CORRECTS the earlier claim that `obligations` has no recipient column** — `guardian_id` now exists and is selected by the live queue (`host.html:11444`) and joined by `auto_approve_agent_drafts` (`20260901_001017`).

**The money-auto consent gate is client-side only today.** `lifecycle_prefs_auto_scope` (`20260901_001017:66-69`) permits `mode='auto'` on `agent_a1`/`agent_a2` unconditionally; the only thing standing between a director and auto-sending dues chases is the confirmation modal in `host.html:15784`. A PATCH straight to `lifecycle_message_prefs` from any signed-in owner bypasses it entirely.

**Zero UI strings consume vocabulary tokens.** No `{group}`, `{event}`, `{session}` or `{member}` placeholder exists anywhere in `src/`; labels are literals ("Roster", "Queue", `host.html:10367-10372`). Org-configurable vocabulary is a new mechanism, not a config toggle over an existing one — but `provider_settings` (KV, RLS'd, stamp-triggered) can hold it with no migration.

## The company brain (doc 11) — verified 2026-09-01

- **The auto-approver cron `sporv-auto-approve` (`*/5 * * * *`) is scheduled by migration 1017, and 1018 depends on 1017 — so removing "Auto" per doc 11 is a DB act, not a UI edit.** `20260901_001017:auto_approve_agent_drafts` schedules the every-5-min job; `20260901_001018` (its header says "Applied to prod as spec_audit_gate_nextevent") references `provider_settings` + the `agent_a1/a2` mode='auto' constraint, both created in 1017 — so 1017 is applied to prod too. Stripping the UI leaves the cron auto-approving `obligations` and inserting `outbound_messages`. Safe minimum to actually stop Auto: `cron.unschedule` `sporv-auto-approve` + revert `lifecycle_prefs_auto_scope` to logistics-only. VERIFY applied state: `select jobname from cron.job where jobname='sporv-auto-approve'`.
- **Findings are not expressible in `obligations` without corrupting the send path.** `obligations.kind` is CHECK'd to `fee/deadline/schedule/waiver/message` (`20260830_000200:33`) and `approve_obligation_and_queue` (`agent_v2:304-308`) maps every kind → an outbound event. A READ-only "finding" (no recipient, nothing to send) needs a SEPARATE `agent_findings` table, or it becomes auto-approvable and sendable.
- **No attendance data exists.** No `attendance` table and no `attended`/`checked_in`/`check_in` column anywhere in baseline. Any "attendance patterns" READ job is needs-schema, not build-now.
- **Both `program_waitlist` (baseline:425) and `waitlist` (baseline:646) exist** — waitlist-matching / idle-capacity READ jobs have a real source. `disputes`, `refund_requests`, `payment_event_ledger`, `session_notes`, `organization_members`, `staff_certifications` all exist; `inquiries`/`leads` do NOT (D1 never-converted leg stays refused).

## Doc-11 company brain — schema truths for the READ/WRITE fill (verified 2026-09-01)
- **`team_athletes` IS the org "member" table now.** `001007` added `provider_id` (team_id made nullable), `001010` added `first_name/last_name/dob/external_ref/status(active|inactive|withdrawn)`. It has **no `emergency_contact`** column — the `missing_data` finding's DOB leg is build-now (dob nullable), its emergency-contact leg is needs-column. The shipped 1019 generators key off these added columns, not the baseline body.
- **`teams` is `(id, provider_id, name, sport, created_at)` — no `target_size`.** The `roster_gap` finding is needs-column (`teams.target_size int`), not build-now.
- **No saved-card / customer payment-method data exists.** Providers hold `stripe_account_id/charges_enabled` (Connect payout side only). `card_expiry`/`card_expiry_note` require Stripe `payment_methods.list` = not-'none' → REFUSE.
- **Sources that DO exist for doc-11 READ jobs:** `payment_event_ledger(stripe_event_id, booking_id, stripe_object_id, amount_minor, outcome)` → reconciliation_drift; `installments.attempt_count` → refund_exposure; `sessions(assigned_member_id single uuid, address free-text, start_date)` → staffing_gap/booking_unconfirmed/schedule_conflict; `waiver_signatures.document_version` vs `max(waiver_documents.version)` → waiver_drift; `program_waitlist(status='waiting')` + `programs.enrolled_count/max_capacity` + `offering_type in (private,camp,team)` → waitlist_match/idle_capacity/camp_to_program.
- **`agent_findings` (shipped 1019) is `member_id`-only for subject** (FK team_athletes). Findings about a session/team/booking need a generic `subject_type/subject_id`; severity is `info|warn|urgent` (spec's "attention" = rename churn, skip). No `evidence jsonb`, no `dismissed_at`.
- **`obligations` has no `draft_type`/`recipient`/`why` column** — `kind` CHECK=fee|deadline|schedule|waiver|message, plus `guardian_id`, `source_ref`, `inverse`, `import_batch_id`, `run_id`. A new draft type encodes in `source_ref` prefix; linking a draft to its finding needs a `finding_id` FK. `approve_obligation_and_queue` maps source_ref/kind→outbound event_type and routes to a **guardian only** — a staff-facing (staff_shift_request) or director-facing (weekly_digest) "draft" has no recipient and no event_type, so it is a finding/record, not a send.
- **PROPOSALS (Apply-not-Send) are a new concept with no home** — obligations is a send-path. They need a new `agent_proposals` table + an owner-scoped SECURITY DEFINER Apply executor per kind; `payment_plan` Apply writes fee_schedules/installments = money-path RED.
- **Vocab is read by nothing; the 7 write generators hardcode "Installment"/"last season"/"practice".** `provider_settings` (KV, RLS'd) holds a `vocab` key with no migration; retrofit is prose-template churn on money-adjacent generators → apply vocab to NEW drafts, park the existing-7 retrofit.
