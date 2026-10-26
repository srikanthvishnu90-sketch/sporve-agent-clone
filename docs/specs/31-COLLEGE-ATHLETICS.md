# 31 — College athletics (NCAA Division II and III)

Owner brief, 2026-10-22, saved here so every agent builds against one document.
D2 and D3 athletic departments have tight budgets and small staffs; they want a
single place where a lean department runs everything. This spec maps each part
of the brief to what the repo has today, what is missing, and the build order.
Expanded the same day after the owner judged the first draft "only 10%".

Status legend: **HAVE** (in production code or a committed migration that is
applied), **PARTIAL** (some of it exists, or exists only as a migration file
whose production state is not verified), **MISSING**.
Tier legend from `CLAUDE.md` §12: **GREEN** (ship), **YELLOW** (PR, human
merges), **RED** (draft only; the owner applies migrations, RLS, auth and
secrets by hand; files go to `docs/red-drafts/`).

A VERIFY tag means a factual claim (NCAA rule, law, vendor capability) that
this document does not assert as true. Each one must be confirmed by the named
person before the dependent code ships.

---

## Two pillars

Owner update, 2026-10-22: Sporv for colleges is two co-equal pillars.

| Pillar | Job | Modules |
|---|---|---|
| **MANAGE** | Run the entire program, up to an entire athletic department | A Compliance and eligibility, B Sports information, C Logistics, D Sports medicine |
| **SOURCE** | Find the best people and manage potential recruits until they enrol | E Recruiting and sourcing |

**One data model, one lifecycle.** A person enters as a *recruit* in Source
and, on enrolment, becomes a *student-athlete* in Manage. Nothing is
re-keyed and nothing is copied by hand:

```
recruits ──(convert_recruit_to_athlete on enrolment)──> student_athletes
   │                                                       │
   ├─ recruit_pipelines (per sport program) ───────────────┼─ athlete_team_memberships (per team)
   ├─ recruit_offers (aid) ───────────────────────────────>├─ budget_lines (aid budget, Module C)
   ├─ recruit_visits ──> travel_trips / venue_booking (Module C)
   ├─ transfer-portal fields ─────────────────────────────>├─ transfer_records, seasons_of_competition (Module A)
   └─ recruit_contacts ──> audit_log                        └─ eligibility_status (Module A)

roster needs (Manage) ──> recruiting_targets and gap analysis (Source)
```

The two pillars also share: the institution tenant (`providers`), sport
programs and teams (§2), the role and capability system and its helpers
(§3), the rule-as-data engine (`compliance_rules`, §4.2), the draft-first
inbox (`obligations`), `audit_log` and `data_access_log` (§10), SSO (§8.1)
and entitlements (§13).

**How this document is laid out.**

- §0 Premises (both pillars).
- **Part I — Manage**: §1 context, §2 schema, §3 RBAC (§2 and §3 are the
  shared foundation that Part II builds on), §4-§7 Modules A-D, §8
  integrations.
- **Part II — Source**: E1-E13, Module E recruiting and sourcing.
- **Part III — Shared**: §9 agent behaviour, §10 security and audit, §11
  onboarding, §12 screens (Manage roles; Source screens are in E11), §13
  pricing, §14 acceptance tests (both pillars), §15 phased plan (both
  pillars, Source placed explicitly, not last).

---

## 0. Premises checked before building (CLAUDE.md rule 9)

### 0.1 Repo facts this spec is grounded on

Checked against `supabase/migrations/` on 2026-10-22. Line numbers refer to
`supabase/migrations/00000000000000_baseline.sql` unless another file is named.

| Fact | Evidence | Consequence for this spec |
|---|---|---|
| **There is no `organizations` table.** The org root is `public.providers`. | `organization_members.organization_id` has FK `organization_members_organization_id_fkey → providers(id)` (line 895). `20260915_001050_venue_and_blackout.sql` header: "Org root is public.providers (no organizations table exists)". | The institution is a `providers` row. Every "organization_id" in the brief means `provider_id` here. New tables carry `provider_id uuid not null references providers(id)`. |
| `teams` is already keyed to the org. | `teams(id, provider_id, name, sport, created_at)` (line 639), FK to providers (line 943); `season_id` added in `20260831_001001_seasons.sql`; `target_size` in `20260922_001110_teams_target_size.sql`. | The first draft's claim that teams "hang off provider_id, not the organization" was wrong: provider_id *is* the organization. Teams need gender, level, sport program, not a new parent. |
| Org roles in the database are `owner`, `admin`, `trainer`. | `organization_members_role_check` (line 803). A `treasurer` value exists only in `docs/red-drafts/2026-09-08-treasurer-role.sql`, not in the baseline. | The names `director/treasurer/registrar/coach` are **display mappings**, not stored values: `20260915_001073_dashboard_home.sql` lines 22-29 map `providers.owner_id → owner`, `admin → director`, `trainer → coach`. College roles must be added as a new assignment table, not by stretching the CHECK. |
| One admin helper exists: `is_org_admin(p_org)`. | Line 2729: true for `providers.owner_id = auth.uid()` or an active member with role owner/admin. Used by `venue`, `event`, `blackout_window`, `staff_certifications` policies. | New helpers `has_org_capability()` and `has_team_access()` sit beside it; `is_org_admin` stays as the superuser short-circuit. |
| `athletes` is the **youth child** table owned by a parent. | `athletes(id, parent_id → profiles, first_name, date_of_birth, medical_conditions, emergency_contact, parent_consent, ...)` (line 108, FK line 865). Policies are parent-only (lines 4467-4470). | Student-athletes must **not** go in `athletes`. New table `student_athletes`. Mixing an adult FERPA record into a COPPA-consented child table would break invariant I7's compartment. |
| `team_athletes` has become the member row. | Baseline columns `team_id, athlete_id, jersey_number, is_available, is_paid` (line 630); later `provider_id` (`20260831_001007_member_without_team.sql`), `first_name, last_name, dob, external_ref, status` (`20260831_001010_member_identity.sql`), `season_id`. `agent_findings.member_id → team_athletes(id)`. | College memberships get their own table `athlete_team_memberships`; see 2.6 for why `team_athletes` is not reused. |
| `seasons` exists, org-scoped. | `20260831_001001_seasons.sql`: `seasons(id, provider_id, name, start_date, end_date)`; RLS owner-only. | Reuse; add `sport_program_id`, `segment`, `academic_year`. |
| `event` exists (singular), with `kind in ('practice','game',...)`, `team_id`, `venue_id`, `opponent`, `home_away`, `published_at`, ICS `sequence`. | `20260915_001052_event.sql`. | Competitions are `event` rows with `kind='game'`. No new `events` table. |
| `venue` and `blackout_window` exist; conflicts are computed by `event_conflicts_in_range(provider, from, to)`. | `20260915_001050_venue_and_blackout.sql` ("FILE ONLY — never applied by an agent"); `20260915_001069_event_conflicts_and_cancellation.sql`; `20260915_001076_member_conflicts.sql`. | PARTIAL: migration files exist; production application is not verified here. Facility booking extends `venue`. |
| `facilities` already exists and is a **shared public scouting directory**. | `20260915_001050` header: "facilities is a shared scouting directory with `USING (true)` reads and no org owner." | Do **not** create or reuse a table named `facilities` for department spaces. Use `venue` + new `venue_space`, `venue_booking`. |
| `plan_entitlements` has `modules text[]` per **plan key** (`free`, `pro`, `enterprise`). | `20260921_001108_billing_pipeline_repair.sql` lines 43-116. There is no per-org entitlement override table. | Per-school module add-ons need a new per-org entitlements table (RED). See §13. |
| The approval inbox is `obligations` (status `draft` → approved). The agent-never-sends trigger is `000200`. | `20260830_000200_obligations.sql`; CONTEXT §3 I1. `outbound_messages` and `parent_updates` also carry `approved_by/sent_at`. | Every college agent draft lands in `obligations` with `source_kind` and an `inverse`. No new send path. |
| Audit tables exist but are narrow. | `ai_audit_log` (line 42), `settings_audit` (`20260901_001018`), `intake_audit` (`20260922_001115`), `cron_http_audit`. | No general `audit_log` and no read log exist. Both are new (§10). |
| Waivers exist. | `waiver_documents(provider_id, title, body_md, version, content_hash)` and `waiver_signatures` (`20260831_001005_waivers.sql`). | Reuse for signed forms; add `document_requirements` for physicals and screenings. |
| Calendar feeds exist for guardians only. | `calendar_feed_tokens(provider_id, guardian_id → guardians, token)` (`20260915_001070`). | Add a feed-token table for staff and student-athletes, and a public team feed. |
| Vault is in use for secrets. | `vault.decrypted_secrets` read at baseline lines 2602-2624. | Vault is available for key storage. Column encryption design in §7.6. |
| "Eligibility" today means *unpaid or waiver unsigned*. | `generate_eligibility_report()` in `20260901_001015_agent_v2.sql` builds "Who can't play Saturday" from installments and waivers. | No academic eligibility exists anywhere. Module A is entirely new. |
| The agent product is moving to its own Supabase project. | `docs/decisions/2026-09-15-decisions.md`: "SPLIT THE PROJECTS". | Every RED migration in this spec targets the agent project. |
| `docs/gaps.md` does not exist; `docs/incident-runbook.md` does. | `ls docs/` | §10 ties into the runbook; owner gaps for this spec are the open questions in §15.2. |
| **A `prospects` table already exists** and means club trial/enrolment inquiries. | `20260922_001115_agent_intake_layer.sql` line 583: `prospects(provider_id, event_id → intake_events, name, email, phone, source, status in ('trial','inquiry','enrolled','dropped'), note)`; rows created only via approved `intake_proposals`. | Recruits must **not** go in `prospects`. Module E uses a new table `recruits`. Inbound recruit email can still arrive through `intake_events` and be matched to a recruit. |
| `guardians` + `guardian_links` exist, linked to `team_athletes`. | `20260831_001002_guardians.sql`: `guardians(provider_id, user_id, first_name, last_name, email, phone)`; `guardian_links(guardian_id, member_id → team_athletes, is_payer, relationship)`. | Recruit guardians get their own table `recruit_guardians` so minors' recruiting contacts stay compartmented by sport program (I7) rather than visible to every org admin through the club guardian policies. |

### 0.2 Claims in the brief, checked

| Brief says | What is actually true | Consequence |
|---|---|---|
| Medical module must be "HIPAA-compliant" | Athletic-training records held by a school are generally **education records under FERPA**; HIPAA applies only if the treating provider is a covered entity (for example, it bills insurance electronically) and the record is not an education record. Varies by school. VERIFY with counsel. | Build to the stricter of the two (encryption, access logging, minimum necessary). Do not market "HIPAA-compliant" until counsel signs off and a BAA process exists (§7.8). |
| Export into "NCAA Compliance Assistant (CA)" | Not verified that CA is the NCAA's current tool; the NCAA has moved several workflows to newer online systems. VERIFY with a compliance officer. | Exporter format is TBD. Phase 2 ships CSV exports in our own documented layout. |
| "NCAA LiveStats" ingestion | NCAA LiveStats exists; many D2/D3 SIDs run StatCrew, which exports XML. VERIFY the exact XML schema with the pilot SID. | One ingestion endpoint, format adapters per provider; first adapter is whichever the pilot SID uses. |
| Read-only Banner / Workday sync | Possible; each school's IT must grant API access, usually after a security review. | CSV import first (§8.2), live connectors per customer later. |
| SSO via Shibboleth / Okta / Azure AD | Supabase Auth supports SAML 2.0 SSO on paid plans, configured per provider via the CLI/Management API. VERIFY current plan requirement and per-connection limits. Shibboleth, Okta and Entra ID all speak SAML. | Feasible; one SAML connection per school. RED (auth). |
| Website CMS for the public site | Most D2/D3 sites run on SIDEARM Sports or PrestoSports. VERIFY per customer. | Module B **feeds** the existing site (JSON, iCal, RSS, embed). We do not replace the CMS. |
| Live stats on the public site | CONTEXT §10 puts **live scoring** out of scope. | Ingest finished or periodic stat files only. No in-game scoring console. |
| Positioning | CONTEXT §4 sells to clubs, trainers, gyms. Colleges are new. | Owner decision 2026-10-22 adds colleges; record in `CONTEXT.md` §4 when Phase 1 starts. |
| Pricing "annual base + per-team add-on + module add-ons" | CONTEXT §6.1: plan keys `free/pro/enterprise`; checkout sells monthly only; "No annual, no add-ons at launch"; "pricing page shows exactly two paid cards". | Direct conflict. Proposed resolution in §13: colleges are Enterprise, invoiced annually off-Stripe-Checkout, with per-org entitlements. **Owner must rule.** |
| Agent drafts eligibility alerts, travel memos, recaps | GATES.md rule 4: "no new AI tool until G4 is TRUE". G4 is FALSE. | The rule engine and Roster Lock are deterministic SQL, not AI, and may ship. Every **new agent generator** in §9 is blocked behind G4. |
| Recruiting incumbents to import from | ARMS, Front Rush and Teamworks Recruiting are commonly named college recruiting tools; prospects also post profiles on NCSA, SportsRecruits and FieldLevel. VERIFY current product names, export formats and whether each offers an export at all. | CSV import with a column-mapping screen first; named adapters only after a real export file is in hand. |
| NCAA recruiting calendars (contact, evaluation, quiet, dead periods; first permissible contact dates; visit limits) | These exist and differ by division and sport, and change often. Not stated here as fact. VERIFY every value. | Stored as data (`recruiting_periods`, `compliance_rules` with `recruiting.*` keys), shipped unverified, verified by the compliance officer. |
| National Letter of Intent / signing documents | The NCAA has changed the signing process in recent years (VERIFY whether the NLI program still exists and what replaced it for D1/D2; D3 uses a non-binding celebratory signing form). | `recruit_offers` records a generic `signed_document_kind` with values set from the verified answer. |
| D3 athletic aid | D3 does not permit athletically related aid (VERIFY). | Same trigger as §2.7: a D3 offer with athletic aid is rejected. |
| Most high-school prospects are minors | Ages roughly 14-18; COPPA covers under-13 only, but invariant I7 and state student-privacy laws apply (VERIFY per state). | Guardian records, consent tracking, compartmented contact data, retention and deletion of unsigned prospects (E8). |
| Which gate does this advance? | None of G1-G4. GATES rule 1 requires saying so. CONTEXT §11 puts the two hard gates first. | This is a new-segment spec. It is planning work, not progress. Phase 1 should not start while G2 (first real payment) is open unless the owner explicitly reorders. |

---

# Part I — Manage

Run the program, up to the whole department. §2 and §3 are also the shared
foundation for Part II.

## 1. Context and goal

### 1.1 The buyer and the users

| Person | What they own | How many at a D2/D3 school (typical, VERIFY in discovery) |
|---|---|---|
| Athletic Director (AD) | Budget, hiring, compliance accountability, conference relationships | 1 |
| Associate / Assistant AD | Delegated areas: operations, compliance, business, student-athlete welfare | 1-3 |
| Compliance officer | Eligibility certification, transfer paperwork, rules education, CARA logs | Often 0.5 FTE, frequently an associate AD or registrar staffer doing it part time |
| Sports Information Director (SID) | Rosters, bios, stats, schedules, results, game programs, website | 1, sometimes with student workers |
| Head coach | One sport program | 12-25 programs |
| Assistant coach | Delegated team work | 0-3 per program, many part time |
| Head / staff athletic trainer | Injuries, treatment, return to play, physicals | 1-4 |
| Team physician | Clearances, concussion sign-off | Contracted, part time |
| Business office | Purchase orders, travel advances, per diem, budget actuals | Shared with the institution |
| Student-athlete | Own schedule, forms, hours, travel | 200-600 per department |
| Auditor | Read-only during an NCAA or conference review | Occasional |

The **buyer** is the AD; the **champion** is usually the compliance officer or
the associate AD for operations, because they feel the spreadsheet pain most.

### 1.2 What they use today (VERIFY in discovery calls)

| Job | Common tools | Pain |
|---|---|---|
| Eligibility | Excel per sport, registrar reports, NCAA online systems | Re-keyed every term; no history; certification sign-off lives in email |
| Team operations | Teamworks (scheduling, comms), group texts, email | Priced for D1; D2/D3 departments often cannot justify it |
| Sports medicine | ARMS, Sports Injury Management System, paper | Separate login; clearance status not visible to the person building the lineup |
| Stats and site | SIDEARM or PrestoSports CMS, StatCrew, NCAA LiveStats | Manual roster duplication between CMS, stat software and compliance list |
| Academics | Banner, Workday Student, Colleague, PeopleSoft (SIS) | Athletics gets CSV exports by email from the registrar |
| Money | Institution ERP, P-cards, spreadsheets per team | Coaches do not know their remaining budget |
| Travel | Email chains, spreadsheets, charter bus quotes | Missed-class notices to faculty typed by hand |

### 1.3 The pain in one paragraph

A D2/D3 department runs the same compliance obligations as a larger school
with a fraction of the staff. The single most expensive failure is an
ineligible athlete playing in a contest, which can lead to forfeits and
self-reports (VERIFY consequences per division with the compliance officer).
That failure happens because the person who knows the athlete is ineligible
(compliance) is not the person who submits the lineup (coach), and nothing
between them is enforced.

### 1.4 What "done" looks like for a paid pilot

A pilot is done when one D2 or D3 department, for one full term:

1. Imports its registrar CSV every term and sees each athlete's computed
   eligibility status, with reasons.
2. Has its compliance officer certify every rostered athlete in Sporv, with a
   stored sign-off.
3. Cannot submit a game roster containing an athlete who is not certified
   eligible (Roster Lock), and every override is logged with a reason.
4. Gives each head coach a login that sees only their team.
5. Signs in through the school's SSO.
6. Exports an auditable eligibility history on demand.

Modules B, C and D are not required for the pilot. Phases 1-3 in §15 are.

---

## 2. Tenant model and schema

### 2.1 Hierarchy

```
providers (the institution / athletic department)       -- exists
  └── sport_programs (Women's Basketball, persistent)     -- new
        └── teams (one season instance of a program)      -- exists, extended
              ├── athlete_team_memberships                -- new
              ├── team_staff                              -- new
              └── event (practices, competitions)         -- exists
                    └── game_rosters → lineup_entries     -- new
  └── student_athletes (one per person)                   -- new
  └── academic_terms → athlete_term_records               -- new
```

A sport program persists across years; a team is that program in one season
(`2026-27 Women's Basketball`). Eligibility attaches to the athlete and the
program, not to the team, because certification is per sport per year (VERIFY
with compliance officer whether certification is per sport or per athlete at
the pilot school).

### 2.2 Conventions for every new table

- `id uuid primary key default gen_random_uuid()`
- `provider_id uuid not null references public.providers(id) on delete cascade`
  on every row, even when derivable through a parent, so every RLS policy can
  check the tenant without a join chain and the I6 cross-org test is uniform.
- `created_at timestamptz not null default now()`, `updated_at` where mutable.
- `alter table ... enable row level security; force row level security;`
  `revoke all ... from public, anon;` — the pattern in `20260915_001050`.
- Every function is `security definer set search_path to ''` when it reads
  across RLS, and is revoked from `anon`.
- Status text columns use CHECK constraints, not Postgres enums (matches repo).
- **Every table in this section is a migration and is RED.**

### 2.3 Institution fields on `providers` — RED

```sql
alter table public.providers
  add column if not exists org_kind text not null default 'club'
    check (org_kind in ('club','trainer','gym','institution')),
  add column if not exists institution_type text
    check (institution_type is null or institution_type in ('university','college','community_college','other')),
  add column if not exists ncaa_division text
    check (ncaa_division is null or ncaa_division in ('D1','D2','D3','NAIA','NJCAA','none')),
  add column if not exists conference text,
  add column if not exists ipeds_unit_id text,          -- federal institution id, optional
  add column if not exists fiscal_year_start_month smallint not null default 7
    check (fiscal_year_start_month between 1 and 12),
  add column if not exists default_timezone text;       -- IANA, guarded by assert_iana_timezone
```

`org_kind` is new because `provider_type` today means solo vs. org for the
marketplace (default `'solo'`) and must not be overloaded.

```sql
create table public.org_verified_domains (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  domain        text not null check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  verification_token text not null default encode(gen_random_bytes(16),'hex'),
  verified_at   timestamptz,
  verified_by   uuid references auth.users(id),
  auto_join     boolean not null default false,   -- only after SSO is live
  created_at    timestamptz not null default now(),
  unique (domain)                                  -- one school owns a domain
);
create index on public.org_verified_domains (provider_id);
```

Verification is a DNS TXT record `sporv-verify=<token>` checked by an edge
function. `auto_join` cannot be true until `verified_at` is set (trigger).

### 2.4 Sports catalog and sport programs — RED

```sql
create table public.sports (                -- global catalog, read-only to tenants
  code          text primary key,           -- 'wbb','msoc','fb','wvb','mxc','wtf'...
  name          text not null,              -- 'Basketball'
  gender        text not null check (gender in ('men','women','mixed')),
  default_season text not null check (default_season in ('fall','winter','spring','year_round')),
  championship_segment text check (championship_segment in ('fall','winter','spring')),
  stat_format   text,                       -- 'statcrew_xml','livestats_xml', null
  ncaa_sport_code text,                     -- VERIFY codes against NCAA sport list
  roster_positions text[] not null default '{}'
);
alter table public.sports enable row level security;
create policy sports_read on public.sports for select to authenticated using (true);
```

The catalog is the college equivalent of a sport pack (CONTEXT §5.4): it
carries vocabulary and positions; no component hardcodes them.

```sql
create table public.sport_programs (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  sport_code    text not null references public.sports(code),
  display_name  text not null,              -- 'Women's Basketball'
  level         text not null default 'varsity'
                  check (level in ('varsity','jv','club','emerging')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (provider_id, sport_code, level)
);
create index on public.sport_programs (provider_id);
```

### 2.5 Changes to `teams` and `seasons` — RED

