# SPORV — AGENT CONTEXT AND BUILD CONSTITUTION
**Last updated: 9 September 2026 · Repo: `srikanthvishnu90-sketch/sporve-agent-clone` · Production: sporv.ai (Vercel) · Backend: Supabase**

> Saved verbatim from the owner's 2026-09-09 message, at his instruction ("make
> sure to save this info"). Two facts this repo knows that the header does not:
> production deploys reach sporv.ai through the `sporve-agent-clone` MIRROR (see
> `tools/deploy-prod.sh`), and this repository — `sporve-web` — is where the code
> is reviewed and merged. Where this file conflicts with older docs, this file
> wins; where it conflicts with code, follow rule 3 in §0.

---

## 0. HOW TO USE THIS FILE

**Claude Code** — save at repo root as `CONTEXT.md`. Add to `CLAUDE.md`:
`Read CONTEXT.md before any work. Sections 3, 6, 7, 8 are binding constraints, not suggestions.`

**Codex** — save at repo root as `AGENTS.md`, or paste in full as the first message of a session.

Rules for both agents, applying to every session:

1. **Never claim a thing works because a commit message says it works.** Find the code. If the code does not support the claim, say so — that discrepancy is more valuable than the fix.
2. **Never mark a task complete without pasted evidence.** Test output, EXPLAIN ANALYZE output, curl response, screenshot path, or a SQL result. A checkbox without evidence is a fail.
3. **When a spec here conflicts with existing code, the spec wins** — but say which code you are overriding and why, before you change it.
4. **When you do not know, say you do not know.** Do not fill a gap with a plausible implementation and report it as done.
5. **Scope discipline.** Do the task in the session prompt. Note adjacent problems in a findings list; do not fix them silently.

---

## 1. WHAT SPORV IS

Sporv is **B2B agentic software for sports organizations**. It is not a marketplace, not a CRM, and not a SaaS tool with AI features bolted on.

The premise: a club director or private trainer already runs their operation across email, text messages, a website, Stripe, and a pile of spreadsheets. Sporv connects to all of it, reads it continuously, and does the grunt work — finding who owes money, who hasn't signed a waiver, which practice conflicts with which, which family went quiet — and then **writes the message or the change that resolves it**.

The human never composes. The human reads and clicks Send.

**Positioning analogues:** Toast, Shopify, ServiceTitan. Not Uber, not Fiverr.
**What we replace:** TeamSnap, SportsEngine, Spond, Jersey Watch, TrueCoach, and — most often — Google Sheets plus a personal Gmail account.

A separate consumer marketplace surface exists in a different repo. **It is out of scope for this repo. Never reference it in code, copy, or UI here.**

---

## 2. WHERE THE PRODUCT ACTUALLY STANDS (evidence-based, 9 Sep 2026)

Read this before proposing anything. The gap between the spec surface and the verified surface is large, and closing it is the job.

### Built and verified
- Schema migrations committed; production baseline reconstructable from the repo
- `billing_subscriptions`, `plan_entitlements`, `ai_quota` tables exist; plan enum is `free | solo | organization`
- Findings → drafts → review queue architecture
- Draft-first invariant enforced at the database trigger level (`000200`)
- Stripe Connect wiring for collecting dues on connected accounts
- Website extraction and CSV import
- Marketing surface and product screens designed to the system in §7

### Not built — ranked by damage
1. **Every connector.** Gmail, Outlook/M365, Google Calendar, Sheets, Drive, SMS, QuickBooks, Google Business Profile: none exist. This is not a missing feature, it is the missing product. Without ingestion, Sporv is a roster tool with a draft queue, competing against Spond, which is free.
2. **Entitlement enforcement.** Zero `402` responses in any edge function. Every plan limit is currently decorative. A paywall enforced only in the UI is a bug report waiting to be filed.
3. **`sport_pack`, `monthly_recurring`, `invite_link`** — all absent. Each blocks a customer segment.
4. **Feature inventory has never been run.** The claimed-vs-real ratio is unknown.

### Two hard gates, both still open
- **DELIVERY** — no real email has ever been sent from `mail.sporv.ai` to a real inbox. Required evidence: provider message id, mail-tester score ≥ 9, bounce path proven. Written to `docs/gates/delivery-live.md`.
- **FIRST REAL PAYMENT** — no real payment has ever been processed. Required evidence: live `acct_`, `ch_`, `re_` ids, a live decline, a live refund, ledger reconciled to zero drift. Written to `docs/gates/first-real-payment.md`.

