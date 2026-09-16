# 2026-09-16 — the booking safety gate cleared an organization when one member was cleared

**Window:** from the baseline's `provider_safety_cleared()` (before 2026-08-31) → migration `20260915_001064` (a file until the owner applies it).
**Impact:** none realised. **Zero live rows** carried a background check on 2026-09-16 (`background_check` did not exist; no vendor was integrated; `staff_certifications` was empty), so no person was ever exposed. The *shape* was a safety defect, not a display bug: for `provider_type='organization'` the function returned true if **any one** active member had `background_check_status='verified'`, and the booking trigger called it with the organization only — one cleared director would have cleared every uncleared trainer on the roster for booking.
**Detected by:** the spec 16.1 thesis pass (read-only) reading `provider_safety_cleared()` and `enforce_booking_provider_verified()` in `supabase/migrations/00000000000000_baseline.sql`.

## Timeline
- ≤2026-08-31 — org-level clearance shipped in the baseline.
- 2026-09-16 — found during the 16.1 audit; reproduced in `docs/red-drafts/2026-09-16-spec16-badge-integrity.test.sql` (a booking for a session run by an unchecked trainer is accepted because the director is verified); fixed in `20260915_001064`: clearance is per person — the assigned member of the session or program, never the org; nobody assigned → no booking.

## Cause
The check was modelled as a column on the organization's members, and the gate asked "is anyone in this org cleared?" instead of "is the person running this session cleared?". There was also no record of a check as a thing — only a status column any service-role caller could set.

## What we changed
- `background_check`: one row per check, per person (`organization_members.id`), status and dates only.
- `provider_safety_cleared(provider, member)`; the one-argument form clears only a solo provider, never an organization.
- `background_check_status` is a strictly derived mirror with exactly one writer; a guard trigger rejects every other write, service_role included.
- Vendor webhook skeleton fails closed: unconfigured means no result can be recorded.

## What would have caught it sooner
A fixture that books a session run by an unchecked person in an org with one cleared member. It exists now and runs on every PR.
