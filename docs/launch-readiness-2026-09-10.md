# Launch readiness — 10 September 2026

**Every claim below was checked against the live database and live endpoints
today, not against the repository.** Where the repo and production disagree,
production wins and the disagreement is named. This file replaces guesswork
about "what's left"; it is meant to be re-run and re-dated, not admired.

Method: `list_migrations` and direct SQL against `tseszaprvtvqrkfpditu`, plus
unauthenticated HTTP against the deployed edge functions and the REST API.

---

## The verdict in one line

**Not launchable, and the reason is not the software.** Both hard gates are
open, and the blocker on each is a real-world action nobody has taken yet: no
email has ever been sent, and no payment can currently succeed.

---

## The two gates (CONTEXT.md §2)

### G1 — DELIVERY: a real email, delivered to a real inbox

**OPEN. Never attempted.**

`public.outbound_messages` holds **zero rows**. Not one message has left this
system, to anyone, ever. Resend is configured (`RESEND_API_KEY`, `MAIL_DOMAIN`
both present since 3 September) and the sending path exists, so this is not a
build task — it is an untaken action, currently blocked behind Codex's send
quota and delivery-receipt work (PR #399, #402, both open drafts).

Evidence required to close: a provider message id, a mail-tester score ≥ 9, and
a proven bounce path.

### G2 — FIRST REAL PAYMENT

**OPEN, and worse than open — a payment today would fail.**

`trg_ledger_append_only` is live and raises on every UPDATE of
`payment_event_ledger`, but both money RPCs insert a ledger row and then update
its outcome. Any Stripe payment event today fails and retries for three days.

- `payment_event_ledger`: **5 rows**, none since 1 September.
- `apply_stripe_booking_event`: **2 overloads** live, so a caller can still
  reach the legacy nine-argument version.
- Providers with `stripe_charges_enabled`: **0**.

Nobody has hit the defect because nobody has transacted. That is luck, not
design. The repair is written and reviewed — `docs/red-drafts/2026-09-09-ledger-insert-once.sql`,
which leaves the trigger untouched and fixes the callers — and is **unapplied**.

**This is the single highest-value action available.** It is one migration.

---

## What actually shipped today

| | state | evidence |
|---|---|---|
| `org_connectors`, `connector_sync_state` | **live** | migration `20260909_001037`; RLS enabled *and* forced, zero anon grants, no client write policy on sync state |
| Connector no-send constraint | **live and tested in production** | gmail rejected `write_mode=apply`; quickbooks rejected any write mode; duplicate connection rejected |
| OAuth state + Vault wrappers | **live** | `20260909_001038`; state claims once, replay finds nothing, expired rows swept, reconnect destroys the old token, delete destroys the token, all four secret functions unreachable by `anon` and `authenticated` |
| `plan_entitlements.connectors` | **live** | `20260910_001039`; free = website/CSV/Stripe, pro adds Gmail/Calendar/SMS, enterprise adds the rest |
| `connectors-available` | **deployed** | returns `["stripe","website","file_import","gmail","google_calendar"]` |
| `google-oauth-start` | **deployed** | refuses an unauthenticated caller with 401 |
| `google-oauth-callback` | **deployed** | a forged state redirects to `status=failed&reason=expired`, connects nothing |
| Google OAuth client | **live pair** | token endpoint returns `invalid_grant` for a bogus code, not `invalid_client` — and not `redirect_uri_mismatch`, so the redirect URI has already propagated |

### The scope correction

Gmail is now **`gmail.readonly` alone**. An earlier version requested
`gmail.compose` on the stated belief that it could not send. That was wrong —
Google documents it as "Manage drafts and send emails" and accepts it for
`users.messages.send`. There is no Gmail scope permitting drafts without send,
so Sporv takes none of them. Drafts live in Sporv's own queue; approved
messages leave through our sender. Invariant I1 is now a property of the token,
not of our code's restraint.

---

## Open security findings, ranked by what they'd actually cost

### 1. `anon` holds write grants on `public.programs` — latent, not open

`anon` holds `INSERT, UPDATE, DELETE, TRUNCATE` (plus SELECT, REFERENCES,
TRIGGER) on `programs`. **Row-level security currently denies every one of
them** — all three write policies are scoped `{authenticated}`, and a live
unauthenticated INSERT against the REST API did not succeed.

So this is not an open door. It is a door with no lock, held shut by a rug: one
careless policy addition scoped to `public` and a signed-out visitor can write
to the programs table. The grant should not exist.

### 2. The coordinate leak — real, currently harmless, live the day you launch

`programs_select_public` grants `SELECT` on **all columns** of any published
program to the `public` role, which includes `anon`. That includes latitude and
longitude at six decimal places, `address_line1`, `zip`, `assigned_member_id`
and the pgvector embedding. The August geo lockdown fuzzed `providers` to two
decimals; `programs` hands the precise coordinates back for free.

Verified today: **no programs are published**, so there is nothing to leak
right now. It becomes a live child-safety exposure the moment one club
publishes its first program — which is the same moment you launch.

### 3. `anon` policy on `organization_members`

Live. The moment one row qualifies it exposes trainer name and email,
commission value, and the Checkr background-check reference.

All three are fixed by `docs/red-drafts/2026-09-08-pentest-hardening.sql`,
**unapplied**.

Good news: `public` tables without RLS = **0**. Invariant I6 holds.

---

## Enforcement — half real

- **Connectors: real.** `google-oauth-start` reads `plan_entitlements.connectors`
  and returns a 402 with the I3 payload for a plan that does not carry the
  connector. This is the first genuine paywall in the product.
- **Everything else: still decorative.** `resolve_provider_entitlements_internal`
  does not exist; member caps, seat caps, draft and send quotas are unenforced
  server-side. Codex's entitlement set (six drafts) is written, fixture-green,
  and unapplied — its own header holds it behind a caller cutover.

Plan keys in production remain the baseline's `free | pro | enterprise`. The
constitution's `free | solo | organization` rename ships with Codex's draft.
Nothing has been renamed unilaterally.

---

## What is actually in the product

| | count |
|---|---|
| Organizations | 3 — one eval fixture, two named "My Academy" |
| Roster rows | 3 |
| Drafts waiting in the queue | 14 |
| Messages ever sent | **0** |
| Orgs that can take payment | **0** |
| Connectors connected | **0** |

Two facts worth stating plainly. **No organization has completed onboarding**
(`onboarding_completed` is false on all three). And **`sporve123@gmail.com` owns
no organization at all** — the three orgs belong to `sporve123+goldeneval@`,
`srikanthvishnu90@` and `vishnusrikanth8@`. Signing in as yourself and clicking
Connect returns "Set up your organization first," not a Google consent screen.

The eval org `ae9f8097-fa09-4f5e-8019-c5ea76aefa8a` is an approved provider
visible to anyone listing approved providers. It must be deleted before pilots.

---

## The queue, in dependency order

Full detail in `docs/red-drafts/APPLY-ORDER.md`. Thirteen live drafts, seven
waves; eleven of the twenty-four files there are already applied or dead.

1. **Ledger fix** — money is broken today. One migration, alone, verified.
2. **Pentest hardening + anon definer revoke** — the three findings above.
3. **Generator targeting + invite-creates-guardian** — verified unapplied; idle
   offers still go to families already enrolled, and "Accept this invite"
   attaches nobody to the club.
4. **Entitlements** (Codex, six files, not splittable) — needs confirmed Solo
   and Organization prices or it lands inert.
5. **Connectors** — done.
6. **Send quota and delivery** (Codex, four files) — blocks G1.
7. **Housekeeping** — rate-limit GC, treasurer role, performance advisors
   (95 policies still re-evaluate a bare `auth.uid()` per row).

---

## What only the owner can do

| | why it cannot be automated |
|---|---|
| Say "apply the ledger fix" | RED set; one migration; unblocks G2 |
| Sign in as `srikanthvishnu90@` or `vishnusrikanth8@` and connect Gmail | both orgs are now on `pro`, so Gmail is entitled; the first real connection needs a human at a consent screen |
| Rotate the Google client secret | it passed through a chat transcript on 9 September |
| Confirm Solo and Organization prices | the entitlement draft refuses Checkout for an unconfirmed price |
| Delete the eval org before pilots | it is publicly listed |
| Leaked-password check, PITR | dashboard toggles; the API call was blocked by the permission classifier |
| Docker + an Anthropic key for Strix | the deep security pass has been staged, not run, for days |

---

## Honest summary

The connector spine is real, tested in production, and the first honest paywall
in the product runs through it. Nothing else moved: both gates are exactly where
they were, and the highest-value action available is a single unapplied
migration that would make payments work again.

Per `GATES.md`, today's grade is **NOTHING MOVED** on G1–G4. The connector work
is infrastructure for priority #2 in the constitution, and it is genuinely done
— but a gate is a gate.
