// ============================================================================
// waitlist-offer-draft  (Supabase Edge Function) — the AGENT DRAFTS the OFFER
// ============================================================================
// Provider Model Rebuild item #8. Invoked by open_waitlist_seat (20260729_000800)
// over pg_net when a seat frees on a FULL group slot and the first eligible waitlist
// family is resolved. It writes a GROUNDED, coach-only ai_draft into the family's
// conversation — reusing the EXISTING ai_draft pipeline (messages.status='ai_draft',
// visible_to_parent=false; the coach approves/sends via resolve_draft; the offer is
// revealed to the family by the trg_waitlist_offer_on_message_sent trigger). It NEVER
// auto-sends (L-003) and NEVER invents a price/time (L-012).
//
// Auth: server-only. Requires the exact service-role bearer (same as draft-reply).
// verify_jwt is OFF; the caller is the DB trigger. A forged/absent bearer -> 403.
//
// GROUNDING: the ONLY facts cited are the offer's real opening (service title, the
// exact freed day/time, the service price + duration in the DB) + the 24h window +
// the coach's name/verification. Everything is a DB fact tied to THIS offer — no
// availability is invented. The model is used for the coach's VOICE; if it is
// unavailable, a deterministic grounded template (identical facts) is drafted instead,
// so the coach is never left with an empty draft (the whole point of #8 is that the
// coach doesn't forget who asked). Either way the coach reviews before sending.
//
// Input (from open_waitlist_seat): { offer_id }.  Also tolerates a Dashboard
// Database-Webhook payload: { record: { id } }.
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
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

type Admin = ReturnType<typeof createClient>;

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Strict-JSON contract — the model only rewrites the given facts in the coach's voice.
const OFFER_TOOL = {
  name: "drafted_offer",
  description:
    "Emit ONE short, warm offer message a youth-sports coach could send to a family whose waitlisted spot just opened. Draft only — never sent automatically. Use ONLY the facts provided.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply_text: {
        type: "string",
        description:
          "The offer, in the coach's voice, under ~70 words: a spot opened for <service> on <day/time>, invite them to claim it, mention it holds ~24h. Never invent any other time, price, or promise.",
      },
    },
    required: ["reply_text"],
  },
};

const SYSTEM = [
  "You draft a short message a youth-sports coach sends to a family whose waitlisted spot just opened. You will CALL the drafted_offer tool — nothing else.",
  "GROUNDING — non-negotiable (you are quoted verbatim to a real parent):",
  "- Use ONLY the facts in the CONTEXT block: the service, the ONE freed day/time, the price/duration if present, and the ~24h hold window. Treat that block as the entire world.",
  "- NEVER state another time, day, price, or availability that is not in the context. NEVER promise or confirm a booking or a charge — invite them to claim it; the family confirms.",
  "- Prices in the context are in CENTS; convert to dollars when you mention money (8000 -> $80). Introduce no number that isn't in the context.",
  "STYLE: warm, plain, concise, under ~70 words. This is good news — a spot they wanted just opened.",
].join("\n");

/** Coerce a Postgres `time` value ("17:00:00") to a friendly "5:00 PM". */
function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
  if (!m) return String(t ?? "");
  let h = Number(m[1]);
  const min = m[2];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

