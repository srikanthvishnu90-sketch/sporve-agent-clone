# Scheduled Sporv quality audit

## The only grade

`GATES.md` is authoritative. The scheduled watcher first runs
`python3 scripts/gates-status.py`, preserves `audit-output/gates-status.json`,
and reports the current G1–G4 states. If no gate's complete **Done looks like**
evidence has changed its status, the report must lead with `NOTHING MOVED`.

Builds, feature scores, contract counts, browser checks, documents, and commit
volume are detector evidence, not progress. They can disprove a gate or identify
the next gate-sized slice, but they cannot turn a gate `TRUE` by themselves. No
scheduled recommendation may add a new AI tool before G4 is `TRUE`.

## What is active after this change lands

`.github/workflows/scheduled-quality-audit.yml` records the authoritative gate
grade, then runs the deterministic build, agent contract, supporting 87-feature
evidence validator, latest dedicated-agent response contract, product contracts,
and full browser smoke suite every Monday at 15:17 UTC. It is read-only with
respect to production and uploads its evidence for 30 days; it never edits
product files, sends messages, changes consent, or creates Stripe/Supabase
records.

That schedule measures drift. It does not let an AI silently “improve” the
product: the dedicated `sporv_test_agent` remains read-only and turns failures
into a prioritized proposal that a person can review.

The first full 87-row Sol/xhigh run took roughly nine minutes and returned a
release failure, so the deep judgment is a periodic audit rather than an
every-commit gate. The deterministic catalogue and preserved-response contracts
remain fast enough for PR and weekly checks.

## Codex Scheduled task to enable in the desktop app

Codex Scheduled tasks are managed in the Codex app, not by a repository file or
the CLI. Create a local-project task for this repository, choose a weekly Monday
cadence, test the prompt once, and paste the following prompt verbatim:

> Read `GATES.md` first and grade only G1 SCHEMA, G2 MONEY, G3 SUPPLY, and G4
> GUARDS against each gate's complete Done looks like evidence. Run
> `python3 scripts/gates-status.py`; if no gate moved, lead with exactly NOTHING
> MOVED. Then use the project agent `sporv_test_agent`, read
> `evals/sporv-product-audit/test-agent-prompt.md`, validate the 87-row catalogue,
> run the council, product, Getting Started, and browser smoke contracts, and
> inspect production read-only. Treat every test, score, audit, and commit as
> supporting evidence rather than progress. Tie each of at most three proposed
> work slices to one gate, and do not propose a new AI tool until G4 is TRUE.
> Do not edit, patch, commit, push, deploy, message, charge, refund, or mutate
> Stripe/Supabase; report stop-condition failures instead of trying to fix them.

For a local-project Scheduled task, the computer must be awake and the Codex
app must be running at the scheduled time. A web task cannot substitute for
this one because web tasks do not have the local checkout; the GitHub workflow
above is the always-on deterministic fallback.

## Improvement loop

1. The weekly workflow records the G1–G4 grade and preserves supporting evidence.
2. If no complete gate changed state, every summary says `NOTHING MOVED`.
3. The test agent may propose no more than three slices, each tied to one gate.
4. A human selects and authorizes one bounded slice.
5. An implementation agent changes it behind the normal tests and release gate.
6. A gate becomes `TRUE` only when its full **Done looks like** evidence exists;
   feature scores and prettier demos never substitute for that evidence.
