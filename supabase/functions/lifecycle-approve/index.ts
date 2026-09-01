// ============================================================================
// lifecycle-approve  (Supabase Edge Function) — the coach's explicit SEND
// ============================================================================
// A drafted lifecycle message NEVER sends on its own. The coach reviews it in the
// approval queue, optionally edits the body, and explicitly approves — this
// function then approves + delivers it. (outbound_messages is SELECT-only for
// clients, so approve+send must happen server-side, like parent-update-send.)
//
// Authorization: caller must own the provider on the row. State guard: only a
// 'drafted' row may be approved. Final claim guardrail is applied to the body so
// no credential/medical/safety claim can reach a parent even if hand-typed.
//
// Input: { id: string, body?: string }   // body = coach's edited text (optional)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { enforceLifecycleDraft } from "../lifecycle-process/policy.ts";
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
    const id: string = typeof body?.id === "string" ? body.id : "";
    if (!id) return json({ error: "id is required." }, 400);
    const editedBody: string | null = typeof body?.body === "string" ? body.body : null;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: row, error: rErr } = await admin.from("outbound_messages")
      .select("id, provider_id, child_id, status, content").eq("id", id).maybeSingle();
    if (rErr) return json({ error: rErr.message }, 400);
    if (!row) return json({ error: "Message not found." }, 404);

    // AUTHORIZATION: caller must own the provider on this row.
    const { data: prov } = await admin.from("providers")
      .select("id").eq("id", row.provider_id).eq("owner_id", uid).maybeSingle();
    if (!prov) return json({ error: "Not authorized to approve this message." }, 403);

    if (row.status === "sent") return json({ ok: true, alreadySent: true, status: "sent" });
    if (row.status !== "drafted") {
      return json({ error: `Only a drafted message can be approved (status='${row.status}').` }, 409);
    }

    // Final guardrail: strip any credential/medical/safety claim from the body
    // that will actually be delivered (defense in depth, even on hand-typed edits).
    const sourceBody = editedBody ?? (row.content as { body?: string } | null)?.body ?? "";
    const { body: cleanBody, removed } = enforceLifecycleDraft(sourceBody);
    if (!cleanBody.trim()) {
      return json({ error: "Message body is empty after validation; nothing to send." }, 422);
    }

    // Resolve the verified guardian and deliver via the notifications channel.
    let guardianId: string | null = null;
    let childFirstName = "";
    if (row.child_id) {
      const { data: child } = await admin.from("athletes")
        .select("first_name, parent_id").eq("id", row.child_id).maybeSingle();
      guardianId = (child as { parent_id?: string } | null)?.parent_id ?? null;
      childFirstName = (child as { first_name?: string } | null)?.first_name ?? "";
    } else {
      // Agent rows (spec 05: dues/waiver/practice) carry the ORG guardian in
      // content.guardian_id. Delivery still requires a CLAIMED guardian — a
      // guardians row linked to a real user. An unclaimed guardian has no
      // channel yet, and pretending to send would be a lie the director acts on.
      const orgGuardianId = (row.content as { guardian_id?: string } | null)?.guardian_id;
      if (orgGuardianId) {
        const { data: g } = await admin.from("guardians")
          .select("user_id, email, email_bounced_at").eq("id", orgGuardianId).maybeSingle();
        const gr = g as { user_id?: string; email?: string; email_bounced_at?: string } | null;
        guardianId = gr?.user_id ?? null;
        if (!guardianId) {
          // Doc 08: an UNCLAIMED guardian is exactly who email exists for.
          // Approve the row (real approved_by — the director read this body)
          // and hand it to the email pass in lifecycle-process. A bounced
          // address is refused honestly instead of queued to fail.
          if (gr?.email_bounced_at) {
            return json({ error: "This guardian's email address bounced — fix the address on their record first." }, 422);
          }
          if (!gr?.email) {
            return json({ error: "This guardian has no email on file and hasn't joined Sporv yet." }, 422);
          }
          const cleanForEmail = enforceLifecycleDraft(sourceBody);
          if (!cleanForEmail.body.trim()) {
            return json({ error: "Message body is empty after validation; nothing to send." }, 422);
          }
          const { data: q } = await admin.from("outbound_messages")
            .update({
              content: { ...(row.content as Record<string, unknown> ?? {}), body: cleanForEmail.body, removed: cleanForEmail.removed },
              status: "approved",
              approved_by: uid,
              approved_at: new Date().toISOString(),
            })
            .eq("id", id).eq("status", "drafted")
            .select("id").maybeSingle();
          if (!q) return json({ error: "Only a drafted message can be approved." }, 409);
          return json({ ok: true, status: "approved", queuedEmail: true });
        }
      }
    }
    if (!guardianId) return json({ error: "No verified guardian to deliver to." }, 422);

    const subject = (row.content as { subject?: string } | null)?.subject ?? "";
    const title = childFirstName ? `Message from your coach about ${childFirstName}`
      : (subject || "Message from your club");
    const sentAt = new Date().toISOString();

    // CLAIM FIRST, DELIVER SECOND — the double-send fix.
    // The status flip is the atomic claim: `.eq("status","drafted")` means only
    // ONE concurrent caller can turn drafted -> sent; every other racer updates
    // zero rows and must NOT deliver. Previously the insert happened first and
    // the flip was gated on id only, so two tabs (or a retry after a failed
    // flip) could both pass the drafted check and both deliver — the parent got
    // the message twice, with no unique constraint on notifications to catch it.
    const { data: claimed, error: claimErr } = await admin.from("outbound_messages")
      .update({
        content: { ...(row.content as Record<string, unknown> ?? {}), body: cleanBody, removed },
        status: "sent",
        approved_by: uid,
        approved_at: sentAt,
        sent_at: sentAt,
      })
      .eq("id", id)
      .eq("status", "drafted")
      .select("id")
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      // Lost the race (or the row left 'drafted' between the read and here).
      // Re-read the truth: if someone already sent it, that's success, not a
      // second delivery; anything else is a genuine wrong-state 409.
      const { data: cur } = await admin.from("outbound_messages")
        .select("status").eq("id", id).maybeSingle();
      return (cur as { status?: string } | null)?.status === "sent"
        ? json({ ok: true, alreadySent: true, status: "sent" })
        : json({ error: `Only a drafted message can be approved (status='${(cur as { status?: string } | null)?.status ?? "unknown"}').` }, 409);
    }

    // Only the winner reaches here. Deliver via the notifications channel + push.
    // Residual (accepted): if this insert fails after the claim, the row is
    // 'sent' but undelivered — the rarer, safer inverse of a double-send; a
    // retry early-returns alreadySent rather than delivering twice.
    const { error: notifErr } = await admin.from("notifications")
      .insert([{ user_id: guardianId, title, message: cleanBody.slice(0, 280) }]);
    if (notifErr) return json({ error: `Marked sent but delivery failed: ${notifErr.message}` }, 500);

    await deliverPush(admin, guardianId, title, cleanBody.slice(0, 280));

    return json({ ok: true, status: "sent", sent_at: sentAt, removed });
  } catch (e) {
    console.error("lifecycle-approve error:", e);
    return json({ error: "Message approval could not be completed." }, 500);
  }
});
