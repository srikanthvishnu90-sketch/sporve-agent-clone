# RED — attendance table (owner-applied). Drafted 2026-08-25 (Feature 5).

This is the ONE owner step for AI attendance (app PR #44). Everything else —
the `mark_attendance`/`get_attendance` tools and the Flutter rail — is code in
PR #44 and goes live the moment you merge + deploy the app. But the table it
writes to must exist first, or an approved "mark Ava present" returns "that
didn't save".

The full migration is already written in the app repo at
`~/SportsMan-main/supabase/migrations/20260825_000300_session_attendance.sql`
(committed in PR #44, but NOT auto-applied). It creates a lightweight, PII-free
`session_attendance` table and a `mark_attendance()` RPC — deliberately NOT
reusing `camp_checkins`, which carries minors' emergency/medical data.

### Exact steps to apply to production
1. Open https://supabase.com/dashboard/project/tseszaprvtvqrkfpditu/sql/new
2. Open `~/SportsMan-main/supabase/migrations/20260825_000300_session_attendance.sql`,
   copy its ENTIRE contents, paste into the SQL editor.
3. Click **Run**. It creates one table + one function; no data migration, no lock.
4. Verify — run:
   ```sql
   select tablename, policyname, qual from pg_policies where tablename = 'session_attendance';
   ```
   The single policy's `qual` must reference `providers` / `auth.uid()` (coach-owner
   read); there is deliberately NO client insert/update policy — writes go only
   through the RPC.
5. Sanity-check the RPC rejects a foreign booking (optional): as a coach, call
   `select public.mark_attendance('<a booking you do NOT own>','2026-08-25','present');`
   → it must raise `not your booking`.

### Order with the other RED items
This is independent of the review-integrity SQL (`docs/security/…`) and the gym
infra (`docs/red-drafts/2026-08-25-gym-rental-infra.md`). Priority order stays:
1. review-integrity (HIGH security), 2. this attendance table (unblocks PR #44),
3. gym infra (Parts A + B).
