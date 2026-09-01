// ============================================================================
// Pure, testable post-validation for message-draft (defense in depth).
// ============================================================================
// The system prompt forbids credential/medical/safety claims, but we ENFORCE it
// here too — no Deno/Supabase deps so it unit-tests in plain Node. Each draft is
// split into sentences; any sentence asserting a certification, credential,
// licen[sc]e, degree, or a medical/safety claim is STRIPPED. A draft that is
// emptied by stripping is dropped. If every draft is emptied, the result is
// REFUSED (the caller returns a needs_revision instead of an unsafe reply).
//
// Mirrors the claim lexicon in session-note-summarize/guardrail.ts so the two AI
// surfaces refuse the exact same claims.
// ============================================================================

const CLAIM_PATTERNS: RegExp[] = [
  /\b(?:NSCA|NASM|ACE|ACSM|CSCS|CPT|USSF|USAW|PES|CES|ISSA|NCSF|NETA|NCCPT)\b/i,
  /\bcertif(?:ied|icate|ication)\b/i,
  /\b(?:licen[sc]ed|licen[sc]e|credential(?:ed|s)?|accredit(?:ed|ation))\b/i,
  /\b(?:cpr|aed|first[\s-]?aid)\b/i,
  /\b(?:bachelor|master|phd|ph\.d|b\.s\.|m\.s\.|degree|diploma)\b/i,
  // safety / medical claims of any kind
  /\b(?:injur(?:y|ies|ed|ing)|concussion|diagnos(?:is|ed)|medical|medication|prescrib\w*|cleared to play|safe to (?:play|return)|rehab\w*|physical therapy|recover(?:y|ed|ing))\b/i,
];

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean);
}

function hasClaim(s: string): boolean {
  return CLAIM_PATTERNS.some((re) => re.test(s));
}

export type MessageDraftGuardrailResult = {
  drafts: { text: string }[];
  removed: string[];
  refused: boolean;
};

/**
 * Strip claim sentences from each draft; drop emptied drafts; cap at 2.
 * `refused` is true when the model returned drafts but ALL of them were emptied
 * (i.e. the only content was a forbidden claim) — the caller must not send a reply.
 */
export function enforceMessageDraftGuardrail(draftsIn: unknown): MessageDraftGuardrailResult {
  const removed: string[] = [];
  const out: { text: string }[] = [];
  const arr = Array.isArray(draftsIn) ? draftsIn : [];

  for (const d of arr) {
    const raw = typeof (d as { text?: unknown })?.text === "string"
      ? (d as { text: string }).text
      : typeof d === "string"
        ? d
        : "";
    const kept: string[] = [];
    for (const s of splitSentences(raw)) {
      if (hasClaim(s)) removed.push(s);
      else kept.push(s);
    }
    const cleaned = kept.join(" ").replace(/\s+/g, " ").trim();
    if (cleaned) out.push({ text: cleaned });
  }

  return {
    drafts: out.slice(0, 2),
    removed,
    refused: out.length === 0 && arr.length > 0,
  };
}
