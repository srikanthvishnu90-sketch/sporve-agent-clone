// ============================================================================
// guardrail.ts — HARD GUARDRAIL for provider onboarding drafts (pure, testable).
// ============================================================================
// Certifications, years of experience, background-check status, and specific
// credentials MUST NOT appear in bio/specialties (or any descriptive field).
// They are UNVERIFIED claims until checked, so they are routed verbatim into
// claimsToVerify[]. This runs as POST-VALIDATION in addition to the system
// prompt — defense in depth: even if the model leaks a claim, we strip it here.
//
// No Deno/Supabase imports — importable by both the Edge Function and a Node
// unit test.
// ============================================================================

// Phrases that indicate a verifiable credential/claim (never descriptive copy).
const CLAIM_PATTERNS: RegExp[] = [
  // Cert/credential acronyms
  /\b(?:NSCA|NASM|ACE|ACSM|CSCS|CPT|USSF|USAW|PES|CES|ISSA|NCSF|NETA|NCCPT)\b/i,
  // Certification / license / credential / accreditation words
  /\bcertif(?:ied|icate|ication)\b/i,
  /\b(?:licen[sc]ed?|credential(?:ed|s)?|accredit(?:ed|ation)?)\b/i,
  // Years of experience
  /\b\d+\s*\+?\s*(?:years?|yrs?)\b/i,
  /\byears?\s+of\s+experience\b/i,
  // Background check / vetting
  /\bbackground[\s-]?check(?:ed|s)?\b/i,
  /\b(?:vetted|cleared)\b/i,
  // Degrees / formal education
  /\b(?:bachelor'?s?|master'?s?|ph\.?\s?d|b\.?\s?s\.?|m\.?\s?s\.?|degree|diploma)\b/i,
  // Safety creds
  /\b(?:cpr|aed|first[\s-]?aid)\b/i,
];

function isClaim(s: string): boolean {
  return CLAIM_PATTERNS.some((re) => re.test(s));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function enforceClaimsGuardrail(
  draftIn: any,
  rawInputText = "",
): { draft: any; moved: string[] } {
  const draft = (typeof structuredClone === "function")
    ? structuredClone(draftIn ?? {})
    : JSON.parse(JSON.stringify(draftIn ?? {}));

  const claims: string[] = Array.isArray(draft.claimsToVerify)
    ? draft.claimsToVerify.map((c: unknown) => String(c))
    : [];
  const moved: string[] = [];
  const addClaim = (c: string) => {
    const t = c.trim();
    if (t && !claims.some((x) => x.toLowerCase() === t.toLowerCase())) claims.push(t);
  };

  // bio — drop any sentence that asserts a credential/claim.
  if (typeof draft.bio === "string") {
    const keep: string[] = [];
    for (const s of splitSentences(draft.bio)) {
      if (isClaim(s)) { addClaim(s); moved.push(s); } else keep.push(s);
    }
    draft.bio = keep.join(" ").trim();
  }

  // array fields that must stay descriptive — drop offending entries.
  for (const key of ["specialties", "ageGroupsServed", "sessionTypes"]) {
    if (Array.isArray(draft[key])) {
      const keep: unknown[] = [];
      for (const v of draft[key]) {
        const s = String(v);
        if (isClaim(s)) { addClaim(s); moved.push(s); } else keep.push(v);
      }
      draft[key] = keep;
    }
  }

  // price rationale — strip any leaked claim sentence (rare).
  if (draft.suggestedPriceRange && typeof draft.suggestedPriceRange.rationale === "string") {
    const keep: string[] = [];
    for (const s of splitSentences(draft.suggestedPriceRange.rationale)) {
      if (isClaim(s)) { addClaim(s); moved.push(s); } else keep.push(s);
    }
    draft.suggestedPriceRange.rationale = keep.join(" ").trim();
  }

  // Safety net: ensure any claim present in the RAW INPUT is captured verbatim,
  // even if the model dropped it entirely.
  for (const s of splitSentences(rawInputText)) {
    if (isClaim(s)) addClaim(s);
  }

  draft.claimsToVerify = claims;
  return { draft, moved };
}
