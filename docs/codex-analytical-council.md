# Codex analytical council

The repository includes a project-scoped Codex agent named
`sporv_analytical_lead` and fifteen read-only specialist agents. They are local
Codex configuration, not an in-product feature and not a second source of
business data.

## How to invoke it

Ask the primary Codex chat to spawn or use `sporv_analytical_lead` for a decision
or review; a custom agent file does not replace the primary persona by itself.
Say “use the full 15-agent council” when every specialist should report;
otherwise the lead selects only the roles whose independent evidence can change
the decision.

The lead gathers reports, resolves disagreements against evidence, and returns
one recommendation. Fifteen roles can exist even when only three subagents run
at once: the lead runs the remaining roles in bounded waves and waits for every
requested report before synthesis.

## Council roster

| Agent | Focus |
|---|---|
| `intent_clarifier` | Intended outcome, ambiguity, decision boundary, and the one forcing question |
| `requirements_analyst` | Scope, acceptance criteria, contradictions, and missing decisions |
| `evidence_verifier` | Repository evidence, current authoritative sources, and claim confidence |
| `repository_mapper` | Execution paths, ownership boundaries, dependencies, and affected files |
| `product_strategist` | User value, sequencing, business tradeoffs, and success measures |
| `ux_accessibility_reviewer` | User journeys, information clarity, keyboard, screen reader, and responsive behavior |
| `frontend_architect` | Browser execution paths, state, component contracts, and integration |
| `backend_api_architect` | API boundaries, auth propagation, idempotency, and service contracts |
| `supabase_rls_analyst` | Schema assumptions, RLS evidence, ownership, and data lifecycle |
| `stripe_payments_risk_analyst` | Stripe mode, money movement, refunds, webhooks, and ledger integrity |
| `security_privacy_coppa_reviewer` | Trust boundaries, secrets, abuse cases, privacy, and youth-data duties |
| `reliability_observability_reviewer` | Failure modes, retries, timeouts, telemetry, and recovery |
| `performance_cost_analyst` | Runtime cost, latency, concurrency, caching, and capacity |
| `qa_evals_release_reviewer` | Regression coverage, evals, release gates, and production evidence |
| `adversarial_critic` | Counterexamples, hidden assumptions, unsafe optimism, and stop conditions |

## Shared questioning contract

All sixteen profiles inherit `AGENTS.md`. Its analytical contract borrows the
verified coach chatbox discipline and uses a compatible `read | proposed |
clarify | refuse` decision envelope: verify before answering, do not invent
missing facts, ask one focused question only when ambiguity changes the outcome,
and keep consequential actions as explicit proposals. The agents do not receive
or read private chatbox history; “same questioning” means the same decision
discipline, not shared user conversations or hidden model reasoning.

## Permissions and connections

Every profile is `read-only`. The project config keeps the legacy shell tool and
login-shell semantics disabled. Codex's bounded unified command runner remains
available because this repository requires builds, tests, git, and release
verification; it is not an unrestricted Bash persona. The existing Stripe and
Supabase MCP connections remain inherited from the parent session. Stripe stays
on its allowlisted planning/search surface, and Supabase stays pinned to the
current project with `read_only=true`; a specialist can inspect evidence but
cannot use the council as a write bypass.

The configuration caps spawned agent threads at three, and official guidance
recommends bounded parallelism for independent read-heavy work. If the custom
lead itself occupies one spawned thread, the runtime may schedule two specialist
reports beside it and continue in later waves. A full council consumes
materially more tokens than a focused review, so the lead uses all fifteen only
when explicitly requested or when the decision genuinely spans the whole system.