```sql
alter table public.teams
  add column if not exists sport_program_id uuid references public.sport_programs(id) on delete restrict,
  add column if not exists gender text check (gender is null or gender in ('men','women','mixed')),
  add column if not exists level  text check (level is null or level in ('varsity','jv','club','emerging','youth')),
  add column if not exists academic_year text check (academic_year is null or academic_year ~ '^\d{4}-\d{2}$'),
  add column if not exists roster_locked_at timestamptz;
create unique index teams_program_year_uq on public.teams (sport_program_id, academic_year)
  where sport_program_id is not null;
create index if not exists teams_provider_program_idx on public.teams (provider_id, sport_program_id);

alter table public.seasons
  add column if not exists sport_program_id uuid references public.sport_programs(id) on delete cascade,
  add column if not exists segment text check (segment is null or segment in ('championship','nontraditional','preseason','postseason')),
  add column if not exists academic_year text;
```

Existing club teams keep `sport_program_id` null; nothing in the youth product
changes. `teams.sport` (free text) stays for clubs; college teams read sport
from the program.

### 2.6 Staff assignment — RED

Department-wide roles and team-scoped roles share one table so one helper
reads one place. `team_staff` is a view over it for the brief's vocabulary.

```sql
create table public.role_assignments (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  member_id     uuid not null references public.organization_members(id) on delete cascade,
  role_key      text not null references public.college_roles(key),
  team_id       uuid references public.teams(id) on delete cascade,   -- null = department-wide
  sport_program_id uuid references public.sport_programs(id) on delete cascade, -- program-wide (all seasons)
  title         text,                       -- display only: 'Associate Head Coach'
  starts_on     date not null default current_date,
  ends_on       date,
  granted_by    uuid not null references auth.users(id),
  source        text not null default 'manual' check (source in ('manual','sso_group','import')),
  created_at    timestamptz not null default now(),
  constraint ra_scope check (not (team_id is not null and sport_program_id is not null)),
  constraint ra_dates check (ends_on is null or ends_on >= starts_on)
);
create unique index ra_uq on public.role_assignments
  (member_id, role_key, coalesce(team_id, '00000000-0000-0000-0000-000000000000'),
   coalesce(sport_program_id, '00000000-0000-0000-0000-000000000000'));
create index ra_member_idx on public.role_assignments (member_id) where ends_on is null;
create index ra_team_idx on public.role_assignments (team_id) where team_id is not null;

create view public.team_staff with (security_invoker = true) as
  select id, provider_id, member_id, role_key, team_id, sport_program_id, title
  from public.role_assignments where team_id is not null or sport_program_id is not null;
```

A trigger rejects a team-scoped assignment of a role whose `college_roles.scope`
is `department` (for example, assigning `compliance_officer` to one team).

`organization_members` is unchanged except that college staff are inserted with
`role='trainer'` (the lowest existing value) so `is_org_admin` stays false for
them; their real authority comes only from `role_assignments`. The AD is the
`providers.owner_id` or an `admin` member, so `is_org_admin` remains a correct
superuser check.

### 2.7 Student-athletes and memberships — RED

```sql
create table public.student_athletes (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  user_id          uuid unique references auth.users(id) on delete set null,  -- login, via SSO
  institution_student_id text not null,      -- SIS id; never displayed publicly
  legal_first_name text not null,
  legal_last_name  text not null,
  preferred_name   text,
  email            text,
  date_of_birth    date,                     -- needed for age checks; not public
  class_year       text check (class_year is null or class_year in ('FR','SO','JR','SR','GR','5th')),
  hometown         text,
  high_school      text,
  previous_school  text,
  major            text,
  headshot_path    text,                     -- storage path, private bucket
  bio_md           text,
  directory_opt_out boolean not null default false,   -- FERPA directory-information block
  directory_opt_out_fields text[] not null default '{}', -- partial opt-out, VERIFY school policy
  ncaa_id          text,                     -- NCAA Eligibility Center id, VERIFY field name
  initial_full_time_term_id uuid,            -- FK added after academic_terms exists; starts the clock
  status           text not null default 'active' check (status in ('active','inactive','graduated','transferred_out','withdrawn')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (provider_id, institution_student_id)
);
create index sa_provider_name_idx on public.student_athletes (provider_id, legal_last_name, legal_first_name);

create table public.athlete_team_memberships (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  team_id          uuid not null references public.teams(id) on delete cascade,
  jersey_number    text check (jersey_number is null or jersey_number ~ '^[0-9]{1,3}$'),
  position         text,
  roster_status    text not null default 'active'
                     check (roster_status in ('prospect','active','redshirt','medical_hardship','injured_reserve','departed')),
  is_public        boolean not null default false,   -- appears on public roster feed
  scholarship_flag boolean not null default false,   -- D3: must stay false; enforced by trigger (VERIFY)
  joined_on        date not null default current_date,
  left_on          date,
  created_at       timestamptz not null default now(),
  unique (team_id, student_athlete_id)
);
create unique index atm_jersey_uq on public.athlete_team_memberships (team_id, jersey_number)
  where jersey_number is not null and roster_status <> 'departed';
create index atm_athlete_idx on public.athlete_team_memberships (student_athlete_id);
```

**Why not reuse `team_athletes`:** it carries youth identity (`dob`,
`athlete_id → athletes`), money flags (`is_paid`) and is read by every club
agent generator. Putting adult FERPA records in it would expose them to club
generators and to `is_org_admin`-only policies with no team scoping. The cost
is that existing agent findings do not see college athletes; §9 adds
college-specific generators instead. Open question Q4.

The D3 scholarship trigger: if `providers.ncaa_division = 'D3'`, inserting
`scholarship_flag = true` raises `D3_NO_ATHLETIC_AID`. D3 prohibits athletically
related financial aid (VERIFY exact rule text with compliance officer).

### 2.8 Academics — RED

```sql
create table public.academic_terms (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  term_code     text not null,              -- SIS code, e.g. Banner '202610'
  name          text not null,              -- 'Fall 2026'
  term_type     text not null check (term_type in ('semester','quarter','trimester','summer','winter_session')),
  starts_on     date not null,
  ends_on       date not null,
  census_date   date,                       -- enrollment snapshot date; VERIFY school uses one
  counts_toward_clock boolean not null default true,  -- summer usually false; VERIFY
  created_at    timestamptz not null default now(),
  unique (provider_id, term_code),
  constraint at_dates check (ends_on >= starts_on)
);
alter table public.student_athletes
  add constraint sa_initial_term_fk foreign key (initial_full_time_term_id)
  references public.academic_terms(id) on delete set null;

create table public.athlete_term_records (
  id                     uuid primary key default gen_random_uuid(),
  provider_id            uuid not null references public.providers(id) on delete cascade,
  student_athlete_id     uuid not null references public.student_athletes(id) on delete cascade,
  term_id                uuid not null references public.academic_terms(id) on delete restrict,
  credits_enrolled       numeric(5,2),       -- at census
  credits_attempted      numeric(5,2),
  credits_earned         numeric(5,2),
  credits_degree_applicable numeric(5,2),    -- earned AND counts toward declared degree
  term_gpa               numeric(4,3) check (term_gpa is null or term_gpa between 0 and 4.333),
  cumulative_gpa         numeric(4,3) check (cumulative_gpa is null or cumulative_gpa between 0 and 4.333),
  cumulative_credits_earned numeric(6,2),
  full_time              boolean,            -- per institution's definition
  progress_toward_degree_pct numeric(5,2) check (progress_toward_degree_pct is null or progress_toward_degree_pct between 0 and 100),
  declared_major         text,
  degree_program_credits numeric(6,2),       -- total credits the degree requires
  source                 text not null check (source in ('sis_csv','sis_api','manual')),
  sis_import_row_id      uuid,               -- FK to sis_import_rows when imported
  entered_by             uuid references auth.users(id),
  is_final               boolean not null default false,  -- grades posted
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (student_athlete_id, term_id)
);
create index atr_term_idx on public.athlete_term_records (term_id);
```

`progress_toward_degree_pct` is stored as imported if the registrar provides
it; otherwise computed as `cumulative degree-applicable credits /
degree_program_credits`. The computed value is labelled "computed" in the UI;
the compliance officer certifies against the registrar's figure.

### 2.9 Compliance rules and eligibility — RED

```sql
create table public.compliance_rules (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid references public.providers(id) on delete cascade, -- null = Sporv default set
  division       text not null check (division in ('D1','D2','D3','NAIA','NJCAA','institution')),
  rule_key       text not null,             -- 'min_credits_per_term', 'ptd_entering_year_3'...
  version        integer not null check (version >= 1),
  params         jsonb not null,            -- thresholds; see §4.2
  severity       text not null check (severity in ('blocking','warning','info')),
  description    text not null,             -- plain English, shown to compliance officer
  source_citation text,                     -- bylaw number as entered by the compliance officer
  verified_by    uuid references auth.users(id),   -- null = UNVERIFIED, engine refuses to block on it
  verified_at    timestamptz,
  effective_from date not null,
  effective_to   date,
  created_at     timestamptz not null default now(),
  unique (coalesce(provider_id,'00000000-0000-0000-0000-000000000000'), division, rule_key, version)
);

create table public.eligibility_status (     -- current state, one row per athlete per program per year
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  sport_program_id uuid not null references public.sport_programs(id) on delete cascade,
  academic_year    text not null,
  computed_status  text not null check (computed_status in ('eligible','pending','ineligible','waiver_pending')),
  computed_reasons jsonb not null default '[]',   -- [{rule_key, version, result, detail}]
  computed_at      timestamptz not null,
  certified_status text check (certified_status in ('certified_eligible','certified_ineligible')),
  certified_by     uuid references auth.users(id),
  certified_at     timestamptz,
  certification_note text,
  certification_valid_from date,
  certification_valid_to   date,
  seasons_used     smallint not null default 0,
  terms_used       smallint not null default 0,   -- semesters/quarters toward the clock
  updated_at       timestamptz not null default now(),
  unique (student_athlete_id, sport_program_id, academic_year),
  constraint es_cert_pair check ((certified_status is null) = (certified_by is null))
);
create index es_program_idx on public.eligibility_status (sport_program_id, academic_year);

create table public.eligibility_events (     -- append-only history
  id               bigint generated always as identity primary key,
  provider_id      uuid not null references public.providers(id) on delete cascade,
  eligibility_status_id uuid not null references public.eligibility_status(id) on delete cascade,
  event_type       text not null check (event_type in
                     ('computed','certified','decertified','waiver_filed','waiver_granted','waiver_denied',
                      'override_used','note','transfer_recorded','season_counted')),
  from_status      text,
  to_status        text,
  actor_id         uuid references auth.users(id),     -- null = system computation
  actor_kind       text not null check (actor_kind in ('user','system','agent')),
  reason           text,
  payload          jsonb not null default '{}',
  occurred_at      timestamptz not null default now()
);
create index ee_status_idx on public.eligibility_events (eligibility_status_id, occurred_at desc);
-- trigger: reject UPDATE and DELETE (append-only), same pattern as payment_event_ledger.

create table public.seasons_of_competition (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  sport_code       text not null references public.sports(code),
  academic_year    text not null,
  institution_name text not null,           -- prior schools count too
  counted          boolean not null,        -- false = not used (redshirt, hardship)
  basis            text not null check (basis in ('competed','redshirt','medical_hardship','waiver','prior_school')),
  contests_played  smallint,
  recorded_by      uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (student_athlete_id, sport_code, academic_year, institution_name)
);

create table public.transfer_records (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  direction        text not null check (direction in ('incoming','outgoing')),
  other_institution text not null,
  other_division   text,
  portal_entry_date date,                   -- VERIFY whether D2/D3 use the same portal process
  notification_date date,
  release_or_tracking_ref text,
  academic_transcript_received boolean not null default false,
  prior_seasons_used smallint,
  status           text not null default 'open' check (status in ('open','pending_docs','complete','withdrawn')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.cara_logs (              -- countable athletically related activity
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  team_id          uuid not null references public.teams(id) on delete cascade,
  week_starting    date not null,
  activity_date    date not null,
  event_id         uuid references public.event(id) on delete set null,
  activity_type    text not null check (activity_type in ('practice','competition','strength','film','meeting','other')),
  hours            numeric(4,2) not null check (hours >= 0 and hours <= 24),
  is_day_off       boolean not null default false,
  logged_by        uuid not null references auth.users(id),
  athlete_ack_by   uuid references public.student_athletes(id),   -- athlete-signed log, if school requires
  athlete_ack_at   timestamptz,
  created_at       timestamptz not null default now()
);
create index cara_team_week_idx on public.cara_logs (team_id, week_starting);
```

### 2.10 Competitions, game rosters and lineups — RED

`event` already models competitions. Additions:

```sql
alter table public.event
  add column if not exists is_countable_contest boolean,       -- counts toward contest limits; VERIFY per sport
  add column if not exists is_conference boolean not null default false,
  add column if not exists is_postseason boolean not null default false,
  add column if not exists external_game_id text,              -- stat-provider game id
  add column if not exists result_status text check (result_status is null or result_status in ('pending','final','forfeit','no_contest'));
create unique index if not exists event_external_game_uq on public.event (provider_id, external_game_id)
  where external_game_id is not null;

create table public.game_rosters (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid not null references public.event(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,
  status        text not null default 'draft' check (status in ('draft','submitted','locked')),
  submitted_by  uuid references auth.users(id),
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (event_id, team_id)
);

create table public.lineup_entries (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  game_roster_id uuid not null references public.game_rosters(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,     -- denormalised for RLS
  event_id      uuid not null references public.event(id) on delete cascade,     -- denormalised for the lock
  student_athlete_id uuid not null references public.student_athletes(id) on delete restrict,
  jersey_number text,
  position      text,
  is_starter    boolean not null default false,
  dress_status  text not null default 'dressed' check (dress_status in ('dressed','travel_only','not_dressed')),
  override_id   uuid,                        -- set only via compliance override RPC
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (game_roster_id, student_athlete_id)
);
create index le_event_idx on public.lineup_entries (event_id);
create index le_team_idx on public.lineup_entries (team_id);

create table public.roster_lock_overrides (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  event_id      uuid not null references public.event(id) on delete cascade,
  reason        text not null check (length(reason) >= 20),
  granted_by    uuid not null references auth.users(id),
  granted_at    timestamptz not null default now(),
  consumed_at   timestamptz,
  unique (student_athlete_id, event_id)
);
```

### 2.11 Facilities, travel, budgets — RED

```sql
create table public.venue_space (           -- bookable subdivision of a venue
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  venue_id      uuid not null references public.venue(id) on delete cascade,
  name          text not null,              -- 'Main court', 'Court A', 'Weight room'
  space_kind    text not null check (space_kind in ('court','field','pool','track','weight_room','training_room','meeting','other')),
  parent_space_id uuid references public.venue_space(id) on delete cascade, -- 'Court A' inside 'Main court'
  capacity      integer check (capacity is null or capacity > 0),
  created_at    timestamptz not null default now(),
  unique (venue_id, name)
);

create extension if not exists btree_gist;  -- VERIFY enabled on the agent project
create table public.venue_booking (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  venue_space_id uuid not null references public.venue_space(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete cascade,
  event_id      uuid references public.event(id) on delete cascade,
  purpose       text not null check (purpose in ('competition','practice','strength','rental','maintenance','admin')),
  during        tstzrange not null,
  status        text not null default 'requested' check (status in ('requested','confirmed','bumped','cancelled')),
  priority      smallint not null,          -- computed at request time, §6.1
  requested_by  uuid not null references auth.users(id),
  decided_by    uuid references auth.users(id),
  decision_note text,
  created_at    timestamptz not null default now(),
  constraint vb_no_double_confirm exclude using gist
    (venue_space_id with =, during with &&) where (status = 'confirmed')
);
create index vb_space_during_idx on public.venue_booking using gist (venue_space_id, during);
```

The exclusion constraint makes a double-confirmed space impossible at the
database level. It does not handle parent/child spaces (booking "Main court"
while "Court A" is confirmed); a trigger checks the parent chain.

```sql
create table public.travel_trips (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,
  title         text not null,
  depart_at     timestamptz not null,
  return_at     timestamptz not null,
  destination   text not null,
  status        text not null default 'draft' check (status in ('draft','submitted','approved','booked','completed','cancelled')),
  budget_line_id uuid,                      -- FK below
  approval_request_id uuid,                 -- FK below
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tt_dates check (return_at > depart_at)
);
create table public.trip_events (            -- which competitions this trip serves
  trip_id uuid not null references public.travel_trips(id) on delete cascade,
  event_id uuid not null references public.event(id) on delete cascade,
  primary key (trip_id, event_id)
);
create table public.trip_legs (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  trip_id       uuid not null references public.travel_trips(id) on delete cascade,
  seq           smallint not null,
  mode          text not null check (mode in ('bus','van','air','train','car')),
  carrier       text,
  depart_at     timestamptz not null,
  arrive_at     timestamptz not null,
  origin        text not null,
  destination   text not null,
  confirmation_ref text,
  cost_cents    integer check (cost_cents is null or cost_cents >= 0),
  unique (trip_id, seq)
);
create table public.trip_travelers (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  trip_id       uuid not null references public.travel_trips(id) on delete cascade,
  student_athlete_id uuid references public.student_athletes(id) on delete cascade,
  member_id     uuid references public.organization_members(id) on delete cascade,
  traveler_kind text not null check (traveler_kind in ('athlete','staff','other')),
  other_name    text,
  constraint tt_one_person check (num_nonnulls(student_athlete_id, member_id, other_name) = 1)
);
create table public.trip_rooms (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  trip_id       uuid not null references public.travel_trips(id) on delete cascade,
  hotel_name    text not null,
  check_in      date not null,
  check_out     date not null,
  room_label    text,
  nightly_rate_cents integer,
  confirmation_ref text
);
create table public.room_assignments (
  room_id       uuid not null references public.trip_rooms(id) on delete cascade,
  traveler_id   uuid not null references public.trip_travelers(id) on delete cascade,
  primary key (room_id, traveler_id)
);
create table public.per_diem_rates (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  label         text not null,              -- 'Standard', 'Postseason'
  breakfast_cents integer not null, lunch_cents integer not null, dinner_cents integer not null,
  effective_from date not null,
  effective_to  date
);
create table public.per_diem_lines (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  trip_id       uuid not null references public.travel_trips(id) on delete cascade,
  traveler_id   uuid not null references public.trip_travelers(id) on delete cascade,
  meal_date     date not null,
  meal          text not null check (meal in ('breakfast','lunch','dinner')),
  provided      boolean not null default false,   -- team meal, no cash
  amount_cents  integer not null check (amount_cents >= 0),
  rate_id       uuid not null references public.per_diem_rates(id),
  paid_at       timestamptz,
  unique (traveler_id, meal_date, meal)
);

create table public.budget_periods (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  fiscal_year   text not null,              -- 'FY27' = Jul 2026 - Jun 2027 when FY starts in July
  starts_on     date not null, ends_on date not null,
  unique (provider_id, fiscal_year)
);
create table public.budget_lines (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  budget_period_id uuid not null references public.budget_periods(id) on delete cascade,
  sport_program_id uuid references public.sport_programs(id) on delete cascade, -- null = department
  category      text not null check (category in ('travel','equipment','officials','recruiting','meals','lodging','salaries','facilities','other')),
  account_code  text,                       -- institution GL code
  amount_cents  bigint not null check (amount_cents >= 0),
  created_at    timestamptz not null default now(),
  unique (budget_period_id, sport_program_id, category)
);
create table public.budget_actuals (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  budget_line_id uuid not null references public.budget_lines(id) on delete cascade,
  amount_cents  bigint not null,            -- negative = refund
  occurred_on   date not null,
  description   text not null,
  source        text not null check (source in ('manual','trip','per_diem','import')),
  source_ref    text,
  entered_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
create table public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  subject_kind  text not null check (subject_kind in ('trip','expense','facility_booking','budget_change','media_release')),
  subject_id    uuid not null,
  amount_cents  bigint,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  requested_by  uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
create table public.approval_steps (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
  seq           smallint not null,
  approver_capability text not null,        -- 'travel.approve', 'budget.approve'
  decided_by    uuid references auth.users(id),
  decision      text check (decision in ('approved','rejected')),
  decided_at    timestamptz,
  note          text,
  unique (approval_request_id, seq)
);
alter table public.travel_trips
  add constraint tt_budget_fk foreign key (budget_line_id) references public.budget_lines(id),
  add constraint tt_approval_fk foreign key (approval_request_id) references public.approval_requests(id);
```

### 2.12 Sports medicine — RED (plus legal review)

All medical tables live in a separate schema `med` so that a missing policy on
a new table cannot leak through the `public` API surface: the `med` schema is
**not** exposed through PostgREST, and reads go only through
`security definer` RPCs that check capability and write `data_access_log`.