**Nothing else counts as progress until both gates close.** High commit volume is fully compatible with a verdict of NOTHING MOVED. See `GATES.md`.

### Business reality
Zero paying customers. Zero signed orgs. Zero rosters imported from a real club. Every design decision in this file is a hypothesis until a real customer tests it.

---

## 3. INVARIANTS — NEVER BREAK THESE

These are enforced, not trusted. Each one has or needs a mechanical check (trigger, Semgrep rule, CI grep, or test).

| # | Invariant | Enforcement |
|---|---|---|
| I1 | **The agent never sends.** No cron, edge function, generator, or Ask tool may write `approved_by`, `sent_at`, issue a refund, or create a charge. There is no auto-send setting, flag, or override. | DB trigger `000200` + grep in CI |
| I2 | **Entitlements are the only source of truth.** Nothing reads a plan *name*. `grep -rE "plan\s*===\s*['\"]"` over `src/ api/ supabase/` must return zero. | CI grep |
| I3 | **Limits return `402`, never a silent no-op and never a `500`.** Payload: `{ reason, current_plan, upgrade_to, limit, current }`. | Test per gated route |
| I4 | **Data export is never gated.** Any plan, any state, including cancelled and over-cap. Gating the exit is how you earn the review that ends the company. | Test |
| I5 | **Dues collection is never blocked.** Even on Free, even over-cap, even after cancellation. We never stand between a club and its money. | Test |
| I6 | **RLS on every public table.** `select tablename from pg_tables where schemaname='public' and rowsecurity=false` → zero rows. Cross-org read as org A into org B → zero rows with application filters removed. | Nightly CI audit |
| I7 | **Minors' data is compartmented.** DOB, emergency contact, and medical notes are readable only by that member's guardians and org admins. Query as staff → null. | Test |
| I8 | **No secrets in the repo or the browser bundle.** `sk_live`, `sk_test`, `whsec_`, `service_role`, provider keys → zero hits. | CI grep |
| I9 | **The agent cannot leak across orgs.** A finding, draft, or Ask answer may never cite a row from another org. | Two-org seeded test |
| I10 | **Stripe Billing (our subscription) and Stripe Connect (their dues) share no table, no webhook handler, and no edge function.** | Review + grep |
| I11 | **Downgrade never deletes.** Over-cap orgs keep all reads, all exports, all dues collection. New writes return `402`. | Test |
| I12 | **No emojis. No decorative icons.** Anywhere: product, marketing, commit messages, seed data. | `scripts/slop-audit.js` |

---

## 4. WHO WE SELL TO

Three segments, one platform. They differ mainly in **billing shape**, not in workflow.

| Segment | Billing shape | Who |
|---|---|---|
| **1v1 private trainers** | Per session, or prepaid packages of sessions | Any sport, worldwide. Solo operators. |
| **Team organizations** | Season fee, one upfront charge or N installments | Soccer, basketball, football, dance, AAU/travel. Sell to mid-size clubs (4–8 teams) first. |
| **Gyms, studios, academies** | Monthly recurring membership | Weight training, skills academies, dance studios |

Roster, waivers, messaging, scheduling, and payouts are shared across all three. Only the billing shape and the nouns change (§5.4 sport packs).

**Priority for launch: mid-size team organizations, then solo trainers.** Gyms are third and should not block anything.

---

## 5. WHAT THE PLATFORM MUST DO

### 5.1 Ingestion — the connectors

This is the product. At signup, the org connects what they already use, and everything in it, plus every future change to it, flows into Sporv.

| Connector | Reads | Writes |
|---|---|---|
| Website | Org structure, programs, prices, schedule, staff | — |
| CSV / paste-anything | Roster, contacts, any tabular data (AI parse) | — |
| Stripe Connect | Charges, refunds, failed payments, card expiry, payouts | Charges, invoices, plans (human-approved only) |
| Google Calendar | Practices, games, conflicts, availability | Events (human-approved only) |
| Gmail | Inbound parent email, tournament PDFs, league notices, facility replies | **Drafts only.** Never sends. |
| SMS (Sporv number) | Inbound parent texts | Drafts only |
| Outlook / M365 | Same as Gmail + Calendar | Drafts only |
| Google Sheets | The spreadsheet the org actually runs on | Read-only at launch |
| Google Drive | Waivers, PDFs, forms, docs | Read-only at launch |
| QuickBooks | Reconciliation, treasurer reporting | Read-only at launch |
| Google Business Profile | Listing accuracy, reviews, hours | Draft updates |

