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
/* Run lifecycle-process's approved pass immediately (audit P2-6). Bounded to
   12s so an approval never hangs on delivery; the minute cron is the net. */
async function kickDelivery(): Promise<{ delivered?: number; deliveryFailed?: number; kick: "done" | "timeout" | "error" }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/lifecycle-process`, {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
      body: JSON.stringify({ reason: "approval" }),
    });
    const j = await r.json().catch(() => ({})) as { emailed?: number; emailFailed?: number };
    return { kick: r.ok ? "done" : "error", delivered: j.emailed, deliveryFailed: j.emailFailed };
  } catch (e) {
    return { kick: (e as Error)?.name === "AbortError" ? "timeout" : "error" };
  } finally { clearTimeout(t); }
}

/* ── G4 guard declaration (GATES.md G4, 2026-10-22) ──────────────────────────
   This function is the ONLY sender of a drafted outbound message, and it runs
   only on a human click (I1: the agent never sends — nothing here is callable
   by a cron, generator or Ask tool, and approved_by is always the caller).
   The client registry (src/mod-actions.js queue_approve) reads the receipt
   below back from outbound_messages before it shows "Sent". */
export const APPROVE_GUARD = {
  action: "lifecycle-approve",
  writes: "outbound_messages (status drafted -> sent | approved, approved_by, approved_at, sent_at) + notifications (one row per in-app delivery)",
  precondition: "authenticated caller; within rate limit; row exists; caller owns the row's provider; status is 'drafted' (atomic claim .eq('status','drafted')); body non-empty after the claim guardrail; a claimed guardian (in-app) or a non-bounced email (email pass)",
  inverse: "none — a delivered message cannot be recalled. An 'approved' row still waiting for the email pass can be returned to draft from Approvals. A claim whose in-app delivery insert is definitely refused is released back to 'drafted' before the 500; an uncertain insert is reconciled and, if unconfirmed, stays claimed.",
  receipt: "response.receipt { message_id, status, notification_id | null } — message_id is the claimed outbound_messages row; notification_id is the inserted notifications row; a delivery insert that returns no row is a 500, never ok:true",
} as const;

/* Delivery with a receipt: the notifications insert must return its row id.
   A write that returns no row (RLS, constraint, outage) is reported as an
   error — never as a delivery. Exported for tests/e2e/g4-action-registry. */
// `definite` is true only when the database answered and refused the row
// (a constraint, permission, type or PostgREST error code): then nothing was
// written and the claim may be released. A thrown fetch, a timeout, an error
// with no code, or a "success" with no row is UNCERTAIN — the row may exist.
const DEFINITE_REFUSAL = /^(23|42|22|P0|PGRST)/;
// deno-lint-ignore no-explicit-any
export async function insertDeliveryReceipt(admin: any, row: { id: string; user_id: string; title: string; message: string }) {
  try {
    const { data, error } = await admin.from("notifications").insert([row]).select("id").single();
    if (error) {
      const code = String((error as { code?: unknown }).code ?? "");
      return { notification_id: null, error: error.message || "delivery insert failed", definite: DEFINITE_REFUSAL.test(code) };
    }
    // deno-lint-ignore no-explicit-any
    const id = (data as any)?.id ?? null;
    if (!id) return { notification_id: null, error: "delivery insert returned no row", definite: false };
    return { notification_id: String(id), error: null, definite: true };
  } catch (e) {
    return { notification_id: null, error: (e as Error)?.message || "delivery insert failed", definite: false };
  }
}

/* After an UNCERTAIN insert: look up the notification by the id this
   request generated BEFORE inserting (notifications.id is a plain uuid
   default, so a client-supplied id is accepted). Exact, no heuristics.
   Returns the id, null when the read proves there is none, or undefined
   when the read itself failed (still undetermined). */
// deno-lint-ignore no-explicit-any
export async function findDeliveredNotification(admin: any, notificationId: string): Promise<string | null | undefined> {
  try {
    const { data, error } = await admin.from("notifications").select("id")
      .eq("id", notificationId).limit(1);
    if (error) return undefined;
    // deno-lint-ignore no-explicit-any
    const id = Array.isArray(data) && data[0] ? (data[0] as any).id : null;
    return id ? String(id) : null;
  } catch {
    return undefined;
  }
}

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: withinLimit, error: rateError } = await admin.rpc(
      "consume_edge_rate_limit",
      { p_actor_key: `user:${uid}`, p_scope: "lifecycle-approve:minute", p_limit: 30, p_window_seconds: 60 },
    );
    if (rateError) return json({ error: "Approval service is temporarily unavailable." }, 503);
    if (withinLimit !== true) return json({ error: "Too many approval attempts. Try again shortly." }, 429);

    const body = await req.json().catch(() => ({}));
    const id: string = typeof body?.id === "string" ? body.id : "";
    if (!id) return json({ error: "id is required." }, 400);
    const editedBody: string | null = typeof body?.body === "string" ? body.body : null;

    const { data: row, error: rErr } = await admin.from("outbound_messages")
      .select("id, provider_id, child_id, status, content").eq("id", id).maybeSingle();
    if (rErr) return json({ error: rErr.message }, 400);
    if (!row) return json({ error: "Message not found." }, 404);

    // AUTHORIZATION: caller must own the provider on this row.
    const { data: prov } = await admin.from("providers")
      .select("id").eq("id", row.provider_id).eq("owner_id", uid).maybeSingle();
    if (!prov) return json({ error: "Not authorized to approve this message." }, 403);

    if (row.status === "sent") {
      return json({ ok: true, alreadySent: true, status: "sent", message_id: id,
        receipt: { message_id: id, status: "sent", notification_id: null } });
    }
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
          if (!q?.id) return json({ error: "Only a drafted message can be approved." }, 409);
          /* AUDIT 2026-09-17 P2-6: delivery waited for the next minute's cron
             tick (15–62s). Kick the delivery pass now for this approval and
             report what it did; the cron stays as the safety net, and the
             pass itself is idempotent (it claims each row once). A kick that
             fails or times out leaves the row approved for the tick. */
          const kicked = await kickDelivery();
          return json({ ok: true, status: "approved", queuedEmail: true, ...kicked, message_id: q.id,
            receipt: { message_id: q.id, status: "approved", notification_id: null } });
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
        ? json({ ok: true, alreadySent: true, status: "sent", message_id: id,
            receipt: { message_id: id, status: "sent", notification_id: null } })
        : json({ error: `Only a drafted message can be approved (status='${(cur as { status?: string } | null)?.status ?? "unknown"}').` }, 409);
    }

    // Only the winner reaches here. Deliver via the notifications channel + push.
    // G4: the delivery must hand back its row id. No row = no delivery = loud 500.
    // The id is chosen here, before the insert, so an uncertain outcome can be
    // reconciled by exact id and a lost response can never mint a second row.
    const note = { id: crypto.randomUUID(), user_id: guardianId, title, message: cleanBody.slice(0, 280) };
    const delivered = await insertDeliveryReceipt(admin, note);
    let notificationId: string | null = delivered.notification_id;
    if (!notificationId && !delivered.definite) {
      /* UNCERTAIN (network, timeout, no code): the row may have landed.
         Reconcile before deciding. Found -> it was delivered; carry on with
         that receipt. Not found, or the check failed -> keep the claim: a
         late-committing insert plus a released draft would send twice, and a
         message held as 'sent' is the safer, recoverable failure. */
      const found = await findDeliveredNotification(admin, note.id);
      if (found) {
        notificationId = found;
      } else {
        return json({
          error: `Delivery could not be confirmed (${delivered.error}). The message is held as sent so it cannot go out twice; check with the family before sending it again.`,
          message_id: claimed.id, status: "sent", released: false, delivery: "unconfirmed",
        }, 500);
      }
    }
    if (!notificationId) {
      /* DEFINITE refusal: the database rejected the row, so nothing reached
         the parent. Release the claim so the row does not read 'sent' (a
         retry would hit the alreadySent paths and the message would never
         go): back to 'drafted' with the approval/sent stamps cleared,
         guarded on OUR claim (status sent + this sent_at) so a concurrent
         winner is never undone. Service role: the baseline
         outbound_freeze_server_columns trigger returns early for it, and
         outbound_messages_status_check allows 'drafted'. */
      const { data: released } = await admin.from("outbound_messages")
        .update({ status: "drafted", approved_by: null, approved_at: null, sent_at: null })
        .eq("id", claimed.id).eq("status", "sent").eq("sent_at", sentAt)
        .select("id").maybeSingle();
      return json({
        error: released?.id
          ? `Delivery failed: ${delivered.error}. The message was returned to drafts; nothing was sent.`
          : `Marked sent but delivery failed: ${delivered.error}`,
        message_id: claimed.id, status: released?.id ? "drafted" : "sent", released: !!released?.id,
      }, 500);
    }

    await deliverPush(admin, guardianId, title, note.message);

    return json({ ok: true, status: "sent", sent_at: sentAt, removed, message_id: claimed.id,
      notification_id: notificationId,
      receipt: { message_id: claimed.id, status: "sent", notification_id: notificationId } });
  } catch (e) {
    console.error("lifecycle-approve error:", e);
    return json({ error: "Message approval could not be completed." }, 500);
  }
});
