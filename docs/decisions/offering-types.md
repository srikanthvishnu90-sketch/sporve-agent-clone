# Offering types — the taxonomy the schema is built on

Extracted verbatim from `src/mod-companies.js` (deleted per spec 01, 2026-08-31)
and `docs/offering-taxonomy.md`. Spec 02's `programs.offering_type` column
('private'|'camp'|'team', applied to prod 2026-08-31) encodes exactly this.

## The three shapes

| type | verb | scarce thing | billing shape |
|---|---|---|---|
| private | BOOK | a slot on one coach's clock | per session or package |
| camp | RESERVE | a seat in a fixed week | one charge upfront |
| team | APPLY | a spot on a roster | season total split into N installments |

## The original reasoning (mod-companies.js header, verbatim)
```
/* ═══════════════════════════════════════════════════════════════════
   MOD_COMPANIES — the sample businesses as first-class entities,
   plus offering-type-aware booking.

   Thesis: a team, a camp and a private trainer are three different
   commercial objects, not three variants of one booking.

     private → BOOK    · scarce = a slot on one coach's clock
     camp    → RESERVE · scarce = a seat in a fixed week
     team    → APPLY   · scarce = a spot on a roster

   The catalogue has no offering-type field — pricingModel (single_session
   / monthly / package) is doing double duty as billing cadence AND product
   kind, and does it badly. OFFERING below supplies the missing axis for all
   thirty listings, keyed to the ids in lib/core/mock/mock_data.dart.

   Contract: registers window.MOD_COMPANIES and never redefines a host
   symbol. Every class is co-prefixed. Reads PROGRAMS / S / sportColor /
   PICON from the host, writes nothing outside its own state keys. The two
   public views are stacks of full-width `.band` sections, matching
   productHTML(); nothing here owns a page-level ground of its own.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

/* ── local helpers (shadow nothing, depend on little) ─────────────── */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const sc  = s => (typeof sportColor === "function" ? sportColor(s) : "#223140");
/* The host's stroke icon set, read the same defensive way as ICON. Nothing in
   this module draws an emoji any more; a missing PICON renders nothing rather
   than falling back to a colour-font glyph on a different optical baseline. */
const pic = k => (typeof PICON !== "undefined" && PICON[k]) || "";
const H   = () => S;
/* DEMO_CATALOGUE, not PROGRAMS. This module is ABOUT the six sample businesses
   declared below — every figure on its two views is counted by matching
   `p.biz` against a COMPANIES name. Once mod-catalog.js swaps PROGRAMS for live
   rows, no live listing carries one of those names, so this would count zero
   programmes and zero sports under six business headings and render a
   confidently wrong stat block. Pointing it at the seeded array keeps the
   surface internally consistent; Phase C3 replaces it with real providers. */
const CAT = () => (typeof DEMO_CATALOGUE !== "undefined" && DEMO_CATALOGUE
  ? DEMO_CATALOGUE
  : (typeof PROGRAMS !== "undefined" && PROGRAMS ? PROGRAMS : []));
const $$  = sel => Array.prototype.slice.call(document.querySelectorAll(sel));
const usd = n => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

const MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/* ISO in, "Jun 7" out. Parsed as UTC so the label never slips a day by zone. */
function fmt(iso){
  const p = String(iso).split("-");
  return MONTH[Number(p[1]) - 1] + " " + Number(p[2]);
}
function fmtY(iso){ return fmt(iso) + ", " + String(iso).split("-")[0]; }
/* Calendar maths without a Date round-trip through local time. */
function shift(iso, days){
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

## The stored-column lesson (docs/offering-taxonomy.md, verbatim)
```
# Offering taxonomy — private / camp / team

Extracted 2026-08-30 from the marketplace modules **before** they are deleted
(Task 2 of the B2B pivot). This is the design memory the deletion would
otherwise erase. Source of truth for the three offering types the new `offering`
table (SPEC / Task 1) will encode as `type: private | camp | team`.

## The three types, as the shipped code actually classified them

`ptypeOf(p)` in `src/sporve-web.host.html:6210-6219` was the live classifier.
Its hard-won lesson, in one line from its own comment: **"camp is not a provider
type at all; a camp is a listing format."** So the three offering types do NOT
map one-to-one onto `providers.provider_type` — two of them do, one is a format.

| offering type | what it is | shipped signal | prod schema anchor |
|---|---|---|---|
| **private** (was `solo`) | an independent coach's 1:1 or small-group instruction | `providers.provider_type = 'solo'` (`PTYPE_FROM_PROVIDER={solo:"solo"}`) | `providers.provider_type='solo'`; `programs.pricing_model='single_session'` |
| **camp** | a time-boxed multi-day clinic/class — a *format*, sold by either a solo coach or an org | title/skill regex: `/\bcamp\b\|clinic\|class\|intro\|foundation\|fundamental\|learn-to\|\bbasics\b/` (`:6216`) | NO provider_type; a listing attribute. Nearest real column today: `programs.program_type` + title. Prod already has a `camps`/`camp_roster` pair in APP migrations (not in this baseline). |
| **team** (was `org`) | an organization's squad/league/season — dues-based, recurring | `providers.provider_type = 'organization'` OR title `/squad\|league\|\bclub\b\|academy\|\bteam\b\|dojo\|institute/` OR `pricing_model='monthly'` (`:6217`) | `providers.provider_type='organization'`; `pricing_model in ('monthly','seasonal')`; `organization_members` roster |

## The two traps the deletion must not re-introduce

1. **Two classifiers that disagreed.** `mod-catalog`'s `ptypeOf()` sorted into
   solo/camp/org, while `mod-companies`' `typeOf()` keyed off literal `prog_N`
   ids and labelled all ten listings `private` — "two type systems that now
   disagree with each other" (`mod-catalog.js:246-248`). The new `offering.type`
   column ends this by being **stored, not inferred** — never re-derive type
   from a title regex again.
2. **The empty-band bug.** When type was guessed from the title, the "team"
   band went permanently empty because every live row was `single_session`
   (`mod-catalog.js:241-248`). Lesson for Task 1: `offering.type` must be a
   real, writable column set at creation, not a function of price model.

## Guidance for Task 1's `offering` table

- `offering.type text NOT NULL CHECK (type IN ('private','camp','team'))` —
  stored explicitly, the fix for both traps above.
- `private` ⇒ owned by a solo provider; `team` ⇒ owned by an org
  (`provider_type='organization'`); `camp` ⇒ either, distinguished by `type`,
  never by title.
- Pricing hint (not a constraint): private→single_session, camp→package/fixed,
  team→monthly/seasonal. Do not couple type to pricing_model (that coupling was
  the empty-band bug).

## What is being deleted around this (Task 2)

`mod-catalog` (the PROGRAMS seed→live swapper + `ptypeOf` design notes),
`mod-companies` (the disagreeing `typeOf`), `mod-search`, `mod-media`,
`mod-productpages`, `mod-reviews`, `mod-insights`. Kept: `mod-booking`,
`mod-safety`, `mod-payments`, and the coach-ops surface. The host's `ptypeOf()`
(`:6210`) and `KIND_BANDS` browse UI are marketplace-discovery and go with them;
this doc preserves their taxonomy so Task 1 can encode it properly.
```
