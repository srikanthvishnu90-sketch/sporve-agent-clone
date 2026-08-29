# Scheduled Sporv quality audit

## What is active after this change lands

`.github/workflows/scheduled-quality-audit.yml` runs the deterministic build,
agent contract, 87-feature evidence validator, latest dedicated-agent response
contract, product contracts, and full browser smoke suite every Monday at 15:17
UTC. It is read-only with respect to production and uploads its evidence for 30
days; it never edits product files, sends messages, changes consent, or creates
Stripe/Supabase records.

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

> Run the Sporv full-catalog audit in read-only mode. Use the project agent
> `sporv_test_agent`; read `evals/sporv-product-audit/test-agent-prompt.md`,
> validate all 87 rows with `python3 scripts/sporv-feature-eval.py`, run the
> council, product, Getting Started, and browser smoke contracts, then inspect
> the production URL read-only. Return the schema in
> `evals/sporv-product-audit/response.schema.json`, name every unavailable check,
> compare scores only against committed evidence, and propose the three most
> leveraged improvements. Do not edit, patch, commit, push, deploy, message,
> charge, refund, or mutate Stripe/Supabase. If a stop condition fails, report
> it as a release failure rather than trying to fix it.

For a local-project Scheduled task, the computer must be awake and the Codex
app must be running at the scheduled time. A web task cannot substitute for
this one because web tasks do not have the local checkout; the GitHub workflow
above is the always-on deterministic fallback.

## Improvement loop

1. The weekly workflow records objective drift and preserves artifacts.
2. The test agent independently rates reality and proposes no more than three
   improvement slices.
3. A human selects and authorizes one bounded slice.
4. An implementation agent changes it behind the normal tests and release gate.
5. The next audit moves a score only when new source, test, or live evidence
   exists. A prettier demo alone remains capped at 4/10.
