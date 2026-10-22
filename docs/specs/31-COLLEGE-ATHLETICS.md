# 31 — College athletics (NCAA Division II and III)

Owner brief, 2026-10-22, saved here so every agent builds against one document.
D2 and D3 athletic departments have tight budgets and small staffs; they want a
single place where a lean department runs everything. This spec maps each part
of the brief to what the repo has today, what is missing, and the build order.

Status legend: **HAVE** (in production code), **PARTIAL**, **MISSING**.
Tier legend from `CLAUDE.md` §12: GREEN (ship), YELLOW (PR, human merges),
RED (draft only; the owner applies migrations, RLS, auth and secrets by hand).

---

## 0. Premises checked before building (CLAUDE.md rule 9)

| Brief says | What is actually true | Consequence |
|---|---|---|
| Medical module must be "HIPAA-compliant" | Athletic-training records held by a school are usually **education records under FERPA**; HIPAA applies only if the school's health provider is a covered entity (for example, it bills insurance electronically). Varies by school. | Build to the stricter of the two (encryption, access logging, minimum-necessary access), and have counsel confirm per customer. Do not market "HIPAA-compliant" until a lawyer and a signed BAA process exist. |
| Export into "NCAA Compliance Assistant (CA)" | Not verified that CA is still the NCAA's current compliance tool; the NCAA has moved several compliance workflows to newer online systems. | Confirm the current NCAA tool and its import format with a real compliance officer before building the exporter. |
| "NCAA LiveStats" ingestion | NCAA LiveStats exists; many D2/D3 SIDs also run StatCrew, which exports XML. | Build one ingestion endpoint that accepts the stat-provider's XML/JSON file; start with whichever format the first customer's SID uses. |
| Read-only sync with Ellucian Banner / Workday | Possible, but each school's IT department must grant API access, which takes weeks and often a security review. | Ship a scheduled CSV import from the registrar first; add live connectors per customer. |
| SSO via Shibboleth / Okta / Azure AD | Supabase Auth supports SAML 2.0 single sign-on (paid plan). Shibboleth, Okta and Azure AD all speak SAML. | Feasible; one SAML connection per school. |
| Website CMS for the public athletics site | Most D2/D3 sites run on SIDEARM Sports or PrestoSports, which schools pay for already. | Module B should **push** rosters, schedules and results into the school's existing site (feed or embed) before trying to replace it. |
| Positioning | `CONTEXT.md` §4 targets clubs, trainers and gyms. Colleges are a new segment. | Owner decision 2026-10-22 adds colleges; record it in `CONTEXT.md` when Phase 1 starts. |

---

## 1. Tenant architecture

| Requirement | Status | Notes |
|---|---|---|
| Institution (athletic department) as the root tenant | PARTIAL | `organizations` + `organization_members` exist. Missing: an institution type, a verified email domain (e.g. `mit.edu`) used for SSO and auto-join. |
| Sub-tenant per sport (Men's Soccer, Women's Basketball) | PARTIAL | `teams` exists but hangs off `provider_id`, not the organization, and has no gender/level/season. Needs `organization_id`, `gender`, `level` (varsity/JV/club), `season`. |
| Shared data, isolated views per team | MISSING | RLS today is per provider/org. Needs team-scoped policies so a head coach sees only their team. |
| Strict tenant isolation | HAVE (org level) | RLS on every public table is invariant I6. Extend the cross-org test to cross-team. |

## 2. Roles (RBAC)

Current role values: `owner, director, treasurer, registrar, coach`. Proposed
mapping, keeping existing values so nothing breaks:

