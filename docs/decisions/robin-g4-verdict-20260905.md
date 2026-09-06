# Robin verdict — Codex G4 batch (2026-09-05, three independent read-only passes)

## Commit order (the whole verdict in five lines)
1. COMMIT NOW: stripe-webhook + tests, _shared/http.ts, deps pins, pr-checks.yml, .codex/config.toml.
2. COMMIT AFTER PREREQS: api/ai.js + lib/ (needs SUPABASE_URL + SUPABASE_ANON_KEY set in Vercel FIRST, then a preview deploy proving lib/ is traced); Join-Waitlist (needs one probe: service_role EXECUTE on consume_edge_rate_limit via PostgREST).
3. SEND BACK (4 defects): resend-webhook must not 503-with-zero-writes when data.to is absent/multi (audit row + outbound error unconditionally; skip only the address-scoped suppression) · unsubscribe should render success, not 503, for a deleted guardian with a valid token · Join-Waitlist honeypot should return the old fake-200, not 400 · club-site-extract MUST NOT DEPLOY before its SQL (calls consume_club_extract_rate_limit which exists only in the unapplied draft; also verify Deno.resolveDns exists in the edge runtime, and allow same-registrable-domain redirects).
4. RED DRAFTS: both APPROVE-WITH-EDITS. launch-security.sql: add `revoke select on public.agent_proposals from anon;` + short-circuit the hour counter when the minute window denies (+ optional team_athletes.provider_id NOT NULL). ai-quota.sql: add `quota_unavailable` to lib/ai-request-boundary.js validQuota allowlist; APPLY ONLY AFTER api/ai.js deploys (deployed HEAD maps unknown reasons to 401 auth_invalid).
5. Apply order overall: ai FUNCTION before ai SQL; extractor SQL before extractor FUNCTION.

## Independent verification results
- 74/74 Codex security tests pass, hermetic (re-run under env -i). All existing suites green. Full smoke: 79 PASS / 0 FAIL on the worktree.
- Nothing deleted: suppression system, HMAC unsubscribe, pasted-text extraction, SSRF guards all intact (SSRF now stronger: DNS-resolved per-hop screening).
- Truthy-denial quota fix verified real and strictly fail-closed; cross-checked against every shape the live RPC returns.
- Prod validation of the drafts: apply_agent_proposal cross-tenant write is REAL in prod (0 rows exploitable today); generator FK bug (member_user_id vs om.id) confirmed; preflight counts all satisfiable; no collision with applied hardening 001022/001024/001025.
- Behaviour change to know: proposals will require verified+dated background checks on assignable staff (0→0 today; matters when first staff arrive). A schedule-adjustment apply drafts parent notices (draft-first, two queues from one approval).