```sql
create schema if not exists med;
revoke all on schema med from public, anon, authenticated;

create table med.injuries (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  sport_program_id uuid references public.sport_programs(id),
  occurred_on   date not null,
  body_region   text not null,              -- controlled list
  side          text check (side in ('left','right','bilateral','na')),
  mechanism     text check (mechanism in ('contact','non_contact','overuse','illness','other')),
  setting       text check (setting in ('practice','competition','strength','other')),
  diagnosis_enc bytea,                      -- encrypted, §7.6
  notes_enc     bytea,
  severity      text check (severity in ('minor','moderate','severe')),
  is_concussion boolean not null default false,
  status        text not null default 'open' check (status in ('open','rehab','resolved')),
  recorded_by   uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table med.treatments (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  injury_id     uuid references med.injuries(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  treated_at    timestamptz not null,
  modality      text not null,
  notes_enc     bytea,
  treated_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
create table med.rtp_stages (                -- return-to-play progression
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  injury_id     uuid not null references med.injuries(id) on delete cascade,
  stage_no      smallint not null,
  stage_label   text not null,              -- from protocol template
  entered_at    timestamptz not null,
  completed_at  timestamptz,
  symptoms_reported boolean,
  recorded_by   uuid not null references auth.users(id),
  unique (injury_id, stage_no)
);
create table med.concussion_protocols (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  injury_id     uuid not null unique references med.injuries(id) on delete cascade,
  protocol_template text not null,          -- institution's written protocol, versioned
  baseline_on_file boolean not null default false,
  current_stage smallint not null default 0,
  physician_cleared_by uuid references auth.users(id),
  physician_cleared_at timestamptz,
  return_to_learn_complete boolean not null default false,
  created_at    timestamptz not null default now()
);
create table med.clearances (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  sport_program_id uuid references public.sport_programs(id),
  status        text not null check (status in ('cleared','limited','not_cleared')),
  reason_public text,                       -- what a coach may see: 'Not cleared', never a diagnosis
  effective_from timestamptz not null,
  effective_to  timestamptz,
  decided_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
create index med_clear_athlete_idx on med.clearances (student_athlete_id, effective_from desc);
create table med.screenings (                -- PPE, sickle-cell trait status/waiver, cardiac, etc.
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  requirement_key text not null,            -- references public.document_requirements.key
  academic_year text not null,
  status        text not null check (status in ('missing','submitted','accepted','waived','expired')),
  result_enc    bytea,
  document_path text,                       -- private bucket
  expires_on    date,
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  unique (student_athlete_id, requirement_key, academic_year)
);
create table med.break_glass_grants (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  grantee_id    uuid not null references auth.users(id),
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  reason        text not null check (length(reason) >= 30),
  granted_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '2 hours',
  reviewed_by   uuid references auth.users(id),   -- head AT reviews every grant
  reviewed_at   timestamptz
);
```

The one medical fact a coach and the Roster Lock need is exposed as a
non-sensitive public view:

```sql
create view public.athlete_clearance_current with (security_invoker = false) as
  select distinct on (student_athlete_id, sport_program_id)
    provider_id, student_athlete_id, sport_program_id, status, reason_public, effective_from, effective_to
  from med.clearances
  where effective_from <= now() and (effective_to is null or effective_to > now())
  order by student_athlete_id, sport_program_id, effective_from desc;
```

Access to that view is through an RPC `get_team_clearances(team_id)` gated by
`has_team_access(team_id, 'clearance.read')`, not a direct grant.

### 2.13 Stats ingestion — RED

```sql
create table public.stat_imports (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid references public.event(id) on delete set null,
  source_format text not null check (source_format in ('statcrew_xml','livestats_xml','livestats_json','csv')),
  external_game_id text not null,
  file_sha256   text not null,
  storage_path  text not null,
  status        text not null default 'received' check (status in ('received','parsed','needs_review','applied','rejected')),
  errors        jsonb not null default '[]',
  unmatched_players jsonb not null default '[]',
  uploaded_by   uuid references auth.users(id),     -- null = watched endpoint
  received_at   timestamptz not null default now(),
  applied_at    timestamptz,
  unique (provider_id, external_game_id, file_sha256)   -- same file twice = no-op
);
create table public.game_results (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid not null unique references public.event(id) on delete cascade,
  team_score    integer, opponent_score integer,
  outcome       text check (outcome in ('W','L','T','NC')),
  periods       jsonb not null default '[]',
  attendance    integer,
  stat_import_id uuid references public.stat_imports(id),
  published_at  timestamptz,
  updated_at    timestamptz not null default now()
);
create table public.player_game_stats (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  event_id      uuid not null references public.event(id) on delete cascade,
  student_athlete_id uuid not null references public.student_athletes(id) on delete cascade,
  stat_import_id uuid not null references public.stat_imports(id),
  stats         jsonb not null,             -- sport-specific keys from sports catalog
  unique (event_id, student_athlete_id)
);
```

A re-import of a corrected file for the same `external_game_id` replaces the
game's rows in one transaction (delete-then-insert keyed by event) so the
result is idempotent per game: applying file B after file A gives the same rows
as applying file B alone.

### 2.14 Audit, access, SSO, SIS, documents, media — RED

```sql
create table public.audit_log (
  id            bigint generated always as identity primary key,
  provider_id   uuid not null,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,                       -- null = system
  actor_kind    text not null check (actor_kind in ('user','system','agent','sso_jit','import')),
  action        text not null,              -- 'eligibility.certify', 'lineup.override'
  table_name    text not null,
  row_id        text not null,
  before_sha256 text,
  after_sha256  text,
  diff          jsonb,                      -- changed non-sensitive columns only
  request_id    text,
  prev_hash     text,                       -- hash chain, §10.1
  row_hash      text not null
);
create index audit_provider_time_idx on public.audit_log (provider_id, occurred_at desc);

create table public.data_access_log (
  id            bigint generated always as identity primary key,
  provider_id   uuid not null,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid not null,
  subject_student_athlete_id uuid,
  resource      text not null,              -- 'med.injuries', 'athlete_term_records'
  resource_id   text,
  access_kind   text not null check (access_kind in ('read','export','print','break_glass_read')),
  purpose       text,
  break_glass_id uuid
);
create index dal_subject_idx on public.data_access_log (subject_student_athlete_id, occurred_at desc);

create table public.sso_connections (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null unique references public.providers(id) on delete cascade,
  supabase_sso_provider_id text not null unique,  -- id returned by Supabase SSO admin API
  idp_kind      text not null check (idp_kind in ('shibboleth','okta','entra','google','other_saml')),
  metadata_url  text,
  enforced      boolean not null default false,   -- password login disabled for verified domains
  jit_enabled   boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create table public.sso_group_role_map (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  idp_group     text not null,              -- exact string from the SAML attribute
  role_key      text not null references public.college_roles(key),
  sport_program_id uuid references public.sport_programs(id) on delete cascade,
  unique (provider_id, idp_group, role_key, sport_program_id)
);

create table public.sis_import_jobs (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  term_id       uuid references public.academic_terms(id),
  source        text not null check (source in ('csv_upload','sftp','banner_ethos','workday')),
  file_sha256   text,
  status        text not null default 'staged' check (status in ('staged','validated','needs_review','applied','rejected')),
  row_count     integer, error_count integer, change_count integer,
  started_by    uuid references auth.users(id),
  applied_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  applied_at    timestamptz,
  unique (provider_id, file_sha256)
);
create table public.sis_import_rows (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  job_id        uuid not null references public.sis_import_jobs(id) on delete cascade,
  row_no        integer not null,
  raw           jsonb not null,
  student_athlete_id uuid references public.student_athletes(id),
  match_kind    text check (match_kind in ('exact_id','new','ambiguous','unmatched')),
  diff          jsonb,                      -- field -> {old,new}
  errors        jsonb not null default '[]',
  decision      text check (decision in ('apply','skip')),
  unique (job_id, row_no)
);

create table public.document_requirements (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  key           text not null,              -- 'ppe','sickle_cell','concussion_ack','code_of_conduct'
  title         text not null,
  applies_to    text not null check (applies_to in ('all_athletes','sport_program','new_athletes')),
  sport_program_id uuid references public.sport_programs(id),
  is_medical    boolean not null default false,   -- true = record goes to med.screenings
  waiver_document_id uuid references public.waiver_documents(id),  -- e-sign forms reuse waivers
  renew_every   text check (renew_every in ('academic_year','once','term')),
  blocks_participation boolean not null default true,
  unique (provider_id, key)
);

create table public.media_releases (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  team_id       uuid references public.teams(id),
  event_id      uuid references public.event(id),
  kind          text not null check (kind in ('recap','preview','signing','award','general')),
  body_md       text not null,
  status        text not null default 'draft' check (status in ('draft','approved','published','withdrawn')),
  obligation_id uuid references public.obligations(id),  -- the approval inbox row
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table public.feed_tokens (             -- staff and athlete iCal, plus public team feeds
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  kind          text not null check (kind in ('user_calendar','public_team','public_department')),
  user_id       uuid references auth.users(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete cascade,
  token         text not null unique default encode(gen_random_bytes(32),'hex'),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table public.org_entitlements (         -- per-org override of plan_entitlements, §13
  provider_id   uuid primary key references public.providers(id) on delete cascade,
  base_plan     text not null references public.plan_entitlements(plan),
  extra_modules text[] not null default '{}',
  team_cap      integer,
  contract_start date, contract_end date,
  po_number     text,
  updated_by    uuid not null references auth.users(id),
  updated_at    timestamptz not null default now()
);
```

### 2.15 Table inventory

| Table | Status | Tier |
|---|---|---|
| `providers` (+ institution columns) | HAVE table, DRAFTED columns (docs/red-drafts/2026-10-22-manage-p1-tenant-roles.sql) | RED |
| `organization_members` | HAVE (unchanged) | — |
| `teams` (+ program, gender, level, academic_year) | HAVE table, DRAFTED columns (docs/red-drafts/2026-10-22-manage-p1-tenant-roles.sql) | RED |
| `seasons` (+ program, segment) | HAVE table (file), DRAFTED columns (docs/red-drafts/2026-10-22-manage-p1-tenant-roles.sql) | RED |
| `event` (+ contest fields) | PARTIAL (file `20260915_001052`; prod state unverified) | RED |
| `venue`, `blackout_window` | PARTIAL (file `20260915_001050`) | — |
| `waiver_documents`, `waiver_signatures` | HAVE (file `20260831_001005`) | — |
| `obligations` | HAVE | — |
| `plan_entitlements.modules[]` | PARTIAL (file `20260921_001108`) | — |
| `prospects` (club intake inquiries) | HAVE (file `20260922_001115`); **not used for recruiting** | — |
| `guardians`, `guardian_links` | HAVE (file `20260831_001002`); not used for recruits | — |
| Source (Module E): `recruits`, `recruit_guardians`, `recruit_pipelines`, `recruit_stage_history`, `recruit_sources`, `recruit_import_jobs`, `recruit_import_rows`, `recruit_forms`, `recruiting_targets`, `evaluation_rubrics`, `recruit_evaluations`, `recruiting_periods`, `recruit_contacts`, `recruit_contact_overrides`, `recruit_visits`, `recruit_offers`, `recruit_rankings` | MISSING (E3) | RED |
| `org_verified_domains`, `sports`, `sport_programs`, `college_roles`, `role_capabilities`, `role_assignments`, `student_athletes`, `athlete_team_memberships`, `audit_log` (also `college_capabilities`, `org_role_capability_overrides`, view `team_staff`) | DRAFTED (docs/red-drafts/2026-10-22-manage-p1-tenant-roles.sql; proof `.test.sql`; inverse `2026-10-22-manage-p1-rollback.sql`) | RED |
| `academic_terms`, `athlete_term_records`, `compliance_rules`, `eligibility_status`, `eligibility_events`, `seasons_of_competition`, `transfer_records`, `cara_logs`, `game_rosters`, `lineup_entries`, `roster_lock_overrides`, `venue_space`, `venue_booking`, `travel_trips`, `trip_events`, `trip_legs`, `trip_travelers`, `trip_rooms`, `room_assignments`, `per_diem_rates`, `per_diem_lines`, `budget_periods`, `budget_lines`, `budget_actuals`, `approval_requests`, `approval_steps`, `med.*` (7 tables), `stat_imports`, `game_results`, `player_game_stats`, `data_access_log`, `sso_connections`, `sso_group_role_map`, `sis_import_jobs`, `sis_import_rows`, `document_requirements`, `media_releases`, `feed_tokens`, `org_entitlements` | MISSING | RED |

---

## 3. RBAC

### 3.1 Roles

| `college_roles.key` | Name | Scope allowed | Notes |
|---|---|---|---|
| `ad` | Athletic Director | department | Normally also `providers.owner_id` or `admin` member |
| `assoc_ad` | Associate / Assistant AD | department | Capabilities chosen per school from a preset |
| `compliance_officer` | Compliance officer | department | Only role that certifies or overrides |
| `sid` | Sports Information Director | department | No medical, no academics |
| `head_coach` | Head coach | team or program | |
| `assistant_coach` | Assistant coach | team or program | |
| `athletic_trainer` | Athletic trainer | department or program | Medical write |
| `team_physician` | Team physician | department | Clearance and concussion sign-off |
| `business_office` | Business office | department | Budgets, approvals, per diem |
| `student_athlete` | Student-athlete | self | Derived from `student_athletes.user_id`, not assigned |
| `auditor` | Read-only auditor | department, time-boxed | `ends_on` required |
| `recruiting_coordinator` | Recruiting coordinator (Source) | team, program or department | Capabilities and matrix in E9 |

```sql
create table public.college_roles (
  key text primary key, name text not null,
  scope text not null check (scope in ('department','team','either','self'))
);
create table public.role_capabilities (
  role_key text not null references public.college_roles(key) on delete cascade,
  capability text not null,
  primary key (role_key, capability)
);
create table public.org_role_capability_overrides (   -- per-school tweaks, audited
  provider_id uuid not null references public.providers(id) on delete cascade,
  role_key text not null references public.college_roles(key),
  capability text not null,
  granted boolean not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  primary key (provider_id, role_key, capability)
);
```

Capabilities are seeded data. A school may remove capabilities from a role or
add non-restricted ones; **restricted capabilities** (`eligibility.certify`,
`lineup.override`, `medical.write`, `medical.read`, `medical.break_glass`) can
never be added to a role that does not have them by default. A trigger enforces
this.

### 3.2 Capabilities

| Capability | Meaning |
|---|---|
| `roster.read` | See athletes and memberships on a team |
| `roster.write` | Add, remove, edit memberships, jersey numbers, bios |
| `academics.read` | See term records (credits, GPA, PTD) |
| `academics.write` | Manual entry and SIS import apply |
| `eligibility.read` | See computed and certified status with reasons |
| `eligibility.status_only` | See only eligible / not eligible, no reasons |
| `eligibility.certify` | Certify or decertify |
| `eligibility.rules` | Edit and verify `compliance_rules` |
| `clearance.read` | See current clearance status (no diagnosis) |
| `medical.read` | Read injury, treatment, screening detail |
| `medical.write` | Create and edit medical records |
| `medical.clear` | Issue a clearance |
| `medical.break_glass` | Time-boxed emergency read with reason |
| `lineup.submit` | Build and submit a game roster |
| `lineup.override` | Grant a Roster Lock override |
| `schedule.write` | Create and edit events for the team |
| `facility.request` | Request a venue booking |
| `facility.approve` | Confirm, bump or deny bookings |
| `stats.import` | Upload stat files and reconcile |
| `stats.publish` | Publish results, stats, media releases to feeds |
| `travel.plan` | Create trips, rooming lists |
| `travel.approve` | Approve trips |
| `budget.read` | See budget lines and actuals |
| `budget.write` | Edit budget lines, enter actuals |
| `budget.approve` | Approve expenses and budget changes |
| `cara.log` | Enter CARA hours |
| `export.ncaa` | Run compliance exports |
| `audit.read` | Read `audit_log` and `data_access_log` |
| `admin.users` | Assign roles, manage SSO mappings |
| `agent.review` | Approve agent drafts in the inbox for their scope |

### 3.3 Role x capability matrix (defaults)

D = department-wide; T = within assigned team(s) only; S = self only; R = read-only; blank = none.

| Capability | ad | assoc_ad | compliance | sid | head_coach | asst_coach | athl_trainer | physician | business | student | auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| roster.read | D | D | D | D | T | T | D | D | D | S | D |
| roster.write | D | D |  | D | T |  |  |  |  |  |  |
| academics.read | D | D | D |  |  |  |  |  |  | S | D |
| academics.write |  |  | D |  |  |  |  |  |  |  |  |
| eligibility.read | D | D | D |  |  |  |  |  |  | S | D |
| eligibility.status_only |  |  |  | D | T | T | D |  |  |  |  |
| eligibility.certify |  |  | D |  |  |  |  |  |  |  |  |
| eligibility.rules |  |  | D |  |  |  |  |  |  |  |  |
| clearance.read | D | D | D |  | T | T | D | D |  | S | D |
| medical.read |  |  |  |  |  |  | D | D |  | S |  |
| medical.write |  |  |  |  |  |  | D | D |  |  |  |
| medical.clear |  |  |  |  |  |  | D | D |  |  |  |
| medical.break_glass |  |  | D |  |  |  |  |  |  |  |  |
| lineup.submit |  |  |  |  | T | T |  |  |  |  |  |
| lineup.override |  |  | D |  |  |  |  |  |  |  |  |
| schedule.write | D | D |  | D | T | T |  |  |  |  |  |
| facility.request | D | D |  | D | T | T | D |  |  |  |  |
| facility.approve | D | D |  |  |  |  |  |  |  |  |  |
| stats.import |  |  |  | D | T |  |  |  |  |  |  |
| stats.publish |  |  |  | D |  |  |  |  |  |  |  |
| travel.plan | D | D |  |  | T | T |  |  | D |  |  |
| travel.approve | D | D |  |  |  |  |  |  | D |  |  |
| budget.read | D | D |  |  | T |  |  |  | D |  | D |
| budget.write |  |  |  |  |  |  |  |  | D |  |  |
| budget.approve | D |  |  |  |  |  |  |  | D |  |  |
| cara.log |  |  | D |  | T | T |  |  |  |  |  |
| export.ncaa | D |  | D |  |  |  |  |  |  |  |  |
| audit.read | D |  | D |  |  |  |  |  |  |  | D |
| admin.users | D |  |  |  |  |  |  |  |  |  |  |
| agent.review | D | D | D | D | T | T | D |  | D |  |  |

Judgement calls to confirm with the pilot (Q6): the AD does **not** read
medical detail or certify by default; a coach sees eligible / not eligible
without reasons; the athletic trainer sees status only, not grades.

### 3.4 SQL helpers

```sql
create or replace function public.has_org_capability(p_org uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_assignments ra on ra.member_id = m.id
    join public.role_capabilities rc on rc.role_key = ra.role_key and rc.capability = p_cap
    where m.organization_id = p_org and m.member_user_id = auth.uid() and m.is_active
      and ra.team_id is null and ra.sport_program_id is null
      and ra.starts_on <= current_date and (ra.ends_on is null or ra.ends_on >= current_date)
      and not exists (select 1 from public.org_role_capability_overrides o
                      where o.provider_id = p_org and o.role_key = ra.role_key
                        and o.capability = p_cap and o.granted = false))
  or (public.is_org_admin(p_org)
      and p_cap not in ('medical.read','medical.write','medical.clear','eligibility.certify','lineup.override'));
$$;

create or replace function public.has_team_access(p_team uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1
    from public.teams t
    join public.organization_members m on m.organization_id = t.provider_id
      and m.member_user_id = auth.uid() and m.is_active
    join public.role_assignments ra on ra.member_id = m.id
    join public.role_capabilities rc on rc.role_key = ra.role_key and rc.capability = p_cap
    where t.id = p_team
      and (ra.team_id = t.id
           or ra.sport_program_id = t.sport_program_id
           or (ra.team_id is null and ra.sport_program_id is null))   -- department-wide
      and ra.starts_on <= current_date and (ra.ends_on is null or ra.ends_on >= current_date)
      and not exists (select 1 from public.org_role_capability_overrides o
                      where o.provider_id = t.provider_id and o.role_key = ra.role_key
                        and o.capability = p_cap and o.granted = false))
  or exists (select 1 from public.teams t where t.id = p_team
             and public.is_org_admin(t.provider_id)
             and p_cap not in ('medical.read','medical.write','medical.clear','eligibility.certify','lineup.override'));
$$;

create or replace function public.is_self_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.student_athletes s where s.id = p_athlete and s.user_id = auth.uid());
$$;

create or replace function public.has_athlete_access(p_athlete uuid, p_cap text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.student_athletes s
                 where s.id = p_athlete and public.has_org_capability(s.provider_id, p_cap))
      or exists (select 1 from public.athlete_team_memberships atm
                 where atm.student_athlete_id = p_athlete and atm.roster_status <> 'departed'
                   and public.has_team_access(atm.team_id, p_cap));
$$;
revoke all on function public.has_org_capability(uuid,text), public.has_team_access(uuid,text),
  public.is_self_athlete(uuid), public.has_athlete_access(uuid,text) from public, anon;
grant execute on function public.has_org_capability(uuid,text), public.has_team_access(uuid,text),
  public.is_self_athlete(uuid), public.has_athlete_access(uuid,text) to authenticated;
```

Performance: policies call these per row. Wrap in `(select ...)` where the
argument is constant, and index `role_assignments(member_id)`,
`organization_members(member_user_id, organization_id)`. CONTEXT §9 scale
floor: a roster read for a 600-athlete department must not seq-scan; test
with `explain analyze` at 5,000 orgs of seed data.

### 3.5 RLS policy matrix

S = select, I = insert, U = update, D = delete. "cap(x)" = `has_team_access`
or `has_org_capability` as appropriate. "self" = `is_self_athlete`.

