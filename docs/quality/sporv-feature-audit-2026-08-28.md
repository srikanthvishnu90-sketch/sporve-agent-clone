# Sporv product reality audit — 2026-08-29

This report separates rendered breadth from production truth. It combines the validated 87-feature catalogue, a real run of the project custom agent sporv_test_agent, the full browser gate, two independent UX reviews, and a focused onboarding regression review.

## Decision

Release verdict: **FAIL**.

The supplied Getting Started experience is implemented and passes its local contracts, desktop review, mobile review, and full browser smoke suite. The release is nevertheless stopped because the currently deployed family detail can label Apex Performance Club **Verification in progress** while still exposing session selection, **Request to book**, and **Check out with a card**. That is a direct contradiction of Sporv's claimed background-check booking gate.

| Measure | Catalogue baseline | Dedicated-agent adjudication |
|---|---:|---:|
| Overall score | 3.68/10 | 3.56/10 |
| Live verified | 3 | 2 |
| Implemented, not production-verified | 37 | 36 |
| Demo only | 20 | 20 |
| Spec only | 17 | 17 |
| Absent | 9 | 9 |
| Blocked | 1 | 3 |

The dedicated agent changed only two scores: feature 27, Listing detail + booking flow, fell from 8 to 4; feature 32, Background-check safety gate on booking, fell from 9 to 3. All other scores stayed at the evidence-catalogue baseline.

## What was implemented

Getting Started now has one state-backed guide with three phases and seven real workflow steps:

1. Tell us who you coach.
2. Build your public profile.
3. Publish your first listing.
4. Pass the background check.
5. Open a real session.
6. Connect Stripe payouts.
7. Confirm cancellation terms.

Every step includes an owner, estimated time, why it matters, requirements, a four-part ordered process, completion evidence, the current limitation, what it unlocks, and a real destination. Completion comes from provider, catalogue, session, verification, payout, and policy state; clicking through the guide cannot manufacture progress. Sample availability no longer counts as a completed real session, and the sample correctly reports four of seven steps complete.

The detail drawer uses the shared Media-derived tokens and components, sits above Sporv AI, traps focus, closes on Escape, makes the page/rail/AI layer inert, and restores focus to the exact triggering row. On mobile, all seven process actions are 44px high, there is no horizontal overflow, and a signed-out action opens authentication while preserving the intended destination.

Shared coach UI now includes PageHeader, TabStrip, Block, StatCard/StatGrid, ListCard, DataTable, Callout, Button, ProgressCard, ProcessPhases, and Drawer. The approved Media typography, spacing, panels, button hierarchy, count badges, responsive tables, and sticky URL-backed tabs remain the dashboard contract.

## Verification evidence

- Build: PASS — 17 modules, 3 embedded font faces, 19 CSP hashes, build stamp 713146f29c7f37a6, 2,376,840-byte index.
- Full elevated browser smoke: PASS — 13 visitor routes, 16 coach tabs, CSP, auth, booking, trust contracts, persistence, accessibility contracts, and product-page assertions.
- Live data exercised by smoke: 132 Supabase listings, 825 resolved sessions, 5 correctly badged verified listings.
- Getting Started contract: PASS — seven ordered evidence-derived steps, three phases, detailed process content, shared UI, focus, isolation, and mobile targets.
- Codex council contract: PASS — one lead plus 15 read-only specialists; login and legacy shell disabled.
- Feature-catalogue validator: PASS — 87 ordered rows, no validation errors.
- Dedicated-agent response contract: PASS — valid JSON, 87 ordered ratings, verdict fail, adjudicated average 3.56/10.
- Known warnings retained honestly: four family contrast baselines and ten legacy thin blocks.

## The real test-agent run

The project agent is defined in .codex/agents/sporv-test-agent.toml as gpt-5.6-sol at xhigh reasoning, sandbox_mode read-only, with explicit prohibitions on edits, deployments, messages, charges, refunds, and Stripe/Supabase mutations. Its evidence was injected directly because the requested no-shell policy prevents an uncommitted local-file scan.

