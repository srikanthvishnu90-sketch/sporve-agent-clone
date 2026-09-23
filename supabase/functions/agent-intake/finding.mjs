// Pure finding/intent helpers for agent-intake (./index.ts).
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

/* ── Intent rules ───────────────────────────────────────────────────────────
   Each rule: regexes over the event text → intent + rule confidence.
   needsEntity names the entity type the intent's proposal depends on.
   ORDER IS LOAD-BEARING: cancellation sits before schedule_change so a
   message that both cancels and mentions moving resolves to cancellation
   (ties in rule confidence keep definition order — see classifyIntents).   */
export const INTENTS = {
  unavailability: {
    kind: "people", code: "intake_unavailability", severity: "attention",
    patterns: [/out of the lineup/i, /rolled (his|her|their) ankle/i, /\b(sprained|torn|sidelined)\b/i,
      /can'?t make practice/i, /cannot make practice/i, /won'?t make practice/i,
      /will miss (practice|the game)/i, /out for the season/i, /\binjured\b/i, /\bhurt\b/i],
    needsEntity: "athlete", entityLabel: "athlete",
  },
  payment_hardship: {
    kind: "money", code: "intake_payment_hardship", severity: "attention",
    patterns: [/can'?t pay\b/i, /cannot pay\b/i, /need more time/i, /payment plan/i,
      /\bhardship\b/i, /behind on payments?/i, /struggling to pay/i, /can'?t afford/i],
    needsEntity: null, entityLabel: "family",
  },
  cancellation: {
    kind: "schedule", code: "intake_cancellation", severity: "urgent",
    patterns: [/cancel( tonight'?s|led)? practice/i, /cancel tonight'?s/i, /called off/i,
      /practice (is |has been )?(cancelled|canceled)/i, /no practice tonight/i,
      /tonight'?s (practice|game|session) (is |has been )?(cancelled|canceled|called off)/i,
      // Day-agnostic phrasings (verified live misses): the session will not
      // happen at all, regardless of which day the email names.
      /\bcancel\b.*\b(game|practice|session|scrimmage|training)\b/i,
      /\b(game|practice|session|scrimmage)\b.*\bcancel/i,
      /we (need|have) to cancel/i, /let'?s cancel/i, /call(ing)? it off/i],
    needsEntity: "session", entityLabel: "session",
  },
  schedule_change: {
    kind: "schedule", code: "intake_schedule_change", severity: "urgent",
    patterns: [/moved to/i, /rescheduled/i, /new time\b/i, /\btime change\b/i, /pushed back/i,
      /game (has been |was )?moved/i, /practice moved/i,
      // Natural phrasings (verified live misses).
      /can we (move|shift|reschedule)/i,
      /mov(e|ing|ed) (the |our )?(game|practice|session|scrimmage)/i,
      /what if we moved/i,
      /push (the |our )?(game|practice)/i,
      /new (date|day)\b/i],
    needsEntity: "session", entityLabel: "session",
  },
  waiver_claim: {
    kind: "documents", code: "intake_waiver_claim", severity: "attention",
    patterns: [/signed the waiver/i, /waiver (is )?signed/i, /already signed/i,
      /we signed( the waiver)?/i, /sent the waiver/i],
    needsEntity: "athlete", entityLabel: "athlete",
  },
  trial_request: {
    kind: "clients", code: "intake_trial_request", severity: "info",
    patterns: [/\btrial\b/i, /try ?out/i, /tryout/i],
    needsEntity: null, entityLabel: "prospect",
  },
  enrollment_request: {
    kind: "clients", code: "intake_enrollment_request", severity: "info",
    patterns: [/we'?d like to join/i, /would like to join/i, /want to join/i,
      /sign (him|her|them|my (son|daughter)|us) up/i, /\benroll(ment|ing)?\b/i],
    needsEntity: null, entityLabel: "prospect",
  },
  credential_update: {
    kind: "people", code: "intake_credential_update", severity: "attention",
    patterns: [/background check (cleared|complete|completed|passed|approved)/i,
      /certification (renewed|cleared|complete)/i, /\bcleared\b/i],
    needsEntity: "staff", entityLabel: "staff member",
  },
  staff_unavailable: {
    kind: "schedule", code: "intake_staff_unavailable", severity: "urgent",
    patterns: [/can'?t cover\b/i, /cannot cover\b/i, /need a sub\b/i, /need coverage/i,
      /find a replacement/i, /double[-\s]?booked/i, /can'?t make (it|the session)/i],
    needsEntity: "staff", entityLabel: "staff member",
  },
  program_inquiry: {
    kind: "clients", code: "intake_program_inquiry", severity: "info",
    patterns: [/programs for/i, /what programs/i, /programs do you (have|offer)/i,
      /looking for (a |an )?program/i, /\b\d{1,2}\s*(year[-\s]?old|\byo\b)/i],
    needsEntity: null, entityLabel: "program",
  },
  payment_issue: {
    kind: "money", code: "intake_payment_issue", severity: "attention",
    patterns: [/card declined/i, /payment failed/i, /\bdeclined\b/i, /charge failed/i,
      /payment (was )?declined/i],
    needsEntity: null, entityLabel: "family",
  },
  staff_onboarding: {
    kind: "people", code: "intake_staff_onboarding", severity: "attention",
    patterns: [/new hire/i, /joining our staff/i, /\bnew coach\b/i, /welcome aboard/i,
      /just hired/i],
    // The hire is NEW — never in the roster. The name comes from the text.
    needsEntity: null, entityLabel: "staff member",
  },
};
export const RULE_CONFIDENCE = 0.9;

/** Deterministic intent classification (zero AI). Returns the fired intents
    in INTENTS definition order — callers that pick the best by confidence
    must keep this order so ties resolve deterministically (cancellation
    beats schedule_change). */
export function classifyIntents(text) {
  return Object.entries(INTENTS)
    .filter(([, spec]) => spec.patterns.some((p) => p.test(text)))
    .map(([intent]) => ({ intent, confidence: RULE_CONFIDENCE }));
}

/* ── Slot extraction (dates, times, amounts, ages) — regex only ──────────── */
export function extractSlots(text) {
  const slots = {};
  const t = text.toLowerCase();
  if (/\btonight\b/.test(t)) slots.day_ref = "tonight";
  else if (/\btomorrow\b/.test(t)) slots.day_ref = "tomorrow";
  else if (/\btoday\b/.test(t)) slots.day_ref = "today";
  const wd = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(t);
  if (wd) slots.weekday = wd[1];
  const tm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  if (tm) {
    slots.time = `${tm[1]}${tm[2] ? ":" + tm[2] : ":00"} ${tm[3]}`;
  } else {
    // 24h clock ("18:00", "09:30") → normalized to the same h:mm am/pm form.
    // Only when the am/pm regex did NOT fire, so "6:00 pm" is never
    // double-parsed through the 24h branch.
    const t24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
    if (t24) {
      const h24 = Number(t24[1]);
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      slots.time = `${h12}:${t24[2]} ${h24 >= 12 ? "pm" : "am"}`;
    }
  }
  const amt = /\$\s?(\d[\d,]*)/.exec(text);
  if (amt) slots.amount_cents = Math.round(Number(amt[1].replace(/,/g, "")) * 100);
  const age = /\b(\d{1,2})\s*(?:year[-\s]?old|\byo\b)/i.exec(text);
  if (age) slots.age = Number(age[1]);
  // Honesty slot: payment titles must not claim "card declined" unless the
  // email actually mentions a card.
  slots.card_mentioned = /card/i.test(text);
  return slots;
}

/* ── Session date resolution — emits REAL sessions columns only ───────────
   Real columns (baseline + 20260922_001115): start_date (date), end_date
   (date), start_time (text), end_time (text), timezone, address, capacity,
   cancelled (bool), cancelled_at (timestamptz), cancel_reason (text).
   The applier (apply_intake_patch) RAISES on unknown columns, so day_ref /
   weekday pseudo-slots must NEVER reach a patch — they are resolved to a
   real date here, or dropped.                                            */
const WEEKDAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** "today" as YYYY-MM-DD in the provider's timezone (org_tz; UTC fallback). */
export function localYMD(now, orgTz) {
  const tz = typeof orgTz === "string" && orgTz ? orgTz : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const ymd = `${get("year")}-${get("month")}-${get("day")}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  } catch { /* invalid tz → UTC below */ }
  return now.toISOString().slice(0, 10);
}

function addDaysYMD(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Resolve slots.day_ref / slots.weekday → YYYY-MM-DD in the provider's
    timezone, or null when neither resolves. Explicit deixis (today/tonight/
    tomorrow) wins over a weekday name; a weekday maps to its nearest future
    occurrence (today itself when the weekday is today's). */
export function resolveSessionDate(slots, now, orgTz) {
  const today = localYMD(now instanceof Date ? now : new Date(now ?? Date.now()), orgTz);
  const dr = typeof slots.day_ref === "string" ? slots.day_ref : null;
  if (dr === "tonight" || dr === "today") return today;
  if (dr === "tomorrow") return addDaysYMD(today, 1);
  const wd = typeof slots.weekday === "string" ? slots.weekday.toLowerCase() : null;
  if (wd && wd in WEEKDAY_INDEX) {
    const target = WEEKDAY_INDEX[wd];
    const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const delta = (target - todayDow + 7) % 7;
    return addDaysYMD(today, delta);
  }
  return null;
}

/** Build the schedule_change patch. ONLY real sessions columns — never
    day_ref / weekday pseudo-slots. Returns {} when neither date nor time
    resolves; the caller must then stage nothing (the applier rejects empty
    patches). */
export function buildSessionPatch(slots, now, orgTz) {
  const patch = {};
  const startDate = resolveSessionDate(slots, now, orgTz);
  if (startDate) patch.start_date = startDate;
  if (typeof slots.time === "string" && slots.time) patch.start_time = slots.time;
  return patch;
}

/* ── Waiver-name extraction (honesty: never invent a waiver name) ───────── */
const WAIVER_STOPWORDS = new Set([
  "we", "i", "you", "he", "she", "they", "it", "the", "a", "an", "this", "that",
  "our", "your", "my", "his", "her", "their", "signed", "sign", "already",
  "have", "has", "had", "sent", "send", "got", "get", "received", "need",
  "completed", "attached", "claim", "claims", "says", "said", "form", "forms",
  "for", "and", "or", "on", "please", "just",
]);

/** Extract the waiver name a claimant refers to, or null when the text does
    not name one (callers fall back to "the required waiver" — never guess).
    The generic pattern captures the fragment before the first "waiver";
    when that fragment is stopword-polluted ("we signed the Participation")
    the leading stopwords are stripped and the remainder re-checked, so a
    real name survives its preamble ("Participation"). Returns null when
    nothing clean remains or the length cap trips. */
export function waiverNameFromText(text) {
  const quoted = /"([^"]+)"\s*waiver/i.exec(text);
  if (quoted && quoted[1].trim()) return quoted[1].trim();
  const generic = /([\w][\w ]*?)\s+waiver/i.exec(text);
  if (generic) {
    const name = generic[1].trim().replace(/\s+/g, " ");
    if (name && name.length <= 60) {
      // Strip leading stopwords ("we signed the Participation" →
      // "Participation"); anything still containing a stopword is rejected,
      // and an empty remainder means the text never named a waiver.
      const tokens = name.split(" ");
      let start = 0;
      while (start < tokens.length && WAIVER_STOPWORDS.has(tokens[start].toLowerCase())) start++;
      const cleaned = tokens.slice(start).join(" ");
      const cleanToks = tokens.slice(start).map((t) => t.toLowerCase());
      if (cleaned && cleaned.length <= 60 && !cleanToks.some((tok) => WAIVER_STOPWORDS.has(tok))) {
        return cleaned;
      }
    }
  }
  return null;
}

/** Doc-first match: return the on-file waiver document whose title appears
    verbatim in the raw text (case-insensitive), or null. Longest title wins
    so a generic "Waiver" row never shadows "Participation Waiver". This is
    the primary lookup in checkWaiverClaim() — when the text names a doc
    that is on file, use it directly instead of trusting the extractor. */
export function docTitleInText(docs, text) {
  if (!Array.isArray(docs) || !docs.length || typeof text !== "string") return null;
  const lower = text.toLowerCase();
  const sorted = docs
    .filter((d) => d && d.title)
    .slice()
    .sort((a, b) => b.title.length - a.title.length);
  return sorted.find((d) => lower.includes(d.title.toLowerCase())) ?? null;
}

/** Match an extracted waiver name against the provider's waiver_documents.
    Returns the doc or null — null means "not on file", never a guess. */
export function matchWaiverDoc(docs, name) {
  if (!name || !Array.isArray(docs) || !docs.length) return null;
  const n = name.toLowerCase();
  const sub = docs.find((d) =>
    d.title && (d.title.toLowerCase().includes(n) || n.includes(d.title.toLowerCase())));
  if (sub) return sub;
  let best = null, bestScore = 0.6;
  for (const d of docs) {
    if (!d.title) continue;
    const s = trigramSim(name, d.title);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  return best;
}

/* ── Trigram similarity (Dice coefficient — the same measure pg_trgm's
      similarity() uses). Deterministic, zero AI. ─────────────────────────── */
function trigrams(s) {
  const t = `  ${s.toLowerCase()}  `;
  const set = new Set();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}
function trigramSim(a, b) {
  if (!a || !b) return 0;
  const A = trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return A.size + B.size === 0 ? 0 : (2 * inter) / (A.size + B.size);
}

/* ── Queue detail copy helpers (pure; rendered on the coach Queue) ─────────
   programs.price is numeric(10,2) DOLLARS (the frontend formats it directly) —
   never cents. A /100 render once showed $149.00 as "$1".                   */
export function formatProgramPrice(price) {
  return `$${Number(price).toFixed(0)}`;
}

/** Medium-confidence waiver-claim citation copy. Takes the real
    checkWaiverClaim() result ({ docTitle, signed: true|false|null, docFound })
    — never fabricate it, never invent a waiver name (docTitle comes from
    docTitleInText()/waiverNameFromText()/matchWaiverDoc() only). entityName is the resolved
    athlete or "" (→ "the athlete"). Returns null when there is no check. */
export function waiverMediumCopy(waiver, entityName) {
  if (!waiver) return null;
  const athlete = entityName || "the athlete";
  if (waiver.signed === true) {
    return `Checked the waiver records (waiver_signatures): a signed '${waiver.docTitle}' row already exists for ${athlete} — the claim checks out. Nothing is staged.`;
  }
  if (waiver.signed === false) {
    return `Checked the waiver records (waiver_signatures): no signed '${waiver.docTitle}' row for ${athlete} — the waiver stays UNSIGNED until a real signature is recorded. Nothing is staged until you confirm.`;
  }
  if (waiver.docFound) {
    return `The claim names '${waiver.docTitle}' but I couldn't pin down which athlete it's for, so I can't verify it against the waiver records — nothing is marked signed. Tell me who it's for and I'll check.`;
  }
  return `The claim mentions '${waiver.docTitle ?? "the required waiver"}' but I couldn't match it to a waiver document on file, and couldn't pin down the athlete — nothing is marked signed.`;
}

/* ── Approval-gated proposals: pure builder (the ONLY writer is the DB applier) ── */
/** Stage an approval-gated proposal for high-confidence intents.
    Returns null when the scenario must NOT stage anything (design §3). */
export function buildProposal(args) {
  const { providerId, eventId, intent, confidence, entityId, entityName, fromEmail, slots, ref, findingRef, orgTz, runNow } = args;
  const base = {
    provider_id: providerId, event_id: eventId, kind: "data_change",
    confidence, status: "draft", finding_ref: findingRef, // resolved to why_finding_id at write time
  };
  switch (intent) {
    case "unavailability":
      if (!entityId) return null;
      return { ...base, target_table: "team_athletes", target_row_id: entityId, patch: { is_available: false } };
    case "schedule_change": {
      if (!entityId) return null;
      // buildSessionPatch emits ONLY real sessions columns (start_date,
      // start_time). An empty patch means no date/time resolved — stage
      // nothing; the applier raises on empty patches.
      const patch = buildSessionPatch(slots, runNow, orgTz);
      if (!Object.keys(patch).length) return null;
      return { ...base, target_table: "sessions", target_row_id: entityId, patch };
    }
    case "cancellation":
      if (!entityId) return null;
      // sessions.cancelled added by migration 20260922_001115 (decision 1a);
      // approve flips the flag only — the Schedule UI reads event.status.
      return { ...base, target_table: "sessions", target_row_id: entityId, patch: { cancelled: true } };
    case "credential_update": {
      if (!entityId) return null;
      // staff_certifications keys on member_user_id; match through the
      // organization_members row. No match → finding only, never a guess.
      const staffRow = ref.staff.find((s) => s.id === entityId) ?? null;
      const cert = staffRow?.member_user_id
        ? ref.certs.find((c) => c.member_user_id === staffRow.member_user_id) ?? null
        : null;
      if (!cert) return null;
      return { ...base, target_table: "staff_certifications", target_row_id: cert.id, patch: { status: "verified" } };
    }
    case "staff_unavailable": {
      if (!entityId) return null;
      const sess = ref.sessions.find((s) => s.assigned_member_id === entityId) ?? null;
      if (!sess) return null;
      return { ...base, target_table: "sessions", target_row_id: sess.id, patch: { assigned_member_id: null } };
    }
    case "trial_request":
      // Name unknown deterministically — the email is the contact; the coach
      // fills in the name at approval. Never guess it from the text.
      // Contract (migration 20260922_001115 §N, decision 2c): prospects table,
      // status 'trial'. Never 'enrolled' — no auto-enroll.
      return {
        ...base, target_table: "prospects", target_row_id: null,
        patch: { name: "", email: fromEmail, source: "intake_trial_request", status: "trial" },
      };
    case "enrollment_request":
      // Contract (migration 20260922_001115 §N, decision 2c): prospects table,
      // status 'inquiry'. Enrollment itself stays a manual/coach step.
      return {
        ...base, target_table: "prospects", target_row_id: null,
        patch: { name: "", email: fromEmail, source: "intake_enrollment_request", status: "inquiry" },
      };
    case "program_inquiry": {
      // Contract (migration 20260922_001115 §N, decision 2c + design doc §3
      // scenario 12): inquiries stage a prospects INSERT like
      // enrollment_request — status 'inquiry', never enrolled, never
      // contacted automatically. provider_id is injected by
      // decide_intake_proposal at apply time.
      // Guardian link: guardians carry their email in `extra` (see
      // loadReference). A matching sender email notes the link; otherwise the
      // note is omitted. The name is never guessed.
      const senderEmail = String(fromEmail ?? "").trim().toLowerCase();
      const guardian = senderEmail
        ? ref.guardians.find((c) => String(c.extra ?? "").trim().toLowerCase() === senderEmail) ?? null
        : null;
      const patch = {
        name: "", email: fromEmail, source: "intake_program_inquiry", status: "inquiry",
      };
      if (guardian) patch.note = `Sender matches guardian ${guardian.name}`;
      return { ...base, target_table: "prospects", target_row_id: null, patch };
    }
    case "staff_onboarding":
      // REMOVED 2026-09-23: organization_members.role is NOT NULL with CHECK
      // in ('owner','admin','trainer'), so a role-NULL INSERT can never land.
      // Finding only — the coach adds staff through the normal UI where role
      // is required. Never invent a role.
      return null;
    default:
      // waiver_claim: never mark signed without a row. payment_*: never mutate
      // money paths. → finding only.
      return null;
  }
}
