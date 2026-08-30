# Marketplace modules — re-implementation archive (2026-08-30)

**Why this file exists.** Task 2 of the B2B pivot deletes seven modules
(`mod-catalog`, `mod-companies`, `mod-search`, `mod-productpages`, `mod-media`,
`mod-reviews`, `mod-insights`). Before any deletion, seven read-only subagents
produced a complete re-implementation dossier for each, so that if the pivot
ever needs one back, rebuilding it is easy — a named archive beats "it's in git
history somewhere." The files also remain recoverable from git
(`git show <sha>:src/mod-X.js`), but this captures the *understanding*: purpose,
`window.*` exports, host wiring, the non-obvious invariants, and a rebuild
checklist. **Deletion is gated on this archive being complete.**

Modules and status of their dossier below:
- mod-catalog — ✅ captured
- mod-companies — ✅ captured
- mod-search — ✅ captured
- mod-productpages — ✅ captured
- mod-media — ✅ captured (⚠️ COACH capability, likely mis-scoped for deletion — see its section)
- mod-reviews — ✅ captured
- mod-insights — ✅ captured

**ARCHIVE COMPLETE — all 7 dossiers captured (2026-08-30). Step 2 deletion is
now safe to proceed on the confirmed marketplace set.**

## ⚠️ SCOPE FINDING (from the dossiers)
Two of the seven are **coach-dashboard capabilities, not marketplace/searcher
surfaces**, and deleting them removes real functionality + breaks host
references:
- **mod-media** — the ONLY per-athlete child-media consent gate (`evaluate()`),
  plus `MOD_MEDIA.strength()` consumed by the host dashboard (host:10242/10587/
  10611) and getting-started checklist. Deleting it degrades those to dead/empty
  and removes the consent enforcement with no replacement. **Recommend KEEP.**
- **mod-insights** — coach analytics (a sub-tab of Operations); host embeds
  `demandCard()/watchlistCard()/availabilityWarnings()`. Deleting it removes
  coach retention/price-positioning views. **Owner call.**
The clean marketplace/searcher set is: mod-catalog, mod-companies, mod-search,
mod-productpages, mod-reviews. Confirm scope before deleting media/insights.

---

# `src/mod-catalog.js`

Single-file IIFE (~403 lines) inlined by `src/build.py` into
`sporve-web.host.html`. Public surface: `window.SporveCatalog`.

## 1. Purpose
`mod-catalog` is the live-data hydration layer for the marketplace catalogue. On
load the host renders ~30 fictional seed listings from a host constant
(`RAW` → `PROGRAMS`); this module reaches the production Supabase
`programs`/`sessions` tables and **replaces the seed catalogue in place** with
real listings + bookable sessions. Additive and reversible: any failure
(offline, CSP, RLS revoke, 5xx, empty result) leaves the seed untouched so the
grid never renders empty. It flips `<html data-catalog>` between `"live"`/`"seed"`
at runtime so tests can tell which dataset shows.

## 2. Window API — `window.SporveCatalog` (defined mod-catalog.js:380-401)
Reads `window.SporveAPI` (bails at :53-54 if absent).
- `hydrate() => Promise<boolean>` — `true` if catalogue replaced with live rows, `false` if seed stands. Never rejects; memoized via module `ready`. Success: empties+refills `PROGRAMS` and `LIVE_SLOTS` in place, calls `rebuildBusinesses()`, sets `data-catalog="live"`, `loaded=true`. Failure: `restoreFallback()`. (:381-384)
- `reload() => Promise<boolean>` — forces a fresh fetch (clears `loaded`, re-runs `hydrate()`). Used after a coach publishes (host :15650,:15685). (:391-395)
- `ready` (getter) — the in-flight/settled hydration promise, or `Promise.resolve(false)` if never called. Deterministic await point for the ci-browse harness. (:378,:396)
- `isLive() => boolean` — module `loaded` flag; host wraps as `catalogueIsLive()` (host :6206). (:397)
- `enabled() => boolean` — whether this load intended to go live: false on `file://`; `?live=1`/`?live=0` override; else `DEFAULT_LIVE=true`. (:264-272,:400)

