# G4 write-path inventory

Written 2026-10-22 on branch `feat/g4-guards` (base `style/harvey-redesign`
@ `dafaf89`). Scope: every write reachable from the AI surface (`api/ai.js`,
the coach dock / `coach-command`, the personalization chat) or from the human
approval flow that executes what the AI drafted. Line numbers are for this
branch. "Silent no-op" means: the write can do nothing and the user is still
told it succeeded.

The mechanism: `src/mod-actions.js` (`window.SporvActions`). Every client row
marked **REG** below now executes only through `SporvActions.execute(name, ctx)`,
which throws on an unknown/link-only action, throws on a failed precondition
before `run()`, and rejects when `run()` returns no receipt or the read-back
(`verify`) finds nothing written. Tests: `tests/e2e/g4-action-registry.spec.mjs`
(19, node) and `tests/e2e/g4-approve-receipt.spec.mjs` (2, browser).

## Summary

| | count | silent no-op possible BEFORE | AFTER |
|---|---|---|---|
| Client executable writes (registry `kind:"write"`) | 17 | 10 (+1 partial) | 0 — every one needs a receipt and a passing read-back |
| Client proposable but non-executable (registry `link`/`nav`) | 14 | n/a (no write) | n/a — executing one throws `not_executable` |
| Server writes inside the AI turn (`coach-command`) | 10 | 2 (best-effort, not user-facing) | 2 (unchanged — see open items) |
| Server send executed by the approval click (`lifecycle-approve`) | 1 | 0 (error-checked, no row id) | 0 — now returns `receipt {message_id, status, notification_id}` |
| Other AI draft/generator edge functions | 13 | 3 | 3 (not covered — open items) |

## A. Client — chat review card (coach dock), executed by `approveProposal`

Proposed by: `coach-command` WRITE_TOOLS (`supabase/functions/coach-command/index.ts:168`) or the demo proposer `coachDemoProposal` (`src/sporve-web.host.html:20721`). Card: `propCardHTML` (`host:10944`) — Approve renders only when `PROP_DISPATCH[tool].canSend` AND `SporvActions.check(tool)` pass. Dispatcher: `approveProposal` (`host:21200`) → `SporvActions.execute(p.tool, {proposal, text})`.

| action | rail (executes) | writes | precondition | inverse | receipt + read-back | silent no-op before | after |
|---|---|---|---|---|---|---|---|
| `create_note` REG `mod-actions.js:300` | `PROP_DISPATCH.create_note` `host:21063` → `MOD_NOTES.createFromAI` `mod-notes.js:166` | `S.sessionNotes` (session demo store; no server table) | athlete resolves to exactly one roster row; draft non-empty | remove the note by id | `note.id`; read-back: row present in `S.sessionNotes` | **yes** — the dispatcher reported "Note created" on any resolve (the shipped bug class) | no |
| `create_document` REG `:304` | alias of `create_note` (`host:21159`) | same | same | same | same | **yes** | no |
| `mark_attendance` REG `:306` | `host:21075` → `MOD_NOTES.markAttendanceFromAI` `mod-notes.js:1193` | `S.attendance` (session demo store) | athlete resolves; status in present/absent/late/excused | restore the athlete's prior row status, or remove the new row | attendance row id; read-back: row with that id and status | **yes** (rail returned no id; any resolve = done) | no |
| `draft_recap` REG `:348` | `host:21091` → `sendRecapToParentDemo` `host:20751` | `S.messages` / `S.conversations` (session demo inbox) | athlete resolves; recap non-empty | irreversible — a delivered message is not recalled | message id + thread id (rail now returns them); read-back: message in thread | **yes** | no |
| `draft_message` REG `:369` | `host:21103` → `SporveCoach.sendParentMessage` `mod-coachaccount.js:468` | `conversations` (find-or-create), `messages` insert (coach JWT, RLS) | `args.booking_id` present; body non-empty; module loaded | irreversible | `messages.id`; read-back `GET messages?id=eq.<id>` | no (rail checks the insert representation) | no |
| `draft_bio` REG `:431` | `host:21113` → `SporveCoach.save({bio})` `mod-coachaccount.js:289` | `providers.bio` (PATCH, coach JWT) | module loaded; text non-empty | restore the captured previous bio | provider id; read-back `GET providers?id=eq.<id>&select=id,bio` equals the saved text | **yes** — `save()` returns the cached provider when the PATCH matches 0 rows, so "Saved" showed on a no-op | no |
| `set_policy` REG `:432` | `host:21132` → `SporveCoach.save({what_to_bring｜travel_radius})` | `providers.what_to_bring` / `travel_radius` | field is one of the two logistics fields (cancellation/refund refused); text non-empty | restore the captured previous value (refuses if it was not loaded) | provider id; read-back of that column | **yes** (same `save()` masking) | no |

