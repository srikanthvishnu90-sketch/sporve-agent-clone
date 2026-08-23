# Clo brain — hard-won repo truths (read before every thesis/ground)

This file is Clo's growing memory: facts about *these repos* that specs keep
getting wrong and that Clo keeps re-deriving from scratch. Every entry was paid
for by a real thesis or a real failure. **Read it first; append to it whenever a
thesis surfaces a durable truth or corrects a stale one.** The goal is that the
same mistake is never re-litigated twice — a spec's false premise is caught by
recall, not re-investigation.

Format: one bold claim + one line of evidence (file:line or query). Newest wins
when two conflict; strike the loser, don't delete the history.

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