## 3. The PROGRAMS contract (MOST IMPORTANT to preserve)
`PROGRAMS` is a host `const` array (host :6061) read 747× across host + ~10
modules; several modules capture the reference at load (e.g. `const CAT=()=>PROGRAMS`
in mod-companies). So the module **never reassigns it** — it mutates the same object:
- Live swap (:337-341): `PROGRAMS.length=0; PROGRAMS.push.apply(PROGRAMS, live); PROGRAMS.push.apply(PROGRAMS, sampleListings());` then `rebuildBusinesses()` (:346).
- Fallback snapshot taken ONCE at init before any mutation (:180-181): `var fallbackPrograms = Array.isArray(PROGRAMS) ? PROGRAMS.slice() : [];`. Must precede first mutation — a later `reload()` can fail after a prior success.
- Restore (:188-198): inverse swap from `fallbackPrograms`, then `rebuildBusinesses()`, `clearLiveSlots()`, `loaded=false`, `mark("seed")`, return `false`. Guarded on `.length`.
- `clearLiveSlots()` (:183-186): deletes every key of `LIVE_SLOTS` in place.
- Empty/non-array `rows` is treated as **failure → restore**, not a result (:309-311).

## 4. Host integration
- `PROGRAMS` (host :6061) `= RAW.map(...)`; `RAW` (:6027) is the 30-row seed; `DEMO_CATALOGUE = PROGRAMS.slice()` (:6105) is the frozen copy the coach side always reads.
- `rebuildBusinesses()`/`BUSINESSES` (host :6124-6140) — `BUSINESSES` derived from `PROGRAMS`, rebuilt in place; `bizVerified()` (:6120).
- `LIVE_SLOTS` (host :6278); `slotsFor(pid)` (:6281-6294) reads live slots first (never parses a UUID as an int → no "Invalid Date").
- `ptypeOf(p)` (host :6218-6226) sorts `solo|camp|org` via `PTYPE_FROM_PROVIDER` (real `provider_type`) before title regex.
- `KIND_BANDS` (host :7108-7115): three browse bands private/camps/teams; a band with zero listings renders nothing (host :8687).
- `SAMPLE_ORGS`/`sampleListings()` (host :7171-7211): 7 sample camp/team listings, `sample:true, live:false` so the money path refuses them.
- Hydration call site `hydrateCatalog()` (host :17056-17060): `render()` only on success. Called once at boot.
- `reload()` consumers: coach publish flows (host :15650-15651,:15685).
- DOM: only sets `data-catalog` on `<html>` (a test marker; unstyled). Owns no CSS classes or routes.

## 5. Dependencies (host contract it reads)
`window.SporveAPI` (`.from(table, queryString)`→Promise rows; hard dep, early-return if absent :53-54); `PROGRAMS` (:6061, mutated in place); `LIVE_SLOTS` (:6278); `rebuildBusinesses` (:6130); `sampleListings` (:7195); `phShot(sport)` (:5802, per-sport SVG data-URI placeholder); `document.documentElement` (`data-catalog`); `window.location` (protocol, `?live=`). Uses its own `todayISO()` (real clock) not the host `TODAY` anchor.

## 6. Data shapes
- programs query (`PROGRAM_COLS` :68-77) — explicit columns, never `*` (embedding is a large vector; providers has no blanket anon grant). Filters `status=eq.published&order=is_featured.desc,average_rating.desc&limit=200`. Includes a `providers(...)` embed over the FK.
- sessions query (`SESSION_COLS` :79): `id, program_id, title, start_date, start_time, end_time, timezone, address, capacity`; `start_date=gte.<todayISO>&order=start_date.asc&limit=5000` (5000 not 1000 — a 1000 ceiling drops the tail).
- `toProgram(r)` (:89-151) → renderer record. **Verified requires BOTH** `background_check_status==='verified'` AND a non-null `background_check_completed_at` (status-alone made 20 unmade-claim badges). Carries `checkedOn`, plus live-only `providerId/providerType/providerBio/providerYears/providerCredentials`.
- `toSlot(s)` (:153-169) → `{id, programId, title, date, startTime, endTime, tz, address, capacity, live:true}`; tz normalized `America/Chicago`→`Chicago` (last path segment, `_`→space).