| Table | S | I | U | D |
|---|---|---|---|---|
| `sport_programs` | member of org | `admin.users` (org) | same | same |
| `teams` (college rows) | `roster.read` (team) | `admin.users` | `roster.write` | `admin.users` |
| `role_assignments` | own rows, or `admin.users` | `admin.users` | `admin.users` | `admin.users` |
| `student_athletes` | `has_athlete_access(id,'roster.read')` or self | `roster.write` (org) or SIS import RPC | `roster.write`; self may edit `preferred_name, bio_md, directory_opt_out` via RPC | never (status `inactive`) |
| `athlete_team_memberships` | `roster.read` (team) or self | `roster.write` (team) | `roster.write` (team) | `roster.write` (team) |
| `academic_terms` | member of org | `academics.write` | same | none |
| `athlete_term_records` | `academics.read` (athlete) or self | `academics.write` (org) | same | none |
| `compliance_rules` | `eligibility.read` | `eligibility.rules` | `eligibility.rules`; verified rows immutable, new version instead | none |
| `eligibility_status` | `eligibility.read` or self; status-only via view | system RPC only | `certify_eligibility()` RPC only | none |
| `eligibility_events` | `eligibility.read` or self | trigger only | none | none |
| `transfer_records` | `eligibility.read` | `eligibility.certify` | same | none |
| `cara_logs` | `cara.log` (team), `audit.read` | `cara.log` (team) | creator within 7 days | none |
| `game_rosters` | `roster.read` (team) | `lineup.submit` (team) | `lineup.submit` while `draft` | `lineup.submit` while `draft` |
| `lineup_entries` | `roster.read` (team) | `lineup.submit` (team) + Roster Lock trigger | same | `lineup.submit` while roster `draft` |
| `roster_lock_overrides` | `eligibility.read`, `audit.read` | `grant_roster_override()` RPC | none | none |
| `venue_space` | member of org | `facility.approve` | same | same |
| `venue_booking` | member of org | `facility.request` | requester while `requested`; `facility.approve` | none (cancel) |
| `travel_*`, `trip_*`, `per_diem_*` | `travel.plan` (team), `travel.approve`, travelers see own trip | `travel.plan` | `travel.plan` while `draft`/`submitted` | `travel.plan` while `draft` |
| `budget_*` | `budget.read` | `budget.write` | `budget.write` | none |
| `approval_*` | requester, approvers in chain | RPC only | `decide_approval()` RPC only | none |
| `med.*` | not exposed; RPC with `medical.read` + log | RPC with `medical.write` | same | none |
| `stat_imports`, `game_results`, `player_game_stats` | `roster.read` (team); published rows via public feed | `stats.import` | `stats.import` until applied | none |
| `audit_log`, `data_access_log` | `audit.read` | trigger / definer only | none | none |
| `sso_connections`, `sso_group_role_map` | `admin.users` | `admin.users` (draft); applied by owner | same | same |
| `sis_import_*` | `academics.write` | same | same | none |
| `document_requirements` | member of org | `admin.users` | same | same |
| `media_releases` | `stats.publish`, team staff for own team | agent or `stats.publish` | `stats.publish` while `draft` | none |
| `org_entitlements` | `admin.users` | service role only | service role only | none |

### 3.6 Example policy SQL

`lineup_entries`:

```sql
alter table public.lineup_entries enable row level security;
alter table public.lineup_entries force row level security;
revoke all on public.lineup_entries from public, anon;

create policy le_select on public.lineup_entries for select to authenticated
  using ((select public.has_team_access(team_id, 'roster.read')));
create policy le_insert on public.lineup_entries for insert to authenticated
  with check ((select public.has_team_access(team_id, 'lineup.submit'))
              and created_by = auth.uid()
              and exists (select 1 from public.game_rosters g
                          where g.id = game_roster_id and g.team_id = lineup_entries.team_id
                            and g.event_id = lineup_entries.event_id and g.status = 'draft'));
create policy le_update on public.lineup_entries for update to authenticated
  using ((select public.has_team_access(team_id, 'lineup.submit')))
  with check ((select public.has_team_access(team_id, 'lineup.submit')));
create policy le_delete on public.lineup_entries for delete to authenticated
  using ((select public.has_team_access(team_id, 'lineup.submit'))
         and exists (select 1 from public.game_rosters g where g.id = game_roster_id and g.status = 'draft'));
grant select, insert, update, delete on public.lineup_entries to authenticated;
```

`athlete_term_records`:

```sql
alter table public.athlete_term_records enable row level security;
alter table public.athlete_term_records force row level security;
revoke all on public.athlete_term_records from public, anon;

create policy atr_select on public.athlete_term_records for select to authenticated
  using ((select public.has_athlete_access(student_athlete_id, 'academics.read'))
         or (select public.is_self_athlete(student_athlete_id)));
create policy atr_write on public.athlete_term_records for insert to authenticated
  with check ((select public.has_org_capability(provider_id, 'academics.write')));
create policy atr_update on public.athlete_term_records for update to authenticated
  using ((select public.has_org_capability(provider_id, 'academics.write')))
  with check ((select public.has_org_capability(provider_id, 'academics.write')));
grant select, insert, update on public.athlete_term_records to authenticated;
-- after-row trigger writes audit_log and data_access_log is written by the read RPC used by the UI
```

Note that a plain `select` through PostgREST is not logged in
`data_access_log`; only the RPCs are. For academics this is acceptable (audit
of writes plus access by role). For `med.*` it is why the schema is not
exposed at all.

### 3.7 Break-glass medical access

1. A compliance officer (or a role granted `medical.break_glass`) calls
   `request_break_glass(student_athlete_id, reason)`.
2. The RPC rejects reasons under 30 characters, inserts `med.break_glass_grants`
   with a 2-hour expiry, writes `audit_log` action `medical.break_glass`.
3. While unexpired, medical read RPCs accept the grant and write each read to
   `data_access_log` with `access_kind='break_glass_read'` and `break_glass_id`.
4. A finding is raised for the head athletic trainer to review the grant; it
   stays open until `reviewed_by` is set.
5. The student-athlete can see that a break-glass read happened (date, role,
   reason) in their own access history.

---

## 4. Module A — Compliance and eligibility

### 4.1 Status

| Requirement | Status |
|---|---|
| Term records per athlete | MISSING |
| Rule engine as data | MISSING |
| Computed eligibility with reasons | MISSING (today's "eligibility" is dues/waivers only) |
| Certification sign-off | MISSING |
| Transfer tracking | MISSING |
| Seasons-of-competition counter | MISSING |
| CARA hour log | MISSING |
| Roster Lock | MISSING |

### 4.2 Rules as data

Every threshold is a row in `compliance_rules`. **No number below is stated
as fact. Every value is a placeholder labelled VERIFY with the current NCAA
Division Manual and the institution's compliance officer before launch.** The
engine refuses to mark an athlete `ineligible` on a rule whose `verified_by` is
null; such rules produce `pending` with reason "rule not verified".

| `rule_key` | Applies | `params` shape | Placeholder intent (VERIFY every value) |
|---|---|---|---|
| `full_time_enrollment` | D1, D2, D3 | `{"min_credits_semester": X, "min_credits_quarter": Y}` | Athlete must be enrolled full time to practice and compete; institution defines full time. VERIFY. |
| `min_credits_prev_term` | D1, D2 | `{"semester": X, "quarter": Y}` | Degree-applicable credits passed in the previous full-time term. VERIFY value and D2 difference. |
| `min_credits_academic_year` | D1, D2 | `{"semester": X, "quarter": Y}` | Credits earned during the academic year. VERIFY. |
| `ptd_by_year` | D1, D2 | `{"entering_year_3": X, "entering_year_4": Y, "entering_year_5": Z}` | Percentage toward degree at each year. D1 and D2 values differ. VERIFY. |
| `gpa_min_by_year` | D1, D2 | `{"entering_year_2": X, "entering_year_3": Y, ...}` | Minimum cumulative GPA, may be a percentage of the institution's graduation GPA. VERIFY. |
| `seasons_of_competition_max` | D1, D2, D3 | `{"max_seasons": X}` | Number of seasons an athlete may compete. VERIFY. |
| `eligibility_clock` | D1 | `{"years": X}` | D1 uses a calendar-year clock from initial full-time enrollment. VERIFY. |
| `eligibility_clock_terms` | D2, D3 | `{"semesters": X, "quarters": Y}` | D2 and D3 count full-time terms (commonly described as 10 semesters / 15 quarters). VERIFY. |
| `d3_no_athletic_aid` | D3 | `{}` | D3 may not award athletically related aid. VERIFY. |
| `d3_institution_standard` | D3 | `{"standard": "same_as_student_body"}` | D3 academic eligibility generally follows institutional good standing applied to all students. VERIFY. |
| `cara_weekly_in_season` | D1, D2 | `{"max_hours_week": X, "max_hours_day": Y, "days_off_per_week": Z}` | CARA limits. D2 limits exist; VERIFY values and whether D3 tracks hours or only season length. |
| `cara_weekly_out_of_season` | D1, D2 | `{"max_hours_week": X, "days_off_per_week": Z}` | VERIFY. |
| `d3_playing_season_weeks` | D3 | `{"max_weeks": X}` | D3 limits the length of the playing season rather than daily hours. VERIFY. |
| `transfer_residence` | D1, D2, D3 | `{"rule": "...", "exceptions": [...]}` | Transfer eligibility conditions. Changed frequently in recent years. VERIFY. |
| `amateurism_certified` | D1, D2 | `{}` | Eligibility Center certification on file. VERIFY current terminology. |
| `institution_custom` | any | free-form | School-specific rules (good academic standing, conduct holds). |

Rules are versioned: editing a verified rule creates `version + 1` with a new
`effective_from`; the prior row gets `effective_to`. The engine picks the
version effective on the evaluation date. A Sporv-default rule set
(`provider_id is null`) is shipped **unverified**; each school's compliance
officer verifies or overrides each row during onboarding (week 2, §11).

### 4.3 Computation pipeline

1. **Trigger points:** SIS import applied; manual term record change; rule
   verified or versioned; roster membership added; nightly at 03:00 in the
   school's timezone; on demand by the compliance officer.
2. **Function:** `compute_eligibility(p_athlete uuid, p_program uuid, p_on date)`
   is a pure SQL/PLpgSQL function (no AI). For each applicable rule (division
   from `providers.ncaa_division`, plus `institution` rules), it evaluates the
   athlete's term records, seasons used and transfer records and returns
   `[{rule_key, version, result: pass|fail|unknown, detail}]`.
3. **Status:** any `fail` on a `blocking` rule → `ineligible`; any `unknown`
   (missing data or unverified rule) → `pending`; an open waiver on a failing
   rule → `waiver_pending`; else `eligible`.
4. **Write:** upsert `eligibility_status.computed_*`; if `computed_status`
   changed, append `eligibility_events` (`computed`, from, to) and, if the
   athlete is currently certified and the new computed status is worse,
   append a `decertified` event and clear certification (status worsened
   after certification must be re-reviewed). The clearing is automatic
   because it removes permission; adding permission never is.
5. **Batch:** the nightly run chunks by provider, checkpoints, and one school's
   failure does not stop the run (CONTEXT §9).

### 4.4 Statuses

| Status | Meaning | Can play? |
|---|---|---|
| `pending` | Missing data or unverified rule | No |
| `ineligible` | A blocking rule fails | No |
| `waiver_pending` | Fails a rule, waiver filed | No, unless certified with waiver granted |
| `eligible` | All rules pass, not yet certified | **No** — computed is not certified |
| `certified_eligible` | Compliance officer signed off | Yes, within `certification_valid_from..to` |
| `certified_ineligible` | Signed off as ineligible | No |

### 4.5 Certification workflow

1. Compliance officer opens the certification queue for a sport program and
   year: athletes grouped by computed status, reasons expanded inline.
2. For each athlete or a selected batch of `eligible` athletes, clicks
   **Certify**. The `certify_eligibility(ids[], valid_to, note)` RPC checks
   `eligibility.certify`, refuses any athlete whose computed status is not
   `eligible` unless a granted waiver is attached, stamps `certified_*`, and
   appends `certified` events.
3. A batch certification shows a confirmation listing every name and count
   before it runs. The sign-off is the click plus the stored identity; a typed
   attestation sentence is optional per school (Q7).
4. The certified squad list can be printed or exported as a signed PDF with a
   content hash (VERIFY whether the conference requires a specific form).

### 4.6 Transfers and seasons of competition

- Incoming transfer: create `transfer_records`, record prior seasons in
  `seasons_of_competition` with `basis='prior_school'`, attach transcript
  receipt. The athlete stays `pending` until the compliance officer completes
  the record.
- Seasons counter: when a game roster is `locked` after a countable contest
  and the athlete's `lineup_entries.dress_status='dressed'` and they appear in
  `player_game_stats` (participated), the system proposes a
  `seasons_of_competition` row for that year (`counted=true, basis='competed'`).
  It is a proposal in the inbox, not an automatic write, because redshirt and
  hardship decisions are human (VERIFY participation definition per sport).

### 4.7 CARA logging (D1/D2 note)

Coaches or the compliance officer enter daily hours per team; the weekly view
compares against the verified `cara_weekly_*` rule and raises a finding when
a week exceeds the limit or lacks a day off. Whether D3 tracks hours at all is
VERIFY; the D3 rule set ships `d3_playing_season_weeks` instead. Optional
athlete acknowledgment of weekly logs if the school requires it.

### 4.8 Roster Lock

Enforced in the database so no client can bypass it. Runs on insert and on
any update of `lineup_entries`, and again when a `game_rosters` row moves to
`submitted` or `locked`.

```sql
create or replace function public.roster_lock_check() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_event_date date; v_program uuid; v_year text; v_status record; v_clear text; v_override uuid;
begin
  select (e.starts_at at time zone e.timezone)::date, t.sport_program_id, t.academic_year
    into v_event_date, v_program, v_year
    from public.event e join public.teams t on t.id = new.team_id
   where e.id = new.event_id;

  if v_program is null then
    return new;  -- non-college team: lock does not apply
  end if;

  select * into v_status from public.eligibility_status
   where student_athlete_id = new.student_athlete_id
     and sport_program_id = v_program and academic_year = v_year;

  select c.status into v_clear from public.athlete_clearance_current c
   where c.student_athlete_id = new.student_athlete_id
     and (c.sport_program_id = v_program or c.sport_program_id is null)
   order by c.sport_program_id nulls last limit 1;

  select o.id into v_override from public.roster_lock_overrides o
   where o.student_athlete_id = new.student_athlete_id and o.event_id = new.event_id;

  if v_override is not null then
    new.override_id := v_override;
    update public.roster_lock_overrides set consumed_at = coalesce(consumed_at, now()) where id = v_override;
    return new;   -- audit row written by the override RPC and by audit trigger on this table
  end if;

  if v_status is null
     or v_status.certified_status is distinct from 'certified_eligible'
     or v_event_date < v_status.certification_valid_from
     or (v_status.certification_valid_to is not null and v_event_date > v_status.certification_valid_to) then
    raise exception 'ROSTER_LOCK: athlete % is not certified eligible for % on %',
      new.student_athlete_id, v_program, v_event_date using errcode = 'P0001',
      hint = 'eligibility';
  end if;

  if coalesce(v_clear, 'not_cleared') = 'not_cleared' and new.dress_status = 'dressed' then
    raise exception 'ROSTER_LOCK: athlete % is not medically cleared', new.student_athlete_id
      using errcode = 'P0001', hint = 'clearance';
  end if;

  new.override_id := null;   -- clients may never set it
  return new;
end $$;
create trigger trg_roster_lock before insert or update on public.lineup_entries
  for each row execute function public.roster_lock_check();
```

Clearance design decision: a missing clearance row counts as `not_cleared`
only once Module D is enabled for the org (the function reads
`org_entitlements`); before that, clearance is not checked. `limited`
clearance allows `dressed` (the coach is shown the limitation text).

Override path: `grant_roster_override(athlete, event, reason)` requires
`lineup.override` (compliance officer only), a reason of at least 20
characters, writes `roster_lock_overrides` and `audit_log`
(`lineup.override`), appends `eligibility_events` (`override_used`), and
creates an `agent_findings` row visible to the AD. Overrides are per athlete
per event; there is no blanket override.

The UI greys ineligible athletes in the lineup builder with the reason
category ("Not certified", "Not cleared") but the trigger is the control.

### 4.9 Screens per role (Module A)

See §12 for full screen list. Compliance officer: Eligibility board,
Certification queue, Athlete eligibility record, Rules, Transfers, CARA
review, Overrides log. Coach: Team eligibility (status only), Lineup builder.
Student-athlete: My eligibility (own status, own term records, what is
missing). AD: Department eligibility summary (counts per program).

### 4.10 Agent role in Module A

The agent may draft (all blocked behind G4 per GATES rule 4; see §9):
- "At risk" findings: athlete below the term credit pace mid-term (from a
  mid-term enrollment snapshot), athletes `pending` within 7 days of a
  contest, rules still unverified 14 days after onboarding.
- Emails to athletes asking for missing documents, to the registrar asking
  for a missing record — as `obligations` drafts with an Approve click.

The agent may never: certify, decertify, write `eligibility_status.certified_*`,
grant overrides, verify rules, or insert `lineup_entries`. These RPCs reject
calls where the JWT role is service-role-from-agent (the agent runs under a
distinct database role `sporv_agent` that has no execute grant on them).

---

## 5. Module B — Sports information

### 5.1 Status

| Requirement | Status |
|---|---|
| Roster builder | PARTIAL (club Clients page; no college fields) |
| Bios and headshots | MISSING |
| Schedule builder | PARTIAL (`event`, `event_series`; no contest fields) |
| Results | MISSING |
| Game-day program PDF | MISSING |
| Stats ingestion | MISSING |
| Public feeds and embed | PARTIAL (guardian ICS feed only) |
| Media release drafting | MISSING |
| FERPA directory opt-out on public outputs | MISSING |

### 5.2 Roster builder, bios, headshots

- Built on `athlete_team_memberships` + `student_athletes`. Bulk paste or CSV
  (columns: `institution_student_id, jersey_number, position, class_year,
  hometown, high_school, previous_school, height, weight`).
- Bio editor: SID edits; athlete may propose edits that land as drafts for
  the SID to approve.
- Headshots: upload to a private storage bucket `headshots/<provider>/<athlete>.jpg`;
  public feed serves a signed URL or a copy in a public bucket only when the
  athlete is public and not opted out.
- Height and weight are stored in the memberships table as display strings
  (add `height_display`, `weight_display` columns in the Phase 4 migration) —
  sport specific and optional.

### 5.3 Schedule builder and results

Uses `event` with `kind='game'`, `opponent`, `home_away`,
`is_conference`, `is_postseason`, `venue_id`. Results enter by stat import or
manual entry into `game_results`; publishing sets `published_at`.

### 5.4 Game-day program PDF

Input: event, both rosters (opponent roster pasted or imported as CSV),
season stats to date, schedule and results, staff list, a cover image. Output:
a print PDF generated server-side (edge function), stored, linked from the
event. No AI is required; templates are fixed layouts. Only public, non-opted-
out athletes appear.

### 5.5 Stats ingestion

- **Paths:** (a) manual upload in the SID screen; (b) a watched endpoint
  `POST /functions/v1/stats-ingest/<feed_token>` that stat software or a sync
  script can push to (VERIFY whether StatCrew or LiveStats can push to a URL
  or only write files; if files only, ship a small desktop uploader later).
- **Idempotency:** key `(provider_id, external_game_id, file_sha256)`. Same
  file twice returns the earlier import id. A new file for the same game
  supersedes the earlier one in one transaction.
- **Validation:** XML schema check per adapter; game date within 2 days of a
  matching `event`; team names match program; totals equal the sum of player
  lines; errors stored on `stat_imports.errors`.
- **Reconciliation:** players matched by jersey number against the game
  roster (`lineup_entries`) for that event, falling back to the team roster;
  then by name similarity. Unmatched players go to `unmatched_players`;
  the import is `needs_review` until the SID maps or ignores each one.
- **Apply:** writes `game_results` and `player_game_stats`, sets
  `event.result_status='final'`, and proposes seasons-of-competition rows (§4.6).
- **Out of scope:** live, in-game scoring (CONTEXT §10).

### 5.6 Public feeds

| Feed | URL | Content |
|---|---|---|
| Schedule JSON | `/api/public/<token>/schedule.json` | Published events for a team or department |
| Schedule iCal | `/api/public/<token>/schedule.ics` | Same, ICS with `SEQUENCE` from `event.sequence` |
| Results RSS | `/api/public/<token>/results.rss` | Published results and media releases |
| Roster JSON | `/api/public/<token>/roster.json` | Public, non-opted-out athletes, directory fields only |
| Embed widget | `<script src=".../embed.js" data-token="...">` | Schedule/roster block for SIDEARM or Presto pages |

The embed is a small script rendering into a shadow root with the school's
colours passed as attributes. VERIFY that SIDEARM and Presto allow custom
script embeds on the customer's plan; if not, the school links to a hosted
page instead.

### 5.7 Media releases

The agent drafts recaps from `game_results` and `player_game_stats` (blocked
behind G4). The draft is a `media_releases` row with status `draft` and an
`obligations` row for the SID's inbox. Publishing requires `stats.publish` and
an Approve click; nothing posts automatically. The draft states which import
it was built from.

### 5.8 FERPA directory information

Rosters, bios, heights, weights and photos of athletes are commonly treated
as directory information that a school may disclose unless the student has
opted out (VERIFY with each school's FERPA policy, which defines its own
directory categories). Rules:

- `student_athletes.directory_opt_out = true` → excluded from every public
  feed, embed, program PDF and media release draft. The agent's recap
  generator filters them out before drafting.
- Partial opt-out uses `directory_opt_out_fields` (for example `hometown`).
- The opt-out flag is imported from the SIS (§8.2 column `ferpa_hold`) and
  may only be cleared by an SIS import or by `academics.write`, never by the SID.

---

## 6. Module C — Logistics

### 6.1 Facility booking

Status: PARTIAL (`venue`, `blackout_window`, `event_conflicts_in_range` exist
as files; no spaces, no cross-team priority).

Conflict rules, applied when a booking is requested:

1. A `blackout_window` covering the time rejects the request.
2. A `confirmed` booking on the same space or a parent/child space is a
   conflict.
3. Priority score (stored on `venue_booking.priority`, higher wins):
   `competition` 100; in-season `practice` 60 (team's program has a season with
   `segment='championship'` covering the date); nontraditional-segment
   practice 40; out-of-season practice 30; `strength` 30; `rental` 20;
   `maintenance` 90; `admin` 10. Schools edit these weights (data, not code).
4. A higher-priority request over a lower-priority confirmed booking creates
   a **bump proposal** in the AD's (or `facility.approve`) inbox, with a draft
   message to the bumped coach. Nothing is bumped until approved.
5. Equal priority: first confirmed wins; the second is offered the nearest
   free slot of the same length on the same day.

### 6.2 Travel planning

- **Trip:** linked to one or more `event` rows; travelers default to the
  game roster plus assigned staff.
- **Legs:** bus/air/van with confirmation numbers and cost.
- **Rooming:** rooms per night; assignment respects gender of team by
  default; warnings, not blocks, for rule breaks (school policy).
- **Per diem:** `per_diem_lines` generated from trip dates, meal times and
  departure/return times. Default rule: a meal is owed if the traveler is away
  across that meal window (breakfast before 07:00 departure, lunch 11:30-13:30,
  dinner after 18:00 return), minus meals marked `provided`. Windows are school
  settings. Totals feed `budget_actuals` with `source='per_diem'` after approval.
- **Missed-class report:** for every athlete on the trip, intersect trip time
  with the athlete's class meeting times (from SIS course schedule if
  imported; otherwise the athlete enters their schedule). The agent drafts one
  notice per faculty member listing the athletes and dates, from the
  compliance or academic-support office address, for approval. VERIFY whether
  the school wants notices sent from athletics or delivered as a letter the
  athlete hands to faculty.
