// Pure finding helpers for agent-intake (./index.ts).
// Runs under plain node --test AND inside the Deno edge function.
// Keep in sync with supabase/functions/agent-intake/index.ts.
// Plain JavaScript on purpose: no type annotations (this file is imported
// directly by node tests).

/**
 * Bind member_id on a finding ONLY when the resolved entity is the roster
 * athlete (team_athletes.id). A session or guardian id must never land in
 * member_id: generate_intake_followups() joins member_id to team_athletes,
 * and a wrong-typed id would silently poison the availability_ack draft.
 * Ambiguous / unclassified findings stay null by design — never bind an
 * identity the coach has not confirmed.
 */
export function findingMemberId(args) {
  return args.need === "athlete" ? args.entityId ?? null : null;
}

/**
 * Build one agent_findings row. memberId is the resolved team_athletes id for
 * high-confidence athlete findings; omit (null) everywhere else.
 */
export function buildFinding(args) {
  return {
    provider_id: args.providerId,
    kind: args.spec.kind,
    code: args.spec.code,
    severity: args.spec.severity,
    title: args.title,
    detail: args.detail,
    source_ref: args.sourceRef,
    member_id: args.memberId ?? null,
    status: "open",
  };
}
