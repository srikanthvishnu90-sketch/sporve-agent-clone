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