**Security rules for every connector:** OAuth start checks `connectors[]` in the org's entitlements before redirecting. Every scope requested must be justified in the privacy policy. SSRF protection on all extraction (internal IPs, off-domain redirects, oversized pages, slow-loris → rejected). Inbound email and extracted web content are **untrusted input**: 25 hostile prompt-injection cases run nightly in CI, and none may cause a send, a cross-org read, a write outside the diff-confirm flow, or a fabricated fact.

### 5.2 The agent — READ, WRITE, SEND

**READ (findings).** Runs on schedule and on webhook triggers. Produces findings, never messages.
Overdue detection · failed payment watch · card expiry sweep · unsigned waiver detection · missing member data · schedule conflicts · staffing gaps · eligibility status · lapsed and never-converted members · idle capacity · referral moments · inbox triage · tournament and league document parsing · own-website analysis · GBP audit · facility availability research.

**WRITE (drafts).** Every draft lands in the review queue showing: who it's for, what it says, **why** (the finding that produced it), and one action button.

- *Messages* — dues follow-up with tone escalating by days late; failed-payment card fix; card expiry notice; waiver follow-up; consolidated missing-info request, one per guardian; practice and event reminders; schedule-change notice to affected families only; weekly per-family digest; reply to inbound email drafted from known state; reactivation note to lapsed members; timed referral ask; idle-capacity offer to existing families first; staff shift request; facility inquiry.
- *Proposals* (change the org, not a message) — payment plan restructure at 30+ days late; schedule adjustment resolving a conflict; staff assignment filling a gap; website fix list; GBP update; tournament obligations as draft rows. Button is **Apply**, not Send.
- *Records* — session notes per member from attendance and prior notes; period progress summaries; weekly eligibility report to the director; treasurer summary; meeting minutes from a transcript.

**SEND — human only.** One button per draft. Bulk approve within a group is allowed ("Send all 12 dues reminders"); each row still records the human who clicked. See I1.

**Settings.** `Agent: [Off] [Observe] [Draft]`. Off = nothing runs. Observe = READ only, findings appear, no drafts. Draft = READ + WRITE, default. Per-job on/off toggles for WRITE jobs only, so a director can silence a draft type. READ jobs have no per-job toggle. **There is no Auto state.**

### 5.3 Modules

**Money** — dues and fees; installments with plan-level dunning; per-session and package/credit billing; monthly recurring memberships with freeze and cancel; refunds; credits ledger; sibling/household discounts; unified ledger with reconciliation. Self-serve cancellation, two taps, no retention dark patterns.

**People** — roster; households and guardians; staff and roles; invite link and public registration form; waiver signing and signature records; eligibility tracking (recorded, not ordered); intake forms; member self-portal.

**Scheduling** — practices, games, events; conflict detection; RSVP and availability; capacity and check-in; calendar sync; multi-program and multi-team structure.

**Communication** — per-family threads; team chat with inline agent drafts; SMS threading; group messaging with replies threaded back to the org; delivery and bounce tracking.

**Trainer-specific** — public booking page; availability calendar; packages and session credits; progress tracker (goals, PRs, measurements, video); session notes; no-show and late-cancel policy; client sourcing in Ask (lapsed, referral, Places harvest, GBP).

**Onboarding** — three doors (trainer / team org / gym), each ending on a **populated review queue**, not an empty dashboard. Median completion under 20 minutes, timed on three real people.

### 5.4 Sport packs

One codebase, per-sport vocabulary and fields. A dance studio does not have "innings" and a swim club does not have "quarters". Sport pack defines: member noun, group noun, event nouns, position/level fields, and any sport-specific eligibility fields. Never hardcode a sport's vocabulary into a component.

### 5.5 Migration

Import mappings for TeamSnap, SportsEngine, LeagueApps, Spond, Jersey Watch, Sports Connect, and raw Sheets/CSV. **Sports Connect sunsets in 2027** — that is a forced-migration acquisition window and the mapping for it is a priority, not a nice-to-have.

---

## 6. PAYMENT MODEL — SUBSCRIPTION ONLY

**We charge the organization a subscription for software plus agent. We take zero percent of parent dues at launch.** No parent-facing platform fee, ever. "No junk fees" is a positioning weapon against SportsEngine and must remain literally true in code.

