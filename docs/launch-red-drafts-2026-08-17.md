# RED-tier drafts for the owner — 2026-08-17 launch audit

These two changes touch production auth/trust data, so per the autonomy mandate
they are DRAFTED here for you to run by hand, not applied by the agent.

---

## DRAFT 1 — Data hygiene: de-verify seed/test providers (RED: trust columns)

The audit found seed/test providers that are `status='approved'` and
`verification_status='verified'` while `background_check_status='none'` — a
trust-column falsehood that renders to anonymous visitors. Plus internal
BILLING GAUNTLET test rows I created while proving the payment pipeline.

**Inspect first (read-only):**
```sql
select id, business_name, status, verification_status, background_check_status
from public.providers
where business_name in ('Test Academy','Tiny Toes FC')
   or business_name ilike 'BILLING GAUNTLET%';
```

**Option A — de-verify (keep the rows, make them honest):**
```sql
update public.providers
   set verification_status = 'unverified'
 where verification_status = 'verified'
   and background_check_status = 'none';   -- catches every unbacked 'verified'
```
Note: `verification_status` is frozen by `enforce_provider_trust` on the REST
path, but this UPDATE runs as you (service role / SQL) which the trigger allows.

**Option B — delete the internal gauntlet test rows (mine, safe to remove):**
```sql
-- children first if any FK blocks; these rows have no bookings/programs.
delete from public.providers where business_name ilike 'BILLING GAUNTLET%';
```

Recommended: run Option A now (makes the public catalog honest), and Option B
to clean my test rows. Decide separately whether Test Academy / Tiny Toes FC
should be deleted entirely or kept as de-verified demo.

---

## DRAFT 2 — Fix the plan-progress-sweep cron 401 (RED: edge-function auth)

The only REAL FAIL left on `check_production_invariants()` is:
`ops · cron HTTP calls are succeeding · FAIL · plan-progress-sweep=401`.

**Cause:** `public.invoke_plan_progress_sweep()` POSTs to the `plan-progress`
edge function with `Authorization: Bearer <cron_secret>`. But `plan-progress`
is deployed with `verify_jwt = true`, so the Supabase gateway rejects the raw
cron secret (it isn't a JWT) with `UNAUTHORIZED_INVALID_JWT_FORMAT` before the
function even runs.

**Fix (matches the other lifecycle crons):** redeploy `plan-progress` with
`--no-verify-jwt` and have it validate the shared `cron_secret` in its own
handler (the same pattern `stripe-webhook` uses for its signature). Steps:
1. In `~/SportsMan-main/supabase/functions/plan-progress/index.ts`, add at the
   top of the handler:
   ```ts
   const secret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
   if (secret !== Deno.env.get("CRON_SECRET")) {
     return new Response("unauthorized", { status: 401 });
   }
   ```
   and ensure `CRON_SECRET` (Edge Function secret) equals the vault `cron_secret`.
2. Redeploy: `supabase functions deploy plan-progress --no-verify-jwt`.

This is auth-surface + a redeploy, so it's yours to apply. Once done, the
invariant flips to PASS and the alarm is fully clean.

Note: this cron only fires when `development_plans` exist (currently ~none), so
it is not actively harming anything today — but it is the last false-looking red
on your production alarm, so worth closing before launch.