## 7. Re-implementation checklist
1. IIFE; `var API=window.SporveAPI; if(!API) return;`.
2. Define `PROGRAM_COLS` (explicit list + `providers(...)` embed, never `*`) and `SESSION_COLS`.
3. Helpers: `cap`, `toProgram` (verified = status AND date), `toSlot` (tz normalize), `mark(state)`.
4. `var loaded=false;` and capture `fallbackPrograms = Array.isArray(PROGRAMS)?PROGRAMS.slice():[]` before any mutation.
5. `clearLiveSlots()` — delete all `LIVE_SLOTS` keys in place.
6. `restoreFallback()` — refill `PROGRAMS` from snapshot (guard `.length`), `rebuildBusinesses()`, `clearLiveSlots()`, `loaded=false`, `mark("seed")`, return false.
7. `enabled()` — false on `file://`; `?live=1/0` override; else `DEFAULT_LIVE=true`.
8. `todayISO()` = real clock.
9. `hydrate()` — short-circuit if `loaded`; guard PROGRAMS is array; if `!enabled()` restore; `Promise.all([programs, sessions])`; on empty/non-array rows → restore; build slot index FIRST, then swap PROGRAMS in place, `rebuildBusinesses()`, `loaded=true`, `mark("live")`, return true; `.catch(restoreFallback)`.
10. Export `window.SporveCatalog = { hydrate (memoize into ready), reload, get ready, isLive, enabled }`.
11. Invariants: never reassign PROGRAMS/LIVE_SLOTS/BUSINESSES; snapshot before mutating; empty result = failure = restore; slots before programs; never reject; `mark()` on every decided outcome.

---

# `src/mod-companies.js` (1236 lines, IIFE → `window.MOD_COMPANIES`)

**Purpose.** Treats the six sample businesses as first-class entities and adds the **offering-type axis** (private/camp/team) with a different booking flow per type (Book a slot / Reserve a seat / Apply for a tryout). Two full-page views + a type-aware booking modal + a "What kind" filter rail on Explore. Writes real bookings + ledger rows to host state.

**Window API** (:1218-1233): `css`; `views:{companies,company}`; `modals:{cobook:bookModal}`; `wire`; `state:{companyId:null,coType:null}`; and exported helpers `typeOf`, `imagesFor`, `OFFERING`, `quote`, `commit`, `pickAthlete`.
- `companiesView()` (:685-798) index of 6 businesses, all figures **counted** not hardcoded. `companyView()` (:801-886) single-business profile, reads `H().companyId`. `bookModal()` (:891-910) dispatches by `typeOf` to private/camp/team sheets.

**⚠️ THE typeOf TRAP** (:128-136): its own classifier `OFFERING={prog_1:"team",...prog_30:...}; typeOf=p=>OFFERING[p.id]||"private"` — keyed on **literal seed ids**, vocabulary **private/camp/team**. The host's `ptypeOf` (host:6218) uses **solo/camp/org** and derives from provider_type. The two disagree on keys AND labels; the same catalogue is bucketed two ways. This is exactly why `CAT()` (:42-44) is pinned to `DEMO_CATALOGUE`, not live `PROGRAMS` — both name-matching (`p.biz===company.name`) and `OFFERING` only work on seed data. **Re-impl must keep CAT()→DEMO_CATALOGUE.**

**Host wiring:** discovered via `modules()`; views via `modView` (no hardcoded branch — resolved purely through modView, host:14104); `[data-nav="companies"/"company"]` routing; `injectRail()` inserts `#coRail` before host `.grid` on route=explore and hides non-matching `.card` by reading `[data-open]` id; `[data-cobook]` opens modal (sample→direct, non-sample→`requireAuth`); `[data-coconfirm]` validates checkboxes + `pickAthlete().fits` then `commit()` before toast. Owns `.co-*`/`#coRail` CSS; reuses host `.band/.shell/.prodcard/.modal/.btn`.