The architecture runs on Stripe Connect direct charges so a take rate *could* be enabled later. It is not enabled. Do not build it.

### 6.1 Three plan states

Database keys stay `free | solo | organization`. Customer-facing labels are **Free / Solo / Organization**. Never introduce a `club` tier — it was removed.

All prices live in **one config file** as constants so a price change is a one-line diff. Prices marked ⚠ are pending founder confirmation; wire them, do not hardcode them anywhere else.

| | **Free** | **Solo** ⚠ $49/mo · $490/yr | **Organization** ⚠ from $199/mo · $1,990/yr |
|---|---|---|---|
| Who | Anyone, permanently | One trainer, one coach, one-person op | Clubs, academies, multi-team orgs |
| Members | 15 | 100 | 150 included, ⚠ +$40/mo per additional 50 |
| Admin seats | 1 | 1 | 5 included, with roles; ⚠ +$15/seat |
| Groups | 1 | Unlimited | Unlimited |
| Connectors | Website extraction, CSV, Stripe | + Gmail (read + draft), Google Calendar, SMS number with inbound reading | + Outlook/M365, Sheets, Drive, QuickBooks, GBP, all migration mappings |
| Agent cadence | Nightly only | Nightly + triggered | Nightly + triggered + on-demand unlimited |
| Agent jobs | Money and document findings only. No proposals, no records, no client sourcing. | All READ + all WRITE, including records, proposals, and client sourcing in Ask | All jobs, plus treasurer summary and multi-program views |
| Drafts | 20/mo, then marked over-limit (see 6.5) | Unlimited | Unlimited |
| Sends | 20/mo hard stop | Fair-use unlimited | Fair-use unlimited |
| Ask messages | 25/mo | 500/mo | 2,500/mo, then metered |
| Modules | Roster, dues, waivers | + booking page, packages/credits, notes, progress tracker, per-session and pack billing | + installments, RSVP, invite link and registration form, team chat, eligibility, memberships, capacity/check-in, multi-program, league view |
| Setup | Self-serve | Self-serve | Done-for-you migration + onboarding call |
| Branding | "Sent via Sporv" footer on outbound | None | None |
| Dues collection | Always allowed | Always | Always |
| Export | Always allowed | Always | Always |

Above ~800 athletes the Organization card becomes "Talk to us". That is a *conversation*, not a third plan. **The pricing page shows exactly two paid cards.**

Annual billing is **two months free** everywhere. Not 20%, not 17% — two months free, stated identically in the config, the pricing page, Stripe, and every doc.

Do **not** build a per-camp add-on for launch. A second pricing dimension on a page nobody has bought from yet is complexity we cannot afford to explain.

### 6.2 Entitlements table

Extend `plan_entitlements` to hold, per plan key:

```
member_cap, admin_cap, group_cap,
connectors text[], jobs text[], modules text[],
scan_mode ('nightly'|'triggered'|'ondemand'),
draft_quota_month, send_quota_month, ask_quota_month,
branding_footer bool
```

Seed all three rows in a migration. **Changing a limit is a data change, never a code change.** See I2.

### 6.3 Stripe Billing, separate from Connect

Our subscription runs on the **platform** account via Stripe Billing. Their dues run on **connected** accounts via direct charges. See I10.

- Products and prices in Stripe: Solo monthly/annual, Organization monthly/annual, athlete-band add-on, seat add-on.
- New edge function `billing-webhook` — **do not extend `stripe-webhook`**, which handles dues. Handles `checkout.session.completed` (mode=subscription), `customer.subscription.created/updated/deleted`, `invoice.payment_failed`. Verifies signature. Rewrites the org's entitlements row from the price id within 60 seconds of every event.
- New edge function `billing-portal` — returns a Stripe Customer Portal session so a director changes card, upgrades, downgrades, or cancels without emailing a human.
- `invoice.payment_failed` → org drops to Free entitlements **after** Stripe's dunning window closes, never immediately. Write a finding.

### 6.4 Enforcement

Every one of these returns `402` with the I3 payload:

member insert past `member_cap` · admin invite past `admin_cap` · group create past `group_cap` · connector OAuth start for a kind not in `connectors[]` · draft generation past `draft_quota_month` · send past `send_quota_month` · Ask past `ask_quota_month` · any route for a module not in `modules[]`.

Cron generators filter on `jobs[]` and `scan_mode` **before** generating, so a Free org's nightly run produces no proposals rather than generating and hiding them.

