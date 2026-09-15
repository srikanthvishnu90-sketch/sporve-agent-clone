# 15 — AGENT AUTOMATION

**Gate:** G6. Gates all agent work; start immediately and in parallel.
**Current state:** `agent_findings`, `agent_proposals`, `org_connectors`,
`connector_oauth_state`, `connector_sync_state`, `coach_agent_turns`,
`ai_audit_log`, `ai_observability_events` exist. Draft-first is enforced at the
database layer by `trg_enforce_obligation_lifecycle`, `trg_outbound_freeze`, and
`trg_agent_findings_dismiss_only`. Edge functions exist for `gmail-scan`,
`draft-reply`, `draft-recap`, `generate-proposals`, `message-draft`.

The spine is real. What is missing is a **job catalog** — a closed, testable list
of what the agent actually does — and an evaluation harness that proves it.

---

## 15.1 The invariant, restated

Modes are **off / observe / draft**. There is no auto-send. The agent never sends
a message, never charges a card, never publishes a schedule. A human clicks once.

This is not a limitation to be relaxed later. It is the reason a director will
connect their inbox. Removing it destroys the thing that makes the product
sellable into an environment with minors and money.

---

## 15.2 Job catalog

The agent's work is a closed set. Each job declares its trigger, its inputs, its
output artifact, and its failure mode. Anything not on this list is not shipped.

| # | Job | Trigger | Output |
|---|---|---|---|
| J1 | Dues chase | Obligation past due | Drafted message per family, prioritised by amount and age |
| J2 | Inbound triage | New email or SMS from a known guardian | Classification + drafted reply + suggested action |
| J3 | Schedule change propagation | Event cancelled or moved | Drafted notices per affected family, per channel |
| J4 | Availability chase | Event in 72h with <70% responses | Drafted nudges to non-responders only |
| J5 | Document chase | Missing waiver or expiring certification | Drafted request with a scoped link |
| J6 | Registration gap | Form open, prior-season family not registered | Drafted re-registration invite |
| J7 | Weekly director digest | Monday 7am org time | Money, roster, schedule, and risk summary |
| J8 | Conflict surfacing | Schedule write | `agent_findings` row, no message |
| J9 | Payment failure recovery | Declined installment | Drafted parent message + treasurer finding |
| J10 | Roster hygiene | Ingestion detects drift | Findings: duplicates, missing guardians, bad phones |

**Every job produces an artifact a human approves, or a finding a human dismisses.
Nothing else.**

---

## 15.3 Write safety registry

Every write path the agent can reach declares, in code and in a registry CI
checks:

```ts
{
  op: 'create_note',
  precondition: 'athlete exists and belongs to org',
  effect:       'inserts exactly one session_notes row',
  inverse:      'soft-delete that row by id',
  receipt:      'returns { id, created_at } from the inserted row',
}
```

**The known defect class:** `create_note` previously reported success while doing
nothing. A write that returns success without a receipt proving a row changed is a
CI failure, not a bug. Every job above is covered.

**DoD:** `tests/agent/write-registry.spec.ts` — enumerates every exported write,
asserts a registry entry exists, and asserts that a mocked zero-row write throws.

---

## 15.4 Ingestion

`org_connectors` and `connector_oauth_and_vault` exist; Gmail scan is wired.

Connector set for v1, in priority order: **Gmail, Google Calendar, Stripe,
Google Sheets, Outlook.** Each declares scopes, a sync cursor in
`connector_sync_state`, and a backfill window.

**Rules**
- Least privilege. Gmail is read-only plus draft-create. Never send scope.
- Tokens in Vault, never in a table column.
- Every ingested item carries provenance: source, external id, fetched-at. The
  agent cites provenance in every finding, so a director can always ask "why do
  you think that" and get a link.
- Ingestion never writes org state directly. It writes findings and proposals.
- A connector that fails auth degrades loudly in the agent rail, never silently.

**Privacy boundary.** A director's inbox contains personal mail. Scope ingestion to
threads matching org signals (known guardian addresses, org domain, program
names), retain non-matching content for zero seconds, and state this plainly in
the connect screen. Getting this wrong once ends the company.

---

## 15.5 Evaluation harness

An agent shipped without evals is a liability. `evals/` exists; make it load-bearing.

- A golden set of at least 200 real-shaped inbound messages, labelled with correct
  classification and an acceptable reply range
- Per-job metrics: classification accuracy, draft acceptance rate (the director
  sent it unedited), edit distance when edited, and false-finding rate
- **Ship gate: ≥85% draft acceptance on the golden set, and a false-finding rate
  below 5%.** A director who dismisses most findings stops reading the rail, and a
  rail nobody reads is the whole product dead.
- Every prompt change runs the suite in CI. Regressions block merge.

**DoD:** `evals/run.ts` produces a scored report; CI fails on regression beyond a
declared tolerance.

---

## 15.6 Inbound handling

Consequence of the zero-install parent channel: parents reply to texts and emails,
and something must read, route, and answer them. The current design drafts
outbound well and has no inbound story.

- Inbound email lands via a Resend inbound route; inbound SMS via the provider
  webhook. Both write to `conversations` and `messages`.
- Threading is by guardian, not by channel. A parent who texts and then emails is
  one conversation.
- J2 classifies into: schedule question, payment question, absence notice, roster
  change, complaint, safety concern, other.
- **Safety concerns and anything mentioning injury, abuse, or a minor's welfare
  are never auto-drafted.** They are escalated immediately to `director` and
  `owner` with the raw message and no AI summary interposed.
- SLA surfaced in the rail: unanswered inbound older than 24h is a finding.

**DoD:** `tests/agent/inbound-routing.spec.ts` including an explicit assertion that
a safety-classified message produces zero drafts and one escalation.

---

## 15.7 Failure containment

- Every agent run is bounded: max tokens, max tool calls, max wall clock. A run
  that exceeds them is killed and recorded, not retried indefinitely.
- Per-org spend caps with `ai_alert_thresholds`, already present. Wire them to a
  hard stop, not just an alert.
- A model outage degrades the product to a manual tool that still works. The
  schedule, roster, and money must function with the agent entirely off. Test this
  path.

**DoD:** `tests/agent/degraded-mode.spec.ts` — with the model provider mocked to
fail, assert that scheduling, attendance, registration, and payment all still
complete.

---

## 15.8 Acceptance for G6 and G9

Four consecutive weeks, one real org. The agent observes a connected inbox, drafts
every category in the job catalog at least once, the director sends from the rail,
and no agent write occurs without a receipt. Draft acceptance measured and above
85%. The founder does not touch the database at any point.
