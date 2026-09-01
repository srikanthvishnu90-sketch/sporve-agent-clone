// ============================================================================
// _shared/coach_voice.ts
// ============================================================================
// buildCoachVoiceProfile(admin, providerId) — a READ-ONLY tone source for AI
// features that write in a coach's voice (message-draft today; session notes
// later). It returns 1–3 SHORT sample strings of the coach's OWN approved
// writing, to be injected as VOICE/CONTINUITY guidance only — never as a source
// of facts, and never another coach's content.
//
// Sources, both strictly scoped to this provider:
//   • parent_updates the coach has APPROVED (status in 'approved'|'sent') — the
//     coach authored & signed off on these (ai-stage2-audit §4).
//   • messages the COACH THEMSELVES sent (messages.sender_id = provider owner).
//     NOTE: chat is not persisted yet (ai-stage2-audit §2: saveMessages is a
//     no-op), so this query returns nothing today; it is future-proofed so the
//     voice profile improves automatically once messages are stored.
//
// Privacy: returns only text the coach authored. No other coach's content, and
// no PII beyond what the coach themselves wrote. Best-effort: any read error
// degrades to fewer (or zero) samples rather than throwing.
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
): Promise<string[]> {
  if (!providerId || typeof providerId !== "string") return [];

  // Resolve the coach's profile id (the author of any sent messages).
  let ownerId: string | null = null;
  try {
    const { data: prov } = await admin
      .from("providers").select("owner_id").eq("id", providerId).maybeSingle();
    ownerId = (prov?.owner_id as string | undefined) ?? null;
  } catch (_) { /* degrade to parent_updates only */ }

  const candidates: Dated[] = [];

  // 1) Coach-approved parent updates (the primary tone source today).
  try {
    const { data: updates } = await admin
      .from("parent_updates")
      .select("summary_body, created_at")
      .eq("provider_id", providerId)
      .in("status", ["approved", "sent"])
      .not("summary_body", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_SAMPLES);
    for (const u of updates ?? []) {
      const s = toSample((u as { summary_body?: string }).summary_body);
      if (s) candidates.push({ text: s, at: String((u as { created_at?: string }).created_at ?? ""), rank: candidates.length });
    }
  } catch (_) { /* best-effort */ }

  // 2) Messages the coach themselves sent (future-proofed; empty today).
  if (ownerId) {
    try {
      const { data: msgs } = await admin
        .from("messages")
        .select("body, created_at")
        .eq("sender_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(MAX_SAMPLES);
      for (const m of msgs ?? []) {
        const s = toSample((m as { body?: string }).body);
        if (s) candidates.push({ text: s, at: String((m as { created_at?: string }).created_at ?? ""), rank: candidates.length });
      }
    } catch (_) { /* best-effort */ }
  }

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
