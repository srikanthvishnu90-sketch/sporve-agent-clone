// ============================================================================
// chat-answer  (Supabase Edge Function) — grounded customer-chat answer
// ============================================================================
// Prompt 2/3: the answering stage. Given the user's question + the retrieved
// provider rows (find/compare) OR policy text (question_about_booking), produce
// a short, warm, CONCRETE answer grounded ONLY in what it's given — never
// inventing a provider, price, rating, availability, or policy. Routes through
// ai-gateway (task="reason" -> sonnet workhorse tier, feature="chat_answer").
//
// Returns { text, provider_ids } — the ids the answer referenced, so the UI can
// render tappable provider cards. Retrieval already applied the hard safety
// gates; this stage must not relax anything.
//
// Input: {
//   question: string,
//   intent_type: "find_providers"|"compare"|"question_about_booking"|"other",
//   rows: Row[],           // retrieved services (facts-only; may be empty)
//   policy?: string,       // policies.md text (only for question_about_booking)
//   history?: {role,content}[]   // last turns for follow-up grounding
// }
// ============================================================================

import { HttpInputError, readBoundedJson } from "../_shared/http.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

const SYSTEM =
  `You are Sporve's assistant helping parents find youth sports coaching. Answer ONLY from the provided rows. Never invent a provider, price, rating, or availability. If asked for a list, return the top 3-5 with name, price, distance, and one concrete reason each. If the rows are empty, say no matches were found for those criteria and suggest ONE concrete widening (larger distance or higher budget) — never fabricate alternatives, never relax safety or age filters. If the question is about how bookings/refunds/policies work (intent_type: question_about_booking), answer from the provided policy text only; if no policy text covers it, say you don't know and point them to support. Keep answers short, warm, and concrete.`;

const ANSWER_TOOL = {
  name: "grounded_answer",
  description:
    "Return the assistant's answer and the provider_ids you referenced (empty for policy/other/no-match answers).",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string" },
      provider_ids: { type: "array", items: { type: "string" } },
    },
    required: ["text", "provider_ids"],
    additionalProperties: false,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const body = await readBoundedJson(req);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) return json({ error: "Provide `question`." }, 400);
    const intentType = typeof body?.intent_type === "string" ? body.intent_type : "other";
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const policy = typeof body?.policy === "string" ? body.policy : "";
    const history = Array.isArray(body?.history) ? body.history : [];

    // Build the grounding context the model may use — and nothing else.
    const context =
      intentType === "question_about_booking"
        ? `intent_type: question_about_booking\n\nPOLICY (the ONLY source you may cite):\n${policy || "(no policy text provided)"}`
        : `intent_type: ${intentType}\n\nRETRIEVED ROWS (the ONLY providers/prices/ratings you may cite; JSON):\n${JSON.stringify(rows)}`;

    const messages = [
      ...history
        .filter(
          (m: { role?: string; content?: string }) =>
            (m?.role === "user" || m?.role === "assistant") &&
            typeof m?.content === "string",
        )
        .slice(-6)
        .map((m: { role: string; content: string }) => ({
          role: m.role,
          content: [{ type: "text", text: m.content }],
        })),
      {
        role: "user",
        content: [{ type: "text", text: `${context}\n\nUser question: ${question}` }],
      },
    ];

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "reason",
        feature: "chat_answer",
        system: SYSTEM,
        messages,
        tools: [ANSWER_TOOL],
        tool_choice: { type: "tool", name: "grounded_answer" },
        maxTokens: 700,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) return json({ error: g?.error ?? `ai-gateway error (${gResp.status})` }, 502);

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    const out = (call?.input ?? {}) as { text?: unknown; provider_ids?: unknown };
    const text = typeof out.text === "string" ? out.text.trim() : "";
    if (!text) return json({ error: "The assistant did not return an answer." }, 502);

    // Only ever surface ids that were actually in the retrieved rows (defense in
    // depth against a hallucinated id).
    const allowed = new Set(rows.map((r: { provider_id?: unknown }) => String(r?.provider_id ?? "")));
    const ids = Array.isArray(out.provider_ids)
      ? out.provider_ids.map((x) => String(x)).filter((x) => allowed.has(x))
      : [];

    return json({ text, provider_ids: ids });
  } catch (e) {
    if (e instanceof HttpInputError) return json({ error: e.message }, e.status);
    console.error("chat-answer error:", e);
    return json({ error: "An answer could not be generated." }, 500);
  }
});