**Never gate a send in a way that breaks a paying club mid-season.** Free is hard-capped; both paid plans are fair-use unlimited. A club whose dues reminders stop because of a quota concludes the product is broken, not that they should upgrade.

### 6.5 The paywall experience

Free users hit walls in a predictable order: draft/send quota (~week 2), member cap (first real import), connector lock (the moment they want Gmail), Ask quota. Each wall shows three things and nothing else: **what stopped, exactly what they'd get, one button.**

Copy pattern — name the cost in their terms, not ours:
> 8 families weren't contacted this month. Solo sends without a monthly limit. [See plans]

**The conversion mechanic is visible unfinished work.** Past the quota, drafts still generate and sit in the queue clearly marked over-limit. A free user who sees eight unsendable drafts upgrades; one who sees an empty queue concludes the product does nothing. Never silently skip generation.

Quota is visible before it bites: queue header shows remaining sends from 50% used; a banner at 80% names what runs out and when it resets.

Locked surfaces sell. A locked tab renders greyed with its real structure visible behind it and one line naming the plan. Not hidden, not blank. Locked connector cards state what they'd feed: "Gmail — sorts parent email, reads tournament PDFs, finds families. Solo and up."

Upgrade flow: one sheet, two paid plans, current plan marked, annual toggle → Stripe Checkout → `billing-webhook` → entitlements within 60s → **the blocked action retries automatically and completes**. The user lands exactly where they were, with the thing they tried to do now done.

### 6.6 Trial, downgrade, cancellation

**Trial** — 14 days at Organization entitlements, no card required. Findings fire on days 11, 13, and 14 naming what they will lose with counts from their own org ("your 47 members exceed Free's 15"). At day 14 the org drops to Free automatically. We want them to feel the full product, then feel the free tier.

**Downgrade** — deletes nothing. Reads work, exports work, dues keep collecting, new writes return `402`. State this plainly on the pricing page.

**Cancellation** — access through the paid period, then Free. One question on cancel: why, free text, stored. In month one this is the most valuable data we will collect.

**Billing self-service** — Settings → Billing shows current plan, live usage against every quota, next invoice date and amount, change plan, update card, cancel, invoice history. All through `billing-portal`. No billing email should ever require a human.

### 6.7 Price defensibility

TeamSnap runs roughly $10.83–$13.75/month per team on annual billing. Spond charges nothing for its core product and takes ~2.5% on payments instead. A six-team club's current software bill is therefore $60–85/month, or zero.

This means **Organization is a labor-replacement sale, not a software sale.** The page cannot lead with features; it leads with the registrar's hours. Which requires a number we do not yet have.

**Build this instrumentation before the paywall ships:** time from finding created → draft approved; drafts approved per week; families contacted who otherwise would not have been; hours saved per month per org. Surface it in-product ("Sporv drafted 43 messages for you last month") and store it. Without it, the price is a guess that cannot be defended to a treasurer, and treasurers approve this purchase.

---

## 7. DESIGN SYSTEM

Binding. Do not introduce a font, a color, or a glyph that is not on this page.

### Typography
| Role | Face | Treatment |
|---|---|---|
| Display headings, buttons | **Roboto Condensed 700** | UPPERCASE |
| Body, labels, all readable text | **Inter** 400 / 500 / 600 | Sentence case |
| Numbers, data values, micro-labels | **JetBrains Mono 500** | — |

One enforced type scale. Components draw sizes from tokens and never declare their own. Dashboard navigation runs 14px/500 with 30px rows (Stripe-measured); section eyebrows are 12px uppercase. Chat renders every message — user and agent — at one identical base size; size differences are reserved for metadata only.

**One large heading per page.** Not one per section.

### Color
| Token | Hex | Use |
|---|---|---|
| Background | `#0B0D0F` | Near-black base |
| Slate | `#6B7F9E` | Primary structural accent |
| Slate light | `#9DB0CB` | Secondary accent |
| Steel blue | `#8EC5E8` | Attention / needs action |
| Green | `#6FA982` | Complete / positive / paid |

**Color encodes state, never decoration.** No gradients. No orange in the agent product. If a color is not carrying state information, it should not be there.