- **Travel memo:** a one-page itinerary PDF for travelers and parents of
  record (adult athletes control who receives it).

### 6.3 Budgets

- Lines per program per category per fiscal year (fiscal year default July 1;
  `providers.fiscal_year_start_month`).
- Actuals from trips, per diem, manual entry, or a CSV export of the
  institution's ledger.
- Coaches see remaining budget per category; overspend raises a finding.
- No payment processing: Sporv records amounts; the institution pays. This
  keeps invariant I10 untouched (no Stripe involvement).

### 6.4 Approval chains

Configured per `subject_kind` and amount band, e.g. trip under a threshold →
business office; over → business office then AD (thresholds are OWNER/school
settings). `decide_approval(step_id, decision, note)` advances the chain; each
decision writes `audit_log`. A rejected step ends the chain.

---

## 7. Module D — Sports medicine

Scoped after legal review. **Phase 7 does not start until Q1 and Q2 are
answered.**

### 7.1 Status

All MISSING. Builds on invariant I7 (compartmented sensitive data).

### 7.2 Injury log and treatment notes

Athletic trainers record injuries (structured body region, mechanism,
setting) with free-text diagnosis and notes encrypted. Treatments link to an
injury or stand alone (preventive). Coaches never see diagnoses.

### 7.3 Return-to-play stages

Each injury may follow a protocol template (stages defined by the school's
medical staff). The current stage shows on the athlete's clearance as
`limited` with the stage label as `reason_public`, if the AT chooses to share
it.

### 7.4 Concussion protocol

The school's written concussion protocol is uploaded and versioned. Stages
are recorded; return-to-learn completion and physician clearance are required
before a `cleared` clearance can be issued for a concussion injury (trigger).
Whether the NCAA requires a specific protocol structure, baseline testing, or
annual protocol submission is VERIFY with the head AT.

### 7.5 Clearance gating

`med.clearances` is the single source of truth. `not_cleared` blocks Roster
Lock (§4.8) for `dressed` entries. Clearances are issued only by
`medical.clear`. A new injury with severity `moderate` or `severe` creates a
draft `not_cleared` clearance for the AT to confirm (not automatic).

### 7.6 Pre-participation physicals and required screenings

`document_requirements` with `is_medical=true` (PPE, sickle-cell trait status
or signed waiver, cardiac screening if school requires; VERIFY which
screenings the NCAA requires vs. recommends per division). Missing or expired
required items block participation via clearance (`not_cleared`,
reason "Required screening missing").

### 7.7 Encryption, access, logging

- **At rest:** Supabase encrypts disks. Column-level: `*_enc bytea` columns
  are encrypted with a per-organization data key; data keys are wrapped by a
  master key stored in Supabase Vault. Supabase has signalled changes to
  `pgsodium` support (VERIFY current status before choosing pgsodium TCE vs.
  application-side envelope encryption in an edge function). Default choice:
  application-side AES-GCM in the `med-api` edge function, key from Vault,
  so the database never holds plaintext and SQL-editor access does not reveal
  notes.
- **Access:** only through `med-api` RPCs; each read writes `data_access_log`.
- **Minimum necessary:** coaches receive `status` and `reason_public` only.

### 7.8 Legal: FERPA vs. HIPAA (VERIFY with counsel for every customer)

| Question | Working understanding | Who confirms |
|---|---|---|
| Are AT records education records? | Generally yes when maintained by the institution's athletics department; FERPA governs. | Customer's counsel |
| When does HIPAA apply? | When the provider is a HIPAA covered entity (for example, a university health system that bills electronically) and the records are not education records; some schools route sports medicine through a hospital partner. | Customer's counsel |
| Do we need a BAA? | Only if the school (or its partner) is a covered entity and we are its business associate. We should be able to sign one before any such customer goes live. | Sporv counsel |
| Treatment records exception | FERPA has a "treatment records" category for records used only for treatment; disclosure to the student changes their status. VERIFY implications for the athlete export feature. | Sporv counsel |
| State law | Some states have health-information or student-data privacy laws stricter than federal law (VERIFY per pilot state). | Customer's counsel |
| Marketing claims | No "HIPAA-compliant" or "FERPA-compliant" claims on the site until counsel approves wording (CONTEXT §8: claims map 1:1 to real features). | Owner + counsel |

### 7.9 Athlete export and retention

- An athlete can request a copy of their own records (export never gated, I4).
  The request is an `obligations` item for the head AT; release requires a
  click.
- Retention per data class in §10.3; deletion at end of retention is a
  scheduled job that writes a deletion receipt to `audit_log` (G4 receipt).

---

## 8. Integrations

### 8.1 SAML SSO (RED: auth)

| Step | Detail |
|---|---|
| 1. Domain verification | School adds DNS TXT record; edge function verifies; `org_verified_domains.verified_at` set. |
| 2. Connection | Owner registers the school's IdP metadata URL with Supabase SSO (CLI `supabase sso add` or Management API; VERIFY current command and plan requirement). Stores returned id in `sso_connections`. |
| 3. Sign-in | User enters email on the Sporv sign-in page; the domain resolves to the SSO provider; redirect to IdP; return with SAML assertion. |
| 4. JIT provisioning | On first login, an auth hook creates `organization_members` (`role='trainer'`, `is_active`) and, if the SAML attribute for student id matches `student_athletes.institution_student_id`, links `user_id`. |
| 5. Role mapping | The IdP's group attribute (name VERIFY per IdP, e.g. `eduPersonAffiliation`, `memberOf`, `groups`) maps through `sso_group_role_map` to `role_assignments` with `source='sso_group'`. Group removal ends the assignment on next login. Restricted roles (`compliance_officer`, `athletic_trainer`, `team_physician`) are never granted by group mapping; an admin assigns them by hand. |
| 6. Enforcement | When `enforced=true`, password and magic-link login for that domain are refused. Break-glass owner account keeps password login with MFA. |
| SCIM | Deferred. Without SCIM, deprovisioning relies on IdP login failure plus a nightly SIS roster diff that deactivates departed athletes. |

### 8.2 SIS import

**CSV first.** Exact columns (header row required, UTF-8, one row per athlete
per term):

| Column | Type | Required | Notes |
|---|---|---|---|
| `institution_student_id` | text | yes | Match key |
| `legal_first_name` | text | yes | |
| `legal_last_name` | text | yes | |
| `preferred_name` | text | no | |
| `email` | text | yes | Institutional address |
| `date_of_birth` | YYYY-MM-DD | no | |
| `term_code` | text | yes | Must exist in `academic_terms` or is created as a draft term |
| `credits_enrolled` | number | yes | At census |
| `credits_attempted` | number | after grades | |
| `credits_earned` | number | after grades | |
| `credits_degree_applicable` | number | no | If absent, PTD is computed |
| `term_gpa` | number | after grades | |
| `cumulative_gpa` | number | after grades | |
| `cumulative_credits_earned` | number | yes | |
| `full_time` | Y/N | yes | Institution's determination |
| `declared_major` | text | no | |
| `degree_program_credits` | number | no | |
| `progress_toward_degree_pct` | number | no | Preferred over computed |
| `class_year` | FR/SO/JR/SR/GR | no | |
| `ferpa_hold` | Y/N | yes | Sets `directory_opt_out` |
| `academic_standing` | text | no | For D3 institutional rule |
| `grades_final` | Y/N | yes | Sets `is_final` |

Flow: upload → `sis_import_jobs` `staged` → validate each row into
`sis_import_rows` with `match_kind` and field-level `diff` → compliance officer
reviews a summary (new athletes, changed values, errors) → **Apply** → term
records upserted, eligibility recomputed, `audit_log` written per change.
Error report downloadable as CSV with row number and message. Same file twice
is rejected by `file_sha256` uniqueness.

**Schedule:** school-set, typically at census, mid-term, and after grades
post. A reminder finding fires if no import has applied by census + 7 days.

**Live connectors later:** Banner via Ellucian Ethos APIs; Workday Student via
Workday web services or RaaS reports (VERIFY per customer, both require
school IT approval and credentials stored in Vault under `org_connectors`
patterns from `20260909_001037_org_connectors.sql`). The connector writes the
same staged job; nothing bypasses review.

### 8.3 Stats

See §5.5. Adapters: `statcrew_xml`, `livestats_xml`/`json` (VERIFY formats with
pilot SID).

### 8.4 NCAA exports

Format TBD (§0.2). Phase 2 ships: certified squad list CSV, eligibility
history CSV, seasons-of-competition CSV, CARA weekly CSV, each with a
documented column list and a content hash. When the current NCAA tool and its
import format are confirmed, add an adapter.

### 8.5 Calendar

Per-user iCal feed (`feed_tokens.kind='user_calendar'`) for staff and athletes;
Google and Outlook subscribe by URL. Two-way sync is not in scope (Google
Calendar connector work in CONTEXT §11 item 2 covers clubs first).

### 8.6 Email and SMS

All outbound goes through the existing draft → approve → send path
(`obligations`, `outbound_messages`, trigger `000200`). New message kinds:
`missing_document`, `missed_class_notice`, `eligibility_at_risk`,
`travel_memo`, `facility_bump`. No new send path, no auto-send.

### 8.7 Migration from Teamworks, ARMS and spreadsheets

Import templates (CSV) for: roster with jersey numbers; staff with role and
team; schedule; historical seasons of competition; injury history (Module D,
encrypted on import, AT-only). Mapping screens reuse `import_batches`
(`20260830_000100`) and `migration_quarantine` (`20260915_001053`) so bad rows
are quarantined, not dropped. VERIFY export formats from Teamworks and ARMS
with a pilot school.

---

# Part II — Source

Find the best people and manage potential recruits until they enrol. One
module, Module E, with the same depth as A-D. Every table here is a migration
and is RED.

## E1. Context and goal

### E1.1 Who does the work

| Person | Recruiting job |
|---|---|
| Head coach | Final say on who is offered; evaluates; owns the board for the program |
| Assistant coach | Most evaluation and day-to-day contact |
| Recruiting coordinator | Board hygiene, questionnaires, camp lists, visit logistics; full-time role at larger programs, part of an assistant's job at most D2/D3 programs (VERIFY in discovery) |
| Compliance officer | Recruiting calendar, contact rules, visit limits, aid limits, overrides |
| Admissions and financial aid | Admit decisions and aid packages; outside Sporv, status mirrored in |
| Prospect and their guardian | Fill questionnaires, attend camps and visits, receive messages |

### E1.2 What they use today (VERIFY in discovery)

| Job | Common tools | Pain |
|---|---|---|
| Prospect database | Front Rush, ARMS, Teamworks Recruiting, spreadsheets | Expensive for D3 budgets; many D3 programs run on spreadsheets and email |
| Finding prospects | NCSA, SportsRecruits, FieldLevel, club tournament books, camp lists | Leads arrive in five places and are re-typed |
| Questionnaires | Website forms, Google Forms | Land in an inbox, never in the database |
| Contact compliance | Paper or spreadsheet phone logs, memory of the calendar | Contact in a dead or quiet period is a self-report risk (VERIFY consequence per division) |
| Roster planning | Whiteboard of graduating seniors by position | Needs not connected to the board |

### E1.3 What "done" looks like for a Source pilot

A Source pilot can run in one program before the department buys Manage. It
is done when, for one recruiting cycle in one sport program:

1. Every lead from camps, questionnaires and imports lands in Sporv, deduplicated.
2. The staff moves recruits through the pipeline and scores them on the program's rubric.
3. The gap view shows how many recruits are needed per position per entry year.
4. Every outbound message is a draft approved by a human and logged; the
   contact log warns or blocks outside a verified permissible window.
5. Committed recruits convert into student-athletes with no re-keying when
   they enrol.

## E2. Status

| Requirement | Status |
|---|---|
| Prospect database | MISSING (the existing `prospects` table is club intake, not recruiting) |
| Sources: camps, questionnaires, referrals, portal, CSV | MISSING; `intake_events` (email intake) HAVE as a file, reusable for inbound messages |
| Pipeline stages | MISSING |
| Evaluations and rubrics | MISSING |
| Roster-need gap analysis | MISSING (depends on §2.7 memberships) |
| AI ranking with explanations | MISSING; blocked behind G4 (GATES rule 4) |
| Agent-drafted communications | PARTIAL: the draft → approve → send path exists (`obligations`, trigger `000200`); recruiting kinds are new |
| Recruiting rules as data | MISSING |
| Contact log with window enforcement | MISSING |
| Visit planning | MISSING; reuses Module C tables |
| Offers and aid tracking | MISSING |
| Conversion to roster athlete | MISSING |
| Minors' data handling for recruits | MISSING; I7 pattern exists for club minors |

## E3. Schema

### E3.1 Recruits and guardians

```sql
create table public.recruits (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  first_name       text not null,
  last_name        text not null,
  preferred_name   text,
  prospect_type    text not null check (prospect_type in ('high_school','juco','transfer_portal','international','post_grad','walk_on')),
  grad_year        smallint check (grad_year between 2000 and 2100),   -- HS or current-school graduation
  expected_entry_term text,                 -- 'Fall 2027'; matched to academic_terms when it exists
  date_of_birth    date,                    -- optional; drives minor status
  is_minor         boolean not null default true,  -- conservative default; recomputed nightly from DOB
  current_school   text,
  current_school_level text check (current_school_level in ('high_school','juco','four_year','prep','club_only','other')),
  club_team        text,
  city text, state_region text, country text default 'US',
  email            text,                    -- prospect's own; see E8 for minors
  phone            text,
  social_handles   jsonb not null default '{}',
  -- academics
  hs_gpa           numeric(4,3),
  test_scores      jsonb not null default '{}',   -- optional; many schools are test-optional
  intended_major   text,
  eligibility_center_id text,               -- VERIFY field name and whether D3 prospects register
  eligibility_center_status text,           -- free text until verified values known
  transcript_received boolean not null default false,
  admissions_status text check (admissions_status in ('not_applied','applied','admitted','denied','deposited','withdrawn')),
  -- transfer portal
  portal_entry_date date,
  previous_institution text,
  seasons_used_elsewhere smallint,
  -- lifecycle
  status           text not null default 'active' check (status in ('active','enrolled','archived','deleted_pending')),
  student_athlete_id uuid unique references public.student_athletes(id),  -- set on conversion
  retain_until     date,                    -- E8.4
  dedupe_key       text generated always as
                     (lower(last_name) || '|' || lower(first_name) || '|' || coalesce(grad_year::text,'')) stored,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index recruits_dedupe_idx on public.recruits (provider_id, dedupe_key);
create index recruits_email_idx on public.recruits (provider_id, lower(email)) where email is not null;
create index recruits_grad_idx on public.recruits (provider_id, grad_year);

alter table public.student_athletes
  add column if not exists recruit_id uuid unique references public.recruits(id) on delete set null;

create table public.recruit_guardians (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  recruit_id       uuid not null references public.recruits(id) on delete cascade,
  full_name        text not null,
  relationship     text,
  email            text,
  phone            text,
  is_primary       boolean not null default false,
  consent_status   text not null default 'not_requested'
                     check (consent_status in ('not_requested','requested','granted','refused','withdrawn')),
  consent_scope    text[] not null default '{}',   -- 'store_profile','contact_prospect','contact_guardian','photos'
  consent_at       timestamptz,
  consent_method   text check (consent_method in ('form_checkbox_email_verified','signed_form','verbal_logged')),
  consent_evidence_ref text,                -- form submission id or document path
  created_at       timestamptz not null default now()
);
create unique index rg_primary_uq on public.recruit_guardians (recruit_id) where is_primary;
```

Identity is per institution; interest is per sport program. A two-sport
prospect has one `recruits` row and two pipelines.

### E3.2 Pipelines and stages

```sql
create table public.recruit_pipelines (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  recruit_id       uuid not null references public.recruits(id) on delete cascade,
  sport_program_id uuid not null references public.sport_programs(id) on delete cascade,
  stage            text not null default 'identified'
                     check (stage in ('identified','evaluated','contacted','visit','offer','committed','signed','enrolled','closed')),
  closed_reason    text check (closed_reason in ('not_a_fit','chose_other_school','academic','no_response','withdrew','admissions_denied','other')),
  position_primary text,
  positions        text[] not null default '{}',
  metrics          jsonb not null default '{}',   -- keys from sports.recruit_metric_keys (E3.9)
  film_links       text[] not null default '{}',  -- https only, validated
  priority         smallint check (priority between 1 and 5),
  owner_member_id  uuid references public.organization_members(id) on delete set null,
  target_entry_year text,                   -- '2027-28'
  recruiting_target_id uuid,                -- FK below
  last_contact_at  timestamptz,
  next_action_on   date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (recruit_id, sport_program_id),
  constraint rp_closed_reason check ((stage = 'closed') = (closed_reason is not null))
);
create index rp_board_idx on public.recruit_pipelines (sport_program_id, stage, priority);

create table public.recruit_stage_history (    -- append-only
  id               bigint generated always as identity primary key,
  provider_id      uuid not null references public.providers(id) on delete cascade,
  pipeline_id      uuid not null references public.recruit_pipelines(id) on delete cascade,
  from_stage       text,
  to_stage         text not null,
  actor_id         uuid references auth.users(id),
  actor_kind       text not null check (actor_kind in ('user','system','import')),
  note             text,
  occurred_at      timestamptz not null default now()
);
```

Stage rules (trigger on `recruit_pipelines`):
- Stages move forward one or more steps, or to `closed`. Moving backward is
  allowed but requires a note (stored in history).
- `offer` requires at least one `recruit_offers` row in `approved_internal`
  or later.
- `signed` requires an offer with `status='accepted'` and `signed_at`.
- `enrolled` is set **only** by `convert_recruit_to_athlete()` (E7).
- Every change appends `recruit_stage_history` and `audit_log`.

### E3.3 Sources and imports

```sql
create table public.recruit_sources (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  recruit_id       uuid references public.recruits(id) on delete cascade,   -- null while staged
  sport_program_id uuid references public.sport_programs(id),
  source_kind      text not null check (source_kind in
                     ('camp_registration','questionnaire','coach_referral','portal_entry','csv_import',
                      'manual','inbound_email','recruiting_service')),
  source_label     text,                    -- 'Summer Elite Camp 2027', 'Front Rush export 2026-10'
  source_ref       text,                    -- form submission id, import row id, intake_event id
  referred_by      text,                    -- coach referral: name of the HS/club coach
  raw              jsonb not null,          -- as received
  status           text not null default 'staged' check (status in ('staged','matched','created','merged','rejected')),
  received_at      timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz
);
create index rs_staged_idx on public.recruit_sources (provider_id, status) where status = 'staged';

create table public.recruit_import_jobs (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  sport_program_id uuid references public.sport_programs(id),
  source_system    text not null check (source_system in ('front_rush','arms','teamworks_recruiting','ncsa','sportsrecruits','fieldlevel','spreadsheet','other')),
  file_sha256      text not null,
  column_mapping   jsonb not null,          -- source column -> recruits/pipeline field
  status           text not null default 'staged' check (status in ('staged','validated','needs_review','applied','rejected')),
  row_count integer, new_count integer, match_count integer, error_count integer,
  started_by       uuid not null references auth.users(id),
  applied_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  applied_at       timestamptz,
  unique (provider_id, file_sha256)
);
create table public.recruit_import_rows (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  job_id           uuid not null references public.recruit_import_jobs(id) on delete cascade,
  row_no           integer not null,
  raw              jsonb not null,
  match_recruit_id uuid references public.recruits(id),
  match_kind       text check (match_kind in ('email','dedupe_key','new','ambiguous')),
  errors           jsonb not null default '[]',
  decision         text check (decision in ('create','merge','skip')),
  unique (job_id, row_no)
);

create table public.recruit_forms (              -- public questionnaires and camp sign-ups
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  sport_program_id uuid not null references public.sport_programs(id) on delete cascade,
  kind             text not null check (kind in ('questionnaire','camp_registration')),
  title            text not null,
  fields           jsonb not null,          -- ordered field list; core fields fixed, extras per sport
  token            text not null unique default encode(gen_random_bytes(16),'hex'),
  requires_guardian_for_minors boolean not null default true,
  is_open          boolean not null default true,
  created_at       timestamptz not null default now()
);
```

Every source lands as a `recruit_sources` row in `staged`. A staged row is
matched by email, then `dedupe_key`; exact single matches are proposed as
merges, others as new recruits. A staff member with `recruit.write` approves
each decision (bulk approve allowed). Nothing becomes a recruit without a
click; this is the same rule as club `prospects` (rows only via approved
proposals).

Questionnaire submissions from an unauthenticated public form go through an
edge function with rate limiting (pattern: `edge_rate_limits`) and never write
directly to `recruits`.

### E3.4 Roster needs and targets

```sql
create table public.recruiting_targets (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  sport_program_id uuid not null references public.sport_programs(id) on delete cascade,
  entry_year       text not null,           -- '2027-28'
  position         text not null,
  target_count     smallint not null check (target_count >= 0),
  priority         smallint not null default 3 check (priority between 1 and 5),
  note             text,
  set_by           uuid not null references auth.users(id),
  updated_at       timestamptz not null default now(),
  unique (sport_program_id, entry_year, position)
);
alter table public.recruit_pipelines
  add constraint rp_target_fk foreign key (recruiting_target_id) references public.recruiting_targets(id) on delete set null;
```

Gap view (deterministic SQL, no AI):