/** Day-of-week name for an ISO date (YYYY-MM-DD), UTC-safe. */
function dayName(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : DOW[d.getUTCDay()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (bearer !== SERVICE_ROLE_KEY) {
      return json({ error: "Forbidden (service role only)." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const record = (body?.record ?? null) as { id?: unknown } | null;
    const offerId: string =
      typeof body?.offer_id === "string" ? body.offer_id
      : typeof record?.id === "string" ? record.id
      : "";
    if (!offerId) return json({ error: "offer_id is required." }, 400);

    const admin: Admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Load the offer + its waitlist entry (service role: RLS bypassed). ───────
    const { data: offer, error: offErr } = await admin
      .from("waitlist_offers")
      .select("id, entry_id, provider_id, service_id, slot_date, slot_time, status, expires_at, draft_message_id")
      .eq("id", offerId)
      .maybeSingle();
    if (offErr || !offer) return json({ error: "Offer not found." }, 404);

    // Only draft for a fresh, undrafted offer (idempotent: a re-fire is a no-op).
    if (offer.status !== "drafted") {
      return json({ skipped: `offer status is ${offer.status}, not drafted.` });
    }
    if (offer.draft_message_id) {
      return json({ skipped: "offer already has a draft." });
    }
    if (!offer.service_id) {
      return json({ skipped: "offer has no service slot to draft for." });
    }

    const { data: entry, error: entErr } = await admin
      .from("program_waitlist")
      .select("id, searcher_id, provider_id, athlete_first_name")
      .eq("id", offer.entry_id)
      .maybeSingle();
    if (entErr || !entry) return json({ error: "Waitlist entry not found." }, 404);

    // The coach = the provider owner's PROFILE (conversations.provider_id is a profile).
    const { data: prov } = await admin
      .from("providers")
      .select("id, owner_id, business_name, background_check_status, account_status")
      .eq("id", offer.provider_id)
      .maybeSingle();
    if (!prov || !prov.owner_id) {
      console.error("waitlist-offer-draft: no provider/owner for", offer.provider_id);
      return json({ skipped: "no provider profile to draft as." });
    }
    const coachProfileId = prov.owner_id as string;
    const familyProfileId = entry.searcher_id as string;

    // The service (title/price/duration) — the ONLY paid facts we may quote.
    const { data: svc } = await admin
      .from("services")
      .select("id, title, price, duration_minutes")
      .eq("id", offer.service_id)
      .maybeSingle();
    if (!svc) return json({ skipped: "service not found." });

    // ── Find-or-create the conversation between this family and this coach. ─────
    // A waitlist offer may be the FIRST contact, so a thread need not exist yet.
    let conversationId: string | null = null;
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("searcher_id", familyProfileId)
      .eq("provider_id", coachProfileId)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      conversationId = existing.id as string;
    } else {
      const { data: created, error: convErr } = await admin
        .from("conversations")
        .insert({ searcher_id: familyProfileId, provider_id: coachProfileId })
        .select("id")
        .single();
      if (convErr || !created) {
        console.error("waitlist-offer-draft: conversation create failed", convErr?.message);
        return json({ error: "Could not open a conversation for the offer." }, 500);
      }
      conversationId = created.id as string;
    }

    // ── Build the grounded fact block (the entire world the draft may cite). ────
    const day = dayName(String(offer.slot_date ?? ""));
    const time = fmtTime(String(offer.slot_time ?? ""));
    const priceCents = typeof svc.price === "number" ? svc.price : null;
    const priceStr = priceCents != null ? `$${(priceCents / 100).toFixed(0)}` : null;
    const dur = typeof svc.duration_minutes === "number" ? svc.duration_minutes : null;
    const whenStr = [day, time].filter(Boolean).join(" ").trim() || `on ${offer.slot_date}`;

    const ctx: string[] = [];
    ctx.push("A waitlisted spot just opened. Draft the coach's offer to the family.");
    ctx.push(`- Coach: ${String(prov.business_name ?? "the coach")}`);
    ctx.push(`- Service: ${String(svc.title ?? "a session")}`);
    ctx.push(`- Freed slot (the ONLY day/time you may cite): ${whenStr}`);
    if (dur != null) ctx.push(`- Duration: ${dur} minutes`);
    if (priceCents != null) ctx.push(`- Price: price_cents=${priceCents} (=${priceStr})`);
    ctx.push("- The offer holds for about 24 hours, then it passes to the next family.");
    if (entry.athlete_first_name) ctx.push(`- Athlete first name: ${String(entry.athlete_first_name)}`);
    ctx.push("Invite them to claim the spot. Do not invent any other time, price, or promise.");

    // Deterministic grounded template — the fallback (and a safe floor). Same facts.
    const athlete = entry.athlete_first_name ? ` for ${String(entry.athlete_first_name)}` : "";
    const priceClause = priceStr ? ` (${priceStr}${dur != null ? `, ${dur} min` : ""})` : "";
    const templateText =
      `Good news — a spot just opened in ${String(svc.title ?? "our session")} ${whenStr}${priceClause}. ` +
      `You're first on the waitlist${athlete}, so it's yours if you'd like it. ` +
      `It'll hold for about 24 hours before it goes to the next family — just tap to claim your spot.`;

    // ── ONE Claude call THROUGH ai-gateway for the coach's voice (best-effort). ─
    let replyText = templateText;
    try {
      const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
        method: "POST",
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task: "draft",
          feature: "waitlist_offer",
          system: SYSTEM,
          messages: [{ role: "user", content: [{ type: "text", text: ctx.join("\n") }] }],
          tools: [OFFER_TOOL],
          tool_choice: { type: "tool", name: "drafted_offer" },
          actorId: prov.id,
          actorRole: "provider",
          maxTokens: 400,
        }),
      });
      if (gResp.ok) {
        const g = await gResp.json().catch(() => ({}));
        const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
        const out = (call?.input ?? {}) as { reply_text?: unknown };
        const t = typeof out.reply_text === "string" ? out.reply_text.trim() : "";
        if (t) replyText = t;
      } else {
        console.error("waitlist-offer-draft: ai-gateway non-ok; using grounded template", gResp.status);
      }
    } catch (e) {
      console.error("waitlist-offer-draft: ai-gateway call failed; using grounded template", e);
    }

    // ── INSERT the coach-only ai_draft, then link it to the offer. ──────────────
    const { data: draft, error: insErr } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: coachProfileId,
        body: replyText,
        status: "ai_draft",
        visible_to_parent: false,
        intent: "booking",
      })
      .select("id")
      .single();
    if (insErr || !draft) {
      console.error("waitlist-offer-draft: draft insert failed", insErr?.message);
      return json({ error: "Draft could not be saved." }, 500);
    }

    const { error: linkErr } = await admin
      .from("waitlist_offers")
      .update({ draft_message_id: draft.id })
      .eq("id", offer.id)
      .eq("status", "drafted");
    if (linkErr) {
      console.error("waitlist-offer-draft: offer link failed", linkErr.message);
      // The draft exists (coach-only); the link is best-effort metadata.
    }

    return json({
      result: "drafted",
      offer_id: offer.id,
      draft_id: draft.id,
      conversation_id: conversationId,
      used_template: replyText === templateText,
      note: "Offer draft saved (coach-only). Never auto-sent — the coach reviews and sends.",
    });
  } catch (e) {
    console.error("waitlist-offer-draft error:", e);
    return json({ error: "Offer draft could not be generated." }, 500);
  }
});
