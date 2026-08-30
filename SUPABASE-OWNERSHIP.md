# SUPABASE-OWNERSHIP.md

**One production database. Three repositories that can deploy to it.**
This file says which repo is allowed to, and what is still undecided.

Identical copies of this file live in all three repos. If you change one,
change all three:

- `~/the-sporve-web` (and its working clone `~/sporve-launch`) — the web product
- `~/SportsMan-main` — the Flutter production client, **APP**
- `~/Downloads/sporve-landing` — the marketing site + compiled Flutter web, **LANDING**

Production project ref: **`tseszaprvtvqrkfpditu`**.

---

## 1. Why this file exists — the mechanism

The Supabase CLI has no global "which project am I working on" setting. It
resolves its deploy target **from the directory you are standing in**. When you
run a command, it walks up from the current working directory looking for a
`supabase/` folder, then reads `supabase/.temp/project-ref` — a plain text file
containing the project id — to decide which remote it talks to. That file is
written by `supabase link` and is the entire binding. There is no confirmation
prompt naming the project, and nothing in the command output distinguishes
"the project I meant" from "the project this folder happens to point at".

So `supabase db push` typed in the wrong terminal tab is a different command
than the same text typed in the right one. That is the whole hazard.

The second half of the hazard is the **ledger**. Supabase tracks applied
migrations in one server-side table, `supabase_migrations.schema_migrations`.
It holds a row per migration version string that has been applied. `db push`
does exactly one thing: it compares your local `supabase/migrations/*.sql`
filenames against that table and runs every file whose version is **not** in the
table. It does not inspect the schema. It does not diff anything. A migration
that was applied by hand in the SQL editor leaves no row, so the CLI believes it
never ran and will run it again.

There is **one** ledger for the project, shared by every repo that links to it.
Two repos with different migration folders pointed at one ledger is not two
opinions about the schema — it is one ledger being fought over by two histories.

### What production's ledger actually says (2026-08-11)

| fact | value |
|---|---|
| entries in `supabase_migrations.schema_migrations` | **17**, last `20260725033343` |
| migration files in **APP** (`SportsMan-main`) | 73 |
| migration files in **LANDING** (`sporve-landing`) | 8 |
| entries that came from APP | **0** |

Most of the production schema was applied **by hand in the SQL editor**. The
objects exist; the rows recording them do not. This means **neither repo's
migration folder describes production**, and the delta between any repo and prod
cannot be computed by any tool — only by dumping prod and reading it.

Concretely: running `supabase db push` from APP today would attempt all 73
migrations, because the ledger claims none have run. Many create objects that
already exist. Best case it aborts on the first collision. Worst case it applies
half of them, and prod ends up in a state no file anywhere describes.

**Until the recovery work in Phase 0.2 of `docs/launch/00-backlog.md` is done
(dump prod, write a `00000000000000_prod_baseline.sql`, mark it applied), the
correct number of `db push` commands to run against production is zero.**

---

## 2. Ownership

| surface | owner | status |
|---|---|---|
| `supabase/functions/` (edge functions) | **APP** (`~/SportsMan-main`) | decided, on production evidence |
| `supabase/migrations/` (schema) | **APP** (`~/SportsMan-main`) | decided, by owner + elimination |
| Supabase secrets / env vars | owner, by hand in the dashboard | never in a repo |
| `supabase/config.toml` | each repo keeps its own; it is local config, not a deploy target | — |

### 2.1 APP owns both surfaces

**An earlier draft of this file named LANDING, on line counts. That was wrong,
and the correction is recorded here rather than quietly overwritten, because the
reasoning error is the useful part.**

The original argument was that LANDING's `index.ts` is larger in all ten
functions that exist in both repos, and that size moving the same direction
across ten independent files is a fork developed on one side. The first half is
true. The second half does not follow — **file size measures which generation a
file belongs to, not which generation is deployed.** Checked directly:

- APP's shared functions were last modified **2026-08-01**; LANDING's
  **2026-07-15**. APP is seventeen days *newer*, not stale.
- The two trees are a genuine **fork**, not an old copy and a new one: APP's
  `ai-gateway` calls `consume_edge_rate_limit`, LANDING's calls
  `reserve_ai_capacity`. **Both RPCs exist in production**, so dependency
  presence does not discriminate either.

What settled it was asking production, not the repos:

1. **Prod runs 33 edge functions. Four are Stripe** —
   `stripe-webhook`, `stripe-create-checkout`, `stripe-connect-onboarding`,
   `stripe-provider-payouts` — and those exist **only in APP**. LANDING could
   not have deployed them.
2. **A bulk deploy stamped `1785208914592` (~2026-07-26) covers twenty functions
   at once.** APP commit `808a793` (2026-07-27) carries a deploy receipt naming
   all twelve shared functions. `git log --all --grep='Deployed Functions'` in
   LANDING returns zero.
3. **Every later single deploy is APP-side** — `draft-recap`, `draft-reply`,
   `setup-interview`, `camp-recap`, `camp-broadcast`, `waitlist-offer-draft`,
   `stripe-provider-payouts`.