```sql
create view public.roster_graduation_gaps with (security_invoker = true) as
with roster as (
  select t.sport_program_id, atm.position,
         -- expected exit year from class_year; GR/5th exit this year. VERIFY with pilot whether
         -- seasons remaining (Module A) should replace class_year when available.
         case sa.class_year when 'FR' then 4 when 'SO' then 3 when 'JR' then 2 else 1 end as years_left
  from public.athlete_team_memberships atm
  join public.teams t on t.id = atm.team_id
  join public.student_athletes sa on sa.id = atm.student_athlete_id
  where atm.roster_status in ('active','redshirt','injured_reserve','medical_hardship')
    and t.academic_year = (select max(academic_year) from public.teams t2 where t2.sport_program_id = t.sport_program_id)
)
select rt.sport_program_id, rt.entry_year, rt.position, rt.target_count,
       (select count(*) from public.recruit_pipelines p
         where p.sport_program_id = rt.sport_program_id and p.position_primary = rt.position
           and p.target_entry_year = rt.entry_year and p.stage in ('committed','signed','enrolled')) as committed,
       (select count(*) from roster r
         where r.sport_program_id = rt.sport_program_id and r.position = rt.position and r.years_left = 1) as departing_next
from public.recruiting_targets rt;
```

The view informs targets; the coach sets the target counts. A suggested
target ("3 departing midfielders, 1 committed") is shown beside the input,
never written automatically.

### E3.5 Evaluations

```sql
create table public.evaluation_rubrics (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  sport_program_id uuid not null references public.sport_programs(id) on delete cascade,
  position         text,                    -- null = all positions
  version          integer not null default 1,
  criteria         jsonb not null,          -- [{key,label,weight,scale_min,scale_max,anchors:{1:'...',5:'...'}}]
  is_active        boolean not null default true,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (sport_program_id, coalesce(position,''), version)
);

create table public.recruit_evaluations (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  pipeline_id      uuid not null references public.recruit_pipelines(id) on delete cascade,
  rubric_id        uuid not null references public.evaluation_rubrics(id),
  evaluator_id     uuid not null references auth.users(id),
  context          text not null check (context in ('film','live_game','camp','visit','practice','interview')),
  seen_on          date not null,
  seen_at_event    text,
  scores           jsonb not null,          -- {criterion_key: number}; validated against rubric
  weighted_score   numeric(5,2) not null,   -- computed by trigger from rubric weights
  projection       text check (projection in ('impact','contributor','developmental','not_a_fit')),
  notes            text,
  created_at       timestamptz not null default now(),
  unique (pipeline_id, evaluator_id, context, seen_on)
);
create index re_pipeline_idx on public.recruit_evaluations (pipeline_id);
```

A trigger validates every rubric key is scored within its scale and computes
`weighted_score`. Rubric edits create a new version; old evaluations keep
their rubric. The board shows the mean across evaluators, the count, and the
spread (max minus min); a spread above a program setting flags "evaluators
disagree" for discussion rather than averaging it away.

Evaluation timing is itself sometimes regulated (evaluation periods, VERIFY);
`context='live_game'` evaluations are checked against `recruiting_periods`
the same way contacts are (E5).

### E3.6 Recruiting rules as data

```sql
alter table public.compliance_rules
  add column if not exists sport_code text references public.sports(code);  -- null = all sports

create table public.recruiting_periods (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid references public.providers(id) on delete cascade,   -- null = Sporv default set
  division         text not null check (division in ('D1','D2','D3','NAIA','NJCAA')),
  sport_code       text references public.sports(code),                     -- null = all sports
  period_kind      text not null check (period_kind in ('contact','evaluation','quiet','dead')),
  prospect_scope   text not null default 'all' check (prospect_scope in ('all','high_school','juco','transfer')),
  starts_on        date not null,
  ends_on          date not null,
  version          integer not null default 1,
  source_citation  text,
  verified_by      uuid references auth.users(id),
  verified_at      timestamptz,
  constraint rper_dates check (ends_on >= starts_on)
);
create index rper_lookup_idx on public.recruiting_periods (division, sport_code, starts_on, ends_on);
```

Scalar recruiting rules live in `compliance_rules` with `rule_key` prefixed
`recruiting.`. **Every value is a placeholder. VERIFY each with the current
NCAA Division Manual and the institution's compliance officer.** The engine
treats an unverified rule as "warn only" and never as permission.

| `rule_key` | `params` shape | Intent (VERIFY every value) |
|---|---|---|
| `recruiting.first_contact_date` | `{"by_grad_year_offset": {"date_md": "MM-DD", "years_before_grad": N}, "channels": [...]}` | Earliest date off-campus or electronic contact is permitted, by sport and division. |
| `recruiting.electronic_contact` | `{"allowed_from": "...", "channels": ["email","text","dm","phone"]}` | When calls, texts and DMs are permitted. D2 and D3 rules differ from D1. |
| `recruiting.off_campus_contact_limit` | `{"max_contacts": N, "per": "prospect"}` | Limit on in-person off-campus contacts, where one exists. |
| `recruiting.official_visit_limit` | `{"max_per_prospect": N, "per_institution": N, "from_date": "..."}` | Official (institution-paid) visit limits and earliest date. |
| `recruiting.unofficial_visit` | `{"allowed_from": "...", "restrictions": [...]}` | Unofficial visits; in some divisions unrestricted. |
| `recruiting.d3_contact_rules` | `{...}` | D3 has fewer contact restrictions than D1/D2; whatever applies is entered here. VERIFY. |
| `recruiting.transfer_contact` | `{"requires_portal_entry": true}` | Contact with a student enrolled at another four-year school generally requires portal entry or permission. VERIFY per division. |
| `recruiting.juco_contact` | `{...}` | Rules for two-year college prospects. |
| `recruiting.aid_equivalency_limit` | `{"sport_code": "...", "max_equivalencies": X}` | D2 per-sport athletic aid limits (equivalency). VERIFY current numbers and whether limits changed with recent roster-limit reforms. |
| `recruiting.no_athletic_aid` | `{}` | D3. VERIFY. |
| `recruiting.contact_at_competition_site` | `{"forbidden_until": "after_competition"}` | Restrictions on contacting a prospect at their competition. VERIFY. |

### E3.7 Contact log

```sql
create table public.recruit_contacts (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  pipeline_id      uuid not null references public.recruit_pipelines(id) on delete cascade,
  recruit_id       uuid not null references public.recruits(id) on delete cascade,
  sport_program_id uuid not null references public.sport_programs(id) on delete cascade,
  contact_kind     text not null check (contact_kind in
                     ('email','text','phone','video','social_dm','mail','in_person_off_campus','in_person_on_campus','evaluation_live')),
  direction        text not null check (direction in ('outbound','inbound')),
  counterpart      text not null check (counterpart in ('prospect','guardian','hs_coach','club_coach','other')),
  occurred_at      timestamptz not null,
  staff_member_id  uuid references public.organization_members(id),
  obligation_id    uuid references public.obligations(id),       -- the approved draft, for sent messages
  subject          text,
  summary          text,                    -- not the full body for calls/visits
  window_result    jsonb not null default '{}',   -- {verdict: permitted|warn|blocked, rules:[...], period}
  warn_acknowledged_by uuid references auth.users(id),
  override_id      uuid,
  logged_by        uuid references auth.users(id),   -- null = system (send pipeline)
  created_at       timestamptz not null default now()
);
create index rc_pipeline_time_idx on public.recruit_contacts (pipeline_id, occurred_at desc);
create index rc_program_time_idx on public.recruit_contacts (sport_program_id, occurred_at desc);

create table public.recruit_contact_overrides (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  recruit_id       uuid not null references public.recruits(id) on delete cascade,
  contact_kind     text not null,
  valid_on         date not null,
  reason           text not null check (length(reason) >= 20),
  granted_by       uuid not null references auth.users(id),
  granted_at       timestamptz not null default now(),
  consumed_at      timestamptz
);
```

Inbound contacts (a prospect emails the coach) are logged but never blocked:
the rules restrict institution-initiated contact (VERIFY how each division
treats prospect-initiated calls and replies).

### E3.8 Visits, offers, rankings

```sql
create table public.recruit_visits (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  pipeline_id      uuid not null references public.recruit_pipelines(id) on delete cascade,
  recruit_id       uuid not null references public.recruits(id) on delete cascade,
  visit_kind       text not null check (visit_kind in ('official','unofficial','virtual','camp')),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'planned' check (status in ('planned','submitted','approved','completed','cancelled')),
  host_student_athlete_id uuid references public.student_athletes(id),
  guardians_attending smallint not null default 0,
  travel_trip_id   uuid references public.travel_trips(id),       -- Module C, for paid travel
  approval_request_id uuid references public.approval_requests(id),
  itinerary_event_ids uuid[] not null default '{}',               -- event rows: tour, class, practice, meeting
  expense_estimate_cents integer,
  limit_check      jsonb not null default '{}',                   -- visit-limit evaluation at submit
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  constraint rv_dates check (ends_at > starts_at)
);

create table public.recruit_offers (
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  pipeline_id      uuid not null references public.recruit_pipelines(id) on delete cascade,
  recruit_id       uuid not null references public.recruits(id) on delete cascade,
  offer_kind       text not null check (offer_kind in ('roster_spot','athletic_aid','preferred_walk_on','walk_on')),
  aid_percent      numeric(5,2) check (aid_percent is null or aid_percent between 0 and 100),
  aid_amount_cents bigint check (aid_amount_cents is null or aid_amount_cents >= 0),
  aid_equivalency  numeric(5,3),            -- computed share of a full grant; D2
  starts_academic_year text not null,
  duration_years   smallint,
  status           text not null default 'draft' check (status in
                     ('draft','approved_internal','extended','accepted','declined','rescinded','expired')),
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  extended_at      timestamptz,
  expires_on       date,
  responded_at     timestamptz,
  signed_document_kind text,                -- values set after VERIFY of current signing process
  signed_at        timestamptz,
  notes            text,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now()
);
create index ro_program_year_idx on public.recruit_offers (provider_id, starts_academic_year, status);

create table public.recruit_rankings (           -- G4-gated AI output; deterministic score stored alongside
  id               uuid primary key default gen_random_uuid(),
  provider_id      uuid not null references public.providers(id) on delete cascade,
  pipeline_id      uuid not null references public.recruit_pipelines(id) on delete cascade,
  computed_at      timestamptz not null default now(),
  method           text not null check (method in ('deterministic_v1','agent_explained_v1')),
  score            numeric(6,2) not null,
  factors          jsonb not null,          -- [{factor, value, weight, contribution, source_rows}]
  explanation      text,                    -- agent text; null for deterministic
  run_id           uuid,
  unique (pipeline_id, method, computed_at)
);
```

Offer triggers:
- D3 institution (`providers.ncaa_division='D3'`): `offer_kind='athletic_aid'`
  or any `aid_*` value raises `D3_NO_ATHLETIC_AID` (VERIFY rule).
- `status` cannot move to `extended` without `approved_by` from a user with
  `recruit.offer_approve`.
- D2: on `approved_internal`, the sum of `aid_equivalency` for the program's
  starting year plus current roster aid is compared with the verified
  `recruiting.aid_equivalency_limit`; over the limit warns the approver
  (blocking is a compliance setting, default warn). Current-roster aid comes
  from a new `athlete_aid_awards` table in Phase R2 or from a manual figure
  until then.

### E3.9 Sport catalog additions

```sql
alter table public.sports
  add column if not exists recruit_metric_keys jsonb not null default '[]';
  -- [{key:'height_in', label:'Height', unit:'in'}, {key:'forty_s', label:'40 yd', unit:'s'}, ...]
```

