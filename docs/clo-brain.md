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
- **The booking/listing detail is `detailHTML(id)` (host), reached via `data-open`
  → `go("detail",id)`.** It is the "professional booking" layout (`.bk-*` classes),
  branched on `ptypeOf(p)` (solo/camp/org): solo = per-session + price ladder, NO
  roster meter; team/camp = capacity meter (`.bk-meter`, real enrolled/cap) +
  per-month/season pricing. Any booking-page restyle edits this ONE function; keep
  the priceLadder + weeklyAvail sections (smoke `coach profile` enforces them). No
  fabricated fixtures/roster names (data GAP).
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

## Process
- **clo never resolves a D-item; the owner writes the decision, dated.**
- **Verify a spec's load-bearing claims against the repo BEFORE building** (rule 9).
  Most pasted specs assume a React app; this is not one.