| Brief role | Maps to | Scope | Status |
|---|---|---|---|
| Athletic Director | `owner` / `director` | Whole department: budgets, compliance flags, all teams | PARTIAL (no budget data yet) |
| Compliance Officer | **new** `compliance` | Read/write eligibility, medical clearances, roster locks; all teams | MISSING |
| Sports Information Director | **new** `sid` | Rosters, schedules, stats, media; all teams; no medical, no eligibility notes | MISSING |
| Athletic Trainer | **new** `trainer_medical` | Medical records only (needed by Module D; not in the brief's table) | MISSING |
| Head Coach | `coach` + team assignment | Their own team(s) only | PARTIAL (role exists; team scoping missing) |
| Student-athlete | **new** `athlete` (end user) | Own schedule, own forms, log hours | MISSING (today athletes have no login; families use magic links) |

Implementation: a `team_staff (team_id, member_id, role)` table for per-team
assignments, plus department-wide roles on `organization_members`. One SQL
helper, `has_team_access(team_id, capability)`, used by every policy. **RED.**

## 3. Modules

The repo already ships features as separate `mod-*.js` files, and
`plan_entitlements.modules[]` (CONTEXT.md §6.2) already exists to switch
modules on per customer. College modules plug into the same mechanism.

### Module A — Compliance and eligibility (the anchor)
| Requirement | Status |
|---|---|
| Credit-hour and GPA tracking per athlete per term | MISSING (needs an `academic_terms` record per athlete) |
| Transfer portal tracking | MISSING |
| Eligibility status per athlete | PARTIAL (agent produces eligibility findings; no stored status) |
| **Roster Lock**: block an ineligible athlete from a game-day lineup | MISSING. Must be enforced in the database (a trigger on lineup insert), not just a greyed-out button, so no client can bypass it. **RED.** |

### Module B — Sports information
| Requirement | Status |
|---|---|
| Roster builder, schedule builder | PARTIAL (Clients and Schedule pages) |
| Game-day program generator | MISSING (PDF from roster + schedule) |
| Live-stat XML/JSON ingestion that updates the public site | MISSING (edge function + feed for the school's site) |

### Module C — Logistics and operations
| Requirement | Status |
|---|---|
| Facility booking with cross-sport conflict detection | PARTIAL (venues, blackouts and conflict findings exist from 2026-09-15 migrations) |
| Travel: buses, hotels, per-diem tracking | MISSING |

### Module D — Sports medicine
| Requirement | Status |
|---|---|
| Injury log, rehab status, medical clearance | MISSING |
| Access limited to athletic trainers and the compliance officer; every read logged | MISSING. Builds on invariant I7 (minors' data compartmented). **RED**, plus legal review (section 0). |

## 4. Integrations

| Integration | Status | First version |
|---|---|---|
| SSO (SAML) | MISSING | One SAML connection per school via Supabase SSO. **RED** (auth). |
| Registrar (Banner, Workday) | MISSING | Scheduled CSV import of enrollment and GPA, read-only. |
| NCAA exports | MISSING | Confirm current tool and format first (section 0). |
| Stats (LiveStats / StatCrew) | MISSING | File ingestion endpoint. |

## 5. Pricing (not built; owner decision needed)

Annual subscription per department: base tier = tenant management, SSO, and
three modules (Compliance, Rosters, Scheduling); flat add-on per additional
team rather than per user. The pricing page was removed on 2026-10-22, so this
lives in sales conversations, not on the site, until prices are decided.

---

## 6. Build order and honest effort

Each phase ends with a demo to one real D2/D3 department before the next starts.

1. **Phase 1, about 10 days: tenant + roles.** Institution fields and domain,
   teams under the organization with gender/level/season, `team_staff`, the
   new roles, `has_team_access()`, team-scoped RLS, cross-team isolation test.
   RED: migrations and RLS are drafted here and applied by the owner.
2. **Phase 2, about 10 days: Module A.** Academic terms, eligibility status,
   lineups, the Roster Lock trigger, compliance officer views, registrar CSV
   import.
3. **Phase 3, about 7 days: SSO.** SAML per school, domain auto-join.
4. **Phase 4, about 10 days: Module C travel + facility booking across sports.**
5. **Phase 5, about 10 days: Module B** stats ingestion and site feed.
6. **Phase 6, scoped after legal review: Module D** medical records.

About 50 working days of engineering before a D2/D3 department could run on
Sporv end to end. Phases 1 and 2 alone are enough for a paid pilot: the
compliance anchor plus correct permissions is the part a department cannot get
from its current spreadsheets.