The successful non-interactive run used Codex CLI 0.150.1 and took roughly nine minutes for the specialist phase. It consumed 104,042 input tokens, including 58,880 cached input tokens, and produced 9,670 output tokens; the response is preserved verbatim as latest-agent-response.json and validated by scripts/sporv-agent-response-test.mjs.

The agent's exact next action was to stop the release, reproduce the Apex Performance Club production state, enforce a server-side fail-closed verification gate for listing actions, booking creation, and checkout creation, and rerun the exact production assertion before deployment.

Earlier attempts are meaningful test-system evidence: the first failed on an overly permissive JSON-schema shorthand, a no-shell run could not read uncommitted files, and ephemeral Codex mode could not register a parent thread for subagent spawning. The final harness avoids those failure modes by using a normal read-only thread, strict response validation, and an injected evidence packet.

## Product thesis

Sporv is currently a broad, polished demonstrator sitting on top of a much narrower live operational spine. The next product milestone should not be another dashboard, AI prompt, or commerce surface; it should be one trustworthy vertical transaction that is correct from verified provider to dated inventory to atomic capacity to checkout to refund and payout.

The sequence should be:

1. **Restore the trust invariant.** Every non-cleared verification state must be blocked in the UI and at booking/checkout server boundaries, with Apex retained as a regression fixture.
2. **Prove one complete money path in test mode.** Create one verified listing and dated session, race the last seat, charge, reconcile the webhook and booking, test each refund band, and verify payout/subscription state without real funds.
3. **Make operations durable.** Replace local roster, inbox, availability, waitlist, attendance, and client-history state with owner-scoped records and cross-account denial tests.
4. **Close youth-data boundaries.** Prove guardian isolation, booking-to-child binding, versioned consent withdrawal, private media storage, signed access, and server-side publish/share gates.
5. **Put AI on truth rails.** Keep drafting and Q&A, but do not add autonomous messaging, inventory, analytics, or scheduling claims until the underlying records and permissions are live.

Defer gear commerce, inventory/reorder AI, broad analytics, external calendar sync, and more demo surfaces until the transaction and operating spine is proven. A feature moves above 4/10 only with durable state and runtime proof; it moves to 10/10 only with production, negative-permission, edge-case, and recovery evidence.

## Independent agent verification

- Feature-reality agent: validated 87 rows at 3.68/10 before the production contradiction was adjudicated.
- UX assessment agent: rated the broad live experience 18/40 on Nielsen dimensions and highlighted the mobile coach-portal trap, non-URL routing, accessibility debt, and the default-open AI panel.
- Detector/browser agent: found 12 deterministic warnings (6 actionable, 1 ambiguous, 5 false positives), measured the family tap-target and contrast failures, and independently identified the booking/trust stop condition.
- Focused onboarding reviewer: passed the final Getting Started regression at high confidence after drawer layering, state evidence, focus isolation, guest authentication, exact focus return, optional-label semantics, and 44px mobile actions were corrected.
- Dedicated sporv_test_agent: independently converted the trust finding into a fail verdict and the two score downgrades above.

The agents agree on the central conclusion: rendered breadth is ahead of verified workflow depth, and trust plus transaction integrity must precede further feature expansion.

## Dashboard tabs and header primary actions

| Page | Tabs | Single header primary action |
|---|---|---|
| Home | None | None |
| Getting Started | None | Continue setup, only while an incomplete step exists |
| Clients | Roster · Requests · Import · History | Add client |
| Schedule | Calendar · Availability · Time off | Add session |
| Listings | Active · Drafts · Archived | New listing |
| Media | Profile · Library · Consent · Performance | Add media |
| Earnings | Summary · Payouts · Transactions · Tax documents | None; read-only |
| Approvals | None | None |
| Operations | Insights · Reviews · Policies · Automated messages | None |
| Billing | Plan · Payment method · Invoices | Go Pro, on Plan only and only when not entitled |

## Connector and execution safety

