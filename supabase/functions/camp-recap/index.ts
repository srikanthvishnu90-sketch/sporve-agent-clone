// ============================================================================
// camp-recap  (Supabase Edge Function)  — Provider Model Rebuild item #7
// ============================================================================
// The END-OF-DAY camp recap: a coach taps the DAY's skills + effort + optional
// one-line note ONCE, and every registered family gets a warm, honest, per-family
// DRAFT — through the EXISTING parent-update send rails (parent_updates draft →
// coach approves → parent-update-send). This function only DRAFTS; it SENDS
// nothing and AUTO-SENDS nothing (doc #12 / L-012 stance).
//
// It reuses draft-recap's grounded shape (ai-gateway, task="summarize",
// feature="camp_recap", tool-forced single output, the same HARD GUARDRAILS): the
// recap is grounded ONLY in what the coach tapped — no fabricated milestones, no
// promises, athlete FIRST NAME only (L-005/L-012). The AI writes ONE camp-wide
// recap of the DAY (no child name, no per-child claims); the function then
// personalizes each family's draft DETERMINISTICALLY by first name only, so no
// per-child fact is ever invented. Every family gets the same grounded day-recap
// with their own child's name — honest, because it IS a camp-wide day.
//
// Input:  { serviceId: string, day: "YYYY-MM-DD", skills?: string[],
//           effort?: 1|2|3, note?: string }
// Output: { created: number, skipped: number, model, audit_id, recap_text }
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

// Mirrors draft-recap's tool + guardrails, but the recap is CAMP-WIDE (no name).
const RECAP_TOOL = {
  name: "camp_day_recap",
  description:
    "Emit a warm, parent-facing recap of ONE day of a youth-sports camp. 2-4 sentences. " +
    "Camp-wide (the group) — do NOT name any child; the app inserts each family's child's first name.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      recap_text: {
        type: "string",
        description:
          "2-4 warm, plain-language sentences about the DAY at camp for a parent. " +
          "Built ONLY from the tapped skills, the effort level, and the optional note. " +
          "NO child names (the app personalizes per family). No fabricated milestones, " +
          "no promises about future outcomes, no credentials/medical/safety claims.",
      },
    },
    required: ["recap_text"],
  },
};

const EFFORT_WORDS: Record<number, string> = { 1: "steady effort", 2: "solid effort", 3: "outstanding effort" };

