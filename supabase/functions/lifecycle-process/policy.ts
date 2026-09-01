// ============================================================================
// lifecycle-process / policy.ts  — pure, testable control-layer logic
// ============================================================================
// The CONTROL decisions that must never depend on the network: which action a
// queued message takes given the coach's mode, which model drafts it, the FIXED
// auto-send template, and the hard guardrail that the auto path may only ever
// emit templated logistics (anything else falls back to draft). No Deno/Supabase
// deps so it unit-tests in plain Node.
//
// Mirrors the claim lexicon used by message-draft/session-note guardrails so all
// AI surfaces refuse the same credential / medical / safety claims.
// ============================================================================

export const LOGISTICS_EVENTS = ["booking_confirmed", "reminder_24h"];
export const ALL_EVENTS = [
  "booking_confirmed",
  "reminder_24h",
  "post_session",
  "no_show_followup",
  "rebook_nudge",
];

export function isLogistics(eventType) {
  return LOGISTICS_EVENTS.includes(eventType);
}

// Resolve the effective action for a queued row. ENFORCES auto-only-logistics:
// 'auto' on a non-logistics type falls back to 'draft' (never auto-sends). An
// unknown/missing mode is treated as the safe default 'draft'.
//   returns 'skip' | 'draft' | 'auto'
export function resolveAction(mode, eventType) {
  if (mode === "off") return "skip";
  if (mode === "auto") return isLogistics(eventType) ? "auto" : "draft";
  return "draft";
}

// Short logistics reminders -> haiku; richer relational follow-ups -> sonnet.
export function modelForEvent(eventType) {
  return isLogistics(eventType)
    ? "claude-haiku-4-5-20251001"
    : "claude-sonnet-4-6";
}

// ── Claim guardrail (shared lexicon) ────────────────────────────────────────
const CLAIM_PATTERNS = [
  /\b(?:NSCA|NASM|ACE|ACSM|CSCS|CPT|USSF|USAW|PES|CES|ISSA|NCSF|NETA|NCCPT)\b/i,
  /\bcertif(?:ied|icate|ication)\b/i,
  /\b(?:licen[sc]ed|licen[sc]e|credential(?:ed|s)?|accredit(?:ed|ation))\b/i,
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

// Strip claim sentences from a drafted body. Returns {body, removed}.
export function enforceLifecycleDraft(text) {
  const removed = [];
  const kept = [];
  for (const s of splitSentences(String(text ?? ""))) {
    if (hasClaim(s)) removed.push(s);
    else kept.push(s);
  }
  return { body: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}

// ── Auto-send template (FIXED, logistics only) ──────────────────────────────
// Thin personalization over a fixed template: child first name + date/time/place.
// Returns null when it CANNOT be built as pure logistics (non-logistics type or
// missing when) — the caller MUST fall back to draft. Never free-form.
export function buildAutoTemplate(eventType, vars) {
  if (!isLogistics(eventType)) return null;
  const v = vars ?? {};
  const date = String(v.dateText ?? "").trim();
  const time = String(v.timeText ?? "").trim();
  if (!date || !time) return null; // logistics requires a concrete when
  const who = String(v.childFirstName ?? "").trim() || "your athlete";
  const place = String(v.place ?? "").trim();
  const at = place ? ` at ${place}` : "";
  if (eventType === "booking_confirmed") {
    return `Hi! ${who}'s session is confirmed for ${date} at ${time}${at}. Looking forward to it — see you then!`;
  }
  // reminder_24h
  return `Quick reminder: ${who} has a session tomorrow, ${date} at ${time}${at}. See you there!`;
}

// HARD GUARDRAIL for the auto path: an auto message may ONLY be the fixed
// logistics template, and must contain NO claims. Returns the safe template to
// send, or null meaning "fall back to draft" (so a human approves).
export function autoOrFallback(eventType, vars) {
  if (!isLogistics(eventType)) return null;
  const tpl = buildAutoTemplate(eventType, vars);
  if (!tpl) return null;            // missing logistics -> draft
  if (hasClaim(tpl)) return null;   // belt-and-suspenders -> draft
  return tpl;
}
