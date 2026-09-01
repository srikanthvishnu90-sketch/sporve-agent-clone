// ============================================================================
// parent-update-send  (Supabase Edge Function)
// ============================================================================
// The DETERMINISTIC send step for an APPROVED parent_update. It contains no AI:
// the content was already drafted, guardrailed, edited, and approved by the
// coach. This step only ROUTES that finalized record to the verified guardian(s)
// of the child, through the existing notifications/inbox channel, then marks the
// row sent.
//
// Runs with the service role because notifications has NO client-insert policy
// (server-side only) — so this function does its OWN authorization:
//   • caller must be the coach who owns the parent_update (provider.owner_id)
//   • the row must be status='approved'
// Then: insert a notification per guardian (athletes.parent_id) and set
// status='sent', sent_at, delivery_channel='inbox'.
//
// Input: { parentUpdateId: string }
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverPush } from "../_shared/push.ts";

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
const DELIVERY_CHANNEL = "inbox";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Identify the caller from their JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json({ error: "Not authenticated" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const parentUpdateId: string = typeof body?.parentUpdateId === "string" ? body.parentUpdateId : "";
    if (!parentUpdateId) return json({ error: "parentUpdateId is required." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Load the record (service role bypasses RLS — we authorize manually below).
    const { data: pu, error: puErr } = await admin
      .from("parent_updates")
      .select("id, provider_id, child_id, status, summary_body")
      .eq("id", parentUpdateId)
      .maybeSingle();
    if (puErr) return json({ error: puErr.message }, 400);
    if (!pu) return json({ error: "Update not found." }, 404);

    // AUTHORIZATION: caller must own the provider on this update.
    const { data: prov } = await admin
      .from("providers").select("id").eq("id", pu.provider_id).eq("owner_id", uid).maybeSingle();
    if (!prov) return json({ error: "Not authorized to send this update." }, 403);

    // Idempotent + state guard: only an approved row may be sent.
    if (pu.status === "sent") {
      return json({ ok: true, alreadySent: true, status: "sent" });
    }
    if (pu.status !== "approved") {
      return json({ error: `Update must be approved before sending (status='${pu.status}').` }, 409);
    }
    if (!pu.child_id) {
      return json({ error: "This update has no child to route to." }, 422);
    }

    // Verified guardian(s) of the child. The schema models a single guardian
    // (athletes.parent_id); we notify each distinct guardian id found.
    const { data: child, error: chErr } = await admin
      .from("athletes").select("id, parent_id, first_name").eq("id", pu.child_id).maybeSingle();
    if (chErr) return json({ error: chErr.message }, 400);
    const guardianIds = [...new Set([child?.parent_id].filter(Boolean))] as string[];
    if (guardianIds.length === 0) {
      return json({ error: "No verified guardian for this child." }, 422);
    }

    // 1) Deliver through the existing notifications/inbox channel.
    const firstName = child?.first_name ?? "your athlete";
    const preview = String(pu.summary_body ?? "").slice(0, 140);
    const rows = guardianIds.map((gid) => ({
      user_id: gid,
      title: `New progress update for ${firstName}`,
      message: preview,
    }));
    const { error: notifErr } = await admin.from("notifications").insert(rows);
    if (notifErr) return json({ error: `Could not deliver: ${notifErr.message}` }, 500);

    // Fan out a push to each guardian (best-effort; the inbox row already sent).
    for (const gid of guardianIds) {
      await deliverPush(admin, gid, `New progress update for ${firstName}`, preview);
    }

    // 2) Mark the record sent (deterministic state transition).
    const { data: updated, error: updErr } = await admin
      .from("parent_updates")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        delivery_channel: DELIVERY_CHANNEL,
      })
      .eq("id", parentUpdateId)
      .select("id, status, sent_at, delivery_channel")
      .single();
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, status: updated.status, sent_at: updated.sent_at, delivery_channel: updated.delivery_channel, notified: guardianIds });
  } catch (e) {
    console.error("parent-update-send error:", e);
    return json({ error: "Parent update could not be sent." }, 500);
  }
});