4. **LANDING deployed exactly two functions, both earlier and both narrow**:
   `join-waitlist` (~2026-07-02) and `ai-feedback` (~2026-07-08).

Migrations follow by elimination plus an owner decision: on 2026-08-11 the owner
confirmed the waitlist landing page **is being taken down**. A repo scheduled
for decommissioning cannot own production.

**Therefore: `supabase functions deploy` and `supabase db push` run from APP only.**

> What LANDING is still needed for, before anything there is deleted. It holds
> three things APP lacks, and two of them are CRITICAL-PATH:
>
> - **`ai-match` is a rewrite, not a diff.** `matchguard.ts:4-10` states that
>   production matching no longer calls a model, using a deterministic
>   `ranking-policy.ts`. Deleting LANDING's copy re-introduces LLM-decided coach
>   matching.
> - **`ai-chat` child-safety is enforced only in LANDING.** A
>   `HEALTH_REQUEST`/`TRAINING_REQUEST` regex preflight returns a canned
>   "contact a healthcare professional" reply *before* the model runs. APP's
>   equivalent is system-prompt text — a suggestion, not a control.
> - `search-parse:181` in LANDING returns `(e as Error).message` to the client,
>   which leaks internals; APP has a generic 500 body and a `405` method
>   allowlist. Take the better half of each.
>
> Reconcile these into APP **before** LANDING is retired, not after.

> Also unaccounted for: two functions in production, `AI-Chat` and
> `Join-Waitlist`, have entrypoint `source/index.ts` with no
> `supabase/functions/` prefix — they were written in the Supabase dashboard
> editor and exist in **no repo at all**. Recover their source before deleting
> them.

---

## 3. The hard rules

1. **Only the owning repo runs the deploy command for its surface.**
   - `supabase functions deploy …` → **APP only** (`~/SportsMan-main`).
   - `supabase db push` → **nobody, today.** After §4 is decided and the
     baseline exists, the repo named there, and only that one.
2. **`supabase link` in a non-owning repo is itself the violation.** The damage
   is done at link time; the destructive command is just the trigger. If a repo
   should not deploy, it should not be linked.
3. **`supabase/.temp/` is never committed, and never exists in more than one
   repo at a time.** It is machine-local state, it names the production project,
   and a second copy is a second loaded gun. Both APP and LANDING already ignore
   it (`SportsMan-main/.gitignore:60`, `sporve-landing/.gitignore:9`), and
   neither has ever tracked it — verified 2026-08-11 with `git ls-files`.
   As of 2026-08-11: **APP is linked** (`supabase/.temp/project-ref` =
   `tseszaprvtvqrkfpditu`); **LANDING is unlinked** (its `.temp` was renamed to
   `.temp.unlinked-2026-08-11`).

   Two live gaps in that, found while writing this file:
   - The ignore rule is `supabase/.temp/` with a trailing slash, so the renamed
     `supabase/.temp.unlinked-2026-08-11/` in LANDING is **not** ignored and
     currently shows as untracked. Broadening the rule to `supabase/.temp*`
     closes it. The pre-push hook already blocks both spellings.
   - APP committed `supabase/.temp/` once, in `35794f1` (2026-07-07), and
     untracked it in `96565c1` (2026-08-02). The project ref and organization id
     are therefore still in that repo's git history. Neither is a credential —
     the credential exposure is the service-role key, tracked as `[RED]` in
     `docs/launch/00-backlog.md` §0.1 — but it is why rule 3 is a rule.
4. **Prod is never the first place a schema change runs.** Once Docker is
   installed, `supabase db reset` locally, then push.
5. **Secrets live in the Supabase dashboard**, not in a repo, not in `.env` that
   sits next to a linked `supabase/` folder.

### The rule and the reality do not currently agree

Rule 1 says functions deploy from APP. Rule 3 records that LANDING is the
repo that is **unlinked**, and APP is the one that is linked. That is
deliberate, and it is the safe ordering: the *linked* repo is the one whose 73
unrecorded migrations could destroy prod, so unlinking removed the wrong kind of
risk first. Before the next function deploy, LANDING must be relinked (§5) and
APP must be unlinked. Do not leave both linked.

---

## 4. Migration ownership — RESOLVED: Option A (APP)

**Decided 2026-08-11.** The owner confirmed the waitlist landing page is being
taken down, which eliminates LANDING; production evidence in §2.1 independently
shows APP is the deploying repo. Option A stands. The analysis below is kept
because the *Against* column is a live risk register, not a rejected argument —
every objection to Option A is still true and still has to be worked off.

Neither option was available until prod is dumped to a baseline, and that is
still true: **Option A is decided, not yet executable.** Backlog 0.2 gates it.

Neither option is available until prod is dumped to a baseline (backlog 0.2).
Both options begin the same way: dump production, commit it as
`00000000000000_prod_baseline.sql`, and insert its version into the ledger so
the CLI stops believing 73 migrations are outstanding.

### Option A — APP (`SportsMan-main`) owns migrations

**For.** It holds 73 migrations, the largest authored history, and the schema
the Flutter client's code actually expects. The outcome-model work — the newer
schema production is *behind* — lives here. Choosing anything else means that
history is orphaned or hand-merged.