**Deps:** `S`(via H()), `render`, `CAT()`→DEMO_CATALOGUE, `sportColor`, `PICON`, `ICON`, `SEED.athletes`, `FEE_RATE`(host:6262, =FEE_PCT/100, FEE_PCT=0 — never redeclare), `requireAuth`, `toast`, own `esc`, `TODAY="2026-08-03"`.

**Data:** `COMPANIES[]` (6 records: id,name,verified,tagline,bio,hood,founded,coaches,seed,look,heroAsset?); ids northside-flight(unverified),apex,coral,hoops,everglade(unv),ironside,sunset(unv). Booking record from `commit()` writes `h.bookings` (unshift) + `h.transactions` (unshift), decrements camp seats; per-type meta objects (privateMeta/campMeta+campSessions/teamMeta). Full field list + `quote()`/`commit()` shapes in the subagent transcript.

**Rebuild checklist:** IIFE; local helpers (own esc, CAT()→DEMO_CATALOGUE critical); COMPANIES[]+index; offering axis (OFFERING/typeOf/TYPE — document the trap); image system (inline-SVG placeholders, real src only for assets/teams/); booking data builders; athlete/consent (pickAthlete age-fits, TODAY pinned); quote/commit (fee via host FEE_RATE); co- CSS; the two views (counted figures); modal dispatch by typeOf; wire (injectRail first, data-cofb fallback, all data-co* handlers, sample-vs-requireAuth gate); export. Build + smoke.

---

# `src/mod-search.js` (1036 lines, IIFE → `window.MOD_SEARCH`)

**Purpose.** Additive, **client-only** advanced discovery layered onto Explore without the host knowing: filters modal (price dual-range, age, skill, model, geo-distance, rating, availability window, bg-check/open-spots), sort control + **in-place grid repaint** (show/hide/reorder existing card nodes, never re-create), saved searches, and a compare view (≤3). All filtering/ranking/geo is **pure JS on seeded data — NO server RPCs** (`search_listings/candidates/relax` are NOT called here).

**Window API** (:1027-1034): `css`; `views:{compare:compareView}`; `modals:{filters:filtersModal, savesearch:saveSearchModal}`; `wire` (the orchestrator — injects toolbar, repaints grid, binds all handlers); `state:{adv,savedSearches,compareIds}`; `applyAdvanced(list)` (PURE → filtered+sorted array). **Gap to preserve/fix:** host:7290 calls `MOD_SEARCH.activeCount()` but it's NOT exported (private at :194) → always resolves 0 via `||0`.

**Key algorithms:** real haversine on each listing's lat/lng (ORIGIN=Chicago 41.8781,-87.6298; EARTH_MI=3958.7613); `applyAdvanced` applies 9 constraints in order then `sortList`; SORTS: **recommended = rating desc, tie-broken by review COUNT desc** (a 4.8 from 40 beats 4.8 from 7 — deliberately NOT paid promotion); sort **index-stabilised** so equal rows never shuffle; NaN-safe asc/desc → ±Infinity; availability via host `slotsFor` within N days of TODAY="2026-08-03".

**Host wiring:** `modView("compare")` route; toolbar injects at `[data-filter="verified"]` chip (host:8674, host is aware — host:8544); grid repaint maps `.card`→`[data-open]` id, toggles display + appendChild reorder (preserves host click bindings), injects `#seEmpty` when advanced matches 0 but base >0. Does NO map rendering (host `map` route is separate). Owns `.se-*` CSS (keep `.se-cmpwrap .se-cmp` min-width scoped — unscoped hits per-card buttons). Live paint (not full render) inside the filters modal.

