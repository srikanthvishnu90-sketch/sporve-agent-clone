-- 20260915_001100_agent_write_registry.sql
-- G4 (v1 gates) / G6 (v2 ladder) mechanism: every AI-surface write path declares
-- its precondition, its inverse, and where its receipt is written. A write that
-- reports success without changing a row is a CI failure, not a bug.
-- Codex migration block 20260915_001100-001149. One concern per file, idempotent.
--
-- Boundary: proposal-only functions (coach-command, message-draft,
-- provider-onboard-draft, ai-chat) execute no writes and are NOT registered here.
-- If a proposal-only function ever gains a write, it must gain a registry row in
-- the same migration or tests/agent/write-registry.spec.ts fails.
-- Money and compliance webhooks (stripe-*, billing-*, ncsi-*, staff-cert-*)
-- belong to other gates and are registered elsewhere, not here.

create table if not exists public.agent_write_registry (
  write_key text primary key,
  function_name text not null,
  operation text not null,
  precondition text not null,
  inverse text not null,
  receipt text not null,
  status text not null default 'pending' check (status in ('verified', 'pending')),
  spec_ref text,
  created_at timestamptz not null default now()
);

alter table public.agent_write_registry enable row level security;

drop policy if exists agent_write_registry_select on public.agent_write_registry;
create policy agent_write_registry_select on public.agent_write_registry
  for select using (auth.role() = 'authenticated');

-- Seed rows. status=verified means the function source was read in full and the
-- row below quotes its real behavior. status=pending means UNAUDITED: the row
-- exists so the path is tracked, and the gate stays open until it is verified.
insert into public.agent_write_registry
  (write_key, function_name, operation, precondition, inverse, receipt, status, spec_ref)
values
-- verified
('lifecycle-approve.approve_send', 'lifecycle-approve',
 'Approve a drafted outbound_message and deliver it to the guardian inbox plus push.',
 'Row is status drafted. Caller owns the row provider. A verified guardian channel exists (claimed user, or an un-bounced email for the email pass). Body is non-empty after claim-strip.',
 'Atomic claim drafted to sent or approved with eq status drafted: exactly one winner delivers. Sent rows are append-only history; correction goes as a new message, never a delete or unsend.',
 'outbound_messages row (status, approved_by, approved_at, sent_at) plus one notifications row per guardian plus the push attempt. alreadySent true replays return the prior receipt and never push twice.',
 'verified', 'G4/G6'),
('parent-update-send.route_send', 'parent-update-send',
 'Route an approved parent_update to the verified guardians of the child through the notifications inbox plus push, then mark the row sent.',
 'Row is status approved. Caller owns the row provider. The child has a verified guardian in athletes.parent_id. Summary body is present.',
 'Notifications rows are append-only; correction goes as a new update. The mark-sent update runs only after the delivery insert succeeds; a failed mark returns 500 and the row stays approved for an honest retry. alreadySent true replays never re-notify.',
 'parent_updates row (status, sent_at, delivery_channel) plus one notifications row per guardian. alreadySent true replays return ok true with no new rows.',
 'verified', 'G4/G6'),
-- pending
('lifecycle-process.stage_content', 'lifecycle-process',
 'Stage AI or template content onto a due pending outbound_message and move it to drafted or skipped. UNAUDITED.',
 'UNAUDITED: presumed due pending row, coach mode not off, claim-strip applied.',
 'UNAUDITED: presumed staged content is overwritten or skipped by the next run; drafted rows need human approval before anything delivers.',
 'UNAUDITED: presumed outbound_messages row (status, content).',
 'pending', 'G4/G6'),
('lifecycle-process.dispatch_email', 'lifecycle-process',
 'Hand an approved email-pass row to the email sender under the shared send quota. UNAUDITED.',
 'UNAUDITED: presumed row approved via the email pass with quota reservation.',
 'UNAUDITED: presumed quota reservation plus provider message id on success; ambiguous rows must not auto-retry.',
 'UNAUDITED: presumed delivery_events row plus provider message id.',
 'pending', 'G4/G6'),
('draft-reply.save_ai_draft', 'draft-reply',
 'Insert a grounded coach-only reply draft into the parent conversation. UNAUDITED.',
 'UNAUDITED: presumed parent post arrived via DB webhook; facts gathered server-side; strict JSON via ai-gateway.',
 'UNAUDITED: presumed draft row is invisible to the parent until the coach approves and sends; discard deletes the draft.',
 'UNAUDITED: presumed messages row with status ai_draft and visible_to_parent false.',
 'pending', 'G4/G6'),
('camp-broadcast.save_ai_drafts', 'camp-broadcast',
 'Fan out one coach announcement into per-family coach-only drafts through the ai_draft pipeline. UNAUDITED.',
 'UNAUDITED: presumed coach-authored announcement scoped to one camp.',
 'UNAUDITED: presumed one draft per family thread; nothing sends until the coach approves each; discard deletes drafts.',
 'UNAUDITED: presumed ai_draft rows per family conversation.',
 'pending', 'G4/G6'),
