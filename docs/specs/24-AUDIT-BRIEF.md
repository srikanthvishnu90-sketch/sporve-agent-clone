# 24 — AUDIT BRIEF
Read 20, 21, 22, 23 first. This is an audit, not an implementation task. Change nothing. Write no migrations. Open no PR except one containing your report.
## 24.1 Three outputs
1. What is missing — required by 20–23, absent from the repo. 2. What is bad — present but wrong, unsafe, incoherent, or unfit; name files and lines. 3. What to do — ordered by consequence, not effort.
## 24.2 Be harsh
Do not grade on effort. Do not assume something works because it exists (zero rows = never exercised; no test = never proven). Verify, do not infer — run the query, read the trigger, check the row count. Name the incoherent parts. Flag anything that could hurt a child or a family — these outrank everything. Say when a spec is wrong.
## 24.3 Questions
**Identity and access.** 1 Is any route reachable without a session that returns org data, money, or athlete records? List every one. 2 Can signup or first page load attach an existing org, provider, athlete, guardian, or team to a new account? Trace every path incl. invite acceptance, magic links, email matching. Highest-risk unknown. 3 Does any demo/seed/sample/fixture data exist anywhere reachable by a real signup? 4 Which onboarding steps cannot be advanced past, and why?
**Coherence.** 5 Does the current dashboard make sense for a person running a season? Walk the actual views; say where a real director gets lost. 6 How much of the UI still assumes the dead marketplace? Where does it leak into something a staff user sees? 7 Does a solo private trainer have a usable product today?
**Integrity.** 8 Which UI claims render without server backing? (earlier audit found 36 claim families — how many survive?) 9 Which agent write paths can report success without changing a row? 10 Does the money ledger reconcile? Current drift and cause?
**Readiness.** 11 If the one signed coach onboarded tomorrow, what breaks first, second, third? 12 What in 20–23 is unbuildable as written against this schema?
## 24.4 Report format — docs/audit-2026-09-15.md
## Verdict (three sentences) · ## Critical — safety, minors, money, unverified claims (each: what, where, evidence, consequence, fix size) · ## Broken · ## Missing (with spec reference) · ## Incoherent — the dashboard walk-through · ## Specs that are wrong · ## Do this next (ordered by consequence; item, why it outranks the next, rough size; no dates).
## 24.5 Rules
Change no code. Every finding carries evidence. Do not rank by effort. "Unverified" + what access is needed is acceptable; a guess is not. Do not pad.