Agent Bash access is off in .codex/config.toml: allow_login_shell=false and features.shell_tool=false, and the council contract enforces both settings. Stripe is configured with read/search/documentation/planning tools only and no write tools. Supabase is project-scoped to tseszaprvtvqrkfpditu with read_only=true.

Do not overstate connector status: the CLI reports authentication as unknown and the test invocation observed a failed Supabase OAuth refresh, so authenticated MCP access is not proven. Separately, the application smoke suite did successfully read the live Supabase catalogue through the app's own runtime path. No Stripe or Supabase record was created, changed, charged, refunded, or deleted during this work.

## Recurring quality cadence

.github/workflows/scheduled-quality-audit.yml runs every Monday at 15:17 UTC after it lands. It builds, validates the 15-agent council, validates the catalogue and latest dedicated-agent response, runs all deterministic product contracts, runs the browser smoke suite, and preserves artifacts for 30 days with contents-read permission only.

The deep dedicated-agent run is intentionally not an every-commit gate: the observed nine-minute, 100k-token evaluation belongs in a periodic audit. A ready-to-enable Codex desktop Scheduled task prompt lives in docs/codex-scheduled-quality-task.md; Codex tasks cannot be activated from repository code, and a local task requires the app and computer to be running. The automation detects and proposes improvements, but it does not autonomously edit or deploy them.

## All 87 adjudicated ratings

