// ============================================================================
// Pure, testable post-validation for session-note-summarize.
// ============================================================================
// The model is instructed to never invent skills/progress, but we ENFORCE it
// here too (defense in depth), with no Deno/Supabase deps so it unit-tests in
// plain Node.
//
// Grounding rule: in a DRAFT, every skill and every sport-skill mention must be
// supported by rawNotes (the ONLY source of truth). Anything ungrounded — plus
// any credential / certification / safety / medical claim — is stripped:
//   • skills_worked[]  -> drop ungrounded / claim entries
//   • summary_body, progress_signal, encouragement -> drop offending sentences
//   • practice_suggestions[] -> drop offending items
// A "needs_clarification" result is passed through (just sanitized to strings).
// ============================================================================

// Unambiguous sport-skill terms. Deliberately excludes generic words
// (power/balance/strength/etc.) to avoid false strips of honest prose.
const SKILL_LEXICON: string[] = [
  "shooting", "shot", "jump shot", "free throw", "layup", "crossover", "rebounding",
  "dribbling", "dribble", "passing", "ball control", "footwork", "finishing",
  "defense", "defending", "tackling", "tackle", "goalkeeping", "heading", "crossing",
  "serve", "serving", "backhand", "forehand", "volley", "rally", "groundstroke",
  "pitching", "batting", "fielding", "catching", "throwing", "base running", "bunting",
  "spiking", "bumping", "blocking",
  "stick handling", "skating", "slapshot",
  "putting", "chipping",
  "tumbling", "vault",
];

const CLAIM_PATTERNS: RegExp[] = [
  /\b(?:NSCA|NASM|ACE|ACSM|CSCS|CPT|USSF|USAW|PES|CES|ISSA|NCSF|NETA|NCCPT)\b/i,
  /\bcertif(?:ied|icate|ication)\b/i,
  /\b(?:licen[sc]ed|credential(?:ed|s)?|accredit(?:ed|ation))\b/i,
  /\b(?:cpr|aed|first[\s-]?aid)\b/i,
  /\b(?:bachelor|master|phd|ph\.d|b\.s\.|m\.s\.|degree|diploma)\b/i,
  // safety / medical claims of any kind
  /\b(?:injur(?:y|ies|ed|ing)|concussion|diagnos(?:is|ed)|medical|medication|prescrib\w*|cleared to play|safe to (?:play|return)|rehab\w*|physical therapy|recover(?:y|ed|ing))\b/i,
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Crude stemmer so "dribbling" in notes grounds the skill "dribble", etc.
function stems(word: string): string[] {
  const w = word.toLowerCase();
  const out = new Set<string>([w]);
  if (w.endsWith("ing") && w.length > 5) out.add(w.slice(0, -3));
  if (w.endsWith("ed") && w.length > 4) out.add(w.slice(0, -2));
  if (w.endsWith("es") && w.length > 4) out.add(w.slice(0, -2));
  if (w.endsWith("s") && w.length > 4) out.add(w.slice(0, -1));
  return [...out];
}

function notesHasWord(notesLower: string, word: string): boolean {
  return stems(word).some((st) => st.length >= 3 && new RegExp(`\\b${escapeRe(st)}`).test(notesLower));
}

// A skill phrase is grounded if the full phrase appears, or every content word
// (>=4 chars) appears (stemmed) in the notes.
function termGrounded(term: string, notesLower: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  if (notesLower.includes(t)) return true;
  const words = t.split(/\s+/).filter((w) => w.length >= 4);
  if (words.length === 0) return notesHasWord(notesLower, t);
  return words.every((w) => notesHasWord(notesLower, w));
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean);
}

function ungroundedLexicon(notesLower: string): string[] {
  return SKILL_LEXICON.filter((term) => !termGrounded(term, notesLower));
}

function hasClaim(s: string): boolean {
  return CLAIM_PATTERNS.some((re) => re.test(s));
}

function mentionsUngrounded(s: string, ungrounded: string[]): boolean {
  const low = s.toLowerCase();
  return ungrounded.some((term) => new RegExp(`\\b${escapeRe(term)}`).test(low));
}

function cleanText(text: unknown, ungrounded: string[], removed: string[]): string {
  if (typeof text !== "string" || !text.trim()) return "";
  const kept: string[] = [];
  for (const s of splitSentences(text)) {
    if (hasClaim(s) || mentionsUngrounded(s, ungrounded)) removed.push(s);
    else kept.push(s);
  }
  return kept.join(" ").trim();
}

function cleanList(list: unknown, ungrounded: string[], removed: string[]): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const s = String(item).trim();
    if (!s) continue;
    if (hasClaim(s) || mentionsUngrounded(s, ungrounded)) { removed.push(s); continue; }
    out.push(s);
  }
  return out;
}

export type GuardrailResult = { result: Record<string, unknown>; removed: string[] };

export function enforceSummaryGuardrail(resultIn: unknown, rawNotes = ""): GuardrailResult {
  const removed: string[] = [];
  const result = structuredClone((resultIn ?? {}) as Record<string, unknown>);

  if (result.type === "needs_clarification") {
    result.questions = Array.isArray(result.questions)
      ? result.questions.map((q) => String(q).trim()).filter(Boolean)
      : [];
    return { result, removed };
  }

  // Anything else is treated as a draft and grounded against the notes.
  result.type = "draft";
  const notesLower = (rawNotes || "").toLowerCase();
  const ungrounded = ungroundedLexicon(notesLower);

  result.skills_worked = (Array.isArray(result.skills_worked) ? result.skills_worked : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .filter((skill) => {
      const ok = !hasClaim(skill) && termGrounded(skill, notesLower);
      if (!ok) removed.push(skill);
      return ok;
    });

  result.summary_body = cleanText(result.summary_body, ungrounded, removed);
  result.progress_signal = cleanText(result.progress_signal, ungrounded, removed);
  result.encouragement = cleanText(result.encouragement, ungrounded, removed);
  result.practice_suggestions = cleanList(result.practice_suggestions, ungrounded, removed);

  return { result, removed };
}