('camp-recap.save_parent_update_drafts', 'camp-recap',
 'Turn one tap of day skills plus effort plus note into per-family parent_update drafts. UNAUDITED.',
 'UNAUDITED: presumed coach taps recorded for the day; grounded shape reused from draft-recap.',
 'UNAUDITED: presumed drafts travel the parent_updates approve then send rails; discard deletes the draft.',
 'UNAUDITED: presumed parent_updates draft rows per family.',
 'pending', 'G4/G6'),
('draft-recap.save_recap', 'draft-recap',
 'Turn coach taps into a warm parent recap draft. UNAUDITED.',
 'UNAUDITED: presumed skills plus effort plus optional note present; summarize via ai-gateway.',
 'UNAUDITED: presumed recap is a draft until approved; discard deletes it.',
 'UNAUDITED: presumed recap draft row.',
 'pending', 'G4/G6'),
('generate-proposals.save_picks', 'generate-proposals',
 'Persist curated provider picks with grounded parent-facing reasons. UNAUDITED.',
 'UNAUDITED: presumed deterministic eligibility gate passed first; model never sees a disqualified provider.',
 'UNAUDITED: presumed picks are proposals the parent approves; regeneration supersedes prior picks.',
 'UNAUDITED: presumed proposal rows with per-pick reasons.',
 'pending', 'G4/G6'),
('waitlist-offer-draft.save_offer_draft', 'waitlist-offer-draft',
 'Write a grounded coach-only waitlist offer draft into the family conversation. UNAUDITED.',
 'UNAUDITED: presumed seat freed on a full slot and first eligible waitlist family resolved via open_waitlist_seat.',
 'UNAUDITED: presumed draft stays invisible until the coach approves; the offer reveals only via the sent trigger.',
 'UNAUDITED: presumed ai_draft row in the family conversation.',
 'pending', 'G4/G6'),
('session-note-summarize.save_summary', 'session-note-summarize',
 'Turn raw coach session notes into a parent-facing draft update. UNAUDITED.',
 'UNAUDITED: presumed notes thick enough to summarize honestly via ai-gateway, else clarify.',
 'UNAUDITED: presumed summary is a draft until approved; discard deletes it.',
 'UNAUDITED: presumed summary draft row.',
 'pending', 'G4/G6'),
('plan-progress.write_digest', 'plan-progress',
 'Write a grounded progress digest after every 4 completed sessions, and propose the next pick when the plan stalls. UNAUDITED.',
 'UNAUDITED: presumed sources are only session_notes plus bookings for that athlete; no data means no digest.',
 'UNAUDITED: presumed digest is a read-only record; the next pick is a proposal the parent approves; never books.',
 'UNAUDITED: presumed digest record plus proposal rows.',
 'pending', 'G4/G6'),
('ai-feedback.store_feedback', 'ai-feedback',
 'Store privacy-minimized AI quality feedback. UNAUDITED.',
 'UNAUDITED: presumed authenticated caller; prompts and histories rejected before read.',
 'UNAUDITED: presumed feedback rows are append-only aggregates; no per-user inverse needed.',
 'UNAUDITED: presumed feedback row id.',
 'pending', 'G4/G6'),
('gmail-scan.save_findings', 'gmail-scan',
 'Save triage findings from the scoped Gmail scan into the review queue. UNAUDITED.',
 'UNAUDITED: presumed read-only Gmail scopes; connector entitlement checked before scan.',
 'UNAUDITED: presumed findings are read-only queue rows; dismissal removes them from view.',
 'UNAUDITED: presumed agent_findings rows.',
 'pending', 'G4/G6'),
-- verified (source read in full 2026-09-18: findClients inserts fresh leads only)
('coach-command.save_client_findings', 'coach-command',
 'Save newly discovered prospect orgs from the Places search as agent_findings rows under the coach org. READ-shaped: discovery never contacts anyone.',
 'Places key configured. Coach JWT with an owned provider org. Leads deduped against existing source_ref values before insert; saving is best-effort and the chat list renders regardless.',
 'Findings are review-queue rows; dismissal removes them from view. Outreach to a prospect happens only through the human-approved draft rail, never from this write.',
 'agent_findings rows (kind clients, code discovery_lead, source_ref lead plus place id) plus the saved_as_findings count returned in the turn.',
 'verified', 'G4/G6'),
-- pending
('ai-gateway.write_audit', 'ai-gateway',
 'Record the audit and observability row for each proxied model call. UNAUDITED.',
 'UNAUDITED: presumed every proxied call logs feature, tier, usage, and audit id.',
 'UNAUDITED: presumed audit rows are append-only; no inverse.',
 'UNAUDITED: presumed audit row id returned to the caller.',
 'pending', 'G4/G6'),
('search-parse.persist_parse', 'search-parse',
 'Persist the parsed constraint set from a parent free-text query. UNAUDITED: the header claims parse-only behavior while the source performs an upsert.',
 'UNAUDITED: presumed authenticated parent query; every field nullable.',
 'UNAUDITED: presumed parse record is superseded by the next parse; no parent-visible effect.',
 'UNAUDITED: presumed parse record id.',
 'pending', 'G4/G6')
on conflict (write_key) do nothing;
