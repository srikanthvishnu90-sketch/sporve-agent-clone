// ============================================================================
// plan-progress (Supabase Edge Function) — the outcome flywheel (Prompt 5)
// ============================================================================
// progress in -> plan adapts -> next proposal out.
//   • Digest: after every 4 completed sessions in a plan, write a grounded,
//     parent-facing summary. Sources = ONLY session_notes + bookings for that
//     athlete. No data => no digest (never fabricate progress).
//   • Adaptation: if the plan has 3+ completed sessions and ZERO upcoming
//     bookings, ask the proposal engine for the next pick (parent still approves).
// Invoked by the owning parent (JWT) or by cron (service role). Never books.
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
const PROPOSALS_FN = "generate-proposals";
const DIGEST_EVERY = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Missing Authorization header" }, 401);
    const isService = bearer === SERVICE_ROLE_KEY;

    const body = await req.json().catch(() => ({}));
    const planId = body?.plan_id;
    if (!planId) return json({ error: "plan_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: plan } = await admin.from("development_plans")
      .select("id, goal_id, phases, current_phase_index").eq("id", planId).single();
    if (!plan) return json({ error: "plan not found" }, 404);
    const { data: goal } = await admin.from("athlete_goals")
      .select("id, athlete_id, created_by, outcome_text, sport").eq("id", plan.goal_id).single();
    if (!goal) return json({ error: "goal not found" }, 404);

    if (!isService) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: u } = await userClient.auth.getUser();
      if (!u?.user) return json({ error: "Not authenticated" }, 401);
      const { data: ath } = await admin.from("athletes").select("parent_id").eq("id", goal.athlete_id).single();
      if (!ath || ath.parent_id !== u.user.id) return json({ error: "Forbidden" }, 403);
    }

    // Completed sessions for this athlete in the goal's sport.
    const { data: completedRows } = await admin.from("bookings")
      .select("id, status, programs!inner(sport_type)")
      .eq("athlete_id", goal.athlete_id).eq("status", "completed");
    const completed = (completedRows ?? []).filter((b: any) =>
      String(b.programs?.sport_type ?? "").toLowerCase() === String(goal.sport ?? "").toLowerCase());
    const completedCount = completed.length;

    // Upcoming (future, not cancelled) bookings for this athlete.
    const today = new Date().toISOString().slice(0, 10);
    const { data: upcomingRows } = await admin.from("bookings")
      .select("id, status, sessions!inner(start_date)")
      .eq("athlete_id", goal.athlete_id).in("status", ["pending", "confirmed"]);
    const upcomingCount = (upcomingRows ?? []).filter((b: any) =>
      String(b.sessions?.start_date ?? "") >= today).length;

    // ---- Digest: every DIGEST_EVERY completed sessions, if there is real data.
    let digest = null;
    const { data: lastDigest } = await admin.from("progress_digests")
      .select("sessions_counted").eq("plan_id", planId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const lastCount = lastDigest?.sessions_counted ?? 0;

    if (completedCount >= DIGEST_EVERY && completedCount - lastCount >= DIGEST_EVERY) {
      const { data: notes } = await admin.from("session_notes")
        .select("id, focus_areas, effort, progress_note, raw_notes, created_at")
        .eq("child_id", goal.athlete_id).order("created_at", { ascending: true });
      const usable = (notes ?? []).filter((n: any) =>
        (Array.isArray(n.focus_areas) && n.focus_areas.length) || n.progress_note || n.raw_notes);
      if (usable.length) {
        const facts = usable.map((n: any) => ({
          focus_areas: n.focus_areas ?? [], effort: n.effort ?? null,
          note: n.progress_note ?? n.raw_notes ?? null,
        }));
        const SYSTEM = [
          "You are Sporve's concierge writing a short, warm, parent-facing progress digest.",
          "Ground EVERY statement ONLY in the provided session notes and counts. Never invent a skill, metric, or milestone that is not in the notes. If the notes are thin, keep it short and honest.",
          "3-5 sentences: what was worked on, what the notes indicate improved, and what's next — no numbers you were not given.",
        ].join("\n");
        const userText = [
          `GOAL: ${goal.outcome_text} (${goal.sport})`,
          `COMPLETED SESSIONS: ${completedCount}`,
          `SESSION NOTES (grounded source — use only these):`, JSON.stringify(facts),
        ].join("\n");
        let bodyText = "";
        try {
          const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
            method: "POST",
            headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
            body: JSON.stringify({
              task: "summarize", feature: "progress_digest", system: SYSTEM,
              messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
              actorId: goal.created_by, actorRole: "searcher", maxTokens: 400,
            }),
          });
          const g = await gResp.json();
          bodyText = typeof g?.text === "string" ? g.text.trim() : "";
        } catch (_) { /* no fabricated fallback — skip digest if the model is unavailable */ }
        if (bodyText) {
          const { data: ins } = await admin.from("progress_digests").insert({
            plan_id: planId, athlete_id: goal.athlete_id, body: bodyText,
            sessions_counted: completedCount, sources: { session_note_ids: usable.map((n: any) => n.id) },
          }).select().single();
          digest = ins ?? null;
          // Normalized provenance makes every displayed digest independently
          // auditable. The DB trigger rejects a note from another athlete.
          if (ins?.id) {
            const { error: sourceError } = await admin
              .from("progress_digest_sources")
              .insert(usable.map((n: any) => ({
                digest_id: ins.id,
                session_note_id: n.id,
              })));
            if (sourceError) {
              // A digest without durable provenance must never be displayed.
              await admin.from("progress_digests").delete().eq("id", ins.id);
              digest = null;
              console.error("progress provenance insert failed:", sourceError.message);
            }
          }
        }
      }
    }

    // ---- Adaptation: 3+ completed AND zero upcoming -> ask the engine for a pick.
    let adapted = false;
    if (completedCount >= 3 && upcomingCount === 0) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/${PROPOSALS_FN}`, {
          method: "POST",
          headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ plan_id: planId, trigger: "adaptation" }),
        });
        const j = await r.json();
        adapted = (j?.generated ?? 0) > 0;
      } catch (_) { /* non-fatal */ }
    }

    return json({
      completed_sessions: completedCount, upcoming_bookings: upcomingCount,
      digest, adapted,
    });
  } catch (e) {
    console.error("plan-progress error:", e);
    return json({ error: "Progress could not be generated." }, 500);
  }
});
