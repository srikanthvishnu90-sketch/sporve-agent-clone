// ============================================================================
// search-execute / explain.ts — pure, testable "why it matched" guardrail
// ============================================================================
// Builds ONE batched prompt for all top results and POST-VALIDATES the model's
// per-result "why" lines. HARD GUARDRAIL: an explanation must be EXTRACTIVE —
// grounded only in the listing's returned bio / specialty / review text. It must
// NOT assert credentials, certifications, background-check status, or any
// medical/safety claim. Anything matching those is stripped; if a whole line is
// unsupported it is dropped (no fabricated reasons). No Deno deps so it unit-tests
// in plain Node.
// ============================================================================

// Claim lexicon — credentials/certs + background-check/vetting + medical/safety.
const CLAIM_PATTERNS = [
  /\b(?:NSCA|NASM|ACE|ACSM|CSCS|CPT|USSF|USAW|PES|CES|ISSA|NCSF|NETA|NCCPT)\b/i,
  /\bcertif(?:ied|icate|ication)\b/i,
  /\b(?:licen[sc]ed|licen[sc]e|credential(?:ed|s)?|accredit(?:ed|ation))\b/i,
  /\b(?:background[\s-]?check\w*|vetted|screened|cleared|verified coach|verification)\b/i,
  /\b(?:cpr|aed|first[\s-]?aid)\b/i,
  /\b(?:bachelor|master|phd|ph\.d|b\.s\.|m\.s\.|degree|diploma)\b/i,
  /\b(?:injur(?:y|ies|ed|ing)|concussion|diagnos(?:is|ed)|medical|medication|prescrib\w*|cleared to play|safe to (?:play|return)|rehab\w*|physical therapy|recover(?:y|ed|ing))\b/i,
];

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean);
}

export function hasClaim(text) {
  return CLAIM_PATTERNS.some((re) => re.test(String(text ?? "")));
}

/**
 * Strip any sentence that asserts a credential / background-check / medical /
 * safety claim. Returns {why, removed}. `why` may be '' if the whole line was
 * unsupported (caller drops it rather than show a fabricated reason).
 */
export function stripUnsupported(why) {
  const removed = [];
  const kept = [];
  for (const s of splitSentences(String(why ?? ""))) {
    if (hasClaim(s)) removed.push(s);
    else kept.push(s);
  }
  return { why: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}

/** Apply the guardrail across the model's explanations, keyed by program_id. */
export function enforceExplanations(explanations) {
  const out = {};
  const removed = [];
  for (const e of Array.isArray(explanations) ? explanations : []) {
    const id = e?.program_id;
    if (!id) continue;
    const r = stripUnsupported(e?.why);
    if (r.removed.length) removed.push(...r.removed);
    if (r.why) out[String(id)] = r.why; // unsupported-only lines are dropped
  }
  return { byId: out, removed };
}

// One concise grounding block per result (only text the model may cite).
export function buildBatchPrompt(items, softAttributes) {
  const soft = (softAttributes ?? []).filter(Boolean);
  const blocks = (items ?? []).map((it, i) => {
    const excerpts = (it.review_excerpts ?? []).filter(Boolean).map((x) => `  • "${x}"`).join("\n");
    return [
      `[${i + 1}] program_id: ${it.program_id}`,
      `title: ${it.title ?? ""}`,
      `specialty: ${it.specialty ?? ""}`,
      `bio: ${it.bio ?? "(none)"}`,
      excerpts ? `reviews:\n${excerpts}` : "reviews: (none)",
    ].join("\n");
  }).join("\n\n");
  return [
    soft.length ? `The parent is looking for: ${soft.join(", ")}.` : "",
    "For EACH listing below, write ONE short sentence (max ~20 words) on why it may fit, grounded ONLY in that listing's bio/specialty/review text above it.",
    "Cite what is actually written. If the text doesn't support a reason, say a brief neutral line about the specialty — do NOT invent.",
    "NEVER mention credentials, certifications, licenses, degrees, background checks, vetting, or any medical/safety claim.",
    "",
    blocks,
  ].filter(Boolean).join("\n");
}

export const EXPLAIN_TOOL = {
  name: "match_explanations",
  description: "Return one short, extractive 'why it matched' line per listing, grounded only in the provided text.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      explanations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            program_id: { type: "string" },
            why: { type: "string", description: "One short sentence, grounded only in this listing's text. No credentials/background-check/medical claims." },
          },
          required: ["program_id", "why"],
        },
      },
    },
    required: ["explanations"],
  },
};

export const EXPLAIN_SYSTEM = [
  "You explain why each youth-sports listing matches a parent's search, in one short EXTRACTIVE sentence per listing.",
  "Ground every explanation ONLY in the provided bio/specialty/review text for that listing. Quote or paraphrase what is actually there.",
  "NEVER assert credentials, certifications, licenses, degrees, background-check or vetting status, or any medical/safety claim — even if it would sound good. If unsupported, keep it neutral and factual about the specialty.",
  "Call the match_explanations tool exactly once with one entry per listing.",
].join("\n");
