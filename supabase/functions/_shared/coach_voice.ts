// ============================================================================
// _shared/coach_voice.ts
// ============================================================================
// buildCoachVoiceProfile(admin, providerId) — a READ-ONLY tone source for AI
// features that write in a coach's voice (message-draft today; session notes
// later). It returns 1–3 SHORT sample strings of the coach's OWN approved
// writing, to be injected as VOICE/CONTINUITY guidance only — never as a source
// of facts, and never another organization's content.
//
// Sources, strictly scoped to this provider and a server-verified target family:
//   • parent_updates the current owner approved for this exact child.
//   • messages the current owner sent in a conversation linked to this org's
//     program. conversations.provider_id is a PROFILE id, not an organization.
// Unlinked/general conversations remain available in chat but cannot establish
// organization provenance for a tone sample, so they are not sampled here.
// Missing target identity yields no raw samples; callers can still draft from
// the explicit current request. Prompt wording is not a privacy boundary.
//
// Privacy: samples may contain text the coach wrote/approved; this is not PII
// redaction or consent verification. Best-effort read errors yield fewer/zero
// verified samples; cancellation is rethrown rather than silently ignored.
// ============================================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_SAMPLES = 3;
const SAMPLE_MAX_CHARS = 240;

/** Collapse whitespace and clip to a short, 1–2 sentence tone sample. */
function toSample(text: unknown): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= SAMPLE_MAX_CHARS) return t;
  // Prefer a clean sentence boundary within the budget; else hard-clip.
  const clipped = t.slice(0, SAMPLE_MAX_CHARS);
  const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  return (lastStop > 80 ? clipped.slice(0, lastStop + 1) : clipped.trimEnd()) + (lastStop > 80 ? "" : "…");
}

// `rank` is a stable tiebreak so output is deterministic when timestamps tie or
// are missing (parent_updates before messages, then original fetch order).
type Dated = { text: string; at: string; rank: number };

/**
 * Pull 1–3 of the coach's most recent self-authored tone anchors.
 * @param admin   a service-role Supabase client (reads bypass RLS; we scope manually).
 * @param providerId the providers.id whose voice we want.
 * @returns up to 3 short tone-sample strings (possibly empty).
 */
export async function buildCoachVoiceProfile(
  admin: SupabaseClient,
  providerId: string,
  signal?: AbortSignal,
  target?: { childId: string; guardianUserId: string },
): Promise<string[]> {
  if (!providerId || typeof providerId !== "string") return [];
  const readSignal = signal ?? new AbortController().signal;
  readSignal.throwIfAborted();
  if (!target || typeof target.childId !== "string" || !target.childId ||
    typeof target.guardianUserId !== "string" || !target.guardianUserId) return [];

  // A shared owner id is not org proof. Resolve the requested provider exactly
  // before considering either approved updates or authored messages.
  let ownerId: string | null = null;
  try {
    const { data: prov, error } = await admin
      .from("providers").select("id, owner_id").eq("id", providerId).abortSignal(readSignal).maybeSingle();
    if (!error && prov?.id === providerId && typeof prov.owner_id === "string" && prov.owner_id) {
      ownerId = prov.owner_id;
    }
  } catch (_) { /* no verified owner means no samples */ }
  readSignal.throwIfAborted();
  if (!ownerId) return [];

  const candidates: Dated[] = [];

  // 1) Coach-approved parent updates (the primary tone source today).
  try {
    const { data: updates, error } = await admin
      .from("parent_updates")
      .select("id, provider_id, child_id, approved_by, approved_at, status, summary_body, created_at, athletes!inner(id, parent_id)")
      .eq("provider_id", providerId)
      .eq("child_id", target.childId).eq("athletes.parent_id", target.guardianUserId)
      .eq("approved_by", ownerId)
      .not("approved_at", "is", null)
      .in("status", ["approved", "sent"])
      .not("summary_body", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_SAMPLES).abortSignal(readSignal);
    if (error || !Array.isArray(updates)) throw new Error("Voice updates unavailable.");
    for (const u of updates) {
      const child = u?.athletes as { id?: string; parent_id?: string } | null;
      if (!u || typeof u.id !== "string" || !u.id || u.provider_id !== providerId ||
        u.child_id !== target.childId || child?.id !== target.childId || child?.parent_id !== target.guardianUserId ||
        u.approved_by !== ownerId || !["approved", "sent"].includes(u.status) ||
        typeof u.approved_at !== "string" || !Number.isFinite(Date.parse(u.approved_at)) ||
        typeof u.summary_body !== "string") continue;
      const s = toSample((u as { summary_body?: string }).summary_body);
      if (s) candidates.push({ text: s, at: String((u as { created_at?: string }).created_at ?? ""), rank: candidates.length });
    }
  } catch (_) { /* best-effort */ }
  readSignal.throwIfAborted();

  // 2) Current-owner messages with independently verified organization lineage.
  if (ownerId) {
    try {
      const { data: msgs, error } = await admin
        .from("messages")
        .select("id, sender_id, conversation_id, body, created_at, conversations!inner(id, provider_id, searcher_id, program_id, programs!inner(id, provider_id))")
        .eq("sender_id", ownerId)
        .eq("conversations.provider_id", ownerId)
        .eq("conversations.searcher_id", target.guardianUserId)
        .eq("conversations.programs.provider_id", providerId)
        .order("created_at", { ascending: false })
        .limit(MAX_SAMPLES).abortSignal(readSignal);
      if (error || !Array.isArray(msgs)) throw new Error("Voice messages unavailable.");
      for (const m of msgs) {
        const c = m?.conversations as { id?: string; provider_id?: string; searcher_id?: string; program_id?: string;
          programs?: { id?: string; provider_id?: string } } | null;
        if (!m || typeof m.id !== "string" || !m.id || m.sender_id !== ownerId ||
          !m.conversation_id || c?.id !== m.conversation_id || c?.provider_id !== ownerId ||
          c?.searcher_id !== target.guardianUserId ||
          !c?.program_id || c.programs?.id !== c.program_id || c.programs?.provider_id !== providerId ||
          typeof m.body !== "string") continue;
        const s = toSample((m as { body?: string }).body);
        if (s) candidates.push({ text: s, at: String((m as { created_at?: string }).created_at ?? ""), rank: candidates.length });
      }
    } catch (_) { /* best-effort */ }
  }
  readSignal.throwIfAborted();

  // Most-recent-first across both sources, de-duplicated, capped at 3. Ties
  // (equal/missing timestamps) fall back to fetch order for deterministic output.
  candidates.sort((a, b) => b.at.localeCompare(a.at) || a.rank - b.rank);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const key = c.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.text);
    if (out.length >= MAX_SAMPLES) break;
  }
  return out;
}
