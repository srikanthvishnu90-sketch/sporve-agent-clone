// ============================================================================
// camp-broadcast  (Supabase Edge Function)  — Provider Model Rebuild item #7
// ============================================================================
// CAMP-SCOPED bulk messaging: a coach writes ONE announcement to every family in a
// camp, and it lands as a coach-only DRAFT in each family's thread — through the
// EXISTING ai_draft pipeline (the same coach-only, invisible-to-parent draft the
// draft-reply robot writes, L-017). The coach then one-approves + sends each from
// the shared inbox. This function NEVER auto-sends: it only creates ai_draft rows.
//
// Why drafts, not sends: a bulk send that skips the coach's eyes is exactly what we
// don't ship. Each draft is visible_to_parent=false until the coach flips it via the
// existing resolve_draft / send path. So "bulk message" = "bulk DRAFT"; the human
// still approves every one.
//
// The drafts are written with the SERVICE ROLE (ai_draft rows are server-only by
// L-017 — no client may forge a coach-only row); this function authorizes the coach
// manually first (must own the camp's provider).
//
// Input:  { serviceId: string, message: string }
// Output: { drafted: number, families: number, skipped: number }
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
    const uid = u.user.id; // the coach = the provider owner's profile id

    const body = await req.json().catch(() => ({}));
    const serviceId: string = typeof body?.serviceId === "string" ? body.serviceId : "";
    const message: string = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
    if (!serviceId || !message) return json({ error: "serviceId and message are required." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // AUTHORIZE: the caller must OWN the provider of this camp service.
    const { data: svc, error: svcErr } = await admin
      .from("services")
      .select("id, service_type, providers!inner(id, owner_id)")
      .eq("id", serviceId)
      .maybeSingle();
    if (svcErr) return json({ error: svcErr.message }, 400);
    if (!svc) return json({ error: "Camp not found." }, 404);
    if (svc.service_type !== "camp") return json({ error: "Service is not a camp." }, 422);
    const ownerId = (svc as { providers?: { owner_id?: string } }).providers?.owner_id;
    if (ownerId !== uid) return json({ error: "Not authorized for this camp." }, 403);

    // The registered families: distinct searcher_id on this camp's bookings.
    const { data: bks, error: bErr } = await admin
      .from("bookings")
      .select("searcher_id")
      .eq("service_id", serviceId)
      .in("status", ["pending", "confirmed"]);
    if (bErr) return json({ error: bErr.message }, 400);
    const families = [...new Set((bks ?? []).map((b: Record<string, unknown>) => b?.searcher_id).filter(Boolean))] as string[];

    let drafted = 0;
    let skipped = 0;
    for (const familyId of families) {
      // Find-or-create the 1:1 thread between this family and the coach. An unrouted
      // thread (no service_id/assigned_member_id) passes enforce_conversation_routing
      // early — we deliberately keep the broadcast thread unrouted.
      let convoId: string | null = null;
      const { data: existing } = await admin
        .from("conversations")
        .select("id")
        .eq("searcher_id", familyId)
        .eq("provider_id", uid)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        convoId = existing.id as string;
      } else {
        const { data: made, error: cErr } = await admin
          .from("conversations")
          .insert({ searcher_id: familyId, provider_id: uid })
          .select("id")
          .single();
        if (cErr || !made?.id) { skipped++; continue; }
        convoId = made.id as string;
      }

      // Insert the coach-only DRAFT (invisible to the parent until the coach sends).
      // sender_id = the coach (provider side). status='ai_draft' guarantees the
      // draft-reply webhook does NOT re-fire (its guard skips non-'sent' rows), and
      // the messages RLS hides it from the parent (incl. realtime — L-017).
      const { error: mErr } = await admin.from("messages").insert({
        conversation_id: convoId,
        sender_id: uid,
        body: message,
        status: "ai_draft",
        visible_to_parent: false,
        intent: "other",
      });
      if (mErr) { skipped++; continue; }
      drafted++;
    }

    return json({
      drafted,
      families: families.length,
      skipped,
      note: "Drafts only — each family's message is a coach-only draft. Nothing was sent; the coach approves + sends from the inbox.",
    });
  } catch (e) {
    console.error("camp-broadcast error:", e);
    return json({ error: "Camp broadcast could not be drafted." }, 500);
  }
});