const SYSTEM = [
  "You write a short, warm, honest end-of-day recap of a youth-sports CAMP day for parents, from a coach's taps.",
  "The tapped skills, the effort level, and the optional one-line note are the ONLY source of truth.",
  "You MUST call the camp_day_recap tool exactly once.",
  "",
  "HARD RULES (non-negotiable):",
  "- 2 to 4 sentences. Warm and specific about the DAY, never generic filler.",
  "- Use ONLY the tapped skills, the effort level, and the note. If it wasn't tapped, it does not appear.",
  "- This recap goes to MANY families — write about the GROUP/the day, and do NOT name any child.",
  "- NO fabricated milestones ('first ever…', 'best in camp') unless the note literally says so.",
  "- NO promises about future outcomes or results.",
  "- NO credentials, certifications, or safety/medical claims of any kind.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json({ error: "Not authenticated" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const serviceId: string = typeof body?.serviceId === "string" ? body.serviceId : "";
    const day: string = typeof body?.day === "string" ? body.day.slice(0, 10) : "";
    if (!serviceId || !day) return json({ error: "serviceId and day are required." }, 400);

    const skills: string[] = Array.isArray(body?.skills)
      ? body.skills.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 8)
      : [];
    const effortRaw = Number(body?.effort);
    const effort = Number.isFinite(effortRaw) && effortRaw >= 1 && effortRaw <= 3 ? Math.round(effortRaw) : null;
    const note: string = typeof body?.note === "string" ? body.note.trim().slice(0, 280) : "";
    if (skills.length === 0 && effort === null && !note) {
      return json({ error: "Tap at least one skill, an effort level, or a note." }, 400);
    }

    // Service-role client: authorize the coach manually, then read the roster (a
    // parent-owned PII table the coach's staff RLS also permits, but service role is
    // how we fan out the drafts atomically per family).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // AUTHORIZE: the caller must OWN the provider of this camp service.
    const { data: svc, error: svcErr } = await admin
      .from("services")
      .select("id, provider_id, service_type, providers!inner(id, owner_id)")
      .eq("id", serviceId)
      .maybeSingle();
    if (svcErr) return json({ error: svcErr.message }, 400);
    if (!svc) return json({ error: "Camp not found." }, 404);
    if (svc.service_type !== "camp") return json({ error: "Service is not a camp." }, 422);
    const providerId = (svc as Record<string, unknown>).provider_id as string;
    const ownerId = (svc as { providers?: { owner_id?: string } }).providers?.owner_id;
    if (ownerId !== uid) return json({ error: "Not authorized for this camp." }, 403);

    // Ground ONE camp-wide recap (mirrors draft-recap). Tone samples reuse the
    // coach's OWN sent/edited corpus for VOICE only (never facts).
    let toneSamples: string[] = [];
    try {
      const { data: fb } = await userClient
        .from("draft_feedback")
        .select("final_text, action, edited_at")
        .in("action", ["sent_as_is", "edited"])
        .not("final_text", "is", null)
        .order("edited_at", { ascending: false })
        .limit(3);
      toneSamples = (fb ?? [])
        .map((r: Record<string, unknown>) => String(r?.final_text ?? "").trim())
        .filter(Boolean)
        .slice(0, 2);
    } catch (_) {
      console.error("camp-recap: tone-sample lookup failed (continuing without)");
    }

    const parts: string[] = [
      "The coach's taps for this camp DAY (the ONLY source of truth):",
      `- Skills worked on: ${skills.length ? skills.join(", ") : "(none tapped)"}`,
      `- Effort: ${effort !== null ? EFFORT_WORDS[effort] : "(not tapped)"}`,
      `- Coach's note: ${note ? `"${note}"` : "(none)"}`,
    ];
    if (toneSamples.length) {
      parts.push("", "Tone anchors — match the warmth/voice ONLY, never copy their facts:",
        ...toneSamples.map((s) => `- ${s}`));
    }
    parts.push("", "Write ONE camp-wide recap of the day using ONLY the taps above. Do NOT name any child.");

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "summarize",
        feature: "camp_recap",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: parts.join("\n") }] }],
        tools: [RECAP_TOOL],
        tool_choice: { type: "tool", name: "camp_day_recap" },
        maxTokens: 600,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);
    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    const recapText = typeof call?.input?.recap_text === "string" ? call.input.recap_text.trim() : "";
    if (!recapText) return json({ error: "Recap could not be drafted from these taps." }, 502);

    // Fan out ONE draft per registered family. Read the camp roster (athlete link +
    // first name) via service role. Each child gets the SAME grounded day-recap,
    // personalized by first name only — no invented per-child facts (L-005/L-012).
    const { data: roster, error: rErr } = await admin
      .from("camp_roster")
      .select("athlete_id, athlete_first_name")
      .eq("service_id", serviceId);
    if (rErr) return json({ error: rErr.message }, 400);
    const registrants = (roster ?? []).filter((r: Record<string, unknown>) => r?.athlete_id);

    let created = 0;
    let skipped = 0;
    for (const r of registrants) {
      const childId = (r as Record<string, unknown>).athlete_id as string;
      const first = String((r as Record<string, unknown>).athlete_first_name ?? "").trim();
      const body = first ? `${first} — ${recapText}` : recapText;

      // Idempotency: one UNSENT camp-day draft per (child, camp, day). If a draft for
      // this child+day already exists and is not yet sent, refresh it rather than
      // stacking duplicates on a re-tap.
      const { data: existing } = await admin
        .from("parent_updates")
        .select("id, status")
        .eq("provider_id", providerId)
        .eq("child_id", childId)
        .in("status", ["draft", "approved"])
        .contains("skills_worked", [`camp_day:${day}`])
        .maybeSingle();

      if (existing?.id) {
        const { error: upErr } = await admin
          .from("parent_updates")
          .update({ summary_body: body })
          .eq("id", existing.id);
        if (upErr) { skipped++; continue; }
        created++;
        continue;
      }

      const { error: insErr } = await admin.from("parent_updates").insert({
        provider_id: providerId,
        child_id: childId,
        summary_body: body,
        // tag the day in skills_worked so a re-run is idempotent per (child, day);
        // this is metadata, not a fabricated skill shown to the parent.
        skills_worked: [`camp_day:${day}`],
        status: "draft", // DRAFT ONLY — coach approves + sends via existing rails
      });
      if (insErr) { skipped++; continue; }
      created++;
    }

    return json({
      created,
      skipped,
      recap_text: recapText,
      model: g?.model ?? null,
      audit_id: g?.audit?.id ?? null,
      note: "Drafts only — the coach reviews and Sends each through the existing parent-update rails. Nothing was sent.",
    });
  } catch (e) {
    console.error("camp-recap error:", e);
    return json({ error: "Camp recap could not be drafted." }, 500);
  }
});
