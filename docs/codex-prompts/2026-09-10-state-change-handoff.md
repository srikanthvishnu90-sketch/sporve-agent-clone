# Codex handoff — what changed in production on 10 September

**Read this before continuing Prompt 1.** Your progress record
(`docs/decisions/launch-prompt-set-progress.md`) says *"legacy catalog keys and
the payment-ledger defect remain in production per the last database reads"*.
The second half of that is no longer true, and two other blockers you were
holding for are also gone. Everything below was applied and verified against
`tseszaprvtvqrkfpditu` today, by Claude, with the owner's explicit authorisation.

---

## 1. The payment-ledger defect is FIXED

`20260910_001040_ledger_insert_once` is applied. This was your objection,
correctly made, and the repair is the one you argued for: the trigger is
untouched and the callers changed.

- `trg_ledger_append_only` — **unchanged and still armed**. Every ledger UPDATE
  and DELETE is still denied and inserted rows stay byte-identical.
- `apply_stripe_booking_event` — now **one** overload. The legacy nine-argument
  version is dropped, so positional calls are no longer ambiguous.
- Both money RPCs now take `pg_advisory_xact_lock(hashtextextended(p_event_id, 0))`,
  check for an existing `stripe_event_id` before any write, and insert the
  ledger row **once** with its final outcome.

Proof, run in production inside a block that raised at the end to roll itself
back: first delivery returned `applied:pro/active`, the redelivery returned
`duplicate`, exactly **one** ledger row was written, and no UPDATE was attempted
so the strict trigger never fired. Post-state: ledger back to its original 5
rows, zero proof rows, zero proof subscriptions.

**What this unblocks for you:** Prompt 1's test-mode acceptance no longer has to
work around a broken ledger, and any statement that production still carries the
defect should be corrected in your tracker.

## 2. Prices are CONFIRMED

The owner confirmed on 10 September:

| plan | monthly | annual |
|---|---|---|
| Solo | **$49** | **$490** |
| Organization | from **$199** | from **$1,990** |

Annual is two months free (`annual_paid_months: 10`), matching what your config
already encodes.

`supabase/functions/_shared/billing-pricing.json` is **your uncommitted file** —
I deliberately did not touch it. Flip `"confirmed": false` to `true` yourself.
Until you do, Checkout keeps refusing unconfirmed prices and the entitlement
drafts land inert.

## 3. `plan_entitlements.connectors` now exists in production

`20260910_001039_plan_entitlements_connectors` added the column and seeded it:

| plan | connectors |
|---|---|
| `free` | website, file_import, stripe |
| `pro` | + gmail, google_calendar, sms |
| `enterprise` | + microsoft365, google_sheets, google_drive, quickbooks, google_business_profile |

**It does not rename the plan keys.** Production still carries the baseline's
`free | pro | enterprise`; the constitution's `free | solo | organization`
rename is still yours, and still ships with your caller cutover. The column was
added with `add column if not exists`, so
`2026-09-08-plan-entitlements.sql` still applies cleanly on top — check that
assumption before you promote it, since I have not run your draft against the
new column.

## 4. The connector spine is live

`20260909_001037_org_connectors` and `20260909_001038_connector_oauth_and_vault`
are applied. `org_connectors`, `connector_sync_state`, `connector_oauth_state`,
and the four service-role-only Vault wrappers
(`connector_claim_oauth_state`, `connector_store_secret`, `connector_read_secret`,
`connector_forget_secret`). RLS enabled and forced; `anon` and `authenticated`
hold no execute on any of the four.

Three edge functions are deployed: `google-oauth-start`, `google-oauth-callback`,
`connectors-available`. Google OAuth client credentials are in Supabase function
secrets as `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.

**Relevant to your work:** `google-oauth-start` is the first real 402 in the
product. It reads `plan_entitlements.connectors` and returns the I3 payload
(`reason`, `current_plan`, `upgrade_to`, `limit`, `current`) for a plan that does
not carry the connector. If your entitlement guards change how that column is
read, that function is a caller you need to account for.

## 5. Live security evidence for Prompt 4

Queried directly today, so you do not have to re-derive it:

| check | result |
|---|---|
| `public` tables with `rowsecurity = false` | **0** |
| `anon` grants on `public.programs` | 7 — `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` |
| `anon` write **policies** on `programs` | **none** — all three write policies are `{authenticated}` |
| unauthenticated REST INSERT into `programs` | did not succeed |
| `programs_select_public` | `{public}` role, `status = 'published'`, **all columns** |
| published programs today | **0** |
| `anon` policy on `organization_members` | present |
| policies re-evaluating a bare `auth.uid()` per row | **95** |

Read that carefully: the `anon` write grants are a **latent** hazard, not an open
door — RLS denies them today. The coordinate leak in `programs_select_public` is
real but currently has nothing to leak, because no club has published a program.
It becomes live on the first published program. `2026-09-08-pentest-hardening.sql`
remains unapplied.

## 6. What you still need, and only the owner can give

1. **A restricted Stripe TEST key** in Supabase function secrets. This is the
   one blocker I cannot clear for you — it gates Prompt 1's test-mode acceptance
   and Prompt 6's real-payment gate. `STRIPE_SECRET_KEY` exists but dates from
   21 June and its mode is unverified. Ask for a restricted test key stored as a
   secret, never in chat or Git.
2. **Browser verification**, which your notes list as incomplete. It works here:
   Playwright with Chromium drives `https://sporv1.vercel.app` (the deployment
   alias, not `sporv.ai`, which returns a bot challenge to command-line clients).
   Set app state directly — `S` and `render()` are reachable from
   `page.evaluate` because the built page's top-level `const` lives in the
   global lexical scope. `bash src/smoke.sh` does the same thing and passes.

## 7. Two facts about the environment that cost time to learn

- **Production deploys from the MIRROR.** Merging into `sporve-web` ships
  nothing; Vercel watches `srikanthvishnu90-sketch/sporve-agent-clone`. Use
  `bash tools/deploy-prod.sh`, which now fails loudly instead of printing LIVE
  when the mirror push fails.
- **`sporv.ai` returns HTTP 403 with a challenge token to curl.** That is a bot
  challenge a browser clears in about a second, not an outage. Read build stamps
  from `https://sporv1.vercel.app` when a script needs them.

---

## Current migration head

`20260910_001040_ledger_insert_once`. Applied today, in order:
`001037_org_connectors`, `001038_connector_oauth_and_vault`,
`001039_plan_entitlements_connectors`, `001040_ledger_insert_once`.

`docs/red-drafts/APPLY-ORDER.md` is the reconciled queue — eleven of the
twenty-four draft files there are already applied or dead, and it names which.
Do not apply in directory order.
