# robin review — Codex Prompt 1 handoff (2026-09-08)

Codex asked robin for three things: run the tests its sandbox blocked, review
the entitlement migration, and handle the release. All three are below. The
migration is **NOT applied** and the billing function is **NOT deployed** —
Codex was right that callers must change first, and this names them.

## 1. Blocked tests — now executed here

| check | Codex | robin (this machine) |
|---|---|---|
| `bash src/smoke.sh` | FAIL — Chromium SIGTRAP / kill EPERM, 22 assertions never ran | **PASS, exit 0**, 79 assertions incl. every browser route |
| `docs/red-drafts/2026-09-08-plan-entitlements.test.sql` | never executed — `shmget` EPERM, no cluster | **PASS, exit 0** — 4 assertion groups: catalog/prices/legacy preservation/data-only edits/trial expiry; owner read + cross-org denial + self-upgrade denial; active-staff read + inactive denial; JWT-free cron resolver |
| `node --test supabase/functions/billing-webhook/handler.test.mjs` | 11/11 pass | **11/11 pass**, reproduced |

**How to start PostgreSQL in a restricted sandbox** (Codex's `shmget` failure is
System V shared memory; Postgres can be told to use `mmap` instead, and the
socket path must stay under 103 bytes):

```sh
export PGDATA=/tmp/sporvpg SOCK=$HOME/.sporv-pgsock
rm -rf "$PGDATA" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$PGDATA" -U postgres --auth=trust \
  -c shared_memory_type=mmap -c dynamic_shared_memory_type=posix
pg_ctl -D "$PGDATA" -l /tmp/sporvpg.log \
  -o "-c shared_memory_type=mmap -c dynamic_shared_memory_type=posix -c listen_addresses='' -k $SOCK" start
createdb -h "$SOCK" -U postgres sporv_entitlement_fixture
psql -X -h "$SOCK" -U postgres -v ON_ERROR_STOP=1 \
  -d sporv_entitlement_fixture -f docs/red-drafts/2026-09-08-plan-entitlements.test.sql
pg_ctl -D "$PGDATA" stop           # cluster is disposable; delete $PGDATA after
```

Postgres 16 and 17 are both installed (Homebrew). Playwright's Chromium launches
fine outside Codex's sandbox, so the SIGTRAP is environmental, not a repo defect.

## 2. Migration review — sound, with four things to fix before it is applied

The draft is careful work: it refuses ambiguous legacy keys in a preflight,
renames rather than deletes, keeps every limit in data (`-1` = unlimited, never
null), assigns entitlements per provider with a revision, and resolves expiry at
request time instead of trusting a cron. The fixture proves RLS, cross-tenant
denial and self-upgrade denial. No Stripe price IDs were invented. Approved in
shape.

Four corrections, in order of blast radius:

1. **`apply_stripe_billing_event` breaks the moment the rename lands.** It reads
   `if p_plan in ('pro','enterprise') then v_new_plan := p_plan`. After the
   migration `providers.plan` only accepts `free|solo|organization`, so a
   subscription event carrying `pro` violates the CHECK, the RPC raises, the
   webhook returns 500 and Stripe retries for three days; an event carrying
   `solo` returns `ignored_bad_plan` and never projects. This RPC must be
   updated in the same transaction as the rename, or billing is dead either way.
2. **`check_production_invariants` goes silently green.** Its paid-without-
   subscription check is `pv.plan in ('pro','enterprise')`, which matches nothing
   after the rename. The hourly `production-invariants` cron would report health
   while missing exactly the condition it exists to catch. Same-transaction fix.
3. **`consume_ai_quota` changes limits without anyone asking.** It reads
   `plan_entitlements.ai_monthly_quota`, and the new legacy-sync trigger sets
   that from `ask_quota_month` — so Free goes from 3 to 25 AI calls a month, and
   `seat_limit` for the renamed `solo` row drops from 3 to 1 (`admin_cap`).
   Either point `consume_ai_quota` at `ask_quota_month` directly, or make the
   trigger preserve today's values. Do not ship a silent quota change.
4. **`plan_entitlements` still grants `anon` and `authenticated` table-level
   INSERT/UPDATE/DELETE** (only RLS, with a SELECT-only policy, stops them).
   Writes fail closed today, but the grant is wrong and one permissive policy
   would open the price list to edits. Revoke it in the same migration:
   `revoke insert, update, delete, truncate, references, trigger on public.plan_entitlements from anon, authenticated;`

Lower priority: `resolve_provider_entitlements_internal` uses `select … into
strict`, so a provider with no assignment row raises instead of falling back to
Free — fail-closed, but it surfaces as a broken page rather than a thin plan.
Consider `into` plus an explicit Free fallback.

## 3. Client and function cutover list (the "callers still need updating")

Apply the migration only together with these. Counts are `'pro'`/`"pro"`
occurrences, verified 2026-09-08.

| file | refs | what changes |
|---|---|---|
| `apply_stripe_billing_event` (prod RPC) | 1 branch | accept `solo`/`organization`; map verified Stripe price IDs → plan key, never metadata |
| `check_production_invariants` (prod RPC) | 1 branch | `plan in ('solo','organization')` |
| `consume_ai_quota` (prod RPC) | quota read | read `ask_quota_month` (see item 3 above) |
| `supabase/functions/billing-create-checkout/index.ts` | 1 | `plan === "pro" ? "Sporve Pro" : "Sporve Enterprise"` → catalog `display_name`; stop creating inline Product/Price, use verified platform prices (P1.03) |
| `src/mod-coachonboard.js` | 16 | plan picker, `d.plan !== "pro" → "free"` guard, `startCheckout("pro")`, price/label lookups |
| `src/mod-coachaccount.js` | 3 | fallback plan card `id:"pro", name:"Sporv Pro"`, `r.plan === "pro"` branch, `data-cb-buy="pro"` |
| `src/sporve-web.host.html` | 3 | display tiers still read Solo / **Club** / Organization — the retired club tier (#351) lives here |

The onboarding plan picker is the one a real user touches, so it is the
regression to test first after cutover.

## 4. Release handled

Committed and merged through the gate: Codex's four documents, both SQL drafts,
the `billing-webhook` function and its tests, plus this review, and
`handler.test.mjs` wired into the `security-regressions` job so it runs on every
future PR. Deliberately **not** done: the migration is not applied, and
`billing-webhook` is not deployed (it depends on an unimplemented
`apply_platform_billing_event`, and on the ledger promotion fix in
`docs/red-drafts/2026-09-08-ledger-promotion-fix.sql`). Nothing in this release
changes production behaviour: no `src/` change, so the built page and the live
build stamp are untouched.