| # | Domain | Feature | Score | Classification | Main blocker |
|---:|---|---|---:|---|---|
| 1 | AI Assistant | Gym finder | 5/10 | implemented_unverified | The live coach-command deployment, Places secret, enrichment table, and inquiry lifecycle were not reverified. |
| 2 | AI Assistant | Gym scheduling | 2/10 | spec_only | A facility is not a live schedulable resource and there is no rental-status writer. |
| 3 | AI Assistant | AI emailing | 1/10 | absent | There is no send_email tool or verified email-delivery provider. |
| 4 | AI Assistant | AI in-app message sending | 6/10 | implemented_unverified | Only the one-parent path is real on web; inbox hydration and bulk dispatch remain incomplete. |
| 5 | AI Assistant | AI notes | 5/10 | implemented_unverified | The web implementation is local and the sibling note and attendance deploy state is unverified. |
| 6 | AI Assistant | AI drafting suite | 7/10 | implemented_unverified | Bulk, broadcast, and recurring campaign execution are not complete. |
| 7 | AI Assistant | AI operations Q&A | 7/10 | implemented_unverified | Waitlist and attendance reads are not fully live and there is no organization scope. |
| 8 | AI Assistant | AI voice calibration | 2/10 | spec_only | A voice transcript is not persisted as a reusable drafting-tone profile. |
| 9 | AI Assistant | AI onboarding concierge | 4/10 | implemented_unverified | There is no durable onboarding state or grounded what-remains tool. |
| 10 | AI Assistant | AI reorder lists | 1/10 | absent | There is no inventory model or stock truth for the AI to read. |
| 11 | AI Assistant | AI review responses | 2/10 | spec_only | The AI has no owned review identifier or draft_review_reply writer. |
| 12 | AI Assistant | AI translation layer | 1/10 | absent | There is no locale-aware translation pipeline or view-original state. |
| 13 | Messaging & Communication | Coach↔parent direct messaging | 7/10 | implemented_unverified | Web inbox reads and compose still split between real and local paths. |
| 14 | Messaging & Communication | Group / broadcast messaging | 3/10 | demo_only | There is no live group membership and delivery model on web. |
| 15 | Messaging & Communication | AI-drafted messages | 7/10 | implemented_unverified | Bulk and scheduled delivery remain incomplete and some deploy state is unknown. |
| 16 | Messaging & Communication | Parent session updates / recaps | 4/10 | blocked | The server path does not prove that the targeted child was coached by the provider. |
| 17 | Messaging & Communication | Two-deep / COPPA-safe structure | 5/10 | implemented_unverified | Guardian isolation exists, but two-deep participation or immutable witnessing is not enforced. |
| 18 | Messaging & Communication | Message notifications (push/email) | 4/10 | implemented_unverified | Push credentials and real-device delivery are unverified and email fallback is absent. |
| 19 | Messaging & Communication | Automated / scheduled messages | 6/10 | implemented_unverified | The approval lifecycle exists, but there is no general recurring scheduler or quiet-hours proof. |
| 20 | Messaging & Communication | Shared team inbox (org routing) | 3/10 | spec_only | The shared inbox schema is authored but not applied. |
| 21 | Messaging & Communication | Message templates | 2/10 | demo_only | Templates and placeholders exist only in local state with no owned persistent store. |
| 22 | Messaging & Communication | Read receipts / unread | 2/10 | demo_only | Unread state is cosmetic; no durable message-read record was found. |
| 23 | Messaging & Communication | In-thread booking / consent actions | 2/10 | spec_only | Threads have no typed action-message schema and cannot safely mutate transactional state. |
| 24 | Booking & Marketplace | Browse / listing grid | 8/10 | live_verified | The local runtime reached live data, but the current production frontend deployment was not checked. |
| 25 | Booking & Marketplace | Filtered search (sport/age/price/location) | 8/10 | live_verified | Filtering is primarily client-side over the full catalogue and has not been load-tested at scale. |
| 26 | Booking & Marketplace | AI natural-language search / match | 4/10 | implemented_unverified | The web uses a local parser instead of the sibling search-execute rail. |
| 27 | Booking & Marketplace | Listing detail + booking flow | 4/10 | blocked | Production exposes booking and checkout affordances for a provider labeled Verification in progress, and no completed paid booking proves the full safe path. |
| 28 | Booking & Marketplace | Real-time availability / open slots | 5/10 | implemented_unverified | Dated sessions are real, but they are not generated from a live recurring availability engine. |
| 29 | Booking & Marketplace | Booking write + hold-while-paying | 5/10 | implemented_unverified | The booking write is real, but there is no verified atomic seat hold or pending-booking expiry. |
| 30 | Booking & Marketplace | Stripe checkout / payment | 6/10 | implemented_unverified | Checkout sessions exist, but the last documented state has zero paid bookings and the production trust gate currently blocks safe checkout verification. |
| 31 | Booking & Marketplace | Booking capacity + waitlist | 2/10 | demo_only | Waitlist state is local and no live atomic no-oversell guarantee was proven. |
| 32 | Booking & Marketplace | Background-check safety gate on booking | 3/10 | blocked | The current production experience contradicts the claimed fail-closed background-check gate; local smoke does not disprove the live assertion. |
| 33 | Booking & Marketplace | Refunds / cancellation policy | 5/10 | implemented_unverified | The server quote and refund function have never been exercised against a completed charge. |
| 34 | Booking & Marketplace | Coach payout (Connect) + review-gating | 5/10 | implemented_unverified | A Connect account exists, but no payout has run and web review state is only partly real. |
| 35 | Payments & Money | Family wallet & saved payment methods | 2/10 | demo_only | Cards and wallet state are local and have no Stripe-backed payment-method ownership. |
| 36 | Payments & Money | Receipts & transaction history | 3/10 | demo_only | The family ledger is local and the coach has no authoritative payout transaction ledger. |
| 37 | Payments & Money | Session packs / credits | 2/10 | spec_only | The local pack demo and authored credit ledger have no live purchase or settlement path. |
| 38 | Payments & Money | Split-family payments | 2/10 | demo_only | The split flow is local and split_pay_links is documented as not live. |
| 39 | Payments & Money | Cash / offline payment logging | 1/10 | demo_only | Mark paid only flips local state and records no actor, tender, or provenance. |
| 40 | Payments & Money | Deposits & remaining balances | 2/10 | spec_only | Camp deposit math is presentational and no charge or balance settlement is live. |
| 41 | Payments & Money | Recurring / installment billing | 2/10 | spec_only | Recurring bookings are authored but deliberately do not move money. |
| 42 | Payments & Money | Coach invoices & payment links | 3/10 | spec_only | Invoice schema and function are not proven live, while web payment links are local. |
| 43 | Payments & Money | Club dues / team billing | 2/10 | spec_only | There is no live team obligation or family allocation ledger. |
| 44 | Payments & Money | Scholarships / financial aid | 1/10 | spec_only | There is no determination policy, eligibility model, or award workflow. |
| 45 | Payments & Money | Dunning / collections | 1/10 | spec_only | Reminder copy exists, but there is no receivables-aging state machine. |
| 46 | Payments & Money | Disputes, chargebacks & reconciliation | 3/10 | spec_only | There is no verified Stripe dispute ingestion or user-visible evidence chain. |
| 47 | Payments & Money | Provider subscription billing & plan management | 6/10 | implemented_unverified | The schema and checkout/portal path exist, but no subscription lifecycle was verified now. |
| 48 | Scheduling & Calendar | Family schedule / calendar | 7/10 | implemented_unverified | The signed-in create-to-reload calendar flow was not exercised with account credentials. |
| 49 | Scheduling & Calendar | Coach session calendar | 6/10 | implemented_unverified | Owner-only editing, capacity state, and public reflection were not tested end to end. |
| 50 | Scheduling & Calendar | Recurring availability | 3/10 | demo_only | Recurring blocks live in local state and generate no durable dated inventory. |
| 51 | Scheduling & Calendar | Blackouts / time off | 1/10 | absent | The page explicitly says time-off records are not connected. |
| 52 | Scheduling & Calendar | Conflict / double-book protection | 3/10 | spec_only | Local overlap checks are not a live database guarantee across services and venues. |
| 53 | Scheduling & Calendar | Rescheduling / cancellation workflow | 4/10 | implemented_unverified | Cancellation is real, but moving a booking does not atomically revalidate availability and capacity. |
| 54 | Scheduling & Calendar | Team season fixtures | 6/10 | implemented_unverified | The table is documented live, but current owner CRUD was not exercised. |
| 55 | Scheduling & Calendar | External calendar / league schedule sync | 0/10 | absent | There is no ICS or API import, sync cursor, or reconciliation worker. |
| 56 | Client & Roster | Unified client roster / CRM | 4/10 | demo_only | The coach roster is local rather than a relational view of real athletes and guardians. |
| 57 | Client & Roster | Manual add-client / shadow records | 2/10 | demo_only | Add-client mutates local state and there is no safe pre-account client identity model. |
| 58 | Client & Roster | Athlete & guardian profiles | 7/10 | implemented_unverified | Full edit and delete behavior and cross-account isolation were not exercised now. |
| 59 | Client & Roster | Consent / COPPA management | 6/10 | implemented_unverified | Booking consent is real, but media and communication consent are separate or local. |
| 60 | Client & Roster | Client detail & relationship history | 5/10 | implemented_unverified | No single client record joins relationship, payment, notes, and consent truth. |
| 61 | Client & Roster | Roster search, sorting & segmentation | 2/10 | demo_only | Workspace search and filters operate over local state only. |
| 62 | Client & Roster | Attendance / check-in | 2/10 | demo_only | Web attendance is local and the sibling migration is authored but not applied. |
| 63 | Client & Roster | Documents, waivers & eligibility | 1/10 | spec_only | There is no athlete document vault, expiry model, or dual-roster audit trail. |
| 64 | Coach & Staff Operations | Organization workspace / multi-team membership | 4/10 | implemented_unverified | Membership exists, but the complete multi-player workspace remains unpurchasable and mostly prose. |
| 65 | Coach & Staff Operations | Staff invitations & affiliations | 3/10 | spec_only | The web invite is local and the sibling affiliation schema is not applied. |
| 66 | Coach & Staff Operations | Roles, permissions & shared access | 5/10 | implemented_unverified | Organization roles and RLS exist, but no complete role-management workflow is surfaced. |
| 67 | Coach & Staff Operations | Staff background-check compliance | 6/10 | implemented_unverified | Current backend invariants were not queried and staff-assigned supply is not live. |
| 68 | Coach & Staff Operations | Certification / waiver expiry tracking | 6/10 | implemented_unverified | The table and fail-closed UI exist, but external verification deployment evidence conflicts. |
| 69 | Coach & Staff Operations | Trainer assignment & commissions | 2/10 | spec_only | Assignment and commission migrations are not applied and explicitly move no money. |
| 70 | Coach & Staff Operations | Camps, teams & multi-program operations | 3/10 | demo_only | Rich local surfaces sit over camp and team schemas that are mostly not applied. |
| 71 | Coach & Staff Operations | Operations approvals & policy queue | 6/10 | implemented_unverified | The real queue covers a narrow action set while other rows remain demo state. |
| 72 | Video & Development | Coach media library | 3/10 | demo_only | Library entries are local and disappear on reload. |
| 73 | Video & Development | Photo/video upload & durable storage | 4/10 | implemented_unverified | Profile images have a real store, but session media and video do not; the existing bucket is public. |
| 74 | Video & Development | Athlete tagging & media-consent gate | 4/10 | demo_only | The consent evaluator is strong but client-only and binds no durable media row. |
| 75 | Video & Development | Private family sharing / public publishing | 3/10 | demo_only | Share and publish actions update local state but persist or deliver nothing. |
| 76 | Video & Development | Video playback, trim & AI analysis | 1/10 | demo_only | The UI explicitly labels analysis as demo and says storage, playback, and trim are not wired. |
| 77 | Video & Development | Goals, development plans & progress digests | 6/10 | implemented_unverified | The sibling implementation is substantial, but its current production deployment and full loop were not verified. |
| 78 | Commerce & Gear | Gear catalog / team store | 0/10 | absent | There is no SKU, product catalog, or team-store implementation. |
| 79 | Commerce & Gear | Inventory & reorder management | 0/10 | absent | There is no inventory table, stock ledger, supplier, or reorder workflow. |
| 80 | Commerce & Gear | Orders, fulfillment & returns | 0/10 | absent | There is no order, shipment, fulfillment, or returns state machine. |
| 81 | Analytics & Growth | Coach business dashboard | 5/10 | implemented_unverified | Some metrics derive from loaded rows, but there is no durable aggregate or historical comparison layer. |
| 82 | Analytics & Growth | Revenue, occupancy & retention analytics | 3/10 | demo_only | Metrics are in-memory or sample and cannot be reproduced consistently across sessions. |
| 83 | Analytics & Growth | Demand, funnel & price insights | 2/10 | demo_only | Demand and funnel figures are disclosed samples; only price position can derive from live catalogue data. |
| 84 | Analytics & Growth | Reviews, referrals & growth loops | 4/10 | implemented_unverified | Coach review reads are real, but web review writes are local and referral credit is not live. |
| 85 | Onboarding & Migration | Coach onboarding & activation | 5/10 | implemented_unverified | Profile fields persist, but service drafts, onboarding state, and background-vendor activation are incomplete. |
| 86 | Onboarding & Migration | Client import & family invites | 3/10 | implemented_unverified | The UI posts without awaiting per-row results, while the invite schema and delivery state are not proven live. |
| 87 | Onboarding & Migration | Organization / legacy-system migration | 0/10 | absent | There is no CSV mapper, dry-run importer, reconciliation report, or rollback path. |

## Confidence and catalogue provenance

Confidence is high on the implemented Getting Started behavior, deterministic checks, full smoke result, dedicated-agent output, and named production trust finding. Confidence is medium on several feature-level production classifications because authenticated Stripe MCP, authenticated Supabase MCP, cross-account RLS tests, real-device notifications, and complete money-path evidence were unavailable.

The original historical audit had canonical names through feature 34. Features 35–87 were reconstructed from the current repository's product vocabulary and then rated against current source, docs, tests, and runtime evidence; use their labels as the maintained catalogue going forward, not as proof that an older canonical list used identical wording.

## Release status

The repository is updated locally, but this change set is intentionally not pushed or deployed while the critical trust stop condition is open. The release can resume after a bounded authorization to fix the verification gate, a passing production regression, a fresh full smoke run, and the normal GitHub/Vercel release evidence.