## B. Client — command bar (`api/ai.js` classifier)

`api/ai.js:107` enum: `send_group_message, create_group, open_tab, create_note, schedule_change, payout`. `api/ai.js` itself writes nothing (its header and `UNKNOWN` fallback; only the quota RPC). Executed by `applyAction` (`host:20583`).

| action | executes | writes | precondition | inverse | receipt | silent no-op before | after |
|---|---|---|---|---|---|---|---|
| `send_group_message` REG `mod-actions.js:456` | `applyAction` parks `S.cmdPending` (`host:20613`) → `confirmPending` `host:20644` | `S.messages[conv]` push, `S.conversations[].last` — **session only, never a server table** | group resolves (ambiguity refused at park time); conversation still exists; body non-empty | remove the message by id | message id; read-back: present in thread | session write always happened, but the toast says **"Sent"** for a write that never leaves the browser | same session write; receipt now names `S.messages` in the toast — **owner decision open** (see §F) |
| `open_tab` (nav), `create_group` (nav) | `applyAction` | nothing (tab switch / opens the New group form) | — | — | — | no | no |
| `create_note`, `schedule_change`, `payout` | `applyAction` deep-links (`host:20622-20640`) | nothing | — | — | — | no | no |

## C. Client — approval queue (human approves what the agent drafted)

| action | UI | executes | writes | precondition | inverse | receipt + read-back | silent no-op before | after |
|---|---|---|---|---|---|---|---|---|
| `queue_approve` REG `mod-actions.js:490` | `[data-qdecide="approve:"]` `host:19636`; also chained after `obligation_approve` | `SporveCoach.decide(id,"approve")` `mod-coachaccount.js:424` → edge `lifecycle-approve` | `outbound_messages` status drafted→sent/approved, `approved_by/at`, `sent_at`; `notifications` insert | id; module loaded (server: owner, `status='drafted'` atomic claim, guardrailed body, reachable guardian) | irreversible (sent); an `approved` row awaiting email can be returned to draft | `message_id` (falls back to the request id on the currently deployed function) + `status`; read-back `GET outbound_messages?id=eq.<id>&select=id,status` in sent/approved/processing | no (server 4xx/5xx on refusal) but the client never checked the body | no |
| `queue_reject` REG `:536` | `[data-qdecide="reject:"]` | `decide(id,"reject")` PATCH `outbound_messages.status='skipped'` | same row | id | `decide(id,"redraft")` | row from PATCH RETURNING with `status='skipped'` | **yes** — `decide` returns `null` on a 0-row PATCH and the handler toasted "Skipped" | no |
| `queue_redraft` REG `:539` | `[data-qdecide="redraft:"]` | PATCH `status='drafted'` | same | id | irreversible (re-approving is a send; only via Approve & send) | RETURNING `status='drafted'` | **yes** (same) | no |
| `obligation_approve` REG `:543` | `[data-oblig-approve]` `host:19010`; bulk `host:19044`, `host:19076` | RPC `approve_obligation_and_queue` (`supabase/migrations/20260831_001013_agent_v1.sql:255`) | `obligations.status='approved'`; inserts one DRAFTED `outbound_messages` row when a guardian exists | obligation status is `draft`; connected (server: owner) | irreversible (owner decision stamped; the queued draft can still be skipped) | obligation id + `queuedMessageId`; read-back `GET obligations?id=eq.<id>` = approved | no (RPC raises) | no |
| `obligation_set_status` REG `:567` | Approve (no recipient) / Mark done / Dismiss — `obligPatch` `host:18995`, used at `host:19005`, `19276`, `19285` | PATCH `obligations.status` (000200 trigger is authority) | live row; status in approved/done/void | irreversible (trigger walks forward only) | RETURNING row with the new status | no (C4 check already) | no — check moved into the registry |
| `intake_decide` REG `:591` | `[data-intake-approve]` / `[data-intake-void]` → `decideIntakeProposal` `host:13503` | RPC `decide_intake_proposal` (`20260922_001115_agent_intake_layer.sql:219`) — applies the patch to the target table and writes `intake_audit` | id; decision approve/void | irreversible (no revert RPC) | RPC `status` must equal applied/void; read-back `GET intake_proposals?id=eq.<id>` | **partial** — client assumed applied/void when no status came back | no |
| `finding_dismiss` REG `:616` | `[data-find-dismiss]` `host:19098` | PATCH `agent_findings.status='dismissed'` | id; signed in (guest demo rows stay local) | PATCH back to `open` | RETURNING row with `status='dismissed'` | **yes** — card removed first, PATCH error swallowed with `.catch(()=>{})`, toast "Dismissed" | no — card leaves only after the receipt |
| `demo_queue_approve` REG `:641` | `[data-qapprove]` `host:19622` (guest preview only) | moves a seeded draft to `S.approvalSent` | not a live account; the draft exists | irreversible (reload restores the seed) | demo row id; read-back in `S.approvalSent` | no (local) | no |
| — `[data-qdismiss]` `host:19632` | guest demo | removes a seeded draft from the local list | — | — | — | UI state, not a write | unchanged |