**Against.** Zero of its 73 migrations are in the production ledger. Its
relationship to prod is not "ahead by N" — it is **unknown**, and stays unknown
until every one of the 73 is classified as already-applied, partly-applied, or
never-applied. Production has ~36 tables where this set describes ~65. This is
the biggest reconciliation job of the two, and the one most likely to be
abandoned half-done, which would leave the exact ambiguity we are trying to end.

**Cost.** High up front. Correct at the end.

### Option B — LANDING (`sporve-landing`) owns migrations

**For.** Its 8 migrations *are* in the production ledger, so its lineage and
prod's already agree. It also owns edge functions, so one repo would own the
whole server side — one place to look, one place to link, one CI target. The
ambiguity this file exists to end would actually end.

**Against.** It inherits 73 migrations it did not write and whose intent it does
not carry, and the Flutter client's schema expectations then live in a repo that
knows nothing about the Flutter client. The web/marketing repo becomes the
database owner, which is organisationally odd and will read as wrong to anyone
who joins later.

**Cost.** Low up front. A naming/ownership mismatch to live with.

### The trade-off in one line

**A** aligns ownership with intent and pays for it in reconciliation work.
**B** aligns ownership with the ledger and pays for it in the schema living in
the wrong-shaped repo.

### The question that settles it

> When the outcome-model schema ships, whose migration files will be written —
> the Flutter engineer's, or the web/backend one's?

Whoever writes the *next* migration should own the folder. Ownership by
authorship survives; ownership by convenience gets violated within a month.

Until this is answered, **`supabase db push` is forbidden from both repos.**

---

## 5. Recovery — relinking

If a repo needs to be (re)linked — and it is the owning repo for the surface you
are about to deploy:

```bash
cd <the owning repo>
supabase link --project-ref tseszaprvtvqrkfpditu
```

This writes `supabase/.temp/` with the project ref, pooler URL and server
versions. It will ask for the database password; that is the Postgres password
from the dashboard, not your Supabase account password.

To unlink, just remove the state — there is no `supabase unlink`:

```bash
mv supabase/.temp supabase/.temp.unlinked-$(date +%Y-%m-%d)
```

Renaming rather than deleting keeps the evidence of what was linked and when.

To confirm what a folder is currently pointed at, without running anything that
touches the server:

```bash
cat supabase/.temp/project-ref 2>/dev/null || echo "not linked"
```

---

## 6. What the guards in this repo do

Both APP and LANDING carry two files. Read `scripts/supabase-guard.sh` before
trusting it — its own comments state its limits.

- **`.git/hooks/pre-push`** — fires on `git push` only. It warns when the repo
  is linked (`supabase/.temp/` present) but is not the designated owner, and
  fails the push if `supabase/.temp/` was ever staged. It **cannot** intercept
  `supabase db push` or `supabase functions deploy`; those are not git
  operations and git never sees them.
- **`scripts/supabase-guard.sh`** — a shell function you must *opt into* by
  sourcing it in your shell profile. Once sourced, it shadows the `supabase`
  command and refuses `db push` / `functions deploy` from a non-owning repo. If
  you have not sourced it, or you invoke `/opt/homebrew/bin/supabase` by full
  path, it does nothing.

Neither is a security control. Both are seatbelts against your own muscle
memory, which is the actual failure mode here.

---

## 7. Changelog

- **2026-08-29 — G1 baseline landed; migration ownership MOVED to WEB
  (`~/the-sporve-web`), superseding the 2026-08-11 Option A (APP) decision.**
  The owner directed the baseline dump into THIS repo
  (`supabase/migrations/00000000000000_baseline.sql`, captured object-by-object
  from prod: 50 tables, 95 functions, 134 policies, 41 triggers, 90 indexes,
  84 FKs, 10 views, RLS on all 50 tables, grants incl. the providers
  column-privacy model), and Codex linked this repo on 2026-08-27. The prod
  ledger — which had grown to **69** entries since the 17 recorded on 08-11 —
  was backed up to `supabase/ledger-backup-2026-08-29.json` and repaired to the
  single baseline row, so `supabase migration list` now agrees with this repo.
  Consequences: APP's 73 migration files are HISTORY (superseded by the
  baseline; never `db push` them), `db push` authority moves here, and new
  migrations are authored here going forward. §2/§4 below predate this and are
  kept for lineage.
- **2026-08-11 — created.** Decided: LANDING owns edge functions, on the
  evidence in §2.1 (LANDING's copy larger in all ten shared functions;
  production's ledger contains exactly LANDING's AI-observability migrations;
  LANDING holds the deployment runbooks and release-safety scripts). Recorded as
  unresolved: migration ownership (§4). Recorded as fact from a direct
  production query the same day: 17 ledger entries ending `20260725033343`, none
  from APP; 36 tables; 97 RLS policies. LANDING unlinked from prod
  (`supabase/.temp` → `.temp.unlinked-2026-08-11`); APP still linked. Guards
  added to both repos. Author: Clo, reviewed by the owner.