**Deps:** `S`(S.adv/savedSearches/compareIds/modal/route/sport/query/filters), `PROGRAMS`, `DEMO_CATALOGUE`, `render`, `esc`, `money`, `fmtDate`, `slotsFor`, `sportColor/Glyph`, `toast`, `visiblePrograms`(guarded), `ICON`. Program fields: id,biz,title,sport,price,model,rating,reviews,minAge,maxAge,cap,enrolled,skill,verified,lat,lng,cancellationPolicy.

**Data:** `DEFAULT_ADV` (:63-74) full filter object (null end = unbounded); saved search `{id,name,at,time,count(frozen),snapshot:{sport,query,filters,adv}}`; `S.compareIds` capped 3. Full shapes + 18-step checklist in transcript. **Invariants:** pure applyAdvanced; DOM-node reuse; index-stabilised sort; recommended=rating→reviews; haversine on real coords; anchor via verified chip; live-paint in modal; no network.

---

# `src/mod-reviews.js` (767 lines, IIFE → `window.MOD_REVIEWS`)

**Purpose.** Three family-side surfaces: (a) the **reviews block** on a listing detail (aggregate + star histogram + list + gated write flow); (b) **athlete progress timeline** (`timeline` route); (c) **goal→plan builder** (`goals` route — outcome+target-date → phased plan with real catalogue matches). Stores on `S.reviews`/`S.goals`.

**Window API** (:758-765): `css`; `views:{timeline:timelineView, goals:goalsView}`; `modals:{review:reviewModal, goalintake:goalIntakeModal}`; `wire`; `reviewsFor(programId)`→HTML (called inline at host:9076 on listing detail); `state:{reviews:REVIEWS, goals:GOALS}`.

**Review logic (preserve):** a **completed booking is the only ticket to review** — `completedBooking(pid)` (status completed, or confirmed & date≤TODAY); `eligibility(pid)`→{ok,why} with 4 states (guest / nosession / already(one per family per program) / ok). `aggregate(list)`→{total,avg,dist[5..1]}; distinguishes seeded **catalogue rating** (`p.rating`/`p.reviews`) from **written Sporv reviews** — never fabricates. Submit is **client-only optimistic prepend** to S.reviews.

**⚠️ Double-blind is SERVER-side, not here:** this module renders only the family side (real author + "Verified booking"). The coach anonymization (`author:"A Sporv family"`) + publish gate live in host `hydrateReviews()` (host:17228-17251, loads only `published_at IS NOT NULL` via RLS `reviews_select_published`) + the `publish_review_pair` RPC. Coach-response UI is host-side (Operations→Reviews, host:11143). **Re-impl must keep coach-reply/publish OUT of this module.**

**Host wiring:** `timeline`/`goals` are family routes via `modView` (mega-menu `nav:timeline`/`nav:goals`); `reviews` is **embedded in listing detail, NOT a route** (`reviewsFor(p.id)` at host:9076); `tab:reviews` is the COACH menu (→Operations, host-rendered). Owns `.rv-*` CSS.

**Deps:** `S`, `PROGRAMS`, `DEMO_CATALOGUE`(prog() fallback — seed reviews carry seed ids), `SEED.parentUpdates`(timeline), `esc/money/fmtDate/ageOf/isVerified/requireAuth/render/toast/sportColor/Glyph/ICON`, `guestPreviewHTML`(guarded).

**Data:** review `{id,programId,author,initials,rating,date,verifiedBooking,body}` (live-hydrated adds author:"A Sporv family",response); goal `{id,athleteId,outcome,sport,target,weekly,createdAt}`; timeline entry `{date,kind,title,body,skills,practice?,encouragement?}`; plan `{age,weeks,phases[],picks[≤3 verified-only],sessions}`. **Server deps (RED):** reviews table, reviews_select_published RLS, publish_review_pair RPC.

---

# `src/mod-insights.js` (967 lines, IIFE → `window.MOD_INSIGHTS`)

