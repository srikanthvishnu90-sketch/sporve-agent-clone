# Sporve Enterprise (AAU/Travel) — grounded audit + build roadmap

Source: the 555-item AAU/travel problem inventory + Verification Packs A/B (2026-08-21).
This is the ranked build order for the enterprise product — built **slowly, one safe
slice per session**, highest-leverage-first. It is NOT a 555-feature build list; the
inventory itself warns a solo founder building 555 solutions dies. The wedge is the
depth TeamSnap/SportsEngine ignore: **trust/compliance, money transparency,
communication accountability.**

## What is LIVE in prod (verified 2026-08-21, project tseszaprvtvqrkfpditu)

| Capability | Table(s) live | Notes |
|---|---|---|
| **Background-check gate** | `providers` (31 rows) + universal bg-check gate + date invariant + invariant board | The wedge. Auditable now. |
| **Multi-team membership** | `organization_members` (RLS on, 7 policies) | Carries `background_check_status/_completed_at/_reference`, `role`, `is_active`, `commission_*`. Corrects the stale D3 note — it IS applied. |
| **Messaging** | `conversations` (3 policies) + `messages` (2) | Real. Basis for comms accountability. |
| **Subscriptions** | `billing_subscriptions` | 3 tiers live. |

## What is GAP (authored-not-applied, or web-prose-only)

- **NOT in prod** (authored on SportsMan-main `main`, not applied): `camp_roster`,
  `camp_checkins`, `team_blocks`, `split_pay_links`, `org_services`, `shared_inbox`,
  `coach_invoices`, `commission_rates`, `recurring_bookings`.
- **Web enterprise = marketing prose** (`mod-productpages.js:426-554`, every node
  `data-prose`, zero CRUD); the Enterprise plan is shipped-OFF
  (`mod-coachaccount.js:116-148`, `workspace_enabled=false`, "$149/mo, in development").
- **Pure GAP domains** (discovery/roadmap, not audit targets): tryouts, tournaments,
  travel, fundraising, uniforms, volunteers/duty-roster, governance/multi-team,
  recruiting, facilities, lifecycle.

## Build order — ranked by inventory-issues-resolved × leverage × safety

1. **Org compliance board** (inventory 311–345, esp. #345 "one click: is every adult
   cleared?"). Builds on LIVE `organization_members` + bg-check gate. Lowest risk.
   - ✅ **Slice 1 SHIPPED 2026-08-21:** `hydrateOrgCompliance()` reads real
     `organization_members` (RLS-scoped), fail-closed clearance (`orgMemberCleared`:
     verified **and** dated only), feeds the enterprise-compliance board real
     "N of M cleared" for a signed-in org admin; guests keep the labelled sample.
     smoke tripwire guards the fail-closed rule (S0 if it opens).
   - ✅ **Slice 2 SHIPPED 2026-08-22:** background-check EXPIRY awareness from the
     live `background_check_completed_at` (no new schema). `orgMemberStatus()` derives
     clear / expiring (≤30d) / expired / pending / none; an expired check no longer
     reads as cleared (gate tightened). Board shows per-staff Expiring·Nd / Expired
     badges + a "Re-run needed" count. smoke tripwire extended (relative dates) to
     prove expired/pending/undated never read cleared (S0). Resolves #33/#316/#345.
     Cert/waiver expiry proper (separate docs) waits on a cert/waiver table (GAP).
   - ✅ **Slice 3-web SHIPPED 2026-08-22 (build a10ba132):** enterprise OVERVIEW
     board shows real staff count + clearance % for a signed-in org admin.
   - ✅ **Slice 4 APPLIED to prod 2026-08-22:** `staff_certifications` table (FK →
     providers, RLS mirrors organization_members: is_org_admin manages, member reads
     self, no public/USING(true)). Verified RLS on, invariant board 0 FAIL. PR #34.
   - ✅ **Slice 5 SHIPPED 2026-08-22 (build e196fed3):** `hydrateStaffCerts()` reads
     the live `staff_certifications` table; `certState()`/`certValid()` fail-closed
     (verified AND non-expired only); compliance board shows a "Certs / waivers:
     N current · M exp. · K expired" line for a signed-in org admin (off when the
     table is empty). smoke tripwire guards it (S0). Resolves #313/#316/#323.
   - ✅ **Slice 6 SHIPPED 2026-08-22 (build 304f4e32):** the cert WRITE path.
     RLS trust-hardened (applied to prod): the admin policy `with_check` now forbids
     a client writing `status='verified'` — only service_role (a vendor/attestation
     process) can, so a director cannot self-clear. Web: a "Record a certification"
     form on the compliance page for a signed-in org admin (member · kind · expiry →
     inserts as `pending`, re-hydrates the board). Verified RLS + invariant board 0 FAIL.
   - ✅ **Slice 7 SHIPPED (draft) 2026-08-22:** the cert VERIFICATION path —
     `staff-cert-webhook` edge function (sporve-app PR #35), the ONLY route to a
     'verified' cert (service_role, bypasses the RLS block). Secret-auth
     (CERT_WEBHOOK_SECRET, constant-time), verified|revoked decisions, fail-closed.
     NOT deployed — owner deploys + sets the secret; no cert vendor wired yet, so it
     completes the loop architecturally and waits.
   - ▶ **Slice 8 (deferred with reason):** extend the bg-check gate to org staff in
     bookable SUPPLY. Deferred because the org-supply/staffing tables (`org_services`)
     are authored-not-applied on prod — gating a flow that isn't live is premature.
     Revisit when org-supply lands; the live booking path is already gated.
2. **Club money transparency** (201–240). `split_pay_links` + `coach_invoices` +
   `commission_rates` are authored on SportsMan-main. RED-set (Stripe) — apply +
   audit as drafts the owner deploys. Family ledger, itemized dues, per-team P&L.
3. **Communication accountability** (161–200). `shared_inbox` over live
   `conversations`/`messages`: roster-derived membership, must-acknowledge,
   announcement-mode (replies-off), two-deep (no 1:1 coach↔minor) — the last is
   TRUST-CRITICAL and already partly guarded.
4. **Roster/eligibility depth** (31–60): document vault, AAU membership expiry,
   dual-roster guard, audit trail. `organization_members` is the anchor.
5. **Roadmap-only (discovery, no build yet):** tryouts (1–30), tournaments/travel
   (96–160), volunteers/uniforms (266–310), fundraising (241–265), governance
   (431–460), recruiting (376–405), facilities (461–480), lifecycle (506–530).

## Rules for every enterprise slice

- Audit-only on backend/RLS/Stripe: log defects, draft fixes, never self-apply (RED).
- Trust displays (bg-check, clearance) FAIL CLOSED and show server-verified state only.
- Features/schema = YELLOW: branch → smoke → PR → owner merges → verify live.
- One slice per session; update this file's "SHIPPED/next" markers each time.
