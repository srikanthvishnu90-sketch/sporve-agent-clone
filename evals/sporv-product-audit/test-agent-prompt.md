# Sporv full-catalog test run

Use the project custom subagent named `sporv_test_agent` and return that
agent's decision-ready report without replacing failures with reassurance.
This run is read-only: do not edit, patch, commit, push, deploy, send, charge,
refund, or mutate any external system.

Required evidence:

1. Read `evals/sporv-product-audit/feature-catalog.json` and rate all 87 rows.
2. Run or verify `python3 scripts/sporv-feature-eval.py`.
3. Read `evals/sporv-product-audit/latest-evidence.json` for the exact baseline
   check outputs and timestamps; do not claim a check ran if it is absent.
4. Inspect the relevant repository paths cited by any failed, changed, or
   high-scoring feature.
5. Inspect `https://the-sporve-web.vercel.app` with a read-only browser when
   available; if unavailable, name that gap.
6. Compare against `docs/feature-audit-2026-08-24.md`, but do not inherit its
   scores: it stopped at feature 34 and some evidence is stale.

Scoring law: 10 means safe, edge-cased, and verified in production; visual
demos cap at 4; specs and authored-but-unapplied work cap at 3; source without
runtime proof is implemented_unverified; unavailable evidence lowers score and
confidence. Return exactly the schema requested by the caller, in feature-id
order, with concise evidence.