**Purpose.** Coach-side analytics: (a) booking funnel + (b) local search demand — **seeded sample data**; (c) price positioning vs live catalogue + (d) client watchlist/retention — **derived at render time** from S.bookings/S.listings/slotsFor. Honesty rule: sample and derived never mixed in one sentence; every sample surface gets a "Sample data" badge, every derived one a "Derived" badge. Also drafts+sends a rebooking check-in into the family inbox.

**Window API** (:953-965): `css`; `tabs:{}` (**empty — no rail entry**, it's a sub-tab of Operations); `views:{insights:insightsView}`; `modals:{checkin:checkinModal}`; `wire`; `state`(demand/funnel/watchlist); and exported `demandCard()`, `watchlistCard()`, `availabilityWarnings()`. Registered automatically via `MOD_[A-Z]+` regex.

**Metrics:** price positioning (same sport+model peer set, min/max/median, prose read, track positions); availability (openSlots within N days, capacity, lapsed families); watchlist cadence (**broken when gap ≥ typicalGap×1.5**, or single-session ≥30d "never rebooked"); funnel (4 seeded stages); demand (top seeded search + "most-requested time you don't offer" cross-checked against real slotsOnWeekday). Pinned clock TODAY="2026-08-03".

**Host wiring:** `setCoachTab("insights")` **redirects to operations** (`S.coachTab="operations"; S.opsTab="insights"`, host:12556). Rendered two ways: new `coachOperationsPage()` (host:11121, calls `availabilityWarnings()`) and legacy operations block (host:11638, `modView("insights")`). Dashboard embeds `demandCard()` (host:10520) + `watchlistCard()` (host:10555) + `availabilityWarnings()` (host:10655). Self-injects `.in-*` CSS.

**⚠️ Two invariants:** (a) sample figure never without its badge, derived never without "Derived"; (b) `watchlistCard()` and `insightsView()` **both self-gate on `isCoachGuest()`** — real client names must never render for a signed-out coach (documented incident).

**Deps:** `S`(.listings/.bookings/.athletes/.auth.user/.conversations/.messages/.modal), `PROGRAMS`, `DEMO_CATALOGUE`, `render/toast/esc/money/fmtDate/slotsFor/modelLabel/sportColor/Glyph/setCoachTab`, `ICON`, `isCoachGuest`/`coachLockHTML`(guarded). No Stripe/RLS/auth/capacity mutation — only appends to S.messages.

---

# `src/mod-media.js` (1991 lines, IIFE → `window.MOD_MEDIA`)  ⚠️ COACH CAPABILITY

**Purpose.** The coach's **Media library** tab: profile media (headshot/intro_video/facility/action) + session media tagged to athletes, org-bio drafter, and a Videos section with "Analyze with AI" (demo; real read is RED Gemini). **The core is a per-athlete consent gate — because these are photos of children.** Client-only demo (seeded, no network).

**Window API:** `css`; `tabs:{media:"Media"}`; `views:{media:mediaView}`; `modals:{upload,consent,sharemedia}`; `wire`; `state:{mediaItems,mediaConsent}` (mediaConsent **Object.freeze**d); `strength()`→{pct,next}. Plus `_test` hook.

**⚠️ THE CONSENT GATE — `evaluate(item)`** (:265-304): returns {canShare,shareReason,canPublish,publishReason,blockKind∈{consent,untagged,null}}. Any tagged athlete with consent `none` blocks BOTH share+publish ("one child who said no is not outvoted"); any `private_share` blocks publish only; zero tagged → canShare false. `consentOf()` resolves unknown → `none` (absent = refusal). **Enforcement re-runs at ACTION time** (share/publish/upload handlers), not just via disabled buttons. This is the ONLY per-athlete child-media consent enforcement in the codebase.

**⚠️ PIVOT SCOPE FLAG:** this is a **coach dashboard tab (S.coachTab="media"), not a marketplace surface.** Deleting it removes: the consent gate (no replacement), public-profile media management, `strength()` (consumed by host dashboard host:10242/10587/10611 + getting-started — those go dead), the org-bio drafter, send-to-family + Videos/Analyze. **Recommend the owner KEEP it, or explicitly confirm removal.** At minimum the 3 `strength()` call-sites + rail tab/product-menu links (host:10160,8775,8379,12471) need cleanup.

**Data:** media item `{id,kind:profile|session,slot,mediaType:photo|video,durationSec,sessionId,programId,athleteIds[],caption,createdAt,published,shareable,sharedWith[],note}`; consent map `{athleteId: public_profile|private_share|none}` (frozen); `RULE`(featurePhotos:5,introMin/Max:30/60...); `SLOTS`. Two renderers in-file: current `.mfmt-*` dark surface (4 panes Profile/Library/Consent/Performance) + retired-but-live legacy `.md-*` stacked bands (has the standalone Videos + org-bio sections). Full checklist in transcript. **Invariants:** freeze mediaConsent; re-run evaluate at every action; `shareable = v.canShare && !!d.shareable` (defeats tampered DOM); guest-gate name display.

---

# `src/mod-productpages.js` (655 lines, IIFE → `window.SporvProductPages`)

**Purpose.** Owns the **18-page text-first marketing/product-tour surface** (the `page:<id>` routes from the mega-menu). Host owns navigation, `PAGE_META`, `pageCTA()`, and the `sig_*` interactive artifacts; this module owns **page composition + explanatory prose** (300–500 words each) so every page is auditable as rendered DOM. Each page = a stack of full-bleed `.pgband` sections built from 5 shared helpers (`hero`, `wrap`, `walkthroughSection`, `definitionSection`, `questionSection`). **The prose is the irreplaceable asset.**

**Window API** (:650-654): `window.SporvProductPages = { ids (18-id copy), has(id), render(id)→HTML ("" if unknown/meta-missing) }`. Reads optional `window.SporveOrgCompliance` + `window.SporveStaffCerts` to hydrate the two Enterprise pages for signed-in admins (else labelled sample). **Hardest dep: bare references to host `PAGE_META` + `pageCTA` — cannot run standalone.**

**THE 18 PAGES** (builder fn / recipe / rhythm — full prose recoverable from git `mod-productpages.js`, summarized here):
- `what-is` (whatIsPage :242, B01, D-L-L-D-L) — "Every sport. One app." — the shared operating record; 6-cell capability grid (Marketplace/Verification/Booking/Payments/Messaging/Progress); 3-question close (who/cost=0% + $34.99 Pro/when).
- `background-checks` (:384, B02, D-L-L-D-L) — "The check is *per person.*" — 5-step walkthrough (invite→vendor→review→dated badge→re-check); honesty panel "what a check cannot promise"; 4 parent Qs.
- `search` (:55, B03, L-D-L) — "Match the athlete, not just *the sport.*" — the matching rule (age range attached, symmetry, verification filterable); demo filter figure; comparison table.
- `map-search` (:109, R2, L-L-D) — "A list of coaches does not tell you *what a map does.*" — place-first; each pin = a listing's location; dark comparison table.
- `instant-booking` (:172, R4, L-L-D) — "Choose the opening and leave with *a confirmed session.*" — seat held during payment, capacity re-checked on write, confirmed only after charge.
- `athlete-progress` (:196, R4, D-L-L) — "The coach can change. *The record stays.*" — athlete-owned dated history, author+session on every entry.
- `roster` (:220, R4, D-L-L) — "Every client becomes *one working record.*" — import + auto-join, dedup before create, private to coach.
- `scheduling` (:87, R1, D-L-L) — "Publish the hours. Families take *the real openings.*" — recurring→dated openings; capacity closes the door; move week keeps history.
- `payments` (:297, R3, D-L-L) — "The whole booking is *the coach's payout.*" — no booking fee, Sporv 0%, subscription revenue; historical flat-fee bookings keep the fee recorded; worked math $45→$45.
- `bookings-receipts` (:274, R3, L-L-L) — "The session and its money stay *on one record.*" — policy snapshot at purchase, itemized receipt, 24h refund threshold.
- `messaging` (:331, R5, L-D-L) — "Ask first. Keep the answer *with the booking.*" — listing-context thread, no phone number, follows the session, can't bypass rules; safety exit.
- `session-notes` (:352, R5, L-D-L, **slate hero**) — "Write once. Send a note that *keeps its context.*" — draft coach-side → sent family copy joins progress; measurements beside not replacing observation.
- `media-consent` (:410, R6, D-L-L) — "A child's image moves only after *the parent's yes.*" — per-athlete (not blanket-team) consent, coach sees locked state, revoke closes future sharing; 5 Qs.
- `insights` (:139, R2, D-L-L) — "A dashboard number should explain *what changed.*" — DEMO (search demand+funnel, labelled sample) vs LIVE (bookings/earnings/price/availability/returns); watchlist private.
- `enterprise` (:437, R2, L-L-L) — "One organization. *One operating record.*" — live/sample board (staff count + clearance % go live; athlete/program counts dropped on real board); "in development".
- `enterprise-roster` (:486, R4, D-L-L) — "Every household and every hire, *on one roster.*" — households (guardian→athletes) + staff (person+role+locations+bg-state, fails closed); sample figure.
- `enterprise-finance` (:510, R3, D-L-L) — "Pay the whole staff, *from one ledger.*" — revenue split divides COACH revenue not a marketplace cut (0%); worked math $90 → 60/40; recurring memberships.
- `enterprise-compliance` (:536, R6, D-L-L) — "Trust that *fails closed.*" — live/sample compliance board + a **cert write-form** (member/kind/expiry, `data-certsave`, always `status:'pending'` — DB rejects client-set 'verified'); 5 Qs incl. COPPA.
- (NOT here: `saved` is redirected to `search` by host `pageHTML`; `ai-coach` renders from the host's own branch.)

**Host wiring:** `pageHTML(id)` (host:13103) redirects saved→search, reads `PAGE_META[id]`, delegates to `SporvProductPages.render(id)` if `has(id)` (legacy in-host branches are a no-module recovery path). `PAGE_META` (host:12837, `{t,d,sport,cta,ctaL}` per page; enterprise-* → pricing cta). `pageCTA(meta)` emits the hero CTA. **`PAGE_SPORT` in build.py (:160-173)** maps each page→hex hue; `_sport_vars()` derives WCAG-safe `--ps-ink`/`--ps-bright` and **fails the build** on a contrast miss. Live hydration: `hydrateOrgCompliance()`/`hydrateStaffCerts()` (host:17314/17343) set the two `window.Sporve*` globals; `data-certsave` handler (host:14590) POSTs a pending cert.

**⚠️ THE slop-audit RECIPE CONTRACT (smoke will fail without it):** each page root must be `<div class="pgroot pg-<id> rebuild-page" data-product-page="true" data-page-id data-recipe data-composition data-rhythm>` with the EXACT recipe/composition/rhythm values (slop-audit.js:156-202). Rule H enforces: body prose 390–500 words, standfirst 50–80 words, body ≤16.1px, `.pg-hero` ≤45vh at 3 breakpoints, no two nav-adjacent pages share a fingerprint (`id|rhythm|H:<heroGeom>|B:<bodyGeom>`), KX footer absent, saved→search redirect. **Verify by rendered DOM, never by grepping index.html** (runtime-generated strings).

**Rebuild checklist:** IIFE self-registering `{ids,has,render}`; define `IDS` (18, exact order); build the 5 shared helpers with exact class output (the 4 `data-*` attrs on `wrap()` are contract-enforced); write the 18 builders with the prose from git (word budget 390–500/50–80, `data-prose`/`data-standfirst` marks); Enterprise live/sample fork (guard `window`, read SporveOrgCompliance/StaffCerts, escP, cert form only when `oc.total && oc.orgId`, always pending); confirm host `PAGE_META`/`pageCTA`/hydration/`data-certsave`/`pageHTML` delegation + saved→search; add `PAGE_SPORT` entries in build.py (AA-clean); ensure CSS for all `.pg-*` classes; `python3 src/build.py` + `bash src/smoke.sh` (exit 0).
