# Sporv full-catalog test run

Use the project custom subagent named `sporv_test_agent` and return that
agent's decision-ready report without replacing failures with reassurance.
This run is read-only: do not edit, patch, commit, push, deploy, send, charge,
refund, or mutate any external system.

Primary grade:

1. Read `GATES.md` before every other evaluation. Grade only G1–G4 against each
   complete **Done looks like** clause; do not infer a pass from partial evidence.
2. Put all four gate states in `executive_summary` and as named
   `deterministic_checks`. If no gate changed to TRUE, lead with exactly
   `NOTHING MOVED`.
3. Tie every proposed improvement to G1, G2, G3, or G4. Do not propose a new AI
   tool while G4 is FALSE.

Supporting evidence, not progress:

4. Read `evals/sporv-product-audit/feature-catalog.json` and rate all 87 rows.
5. Run or verify `python3 scripts/sporv-feature-eval.py`.
6. Read `evals/sporv-product-audit/latest-evidence.json` for the exact baseline
   check outputs and timestamps; do not claim a check ran if it is absent.
7. Inspect the relevant repository paths cited by any failed, changed, or
   high-scoring feature.
8. Inspect `https://the-sporve-web.vercel.app` with a read-only browser when
   available; if unavailable, name that gap.
9. Compare against `docs/feature-audit-2026-08-24.md`, but do not inherit its
   scores: it stopped at feature 34 and some evidence is stale.

Scoring law: 10 means safe, edge-cased, and verified in production; visual
demos cap at 4; specs and authored-but-unapplied work cap at 3; source without
runtime proof is implemented_unverified; unavailable evidence lowers score and
confidence. Return exactly the schema requested by the caller, in feature-id
order, with concise evidence. Feature scores, test counts, and commit volume may
support a gate finding but never constitute progress themselves.
