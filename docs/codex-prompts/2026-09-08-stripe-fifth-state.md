# Codex prompt — Stripe "restricted" (fifth) connect state

Copy everything below the line into Codex. Codex has the Stripe key; Claude does not.

---

MODE: implement. Repo: the-sporve-web. Read AGENTS.md first, claim files with
`python3 .claude/hooks/clo-sync.py begin codex "stripe fifth state" <files>`.

**Problem.** `providers` stores only `stripe_account_id`, `stripe_charges_enabled`,
`stripe_onboarding_started`. The product therefore knows four states (not started /
started / charges enabled / not enabled) and cannot tell "Stripe is still reviewing"
from "Stripe RESTRICTED this account and needs a document". A restricted director
sees "Stripe not connected — billing drafts are held" forever with no reason.

**Build, in this order, all behind PRs (never push to main):**

1. Migration `supabase/migrations/<ts>_stripe_account_state.sql` — RED, draft it in
   `docs/red-drafts/` and DO NOT apply; the owner applies:
   - `providers.stripe_payouts_enabled boolean not null default false`
   - `providers.stripe_disabled_reason text` (Stripe's `requirements.disabled_reason`)
   - `providers.stripe_requirements_due text[] not null default '{}'`
     (`requirements.currently_due` ∪ `requirements.past_due`)
   - `providers.stripe_state_synced_at timestamptz`
   - column-scoped grants: these four are NOT in the anon column grant (001036).
2. `supabase/functions/stripe-webhook/index.ts` — handle `account.updated`
   (signature-verified like every other event; idempotent via
   `payment_event_ledger` on `event.id`). Stripe does not guarantee delivery
   order, so do NOT trust the event snapshot: on receipt call
   `stripe.accounts.retrieve(event.account)` and write the four columns from
   the retrieved account (`requirements.currently_due ?? []` ∪
   `requirements.past_due ?? []` — both can be null), with
   `stripe_state_synced_at = now()` set by the function on every successful
   write. Also `account.application.deauthorized` → resolve the provider by
   `event.account` (NOT `event.data.object`, which is the application) and set
   `stripe_charges_enabled=false, stripe_payouts_enabled=false,
   stripe_disabled_reason='deauthorized', stripe_state_synced_at=now()`.
   Add `account.updated` and `account.application.deauthorized` to the
   Connect endpoint's enabled events in the Stripe dashboard and say so in the
   PR body with the endpoint id.
3. `supabase/functions/stripe-connect-onboarding/index.ts` step 3 (the
   "ALWAYS write charges_enabled back" block): write the same four columns from
   the retrieved account, so the return-from-Stripe path and the webhook agree.
4. Web client `src/sporve-web.host.html` — the one place that decides the
   status pill (search `pv.stripe_charges_enabled`, ~lines 10952, 12245, 13696,
   19413): derive a five-way state
   `none | started | pending | restricted | active`, evaluated in this order
   with null-safe predicates:
   `active = stripe_charges_enabled === true`;
   `pending = disabled_reason === 'requirements.pending_verification' || disabled_reason === 'under_review'`
   (Stripe is reviewing, nothing to do — check this BEFORE restricted);
   `restricted = typeof disabled_reason === 'string' && disabled_reason.startsWith('requirements')`
   (also treat `'deauthorized'` as restricted with body "Sporv was disconnected in Stripe");
   `started = !!stripe_onboarding_started`; else `none`.
   Also fix the checklist consumer at ~line 10952: `pp.stripeAccountId && !S.coachProvider`
   currently counts "Connect payouts" as done — it must require the server's
   `stripe_charges_enabled === true` like every other consumer.
   Copy, exactly (Roboto Condensed labels, Inter body, no icons, no emoji):
   - restricted pill: **RESTRICTED** — body "Stripe needs: <requirements_due joined by ', '>.
     Finish in Stripe to enable charges." Button: "Open Stripe" → existing
     dashboard link.
   - pending pill: **IN REVIEW** — "Stripe is reviewing your account. Nothing to do."
   - honesty rule: show `stripe_state_synced_at` as "as of <time>"; never say
     "active" unless `stripe_charges_enabled` is true from the server.
5. Verification in the PR body: use the Stripe CLI
   `stripe trigger account.updated` AND
   `stripe trigger --stripe-account <CONNECTED_ACCOUNT_ID> account.application.deauthorized`
   against the test Connect endpoint; paste both webhook log lines and the
   resulting `providers` row (id, four columns, `stripe_state_synced_at`).
   `bash src/smoke.sh` must exit 0.

Do not touch: platform fee logic, `apply_stripe_booking_event`, any RLS beyond the
column grants above, the agent generators.
