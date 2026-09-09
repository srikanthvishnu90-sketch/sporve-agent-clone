# Owner list — what only you can do (as of 2026-09-08 evening)

Everything on my side of the launch list is merged and live. Each item below
needs your hands, your account, or your decision. Exact clicks; nothing vague.

## A. Say the word and I run it

0. **"apply the ledger fix"** — FIRST, before anything with money. Robin found
   (and I confirmed in prod) that the append-only ledger trigger I applied on
   2026-09-07 blocks the payment RPCs' own status promotion, so today any Stripe
   payment event would fail and retry for 3 days. No customer hit it (no events
   since 09-01). The fix is `docs/red-drafts/2026-09-08-ledger-promotion-fix.sql`;
   verdict and proof in `docs/robin-2026-09-08.md`.
1. **"apply the red drafts"** — seven SQL files in `docs/red-drafts/2026-09-08-*.sql`.
   I apply each through the Supabase migration ledger, run the verification
   written at the top of each file, and mirror it into `supabase/migrations/`.
   Order: `pentest-hardening` (closes the exact-coordinate leak on `programs`),
   `anon-definer-revoke`, `generator-targeting` (then the golden set goes 19/19),
   `performance-advisors` (dry-run first), `invite-creates-guardian`,
   `treasurer-role`, `rate-limit-gc`.
2. **"delete the eval org"** — right before real pilots: the golden-set org
   `ae9f8097-fa09-4f5e-8019-c5ea76aefa8a` is an approved provider visible to
   anyone who lists approved providers. It has no programs and cannot be booked.

## B. Supabase dashboard (project `tseszaprvtvqrkfpditu`)

3. **Leaked-password check** — https://supabase.com/dashboard/project/tseszaprvtvqrkfpditu/auth/providers
   → **Email** → switch on **Prevent use of leaked passwords** → **Save**.
   (My API call to flip it was blocked by the permission classifier.)
4. **Point-in-time recovery** — https://supabase.com/dashboard/project/tseszaprvtvqrkfpditu/settings/addons
   → **Point in Time Recovery** → **Enable**. Paid add-on (~$100/mo). Today
   only daily backups exist; before the first real charge you want minute-level restore.

## C. Codex (paste this tomorrow)

5. **Stripe fifth state ("restricted")** — Codex has the Stripe key, I do not.
   The full prompt is in section F below; copy everything under its line.

## D. Stripe (dashboard.stripe.com)

6. **Live mode** — Settings → Business details: legal entity, EIN, bank account;
   then **Developers → API keys** (live) → paste the live secret and webhook
   signing secret into Supabase Edge Function secrets (I give the exact
   `supabase secrets set` command when you have them).
7. **Connect webhook events** — Developers → Webhooks → the Connect endpoint →
   **Add events**: `account.updated`, `account.application.deauthorized`
   (Codex's item 5 needs these on).
8. **First real charge** — a real card on a real club's dues, after 6 and 7.

## E. Accounts, legal, and rulings

9. **Twilio** — after A2P 10DLC approval, send me: Account SID, Auth Token,
   Messaging Service SID, the Sporv number. (SMS is signup-only for now.)
10. **Google sign-in** — https://console.cloud.google.com → APIs & Services →
    Credentials → **Create OAuth client ID** (Web) → Authorized redirect URI:
    `https://tseszaprvtvqrkfpditu.supabase.co/auth/v1/callback` → send me the
    Client ID + secret.
11. **Resend** — https://resend.com/api-keys → delete the key named `claude-read`
    (no longer used).
12. **COPPA / Terms / Privacy** — a lawyer's pass on `docs/legal/` before a real
    family signs a waiver through Sporv.
13. **First real club** — one director willing to run `docs/pilot-checklist.md`
    Pilot A with their real roster.
14. **Docker Desktop** — install from https://www.docker.com/products/docker-desktop/
    and open it once; that unlocks the G1 database dump and the Strix scan.
15. **HSTS preload** — https://hstspreload.org → enter `sporv.ai` → **Submit**.
    The header is already correct; this puts the domain on the browser
    hard-coded HTTPS list.
16. **Three onboarding rulings still open** — (a) keep the password field on
    the gate or go magic-link only; (b) require an email-verify interstitial
    before the wizard, or keep today's instant entry; (c) real URL routes
    (`/onboarding/roster`) or keep the single-page state machine.
17. **GitHub branch protection is now ON for `main`** (set today): every change
    needs a PR and green `smoke` + `security-regressions`. If you ever need to
    push straight to `main` yourself, tell me and I lift it for that push.
18. **Site reader (club-site-extract v13) — two optional keys and one ruling.**
    The reader now crawls a club's public site (landing + up to 5 pages that look
    like teams / fees / registration / schedule), renders JavaScript-only pages
    through Jina Reader, and returns teams, programs, fees with evidence quotes,
    contact, and a "gaps" list. It works today with no keys.
    - Optional: a **Jina API key** (https://jina.ai → API key) raises the
      renderer's rate limit — send it and I set `JINA_API_KEY` on the function.
    - Optional, stronger: a **Firecrawl key** (https://firecrawl.dev) if pilots
      hit sites Jina cannot render — I would add it as a second renderer.
    - **Ruling needed — pages behind a login.** I will not build anything that
      reads pages a user is not authorized to see; that is unlawful access, not
      scraping. For a director's OWN portal (TeamSnap, SportsEngine, LeagueApps)
      the legitimate paths are: their CSV export → the roster import wizard
      (exists today), or an official API connection they authorize (TeamSnap
      has OAuth). Tell me which portals the first pilots use and I build that
      connector first.

## F. The Codex prompt (verbatim copy of `docs/codex-prompts/2026-09-08-stripe-fifth-state.md`)

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