Metrics are sport-specific data, not columns (CONTEXT §5.4: never hardcode a
sport's vocabulary into a component).

## E4. Pipeline and board behaviour

| Stage | Entry condition | Typical actions |
|---|---|---|
| `identified` | Created from an approved source or manual entry | Watch film, add metrics |
| `evaluated` | At least one evaluation | Score on rubric; decide to pursue |
| `contacted` | First logged outbound contact (system moves it when the first contact is logged) | Questionnaire, calls, emails |
| `visit` | A visit planned or completed | Visit planning, host assignment |
| `offer` | An offer approved internally | Extend offer, track response |
| `committed` | Recruit verbally commits (staff records) | Admissions and aid follow-through |
| `signed` | Accepted offer with signing recorded | Pre-enrolment documents |
| `enrolled` | Set by conversion only | Becomes a student-athlete |
| `closed` | Reason required | Retention clock starts (E8.4) |

The board is a table grouped by stage (not a decorative card wall), filterable
by position, entry year, priority, owner, last contact age and target. A
"needs" strip above the board shows each position's gap from
`roster_graduation_gaps`.

## E5. Contact window enforcement

Same pattern as Roster Lock: enforced in the database, not by a greyed-out
button.

```sql
create or replace function public.recruit_contact_check() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_div text; v_sport text; v_scope text; v_verdict text := 'permitted'; v_rules jsonb := '[]';
        v_period text; v_override uuid;
begin
  if new.direction = 'inbound' then
    new.window_result := jsonb_build_object('verdict','permitted','reason','inbound');
    return new;
  end if;

  select p.ncaa_division, sp.sport_code into v_div, v_sport
    from public.providers p join public.sport_programs sp on sp.id = new.sport_program_id
   where p.id = new.provider_id;
  select case r.prospect_type when 'high_school' then 'high_school' when 'juco' then 'juco'
              when 'transfer_portal' then 'transfer' else 'all' end
    into v_scope from public.recruits r where r.id = new.recruit_id;

  select rp.period_kind into v_period
    from public.recruiting_periods rp
   where rp.division = v_div and (rp.sport_code = v_sport or rp.sport_code is null)
     and rp.prospect_scope in ('all', v_scope)
     and (new.occurred_at at time zone 'UTC')::date between rp.starts_on and rp.ends_on
     and rp.verified_by is not null
     and (rp.provider_id = new.provider_id or rp.provider_id is null)
   order by rp.provider_id nulls last, rp.sport_code nulls last limit 1;

  -- Evaluate period + recruiting.* rules (first contact date, channel, transfer portal entry).
  -- public.recruiting_rule_eval returns {verdict, rules[]} using only VERIFIED rules for 'blocked';
  -- unverified rules can only produce 'warn'.
  select (x->>'verdict'), (x->'rules') into v_verdict, v_rules
    from public.recruiting_rule_eval(new.provider_id, new.recruit_id, new.sport_program_id,
                                     new.contact_kind, new.counterpart, new.occurred_at, v_period) x;

  if v_verdict = 'blocked' then
    select o.id into v_override from public.recruit_contact_overrides o
     where o.recruit_id = new.recruit_id and o.contact_kind = new.contact_kind
       and o.valid_on = (new.occurred_at at time zone 'UTC')::date and o.consumed_at is null;
    if v_override is null then
      raise exception 'RECRUIT_WINDOW: % contact with recruit % is not permitted on % (%)',
        new.contact_kind, new.recruit_id, new.occurred_at::date, coalesce(v_period,'no period')
        using errcode = 'P0001';
    end if;
    update public.recruit_contact_overrides set consumed_at = now() where id = v_override;
    new.override_id := v_override;
  elsif v_verdict = 'warn' and new.warn_acknowledged_by is null then
    raise exception 'RECRUIT_WINDOW_WARN: acknowledgement required' using errcode = 'P0001';
  end if;

  new.window_result := jsonb_build_object('verdict', v_verdict, 'period', v_period, 'rules', v_rules);
  return new;
end $$;
create trigger trg_recruit_contact_check before insert on public.recruit_contacts
  for each row execute function public.recruit_contact_check();
```

Where it bites:
1. **Sending a drafted message:** the approve-and-send RPC for a recruiting
   draft performs the check **before** sending, by inserting the
   `recruit_contacts` row first in the same transaction. A blocked verdict
   aborts the send; the draft stays in the inbox with the reason. A warn
   verdict requires the approver to tick "I have checked this contact is
   permitted", stored as `warn_acknowledged_by`.
2. **Logging a call or visit by hand:** the same trigger runs. A blocked
   in-person contact cannot be logged without a compliance override; the UI
   says so and offers "Report to compliance" which creates a finding (a
   contact that already happened must be recorded, so the compliance officer
   either grants an override with reason — recording, not approving — or
   records it in the self-report workflow outside Sporv). VERIFY with the
   pilot compliance officer how they want after-the-fact contacts handled.
3. **Clock and time zone:** periods are compared on the institution's local
   date (`providers.default_timezone`), not UTC; the SQL above shows UTC for
   brevity and the shipped function uses the institution zone.

## E6. Ranking and matching

Two layers, kept separate so the human can see which is which.

1. **Deterministic score (ships without G4):**
   `score = w1 * mean_weighted_evaluation + w2 * need_fit + w3 * academic_fit + w4 * interest_signal`
   - `need_fit`: 1 if the recruit's primary position has an open gap for
     their entry year (target minus committed > 0), scaled by target
     priority; 0 if the position is full.
   - `academic_fit`: whether intended major exists and GPA meets the
     admissions band the program enters (data entered by staff; no
     protected attributes).
   - `interest_signal`: recency of inbound contact, questionnaire completed,
     visit completed.
   - Weights are program settings; every factor is stored in
     `recruit_rankings.factors` with its source rows.
2. **Agent explanation (G4-gated):** the agent reads the factors and the
   evaluations' notes and writes a short explanation and suggested next
   action ("Strong film grades from two evaluators; fills the 2027 left-back
   gap; no contact in 21 days"). It does not change the score, does not move
   stages, and never contacts anyone. Its output is labelled as agent text.

Fairness and data minimisation: ranking inputs exclude date of birth,
contact details, guardian data, photos, hometown and anything that is a
protected characteristic. A test asserts the factor list contains only the
allowed keys.

## E7. Conversion to roster athlete

`convert_recruit_to_athlete(p_pipeline uuid, p_institution_student_id text, p_team uuid)`:

1. Requires `recruit.write` and `roster.write` on the target team, pipeline
   stage `signed` (or `committed` for walk-ons), and `admissions_status` in
   (`admitted`,`deposited`).
2. Creates `student_athletes` with name, email (institutional email if
   supplied, else personal), `institution_student_id`, `recruit_id`, class
   year from entry; or links an existing row created earlier by an SIS import
   (matched on `institution_student_id`), never duplicating.
3. Creates `athlete_team_memberships` with position and jersey left blank.
4. For `transfer_portal` recruits, creates `transfer_records` (incoming) and
   `seasons_of_competition` rows marked `basis='prior_school'` as **drafts
   for the compliance officer**, from `seasons_used_elsewhere`.
5. Creates an `eligibility_status` row in `pending` so Module A picks the
   athlete up.
6. Sets pipeline `stage='enrolled'`, recruit `status='enrolled'`, writes
   history and `audit_log`.
7. Data hand-off: guardian records are retained only if the athlete is still
   a minor at enrolment and the school chooses to keep them; otherwise they
   are deleted with a receipt. Contact log, evaluations and offers stay with
   the recruit record under the recruiting retention class (E8.4), readable
   only with `recruit.read`.

Idempotent: calling it twice returns the same `student_athlete_id`.

## E8. Minors' data

### E8.1 Who is a minor

`recruits.is_minor` defaults to true and is recomputed nightly from
`date_of_birth` (age of majority by the recruit's state, default 18; VERIFY
states with a different age). When DOB is unknown the recruit is treated as a
minor.

### E8.2 Under-13 block

A recruit whose DOB indicates under 13 is rejected at insert
(`RECRUIT_UNDER_13`). Youth camp registrations for under-13 children belong
in the club product with its COPPA consent flow, not in recruiting. VERIFY
with counsel whether any camp data for under-13 attendees is retained.

### E8.3 Consent and compartment (invariant I7)

- Public forms for minors require a guardian section; the guardian receives an
  email verification link, and consent scope is recorded on
  `recruit_guardians` (`consent_status='granted'`, method and evidence).
  Until granted, a minor's form submission stays `staged` and only the fields
  needed to contact the guardian are visible.
- Minor DOB, phone, email, address and guardian contact are readable only
  through `recruit.read` on the recruit's program (not department-wide AD by
  default) and only through an RPC that writes `data_access_log`.
- Whether contacting a minor prospect directly is permitted is an NCAA rule
  question (by channel and date, E3.6) plus school policy. Sporv's default
  for minors is: drafts addressed to the prospect copy the primary guardian
  when the school setting `cc_guardian_for_minors` is on (default on).
- The agent never sees minors' DOB, contact details or guardian data. It
  receives a recruit id, name, position, grad year and factors.

### E8.4 Retention and deletion of unsigned prospects

| Recruit state | Default retention (VERIFY with counsel and the school) | Then |
|---|---|---|
| `closed` or never progressed past `identified` | 12 months after `closed`, or 12 months after their expected entry term passes | Delete personal fields; keep an anonymised aggregate row for funnel statistics |
| Minor with guardian consent `refused` or `withdrawn` | Immediately on refusal | Delete everything except a suppression record (hash of email) so they are not re-imported |
| Deletion request from prospect or guardian | Within the period the school's policy sets (VERIFY) | Delete; receipt in `audit_log` |
| `enrolled` | Moves to the student-athlete record classes (§10.3) | Recruiting details kept per recruiting class |
| Contact log entries | As long as the school must evidence recruiting compliance (VERIFY) | Retained even after personal fields are deleted; counterpart details reduced to role |

`retain_until` is set on every state change; a nightly job sets
`status='deleted_pending'` and, after a 30-day grace window the coach can see,
deletes and writes a receipt (G4: every write has a receipt).

## E9. Roles and capabilities

New role `recruiting_coordinator` (scope `either`). New capabilities:

| Capability | Meaning |
|---|---|
| `recruit.read` | See recruits, pipelines, evaluations for the scope |
| `recruit.read_sensitive` | See minors' DOB, contact and guardian details (logged) |
| `recruit.write` | Create recruits, approve sources, edit pipeline, run conversion |
| `recruit.evaluate` | Submit evaluations |
| `recruit.contact` | Approve and send recruiting drafts; log contacts |
| `recruit.visit_plan` | Plan visits |
| `recruit.offer` | Draft offers |
| `recruit.offer_approve` | Approve offers internally |
| `recruit.rules` | Edit and verify recruiting periods and `recruiting.*` rules |
| `recruit.contact_override` | Grant a contact-window override |
| `recruit.targets` | Set recruiting targets for a program |
| `recruit.export` | Export the recruiting database |
| `recruit.forms` | Create questionnaires and camp forms |

Matrix (D = department, T = assigned team/program, blank = none):

| Capability | ad | assoc_ad | compliance | head_coach | asst_coach | recruiting_coordinator | business | sid | auditor |
|---|---|---|---|---|---|---|---|---|---|
| recruit.read | D | D | D | T | T | T | | | D |
| recruit.read_sensitive | | | D | T | T | T | | | |
| recruit.write | | | | T | T | T | | | |
| recruit.evaluate | | | | T | T | T | | | |
| recruit.contact | | | | T | T | T | | | |
| recruit.visit_plan | | | | T | T | T | | | |
| recruit.offer | | | | T | | | | | |
| recruit.offer_approve | D | D | D | | | | D | | |
| recruit.rules | | | D | | | | | | |
| recruit.contact_override | | | D | | | | | | |
| recruit.targets | D | | | T | | | | | |
| recruit.export | D | | D | T | | | | | |
| recruit.forms | | | | T | | T | | | |

`recruit.read_sensitive`, `recruit.rules` and `recruit.contact_override` are
restricted capabilities (cannot be added to other roles, §3.1).

RLS: every Module E table is scoped through the pipeline's
`sport_program_id` using `has_program_access(program_id, capability)`, a thin
wrapper over the §3.4 logic for program-scoped assignments (department-wide
assignments pass). `recruits` itself is readable when the user can read any
pipeline for that recruit; sensitive columns are excluded from the base
grant (column-level `grant select (id, first_name, ...)`) and returned only by
`get_recruit_sensitive(recruit_id)`, which checks `recruit.read_sensitive` and
logs.

## E10. Communications

- Every outbound recruiting message is an agent or staff draft in
  `obligations` (`kind` new value `recruit_message`), stating why it exists
  ("Questionnaire completed 3 days ago; no reply sent").
- Approve-and-send runs the contact check (E5) and logs `recruit_contacts`
  with the `obligation_id`. No auto-send (I1); no sequences that send on a
  timer.
- Templates per program (camp follow-up, questionnaire thank-you, visit
  confirmation, offer letter cover note). Offer content itself is
  institution-authored, never agent-authored.
- Inbound replies arrive through `intake_events` (email) and SMS threading;
  matched to a recruit by address; logged as inbound contacts.
- Bulk messages (camp list follow-ups) create one draft per recipient, each
  checked individually at send; blocked recipients are listed, not silently
  dropped.

## E11. Screens (Source)

House rules as §12.

| Screen | Role | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|---|
| Recruit board | Coaches, coordinator | Pipeline | Stage groups, position/year filters, priority, last contact age, needs strip | Add recruit | "No recruits yet. Import a list or open a questionnaire." |
| Needs | Head coach | Roster gaps | Positions x entry years: departing, committed, target, gap | Set target | "No roster for this program. Add the current team first." |
| Recruit profile | Coaches | One recruit | Identity, school, metrics, film links, academics, evaluations, contacts, visits, offers, stage history | Evaluate | — |
| Evaluation form | Evaluators | Score | Rubric criteria with anchors, context, notes | Submit evaluation | "No rubric for this position. Ask the head coach to set one." |
| Sources inbox | Coordinator | Lead intake | Staged sources, proposed match or new, dedupe conflicts | Approve | "No new leads." |
| Imports | Coordinator | CSV in | Upload, column mapping, preview, errors | Apply import | "No imports. Download the template." |
| Forms | Coordinator | Questionnaires and camps | Forms, link, submissions count, open/closed | Create form | "No forms. Create a questionnaire." |
| Recruiting calendar | All recruiting staff | When contact is allowed | Current period by sport, upcoming changes, unverified-rule notice | — | "Recruiting rules not yet verified by compliance." |
| Messages | Coaches | Drafts to approve | Draft, reason line, window verdict | Approve and send | "No drafts waiting." |
| Visits | Coordinator | Plan visits | Visit list, itinerary, host, travel link, limit check | Submit for approval | "No visits planned." |
| Offers | Head coach, approvers | Aid and roster spots | Offers by entry year, equivalency used vs. limit (D2), status | Submit for approval | "No offers drafted." |
| Rankings | Head coach | Ordered list | Score, factors, agent explanation (when enabled, labelled) | Open profile | "Rankings appear once recruits have evaluations." |
| Recruiting compliance | Compliance officer | Oversight | Contacts by period, warnings acknowledged, overrides, visit counts, rule verification | Verify rule | "No recruiting activity recorded." |
| Prospect questionnaire (public) | Prospect | Submit interest | Core fields, sport fields, guardian section for minors | Submit | — |
| Guardian consent (public) | Guardian | Consent | What the school stores, scopes, withdraw link | Give consent | — |

## E12. Source integrations

| Integration | First version | Later |
|---|---|---|
| Front Rush, ARMS, Teamworks Recruiting exports | CSV with mapping screen; saved mapping per source system | Named adapters after a real export file (VERIFY formats) |
| NCSA, SportsRecruits, FieldLevel | Paste profile URL into `film_links`/source; CSV if offered | API only if a partnership exists (VERIFY) |
| Transfer portal | Manual entry of portal entries with date and tracking reference | Import if the NCAA offers an export (VERIFY) |
| Camp registration | Sporv camp form (E3.3) or CSV from the camp's registration tool | Club product's registration forms (CONTEXT §5.3) when built |
| Email | Existing intake path (`intake_events`) | Gmail connector (CONTEXT §11 item 2) |
| Film | Links only (Hudl, YouTube, etc.); no video hosting or analysis (CONTEXT §10: video analysis out of scope) | — |

## E13. Source acceptance tests and phase placement

Acceptance tests are in §14 under Phases R1-R3. Phase placement is in §15:
Source is scheduled directly after the shared foundation (Phase 1) and runs
interleaved with Manage, not after it.

---

# Part III — Shared across both pillars

## 9. Agent behaviour in the college context

**Gate note:** GATES.md rule 4 forbids new AI tools until G4 is TRUE. Every
generator below is a new agent job and does not ship until G4 is TRUE. The
deterministic parts (rule engine, Roster Lock, conflict checks, per diem
math) are not AI and are not blocked by rule 4.

| Agent drafts (with Approve) | Source data | Inbox owner |
|---|---|---|
| Eligibility risk alert to athlete and compliance | `athlete_term_records`, mid-term snapshot | Compliance officer |
| Missing-document reminders | `document_requirements`, `med.screenings` status only | Compliance / AT |
| Missed-class notices to faculty | Trips + class schedule | Compliance / academic support |
| Travel memo | Trip, legs, rooms | Head coach |
| Game recap media release | Results, stats (opted-out athletes removed) | SID |
| Facility bump message | Bump proposal | AD |
| Weekly CARA exceptions summary | `cara_logs` | Compliance officer |
| AD weekly summary | Counts only: pending certifications, overrides, budget variance | AD |
| Recruit follow-ups (questionnaire thank-you, camp follow-up, check-in after N days) | `recruit_sources`, `recruit_contacts`, pipeline stage | Owning coach |
| Ranking explanation and next-action suggestion | `recruit_rankings.factors`, evaluation notes | Head coach |
| Visit confirmation and itinerary | `recruit_visits`, Module C trip | Recruiting coordinator |
| Recruiting window reminder ("contact period opens Monday for 2028 grads") | Verified `recruiting_periods` | Recruiting staff |

The agent may **never**:
1. Certify, decertify, verify a rule, or grant a Roster Lock override.
2. Insert or change `lineup_entries`, `game_rosters.status`, or clearances.
3. Read `med.*` content. It may read `athlete_clearance_current.status` and
   screening status only, and only for teams in the org that owns the run.
4. Send anything. Every output is a draft (I1).
5. Cite a row from another org (I9) or from another team in a draft addressed
   to a team-scoped user.
6. Contact a recruit, move a recruit's pipeline stage, create a recruit from
   a source, draft or approve an offer, or grant a contact-window override.
7. Read minors' DOB, contact details or guardian data (E8.3), or use any
   protected characteristic in ranking (E6).

Every agent action writes `audit_log` with `actor_kind='agent'` and the
`run_id`, and every draft records its source rows (`obligations.source_ref`).

**Prompt injection:** stat files, SIS rows, uploaded documents and inbound
email are untrusted input. They are parsed by deterministic code into typed
columns before any model sees them; models receive field values, not raw
documents, wherever possible. Free-text fields (bios, notes) passed to a
model are delimited and the model's output is constrained to a draft body; it
cannot choose recipients or actions. Recipient lists are computed in SQL.

---

## 10. Security, privacy and audit

### 10.1 `audit_log`

- Append-only: `revoke update, delete` from all roles; a trigger rejects
  update/delete even for the table owner (pattern from the ledger-append-only
  draft `docs/red-drafts/2026-09-06-ledger-append-only.test.sql`).
- Generic trigger `audit_row()` attached to every college table: records
  actor (`auth.uid()` or system), action (`table.insert|update|delete` or a
  semantic action set by the RPC via `set_config('sporv.audit_action', ...)`),
  `before_sha256`/`after_sha256` of the row's canonical JSON, and a `diff` of
  non-sensitive columns. Sensitive columns (`*_enc`, GPA, DOB) appear only as
  hashes.
- Hash chain: `row_hash = sha256(prev_hash || canonical row)`, per provider.
  A nightly check recomputes the chain and raises an incident finding on a
  break.

### 10.2 `data_access_log`

Written by every RPC that returns academic or medical detail, every export,
every PDF containing eligibility data, and every break-glass read. Visible to
`audit.read` and, for their own records, to the student-athlete.

### 10.3 Retention (VERIFY each period with the school's records officer and counsel)

| Data class | Proposed default | Notes |
|---|---|---|
| Eligibility status, events, certifications | Duration of enrollment + X years | VERIFY NCAA and conference record-keeping requirements |
| Term records | Same as eligibility | |
| CARA logs | X years | VERIFY |
| Medical records | Per state medical-records law, often longer for minors at time of treatment | VERIFY per state |
| Audit and access logs | X years, never shorter than the data they cover | |
| Stats, results, rosters (public) | Indefinite (historical record) | |
| Travel, per diem, budgets | Per institution financial records policy | |
| SIS import raw rows | 90 days after apply | Raw files hold more than we need |
| Recruits not signed (Source) | See E8.4 | Minors' data deleted on consent refusal |
| Recruiting contact log | As long as recruiting compliance must be evidenced | VERIFY |
| Recruit import raw rows and staged sources | 90 days after decision | |

Retention periods are per-org settings with Sporv defaults; deletion jobs
write receipts.

### 10.4 Encryption and backups

TLS in transit; disk encryption at rest (Supabase); column encryption for
medical (§7.7); Vault for SSO and SIS credentials. Backups: Supabase daily
backups and point-in-time recovery on the agent project (VERIFY plan
includes PITR). Backups contain encrypted medical columns; keys are not in the
backup.

### 10.5 Incident runbook

Add to `docs/incident-runbook.md`: (a) suspected cross-team leak — revoke
affected role assignments, query `data_access_log` for the window, notify AD
and compliance; (b) FERPA disclosure — school is the data owner and decides
notification, we supply logs within 24 hours (contract term, VERIFY);
(c) audit chain break; (d) SSO misconfiguration granting wrong roles.

### 10.6 SOC 2 and questionnaires

Sporv is **not** SOC 2 certified and must not say otherwise. Schools will
send HECVAT (Higher Education Community Vendor Assessment Toolkit) or similar
questionnaires (VERIFY current HECVAT version). Prepare: a security overview
document, data flow diagram, subprocessor list (Supabase, Vercel, Anthropic,
Resend, Twilio as applicable), RLS and audit design summary, incident process.
SOC 2 Type I is a later decision (OWNER DECISION, cost and timing).

---

## 11. Onboarding and migration

### 11.1 Department rollout, week by week (pilot)

| Week | Work | Owner on school side | Done when |
|---|---|---|---|
| 0 | Contract/PO, security questionnaire, data processing terms | AD, IT, procurement | Signed |
| 1 | Tenant created, domain verified, sport programs and teams created, staff invited (password + MFA until SSO), roles assigned | AD | Every head coach logged in once |
| 2 | Compliance officer reviews and verifies rule set; academic terms entered; first SIS CSV applied | Compliance | Zero unverified blocking rules; term records for every rostered athlete |
| 3 | Rosters built per team; certification queue worked | Compliance, coaches | Every in-season athlete has a certified status |
| 4 | First game rosters through Roster Lock; overrides tested | Coaches, compliance | One contest per in-season team run through Sporv |
| 5 | SSO connection live; password login retired for school domain | IT | All staff sign in via IdP |
| 6-term end | Steady state; mid-term SIS import; certification refresh | Compliance | Pilot metrics reviewed |

### 11.2 Import templates

Shipped as downloadable CSVs with header rows and one example row each:
`staff.csv`, `rosters.csv`, `sis_terms.csv` (§8.2), `schedule.csv`,
`seasons_history.csv`, `transfers.csv`, `injuries.csv` (Module D only).

### 11.3 Training per role

| Role | Session | Length |
|---|---|---|
| Compliance officer | Rules verification, SIS import, certification, overrides, exports | 90 min + follow-up |
| Head coaches | Roster, lineup builder, what a Roster Lock error means, drafts inbox | 30 min group |
| SID | Rosters, stats import, feeds, embeds, releases | 60 min |
| AD | Department summary, approvals, audit | 30 min |
| Athletic trainers (Module D) | Injuries, clearances, break-glass review | 60 min |
| Student-athletes | Sign in, my eligibility, forms | 10 min video |

### 11.4 Pilot success metrics

1. 100% of in-season athletes certified in Sporv before their first contest.
2. Zero contests where an uncertified athlete was entered without a logged override.
3. Hours per term spent on eligibility tracking, before vs. after, reported by
   the compliance officer (time-saved instrumentation, CONTEXT §11 item 4).
4. Every head coach logged in at least weekly during their season.
5. SIS import applied at least twice in the term.
6. Renewal decision (paid) at term end.

---

## 12. Screens

Manage screens by role. Source (recruiting) screens are in E11.

House rules for every screen: no emoji, no decorative icons (CONTEXT §7);
Archivo uppercase headings, JetBrains Mono for numbers; one large heading per
page; 390px behaviour defined; empty states honest; every agent output is a
draft with an **Approve** button and a one-line reason; status renders only
from server state.

### 12.1 Athletic Director

| Screen | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|
| Department home | Weekly state of the department | Counts: pending certifications, overrides this term, budget variance by program, open approvals, unresolved findings | Open approvals | "No teams yet. Add sport programs to start." |
| Programs and teams | Structure | Program list, current team per program, head coach, roster count | Add program | "No programs. Add the first one." |
| Staff and roles | Who can do what | Members, role assignments with scope and dates, SSO-sourced flag | Assign role | "Only you have access. Invite staff." |
| Approvals | Decisions waiting | Trips, expenses, bumps, with amounts and chain position | Approve / Reject | "Nothing waiting for you." |
| Budget overview | Spend vs. plan | Lines by program and category, actuals, remaining | Open program budget | "No budget for this fiscal year. Add lines." |
| Audit | Oversight | Audit log filters, overrides list, break-glass list | Export | "No activity recorded yet." |

### 12.2 Compliance officer

| Screen | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|
| Eligibility board | All athletes by status | Program filter, status columns, reason chips, last computed time | Open certification queue | "No athletes. Import the SIS file." |
| Certification queue | Sign-off | Athletes with computed `eligible`, reasons expanded, batch select, valid-to date | Certify | "No athletes ready. Resolve pending items first." |
| Athlete eligibility record | One athlete's history | Term records, rule results, seasons used, transfers, event history | Certify / Decertify | — |
| Rules | Verify thresholds | Rule list by division, verified flag, version, effective dates, citation | Verify | "Default rules not yet reviewed." |
| SIS imports | Data in | Jobs list, staged diff summary, errors | Apply import | "No imports. Download the template." |
| Transfers | Incoming/outgoing | Status, missing docs | Add transfer | "No transfers recorded." |
| CARA review | Hours compliance | Week grid per team, exceptions | Mark reviewed | "No hours logged this week." |
| Overrides | Exceptions log | Every override, reason, who, which event | Grant override | "No overrides granted." |
| Exports | Reports | Squad list, history, seasons, CARA | Download | — |

### 12.3 Sports Information Director

| Screen | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|
| Rosters | Public roster prep | Team selector, public flag, bios, headshots, opt-out marker | Publish roster | "No athletes on this team." |
| Schedule | Competitions | Events by team, home/away, conference, published state | Publish | "No games scheduled." |
| Stats imports | Ingest | Uploads, status, unmatched players to map | Apply import | "No stat files received. Upload one or connect the feed." |
| Results | Final scores | Per game result, publish state | Publish result | — |
| Releases | Drafts to publish | Agent drafts with source import, editable body | Approve and publish | "No drafts. Recaps appear after results are applied." |
| Programs | Game-day PDF | Event picker, preview | Generate PDF | — |
| Feeds | Site integration | Feed URLs, embed snippet, token rotate | Copy embed | — |

### 12.4 Head coach and assistant coach

| Screen | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|
| Team home | This week | Next events, roster eligibility counts (status only), clearance counts, drafts for this team | Open lineup builder | "No events this week." |
| Roster | Team members | Athletes, jersey, position, eligible yes/no, cleared yes/no/limited | Add athlete | "No athletes on this team." |
| Lineup builder | Game roster | Event header, available athletes, blocked athletes with reason category, dressed/travel toggles | Submit roster | "No game selected." |
| Schedule | Practices/games | Calendar, facility booking state | Request facility | — |
| CARA log | Hours | Day entries, weekly total vs. limit | Save day | "No hours logged this week." |
| Travel | Trips | Trips, travelers, rooming, per diem | Submit for approval | "No trips planned." |
| Budget | Remaining | Lines and actuals for the program | — | "No budget set for this program." |

### 12.5 Athletic trainer and team physician (Module D)

| Screen | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|
| Training room | Today | Open injuries, rehab stages due, screenings missing | Log injury | "No open injuries." |
| Athlete medical record | One athlete | Injuries, treatments, screenings, clearance history, access log | Issue clearance | — |
| Concussion cases | Protocol tracking | Stage, return-to-learn, physician sign-off | Advance stage | "No active concussion cases." |
| Screenings | Requirement status | Matrix athletes x requirements | Review document | "No requirements configured." |
| Break-glass review | Oversight | Grants awaiting review | Mark reviewed | "No break-glass access." |

### 12.6 Business office

| Screen | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|
| Approvals | Money decisions | Trips, expenses with amounts | Approve / Reject | "Nothing waiting." |
| Budgets | Lines and actuals | Program x category grid, import actuals | Import actuals CSV | "No budget for this fiscal year." |
| Per diem | Payouts | Per trip totals, per traveler | Mark paid | "No per diem owed." |

### 12.7 Student-athlete

| Screen | Purpose | Key elements | Primary action | Empty state |
|---|---|---|---|---|
| My week | Schedule | Practices, games, travel, missed classes | Add class schedule | "Nothing scheduled this week." |
| My eligibility | Own status | Status, what is missing, own term records | — | "Your compliance office has not imported records yet." |
| My forms | Requirements | Required documents, status, sign | Sign / Upload | "No forms required." |
| My trip | Travel | Itinerary, room, per diem | — | "No upcoming trips." |
| My data | Privacy | Who accessed my records (break-glass and exports), request a copy | Request export | — |

### 12.8 Auditor

Read-only versions of Eligibility board, Athlete record (no medical), Overrides,
Audit, Exports, with a banner showing access end date.

---

## 13. Pricing mechanics

**Conflict to resolve first (§0.2):** CONTEXT §6.1 says no annual billing,
no add-ons, two paid cards. College buying requires annual contracts and
purchase orders. Proposed resolution for the owner to accept or reject:
colleges are `enterprise` plan rows, sold by conversation, never on the
pricing page, invoiced annually outside Stripe Checkout; the two-card pricing
page stays as is.

### 13.1 Structure (all figures OWNER DECISION)

| Item | What it includes | Price |
|---|---|---|
| Annual base | Tenant, SSO, roles, Module A, rosters, scheduling, up to N teams | OWNER DECISION |
| Per additional team | Each team beyond N | OWNER DECISION |
| Module B add-on | Sports information | OWNER DECISION |
| Module C add-on | Logistics | OWNER DECISION |
| Module D add-on | Sports medicine (after legal review) | OWNER DECISION |
| Module E (Source) | Recruiting and sourcing; sold either as an add-on to Manage or **standalone per program** (a head coach can buy it from their own budget without a department contract) | OWNER DECISION |
| Onboarding | Migration and training | OWNER DECISION (or included) |
| Pilot | One term, Modules A + rosters, one school | OWNER DECISION (discounted or credited to year 1) |

### 13.2 Entitlements

`plan_entitlements.modules[]` is per plan key, so per-school modules need
`org_entitlements` (§2.14). Effective modules for an org =
`plan_entitlements.modules` of `base_plan` ∪ `org_entitlements.extra_modules`.
New module keys: `college_core`, `college_compliance`, `college_sid`,
`college_logistics`, `college_medical`, `college_recruiting`. A standalone
Source customer gets `college_core` limited to one program (`team_cap` of the
program's teams) plus `college_recruiting`; Roster Lock and eligibility stay
off because `college_compliance` is absent. `team_cap` enforces the per-team limit:
creating a team past the cap returns **402** with the I3 payload. I2 holds:
code checks module keys, never plan names. I4 and I11 hold: exports and reads
never gated; over-cap orgs keep everything they have.

Entitlement changes are written by the owner (service role) when a PO is
received; there is no self-serve upgrade for colleges.

### 13.3 Invoicing and procurement

- Annual invoice against a purchase order; net-30 or school terms. Stripe
  Invoicing (Billing side, not Connect, I10) can issue and track it; ACH or
  check payment. VERIFY that Stripe Invoicing fits under the existing
  `billing-webhook` without touching Connect code.
- Procurement checklist: W-9, certificate of insurance (VERIFY coverage
  amounts schools ask for), security questionnaire (HECVAT), accessibility
  statement (VPAT, VERIFY if required), data processing agreement with FERPA
  "school official" language, sole-source letter if under bid threshold.
- Fiscal year usually starts July 1; budgets are set in spring. Pilot in
  spring term, convert on July 1 contract.

---

## 14. Acceptance tests

Numbered, each runnable as a SQL test (`docs/red-drafts/*.test.sql` pattern)
or an end-to-end check. Each phase's tests must pass before its demo.

### Phase 1 — Tenant and roles

1.1 Creating a `sport_programs` row with a duplicate `(provider_id, sport_code, level)` fails with a unique violation.
1.2 Two teams for the same program and `academic_year` fail with a unique violation.
1.3 A head coach assigned to Men's Soccer selecting from `athlete_team_memberships` for Women's Basketball gets 0 rows.
1.4 The same head coach selecting Men's Soccer memberships gets exactly the seeded count.
1.5 A member of school A selecting any college table for school B gets 0 rows, for every table in §2.15 (I6 extended).
1.6 Assigning `compliance_officer` with a `team_id` raises an error.
1.7 An org admin (`is_org_admin` true) without a `compliance_officer` assignment calling `has_org_capability(org,'eligibility.certify')` gets false.
1.8 A role assignment with `ends_on` yesterday grants nothing today.
1.9 An override removing `roster.write` from `head_coach` at school A does not affect school B.
1.10 Adding `medical.read` to `head_coach` via `org_role_capability_overrides` raises an error.
1.11 `select tablename from pg_tables where schemaname='public' and rowsecurity=false` returns zero rows after the migration.
1.12 A club org (non-institution) sees no change in any existing screen; `smoke.sh` exits 0.
1.13 `explain` of a roster select for a team in a 600-athlete org shows index scans only.

### Phase 2 — Academics and eligibility

2.1 Applying the same SIS CSV twice: the second upload is rejected (file hash) and no rows change.
2.2 A CSV row with an unknown `institution_student_id` is staged as `new`, not applied until the job is applied.
2.3 A CSV row with `credits_earned` = "abc" produces a row error and the job cannot be applied until the row is skipped or fixed.
2.4 With all rules unverified, every athlete computes to `pending` with reason "rule not verified".
2.5 With a verified `min_credits_prev_term` rule at a test value X and an athlete at X-1, the athlete computes `ineligible` with that rule in `computed_reasons`.
2.6 Changing the rule to version 2 with a later `effective_from` does not change results evaluated for dates before it.
2.7 A certified athlete whose computed status changes to `ineligible` is automatically decertified and an `eligibility_events` row `decertified` exists.
2.8 `certify_eligibility` called by a head coach raises an insufficient-privilege error.
2.9 `certify_eligibility` on an athlete with computed `pending` raises an error.
2.10 `update` or `delete` on `eligibility_events` raises an error for every role including the table owner.
2.11 A D3 org inserting a membership with `scholarship_flag = true` raises `D3_NO_ATHLETIC_AID`.
2.12 The agent database role calling `certify_eligibility` gets permission denied.
2.13 A student-athlete selecting `athlete_term_records` sees only their own rows.
2.14 Nightly recompute over 5,000 seeded orgs completes, and an injected error in one org does not stop the others.

### Phase 3 — Lineups and Roster Lock

3.1 Inserting a lineup entry for an athlete with computed `ineligible` raises `ROSTER_LOCK`.
3.2 Inserting a lineup entry for an athlete with computed `eligible` but not certified raises `ROSTER_LOCK`.
3.3 Inserting for a `certified_eligible` athlete whose `certification_valid_to` is before the event date raises `ROSTER_LOCK`.
3.4 Inserting for a `certified_eligible` athlete within the valid window succeeds.
3.5 Updating an existing valid entry's `student_athlete_id` to an ineligible athlete raises `ROSTER_LOCK`.
3.6 A client setting `override_id` directly on insert has it cleared to null, and if the athlete is ineligible the insert raises.
3.7 After `grant_roster_override` by the compliance officer, the same insert succeeds, `override_id` is set, `audit_log` has action `lineup.override`, and a finding exists for the AD.
3.8 `grant_roster_override` with a 10-character reason raises an error.
3.9 `grant_roster_override` called by the AD (no compliance role) raises an insufficient-privilege error.
3.10 An override for event E does not allow the athlete into event F.
3.11 Inserting lineup entries on a `submitted` game roster is rejected by RLS.
3.12 A lineup insert for a club team (no `sport_program_id`) is unaffected by the trigger.

### Phase 4 — SSO

4.1 A user with an email at an unverified domain is not routed to SSO.
4.2 First SSO login creates exactly one `organization_members` row; a second login creates none.
4.3 An IdP group mapped to `head_coach` for Men's Soccer yields a `role_assignments` row with `source='sso_group'`.
4.4 Removing the group at the IdP ends that assignment on next login.
4.5 An IdP group mapped to `compliance_officer` is rejected at mapping time.
4.6 With `enforced=true`, a password login for that domain fails; the owner break-glass account still signs in with MFA.

### Phase 5 — Module B

5.1 Uploading the same stat file twice returns the same `stat_imports.id` and writes no new rows.
5.2 Uploading a corrected file for the same game replaces `player_game_stats` rows for that event; the count equals the corrected file's player count.
5.3 A stat file whose team totals do not equal the player sum is `rejected` with an error naming the stat.
5.4 A jersey number not on the roster lands in `unmatched_players` and the import stays `needs_review`.
5.5 The public roster feed never contains an athlete with `directory_opt_out = true`.
5.6 A media release cannot reach `published` without `approved_by` set by a user with `stats.publish`.
5.7 The public iCal feed returns 404 for a revoked token.
5.8 A recap draft for a game does not name an opted-out athlete even if they led in a stat.

### Phase 6 — Module C

6.1 Two confirmed bookings overlapping on the same space violate the exclusion constraint.
6.2 Confirming "Main court" while "Court A" (child) is confirmed for an overlapping time raises an error.
6.3 A competition request over a confirmed out-of-season practice creates a bump proposal and leaves the practice confirmed.
6.4 Per diem for a trip departing 06:00 and returning 20:00 on one day, no provided meals, yields breakfast, lunch and dinner lines per traveler at the active rate.
6.5 Marking dinner as provided removes the dinner lines.
6.6 A trip over the approval threshold requires two approval steps; approving step 1 does not change trip status to `approved`.
6.7 A head coach cannot read the budget lines of another program.
6.8 The missed-class report lists each athlete once per class meeting that overlaps travel time, and produces drafts only.

### Phase 7 — Module D

7.1 A head coach calling any medical read RPC gets permission denied; `athlete_clearance_current` via `get_team_clearances` returns status and `reason_public` only.
7.2 Every call to a medical read RPC writes one `data_access_log` row.
7.3 A break-glass request with a 10-character reason is rejected.
7.4 A break-glass grant expires after 2 hours; reads after expiry are denied.
7.5 An athlete with a `not_cleared` clearance cannot be inserted as `dressed` (`ROSTER_LOCK`, hint `clearance`).
7.6 A `cleared` clearance cannot be issued for a concussion injury without physician sign-off and return-to-learn complete.
7.7 Selecting `diagnosis_enc` with the SQL editor returns ciphertext, not plaintext.
7.8 The `med` schema is not reachable through the PostgREST API (`/rest/v1/injuries` returns 404).

### Phase R1 — Source core (database, sources, board, evaluations, needs)

R1.1 A head coach of Men's Soccer selecting `recruit_pipelines` for Women's Basketball gets 0 rows.
R1.2 A recruit with pipelines in two programs is visible to coaches of both, and each coach sees only their own program's pipeline, evaluations and contacts.
R1.3 A user from school A selecting any Module E table for school B gets 0 rows (I6 extended).
R1.4 A public questionnaire submission creates one `recruit_sources` row in `staged` and zero `recruits` rows.
R1.5 Approving a staged source whose email matches an existing recruit merges into that recruit; no duplicate `recruits` row exists afterwards.
R1.6 Importing the same recruit CSV twice: the second upload is rejected by file hash.
R1.7 A recruit with DOB indicating age 12 is rejected with `RECRUIT_UNDER_13`.
R1.8 An evaluation missing a rubric criterion, or scoring outside the scale, is rejected; a valid one gets `weighted_score` equal to the hand-computed weighted mean.
R1.9 Moving a pipeline to `enrolled` by direct update is rejected; only the conversion RPC can set it.
R1.10 Moving a pipeline to `closed` without `closed_reason` is rejected.
R1.11 Every stage change appends exactly one `recruit_stage_history` row; update and delete on that table fail.
R1.12 With a seeded roster of 3 departing seniors at one position and 1 committed recruit, `roster_graduation_gaps` reports departing_next 3 and committed 1.
R1.13 A user with `recruit.read` but not `recruit.read_sensitive` selecting `recruits.date_of_birth`, `email`, `phone` gets a permission error; `get_recruit_sensitive` with the capability returns them and writes one `data_access_log` row.

### Phase R2 — Rules, contact log, communications, visits, offers, conversion

R2.1 With a verified `dead` period covering today for the recruit's sport and division, inserting an outbound `in_person_off_campus` contact raises `RECRUIT_WINDOW`.
R2.2 The same insert with direction `inbound` succeeds and is logged with verdict `permitted`.
R2.3 With only an unverified rule failing, an outbound contact without `warn_acknowledged_by` raises `RECRUIT_WINDOW_WARN`; with the acknowledgement it succeeds and stores verdict `warn`.
R2.4 Approving a recruiting draft during a blocked window does not send: no `sent_at`, no delivery, the draft remains with the reason, and no `recruit_contacts` row persists (transaction rolled back).
R2.5 After a compliance officer grants a contact override for that recruit, kind and date, the contact succeeds once; a second contact on the same override raises `RECRUIT_WINDOW`.
R2.6 A head coach calling the override RPC gets insufficient privilege.
R2.7 Contact window evaluation uses the institution's local date: a contact at 23:30 local on the last day of a contact period is permitted even though it is the next day in UTC.
R2.8 A D3 institution inserting an offer with `offer_kind='athletic_aid'` raises `D3_NO_ATHLETIC_AID`.
R2.9 An offer cannot move to `extended` without `approved_by` from a user with `recruit.offer_approve`.
R2.10 A D2 offer pushing the program's equivalency over the verified limit returns a warning on approval and records it on the approval.
R2.11 Submitting an official visit beyond the verified visit limit for that recruit is blocked; an unofficial visit is not.
R2.12 An approved official visit with paid travel creates a linked `travel_trips` row and budget actuals in category `recruiting` (Module C), or a clear error if Module C is not entitled.
R2.13 `convert_recruit_to_athlete` on a signed, admitted recruit creates one `student_athletes` row with `recruit_id` set, one membership, one `eligibility_status` in `pending`; calling it again returns the same id and creates nothing.
R2.14 Converting a `transfer_portal` recruit creates draft `transfer_records` and `seasons_of_competition` items for compliance, not final rows.
R2.15 Converting a recruit whose `institution_student_id` already exists from an SIS import links the existing student-athlete instead of creating a second.
R2.16 A minor's questionnaire without guardian consent keeps the source `staged`; the coach sees only the guardian contact fields.
R2.17 Guardian consent withdrawal deletes the recruit's personal fields within the job run and leaves a suppression hash; a re-import of the same email is flagged as suppressed.
R2.18 A closed recruit past `retain_until` moves to `deleted_pending`, then is deleted after 30 days with an `audit_log` receipt.

### Phase R3 — Ranking (deterministic now; agent explanation after G4)

R3.1 The deterministic score for a seeded recruit equals the hand computation from stored weights and factors.
R3.2 The factor list for every ranking contains only allowed keys (no DOB, contact, guardian, photo, hometown).
R3.3 With G4 FALSE, the agent ranking job is not scheduled and `recruit_rankings` contains no `agent_explained_v1` rows.
R3.4 After G4: an agent explanation never changes `score`, never changes stage, and creates no `recruit_contacts` or sent messages.
R3.5 Bulk follow-up drafts for a 40-person camp list produce 40 separate drafts; at send, blocked recipients are listed by name and not sent.

---

## 15. Phased plan

Effort in working days for one engineer with the agent. Each phase ends
with a demo to one real D2/D3 department. RED items are drafted to
`docs/red-drafts/` with a matching `.test.sql` and applied by the owner.

| Phase | Days | Depends on | Scope | RED items for the owner | Demo checkpoint |
|---|---|---|---|---|---|
| 0. Discovery | 6 | — | Three calls with D2/D3 compliance officers, one SID, and two head coaches about recruiting; answers to Q1-Q20; confirm one Manage pilot and one Source pilot (can be the same school) | None | Written answers; signed pilot letters of intent |
| 1. Tenant and roles | 10 | 0; D5 agent project exists | §2.3-2.7, `college_roles`, capabilities seed, helpers, RLS for all Phase 1 tables, `audit_log` + trigger, cross-team tests 1.1-1.13 | Migration: providers columns, domains, sports, programs, teams/seasons columns, roles, assignments, student_athletes, memberships, audit_log; all RLS | AD creates programs, invites coaches; coach sees only own team |
| R1. Source core | 10 | 1 | `recruits`, guardians, pipelines, stage history, sources inbox, forms, CSV import with mapping, rubrics, evaluations, targets, gap view, board, profile, tests R1.x | Migration: recruits, recruit_guardians, pipelines, history, sources, import jobs/rows, forms, targets, rubrics, evaluations, sports.recruit_metric_keys, student_athletes.recruit_id; RLS + column grants; public form edge function | Coach imports an existing recruit spreadsheet, scores five recruits, sees position gaps |
| 2. Academics and eligibility | 12 | 1 | Terms, term records, SIS CSV import with diff review, rules table + default unverified set, compute pipeline, certification, transfers, seasons, CARA, exports, tests 2.x | Migration: academics, rules, eligibility, transfers, seasons, CARA, sis_import; `certify_eligibility` RPC; append-only trigger | Compliance officer imports a real (de-identified) file, verifies rules, certifies a team |
| 3. Lineups and Roster Lock | 6 | 2 | `event` contest columns, game rosters, lineup entries, trigger, override RPC, lineup builder, tests 3.x | Migration: event columns, game_rosters, lineup_entries, overrides, trigger | Coach tries to enter an uncertified athlete and sees the lock; compliance grants an override and it is logged |
| — | | | **Manage paid pilot can start here** (Phases 1-3 plus password fallback until SSO) | | |
| R2. Source rules, contacts, offers, conversion | 12 | R1, 2 (conversion needs eligibility rows); visits' paid travel needs 6, falls back to manual cost until then | `recruiting_periods`, `recruiting.*` rules, contact log + trigger, send-path check, overrides, message templates, visits with limit check, offers with D3/D2 triggers, conversion RPC, minors' consent flow, retention job, tests R2.x | Migration: periods, compliance_rules.sport_code, contacts, overrides, visits, offers; contact trigger; conversion RPC; retention cron | Coach's approved message is blocked in a verified dead period; a signed recruit converts into the Module A pending list |
| — | | | **Source paid pilot can start here** (Phases 1, R1, R2; standalone per program) | | |
| 4. SSO | 7 | 1 | Domain verification, SAML connection, JIT hook, group mapping, enforcement, tests 4.x | Auth hook, `sso_connections`, Supabase SSO provider registration (owner runs CLI), Vault entries | Pilot staff sign in through their IdP |
| 5. Module B | 10 | 3 | Rosters/bios/headshots, stats ingest adapter for pilot format, results, feeds, embed, program PDF, opt-out enforcement, tests 5.x (release drafts wait for G4) | Migration: stat tables, media_releases, feed_tokens, membership display columns; storage buckets | SID imports a real stat file and the school site shows the updated roster/schedule feed |
| 6. Module C | 10 | 1, 3 | Spaces, bookings with priority and bumps, trips, rooming, per diem, budgets, approvals, tests 6.x | Migration: venue_space, venue_booking (btree_gist), travel, budget, approval tables | Coach plans a trip; business office approves; per diem computed |
| 7. Module D | 12 + legal | Q1, Q2 answered; 3 | `med` schema, `med-api` edge function, encryption, break-glass, clearances in Roster Lock, screenings, tests 7.x | Migration: `med` schema and tables; Vault master key; edge function secrets; BAA template (counsel) | AT logs an injury; coach sees "Not cleared"; lineup blocks |
| R3. Ranking | 4 deterministic; +4 agent after G4 | R1; agent part needs **G4 TRUE** | Deterministic score and factors now; agent explanations and follow-up drafts after G4; tests R3.x | `recruit_rankings` migration; agent role grants (after G4) | Head coach sees a ranked list with every factor shown |
| 8. Agent jobs | 5 | **G4 TRUE**; relevant module | §9 generators (Manage and Source) | Agent role grants | Drafts appear in inbox with source rows and Approve |
| 9. Live SIS connector | 10 per SIS | 2; school IT approval | Banner Ethos or Workday | Connector credentials in Vault | Nightly import staged without a CSV |

**Order for one engineer:** 0 → 1 → R1 → 2 → 3 → R2 → 4 → R3 (deterministic)
→ 5 → 6 → 7 → 8 → 9. Source is placed immediately after the shared
foundation and again after the Manage pilot point, so each pillar reaches a
sellable pilot in turn: Manage pilot at about day 44 (0, 1, R1, 2, 3), Source
pilot at about day 56 (adds R2). If the owner wants Source first, swap to
0 → 1 → R1 → R2 (conversion's eligibility hand-off is stubbed to "pending"
until Phase 2) and the Source pilot moves to about day 38.

Total before a department runs both pillars end to end (Phases 0-7, R1-R3
deterministic): about 99 working days plus legal review time.

### 15.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Rule values wrong → an ineligible athlete marked eligible | Rules ship unverified; engine never blocks or passes on unverified rules; certification is human |
| R2 | Roster Lock blocks a legitimate athlete on game day | Override path with reason; compliance officer reachable on game days (pilot agreement) |
| R3 | Cross-team leak through a missed policy | Policy matrix test for every table; `med` not exposed; I6 nightly audit extended |
| R4 | SSO misconfiguration grants wrong roles | Restricted roles never mapped from groups; mapping changes audited |
| R5 | Legal exposure on medical data | Module D gated on counsel; no compliance claims in marketing |
| R6 | School IT never grants SIS API access | CSV path is the product; API is a convenience |
| R7 | This work displaces the open gates (G2 money, delivery) | Owner decides ordering explicitly; this spec does not claim gate progress |
| R8 | Data model diverges from club product | College tables are additive; club tables unchanged; `org_kind` separates behaviour |
| R9 | Procurement cycle longer than runway | Pilot priced to fall under purchasing-card or small-purchase thresholds (VERIFY typical threshold) |
| R10 | Recruiting contact made in a dead or quiet period because a rule was entered wrong or left unverified | Unverified rules can only warn; blocking uses verified rules; every outbound is logged with its verdict |
| R11 | Minors' recruiting data leaks or is kept too long | Sensitive columns behind a logged RPC; consent tracking; retention job with receipts |
| R12 | Ranking encodes bias | Allowed-factor list tested; explanations show every factor; humans decide |
| R13 | Recruiting incumbents' exports are unusable | Mapping screen works on any CSV; adapters only after a real file |

### 15.2 Open questions

| # | Question | Who answers |
|---|---|---|
| Q1 | For the pilot school, are athletic-training records education records (FERPA) or does a HIPAA covered entity hold them? | Pilot school counsel |
| Q2 | Will Sporv sign BAAs, and what insurance and security commitments come with that? | Owner + Sporv counsel |
| Q3 | Which NCAA tool and import format does the compliance officer actually use today for certification and squad lists? | Pilot compliance officer |
| Q4 | Should college athletes ever appear in club-style agent findings (`team_athletes`), or stay fully separate? | Owner |
| Q5 | Is eligibility certified per sport per year or per athlete per year at the pilot school? | Pilot compliance officer |
| Q6 | Confirm the default matrix: AD without medical/certify; coaches status-only; ATs without grades. | Pilot AD and compliance officer |
| Q7 | Does certification need a typed attestation or a specific conference form? | Pilot compliance officer, conference office |
| Q8 | Which stat software and export format does the pilot SID use, and can it push to a URL? | Pilot SID |
| Q9 | Pricing: base, per-team, module add-ons, pilot price; and acceptance of the Enterprise/annual exception to CONTEXT §6.1 | Owner |
| Q10 | Does this work start before G2 (first real payment) closes, contrary to CONTEXT §11? | Owner |
| Q11 | Supabase SSO: plan tier and per-project connection limits on the agent project | Owner (Supabase dashboard) |
| Q12 | pgsodium status vs. application-side encryption for `med` columns | Engineering, confirmed against Supabase docs at Phase 7 start |
| Q13 | Retention periods per data class | Pilot records officer + counsel |
| Q14 | Do D3 schools at the pilot track CARA hours or only playing-season length? | Pilot compliance officer |
| Q15 | Who sends missed-class notices, athletics or the athlete? | Pilot academic support |
| Q16 | Current recruiting calendars, first-contact dates and visit limits for the pilot's sports and division | Pilot compliance officer |
| Q17 | Is the National Letter of Intent still in use, and what signing document replaced or accompanies it for D2? | Pilot compliance officer |
| Q18 | Which recruiting tool does the pilot program use today, and can we get a real export file? | Pilot head coach / recruiting coordinator |
| Q19 | Retention period for unsigned prospects and handling of minors' guardian consent under the pilot's state law | Pilot school counsel + Sporv counsel |
| Q20 | Sell Source standalone per program (coach budget) or only with Manage? And which pillar pilots first? | Owner |

### 15.3 Owner hand-applied steps (summary)

Every phase's RED items above. For each: the migration file and its
`.test.sql` in `docs/red-drafts/`, applied in the agent project's SQL editor
or via `supabase db push` after review, then the test file run and its output
pasted into the PR. No agent applies any of them.
