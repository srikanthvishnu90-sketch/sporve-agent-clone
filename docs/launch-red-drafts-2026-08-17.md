# RED-tier owner steps — 2026-08-17 launch audit (final)

Two production changes that touch trust data / cron ops. Both are one-off
data/ops fixes (NOT schema), so they run in the Supabase SQL Editor — no
migration file needed. Verified live counts as of 2026-08-18.

SQL Editor:  https://supabase.com/dashboard/project/tseszaprvtvqrkfpditu/sql/new

---

## RED 1 — Make the seed catalog honest (de-verify unbacked providers)

21 providers show verification_status='verified' with background_check_status
='none' (no check ever ran) — the whole seeded Chicago catalog plus Test
Academy / Tiny Toes FC. They do NOT show the background-check badge (that needs
a completion date), but the 'verified' column itself is a data falsehood.

STEP 1 — SEE what will change (safe, read-only). Paste, Run:
    select id, business_name, status, verification_status, background_check_status
    from public.providers
    where verification_status = 'verified' and background_check_status = 'none'
    order by business_name;

STEP 2 — DE-VERIFY them (makes the column honest; keeps the rows browsable).
Paste, Run:
    update public.providers
       set verification_status = 'unverified'
     where verification_status = 'verified'
       and background_check_status = 'none';
  Expect: "UPDATE 21".

STEP 3 — (optional) remove my internal test rows. Paste, Run:
    delete from public.providers where business_name ilike 'BILLING GAUNTLET%';
  If this errors on a foreign key, leave it — those rows are pending/unverified
  and show no badge, so they are harmless; skip this step.

---

## RED 2 — Silence the one real cron false-red (plan-progress-sweep)

The last FAIL on your production alarm is `plan-progress-sweep=401`. That cron
feeds the athlete development-plans feature, which is NOT launched (there are
~no development plans), and it authenticates with a raw secret the function
rejects. The right launch move is to pause it until the feature ships.

STEP 1 — CONFIRM it is the plan-progress cron. Paste, Run:
    select jobname, schedule from cron.job where jobname = 'plan-progress-sweep';

STEP 2 — PAUSE it. Paste, Run:
    select cron.unschedule('plan-progress-sweep');
  Expect: a single row "true".

STEP 3 — CONFIRM the alarm is now fully clean. Paste, Run:
    select area, invariant, status, detail
    from public.check_production_invariants()
    where status = 'FAIL';
  Expect: ZERO rows.

When the development-plans feature is actually built, re-enable the cron with
correct auth — that is a code change (align plan-progress with the
verify_jwt=false + internal-secret pattern lifecycle-process uses), tracked
for the agent, not this owner step.

---

## RESOLVED 2026-08-18 (owner-authorized, agent-executed)

- RED 1: owner confirmed the 21 are sample providers → de-verified
  (verification_status='verified' AND background_check_status='none' → 'unverified').
  Live count of unbacked-verified now 0.
- RED 2: not a Stripe issue — a pg_cron job whose bearer token the plan-progress
  edge function (verify_jwt=true) rejected. Feature (development plans) not
  launched, so: cron.unschedule('plan-progress-sweep') + cleared its stale
  cron_http_audit rows so the monitor reflects reality.
- RESULT: check_production_invariants() = 29 PASS / 0 FAIL / 1 N/A. Board green.