### Hard rules
1. **No emojis. Anywhere.** Not in UI, not in seed data, not in commit messages.
2. **No decorative icons.** No shields, clocks, checkmarks-as-flourish, sport glyphs. If a `SPORT_GLYPH` map exists in the repo, delete it — it is a trap an agent will reach for.
3. Icons are permitted **only** where they encode live state or navigation: verified badge with date, error state, success state on payment screens, input-field icons inside a search bar, close/back glyphs. Each requires a justifying comment.
4. **Text carries meaning.** ~90% of any page is text, not graphics.
5. **Structure follows content.** Do not ship identically-shaped pages. Repetition substituting for structure is the primary tell of templated work; adjacent sections must not repeat the same anatomy.
6. **Trust surfaces never animate.** Verification badges and payment states render from verified server state, always.
7. Every screen has a defined 390px behavior before it merges.

### Enforce it mechanically
`scripts/slop-audit.js` runs in CI and fails the build on: any icon not on the allowlist, any emoji, any font outside the three faces, any color outside the tokens, any gradient, any banned word from §8. **The auditor decides when the work is done, not the agent's judgment.** Agents drift back to patterns that already exist in the codebase; only a mechanical check survives a multi-page sweep.

---

## 8. VOICE AND COPY

**Register: a calm varsity coach. Not a supplement ad, not a SaaS landing page.**

- Headlines ≤ 7 words. Subheads ≤ 28 words. Short declaratives, ending in periods.
- No exclamation marks.
- Concrete, never adjectival. State, do not sell.
- **Athletic vocabulary: 2–3 terms per page, total.** Zero reads as generic SaaS; more than four reads as costume.
  - Allowed: session, drill, rep, roster, court time, game day, off-season, warm-up, first whistle, bench, lineup, season, practice plan, personal best.
  - Banned: grind, beast mode, crush, dominate, unleash, warrior, elite (as hype), 110%, no-excuses, hustle, champion mindset.
- **Banned generic-SaaS words:** seamless, empower, supercharge, revolutionize, leverage, unlock (as hype), game-changing, effortless, magical, delight.
- Register test: *"Every session, accounted for."* passes. *"Dominate your schedule."* fails.

**Product copy specifics:**
- Every draft in the queue states **why** it exists, in one line, referencing the finding. "Marcus Bell is 12 days past due" — not "Suggested message".
- Errors state what failed and what to do. Never a blank pane, never a raw 500.
- Empty states are honest. A fresh org sees what will appear here and how to make it appear, not a fake preview.
- Never claim the agent did something a human did, and never claim a human approved something the agent drafted.
- Marketing claims map 1:1 to features scoring 4+ in the feature inventory. Out-of-scope items are stated plainly on the site so the wrong customer does not sign up.

---

## 9. DEFINITION OF DONE

A task is done when all of the following are true and pasted into the commit or the session summary:

1. Happy path works
2. Empty state (fresh org, zero data) renders with honest copy
3. Error state is visible and specific
4. Multi-tenant case handled: two orgs doing this simultaneously
5. One test that fails before the fix and passes after
6. Relevant invariant from §3 has a passing check
7. Evidence pasted — output, not description

**Scale floor** (assume 5,000 orgs, 500,000 members, 2M installments): no seq-scan on any table over 10k rows on a hot path; cron generators batch, checkpoint, and resume, and one org's error never aborts a run; every external call (Stripe, Resend, Google, Places) rate-limits and backs off on 429; the review queue paginates.

**Concurrency cases that each need a passing test:** two admins approving the same draft → one send; import during cron → no duplicate members; duplicate Stripe webhook → one ledger row; downgrade mid-cron → entitlements respected on the next chunk.

---

## 10. OUT OF SCOPE — do not build, and say so on the site

Consumer marketplace (different repo) · take rate on parent dues · live scoring · programming/workout builder · POS · tee-time management · video analysis · any auto-send capability · any AI that acts without a human click.

---

## 11. PRIORITY ORDER

Do not reorder without saying why.

1. **Close both gates.** Real delivered email. Real processed payment. Nothing below counts until these are done.
2. **Gmail + Google Calendar connectors.** Without one connector there is nothing to sell on Solo.
3. **Entitlement enforcement.** `402` server-side, entitlement-driven, zero plan-name comparisons.
4. **Time-saved instrumentation.** The number the price depends on.
5. **Feature inventory** — evidence-scored, with an explicit "claimed but not real" section. That section reaching zero is a launch requirement.
6. Raise every segment-blocking feature to a 4+: sport packs, invite link and registration form, RSVP and availability, group messaging, SMS with human-sent drafts, monthly recurring billing, public booking page with packages.
7. Security pass with evidence for every check in §3.
8. Paywall experience (§6.5), then launch readiness.