## D. Client — personalization chat proposals

| action | executes | writes | precondition | inverse | receipt | before | after |
|---|---|---|---|---|---|---|---|
| `pers_apply` REG `mod-actions.js:666` | `persApply` `mod-personalize-ui.js:296` → `SporvPersonalization.applyProposal` (`mod-personalization.js:919`) | personalization version store (this device, localStorage) | proposal exists; compare-and-swap on base version; `validateProposal` | `undo()` | `version:<n>`; read-back `currentVersion() === n` | no (CAS + version) | no |
| `persCancel`, `persTweak*`, `dismissProposal` | card state only | — | — | — | — | not writes | unchanged |

## E. Server — edge functions

| function | trigger | writes | precondition | inverse | receipt | silent no-op possible |
|---|---|---|---|---|---|---|
| `coach-command` `remember_fact` `:632` | model tool call (deterministic) | `org_memory` insert | org; 3–500 chars; dedupe | `forget_fact` | `memory_id` or `saved:false` | no (WRITE_GUARDS `:190`, `tests/e2e/write-receipt.spec.mjs`) |
| `forget_fact` `:651` | same | `org_memory` delete | id in the turn's owned set | none (declared) | deleted count | no |
| `draft_lapsed_outreach` `:724` | same | `outbound_messages` DRAFTED insert `:752` | template; reachable families | delete by `draft_ids` | `draft_ids[]` | no |
| `draft_message` / `draft_bulk_message` `draftMessageBulk` `:909` | same | `outbound_messages` DRAFTED insert `:939` | body; audience resolves | delete by `draft_ids` | `draft_ids[]` | no |
| `create_document` `:1085` | same | `coach_documents` insert `:1093` | title/body bounds | delete by id | `document_id` | no |
| `find_clients` `:579`, `find_facilities` `:995` | same | `agent_findings` deduped insert `:617`, `:1072` | dedupe by `source_ref` | delete by `source_ref` | `saved_as_findings` count | no (count only on success) |
| why-line backstop `:2318` | after a model-emitted draft | `outbound_messages.content` update | drafts exist | none | **none** — errors only logged | **yes** (repairs inert drafts; not reported to the coach as success) |
| turn log `:2335` | every turn | `coach_agent_turns` insert | — | — | `turn_id` (best-effort) | yes (telemetry; not user-facing) |
| `lifecycle-approve` | human Approve click only (I1) | `outbound_messages` claim `:203`; `notifications` via `insertDeliveryReceipt` `:66`; email branch `:168` | auth; rate limit; owner; `status='drafted'` atomic claim; guardrailed non-empty body; guardian/email reachable | irreversible (declared in `APPROVE_GUARD` `:54`) | NEW: `receipt {message_id, status, notification_id}`; a delivery insert returning no row is a 500 | no (now with a row-id receipt) — **source only, not deployed** |
| `parent-update-send` | human send (Flutter app; no web caller) | `notifications` insert `:108`; `parent_updates` → sent `:119` | owner; `status='approved'`; guardian exists | irreversible | updated row via `.single()` | no; notification ids not returned |
| `camp-broadcast` | human (no web caller) | `conversations` find-or-create `:105`; `messages` ai_draft `:116` | camp owner; registered families | delete drafts | `drafted` count only (no ids) | no, but no addressable receipt |
| `camp-recap` | human (no web caller) | `parent_updates` update `:214` / insert `:221` | owner; camp day | delete drafts | counts only | **yes** — the update has no `.select()`, so a 0-row update counts as created |
| `waitlist-offer-draft` | human | `conversations` `:173`; `messages` ai_draft `:248`; `waitlist_offers.draft_message_id` `:265` | offer drafted | delete draft | `draft_id` | link update best-effort (logged) |
| `draft-reply` | DB webhook on inbound message | `messages` ai_draft insert `:317` | conversation; not a loop | delete draft | `draft_id` | no |
| `generate-proposals` | human / plan flow | `plan_proposals` insert `:280` (+ expiry `:162`, note `:182`/`:284`) | plan; eligible supply | proposals expire | inserted rows | expiry/note updates unchecked |
| `agent-intake` | READ job (client `runAgentIntake` `host:13524`, cron) | `agent_findings` `:356`, `intake_proposals` `:383`, `intake_events` `:331`/`:393`, `provider_settings` `:407` | cron secret or owner | proposals voided by decide | proposals count; `intake_audit` on decide | `intake_events` updates unchecked |
| `lifecycle-process` | cron + approval kick | drafts and delivery passes (`:93`–`:684`) | cron secret | — | per-row status | **not inventoried row by row — generator, open item** |
| `gmail-scan` | cron | `agent_findings` `:190`, upserts `:213`/`:219`/`:247` | connector token | — | — | open item |
| `plan-progress` | cron | `progress_digests` insert `:121` with rollback delete `:137` (a real inverse) | — | delete on missing provenance | digest id | no |
| `message-draft`, `draft-recap`, `session-note-summarize`, `provider-onboard-draft` | human | **nothing** (draft text returned only; rate-limit RPC) | — | — | — | n/a |
| client `run_agent_read` RPC `host:19112` | human "run" | `agent_findings` via `generate_agent_findings` | owner | — | `{n_kinds, n_rows}` | generator, open item |

## F. Open items for G4 = TRUE

1. **Apply the receipts table** (`docs/red-drafts/2026-10-22-g4-action-receipts.sql`, RED, owner applies). Until then `SporvActions.durableState()` is `absent` and receipts live in the session and the chat bubble only.
2. **Deploy `lifecycle-approve`** (source changed, not deployed). The client already degrades: on the deployed version it uses the request id plus the status read-back.
3. **`send_group_message` is session-only** but toasts "Sent". Owner decision: wire it to a real rail (draft rows + lifecycle-approve) or relabel it as a local draft.
4. **Demo stores** (`create_note`, `create_document`, `mark_attendance`, `draft_recap`) write browser state, not tables. They are now receipt-checked, but their receipts are not durable by nature.
5. **Server generators** (`lifecycle-process`, `agent-intake`, `gmail-scan`, `generate-proposals`, `run_agent_read`, `camp-recap` update, coach-command why-line backstop) have no shared guard declaration or no-op test. `coach-command` WRITE_GUARDS and `lifecycle-approve` APPROVE_GUARD are the pattern to copy.
6. **`intake_decide` has no inverse** — `decide_intake_proposal` applies a patch with no revert RPC.
