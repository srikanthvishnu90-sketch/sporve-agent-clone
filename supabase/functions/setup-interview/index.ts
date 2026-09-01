// ============================================================================
// setup-interview  (Supabase Edge Function) — grounded coach SETUP proposal
// ============================================================================
// Provider Model Rebuild — item #4. Onboarding as an AI INTERVIEW, not a form.
// The Flutter client asks the coach 6–8 short questions and holds a resolved
// SPORT TEMPLATE of typical defaults. This function takes the coach's OWN answers
// (transcript) + that template and emits ONE structured, GROUNDED proposal bundle
// the coach then confirms/edits:
//   { services:[{service_type,title,duration_minutes,price_cents,capacity,sport,
//                source}], weekly_availability:[{day_of_week,start,end,source}],
//     policies:{cancellation,what_to_bring,source} }
//
// Routes through ai-gateway (task="extract" -> haiku, cheap tier,
// feature="setup_interview"). A single tool call constrains the output.
//
// HARD RULE (grounding — L-012 / L-016): every value is EITHER something the
// coach STATED (source="coach") OR the provided template default (source=
// "template", a labeled suggestion). The model must NEVER invent a fact about
// THIS coach — no price/day/duration/policy the coach didn't say and the template
// doesn't provide, and NO credential/experience/claim of any kind. The model
// proposes; the coach disposes. It writes NOTHING — the client's confirm path
// does the writes via the existing #1 repo methods.
//
// BEST-EFFORT: the client (SupabaseRepository.refineSetupBundle) falls back to
// the deterministic, offline template bundle on any error/empty — so this is an
// enhancement (parse messy free-text), never a blocker.
//
// Input:  { sport: string, transcript:[{q,a}], template:{ services, availability,
//           policies } }
// Output: { bundle, model?, audit_id? } | { error }
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

// Sane grounding clamps — a proposal outside these is treated as ungrounded and
// snapped back to the template (never fabricated up/down).
const PRICE_MIN_CENTS = 1000; // $10
const PRICE_MAX_CENTS = 50000; // $500
const DURATION_MIN = 15;
const DURATION_MAX = 240;
const CAPACITY_MAX = 40;
const MAX_SERVICES = 4;
const MAX_BLOCKS = 21; // 3 blocks/day * 7 days ceiling
const MAX_TRANSCRIPT = 12;

const BUNDLE_TOOL = {
  name: "propose_setup_bundle",
  description:
    "Emit ONE grounded setup proposal for this coach. Every field is EITHER a value the coach stated (source='coach') OR the provided template default (source='template'). Never invent a price, day, duration, policy, or any claim the coach did not state and the template does not provide.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      services: {
        type: "array",
        description:
          "The services the coach offers. Include a 'private' and/or 'group' service ONLY as the coach's answers indicate (default to the template's private service if unclear).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            service_type: { type: "string", enum: ["private", "group"] },
            title: { type: "string", description: "Short, plain title. May carry the sport, never a claim like 'elite' or 'certified'." },
            duration_minutes: { type: "integer" },
            price_cents: { type: "integer", description: "Integer cents. The coach's stated price, else the template default." },
            capacity: { type: "integer", description: "1 for private; the template's group size for group." },
            sport: { type: "string" },
            source: { type: "string", enum: ["coach", "template"], description: "'coach' if the coach stated the price/duration; 'template' if it is the suggested default." },
          },
          required: ["service_type", "title", "duration_minutes", "price_cents", "capacity", "sport", "source"],
        },
      },
      weekly_availability: {
        type: "array",
        description:
          "The ONE shared weekly grid — blocks of {day_of_week 0=Sun..6=Sat, start 'HH:mm', end 'HH:mm'}. Use the coach's stated days/times, else the template's. Never a per-service calendar.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            day_of_week: { type: "integer" },
            start: { type: "string" },
            end: { type: "string" },
            source: { type: "string", enum: ["coach", "template"] },
          },
          required: ["day_of_week", "start", "end", "source"],
        },
      },
      policies: {
        type: "object",
        additionalProperties: false,
        properties: {
          cancellation: { type: "string", description: "The coach's stated cancellation policy, else the template default." },
          what_to_bring: { type: "string", description: "What athletes should bring — the coach's words, else the template default." },
          source: { type: "string", enum: ["coach", "template"] },
        },
        required: ["cancellation", "what_to_bring", "source"],
      },
    },
    required: ["services", "weekly_availability", "policies"],
  },
};

const SYSTEM = [
  "You help a youth-sports coach finish onboarding by turning their short interview answers into ONE structured setup proposal, calling propose_setup_bundle exactly once.",
  "You are given (a) the coach's OWN answers and (b) a SPORT TEMPLATE of typical defaults for their sport.",
  "",
  "HARD RULES (grounding — this is a safety-relevant marketplace; do not break them):",
  "- Every value must be EITHER something the coach explicitly stated (mark source='coach') OR the provided template default (mark source='template'). Nothing else.",
  "- NEVER invent a price, day, time, duration, capacity, or policy the coach did not state and the template does not provide. When unsure, use the template default and mark it 'template'.",
  "- NEVER add a credential, certification, experience level, ranking, or any claim about THIS coach ('elite', 'certified', 'D1', years of experience, etc.). Titles may name the sport only.",
  "- The weekly availability is ONE shared grid for the coach, not per service. Do not attach times to services.",
  "- Prices are integer CENTS. If the coach says '$70', that is 7000. If they gave no number, use the template's default price and mark 'template'.",
  "- Keep policy text plain and short. If the coach didn't give one, use the template default verbatim and mark 'template'.",
  "- Do not include a service type the coach clearly does not offer. If the answers are ambiguous, include the template's private service.",
].join("\n");

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? Math.round(v) : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function str(v: unknown, max = 500): string {
  return (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Server-side grounding guard: snap any proposal fact outside sane bounds back to
// the TEMPLATE (never fabricate) and force source labels to the allowed set.
function harden(bundle: Record<string, unknown>, template: Record<string, unknown>): Record<string, unknown> {
  const tServices = Array.isArray(template?.services) ? template.services as Record<string, unknown>[] : [];
  const tPrivate = tServices.find((s) => s.service_type === "private") ?? tServices[0] ?? {};
  const tByType = (type: string) => tServices.find((s) => s.service_type === type) ?? tPrivate;

  const rawServices = Array.isArray(bundle?.services) ? bundle.services as Record<string, unknown>[] : [];
  const services = rawServices.slice(0, MAX_SERVICES).map((s) => {
    const type = s.service_type === "group" ? "group" : "private";
    const t = tByType(type) as Record<string, unknown>;
    const source = s.source === "coach" ? "coach" : "template";
    return {
      service_type: type,
      title: str(s.title, 120) || String(t.title ?? `${template.sport ?? ""} lesson`).trim(),
      duration_minutes: clampInt(s.duration_minutes, DURATION_MIN, DURATION_MAX, clampInt(t.duration_minutes, DURATION_MIN, DURATION_MAX, 60)),
      price_cents: clampInt(s.price_cents, PRICE_MIN_CENTS, PRICE_MAX_CENTS, clampInt(t.price_cents, PRICE_MIN_CENTS, PRICE_MAX_CENTS, 6000)),
      capacity: clampInt(s.capacity, 1, CAPACITY_MAX, type === "private" ? 1 : clampInt(t.capacity, 1, CAPACITY_MAX, 6)),
      sport: str(s.sport, 60) || String(template.sport ?? "").trim(),
      source,
    };
  });
  if (services.length === 0 && tPrivate) {
    const t = tPrivate as Record<string, unknown>;
    services.push({
      service_type: "private",
      title: String(t.title ?? `${template.sport ?? ""} private lesson`).trim(),
      duration_minutes: clampInt(t.duration_minutes, DURATION_MIN, DURATION_MAX, 60),
      price_cents: clampInt(t.price_cents, PRICE_MIN_CENTS, PRICE_MAX_CENTS, 6000),
      capacity: 1,
      sport: String(template.sport ?? "").trim(),
      source: "template",
    });
  }

  const rawBlocks = Array.isArray(bundle?.weekly_availability) ? bundle.weekly_availability as Record<string, unknown>[] : [];
  const tBlocks = Array.isArray(template?.availability) ? template.availability as Record<string, unknown>[] : [];
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  let blocks = rawBlocks.slice(0, MAX_BLOCKS).map((b) => ({
    day_of_week: clampInt(b.day_of_week, 0, 6, 0),
    start: timeRe.test(str(b.start)) ? str(b.start) : "17:00",
    end: timeRe.test(str(b.end)) ? str(b.end) : "20:00",
    source: b.source === "coach" ? "coach" : "template",
  })).filter((b) => b.start < b.end);
  if (blocks.length === 0) {
    blocks = tBlocks.map((b) => ({
      day_of_week: clampInt(b.day_of_week, 0, 6, 0),
      start: str(b.start) || "17:00",
      end: str(b.end) || "20:00",
      source: "template",
    }));
  }

  const rawPol = (bundle?.policies ?? {}) as Record<string, unknown>;
  const tPol = (template?.policies ?? {}) as Record<string, unknown>;
  const policies = {
    cancellation: str(rawPol.cancellation, 500) || str(tPol.cancellation, 500),
    what_to_bring: str(rawPol.what_to_bring, 500) || str(tPol.what_to_bring, 500),
    source: rawPol.source === "coach" ? "coach" : "template",
  };

  return { services, weekly_availability: blocks, policies };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const body = await readBoundedJson(req);
    const sport = typeof body?.sport === "string" ? body.sport.trim().slice(0, 60) : "";
    const template = (body?.template && typeof body.template === "object" && !Array.isArray(body.template))
      ? body.template as Record<string, unknown>
      : null;
    if (!template) return json({ error: "Provide `template` (object)." }, 400);

    const transcript = Array.isArray(body?.transcript)
      ? (body.transcript as unknown[]).slice(0, MAX_TRANSCRIPT).map((t) => {
          const o = (t ?? {}) as Record<string, unknown>;
          return { q: str(o.q, 200), a: str(o.a, 600) };
        }).filter((t) => t.a)
      : [];

    const userText = [
      `SPORT: ${sport || "(not stated)"}`,
      "",
      "SPORT TEMPLATE (typical defaults — use these ONLY where the coach did not state a value; label them source='template'):",
      JSON.stringify(template),
      "",
      "THE COACH'S OWN ANSWERS (the only source of facts about THIS coach):",
      transcript.length
        ? transcript.map((t, i) => `${i + 1}. Q: ${t.q}\n   A: ${t.a}`).join("\n")
        : "(no free-text answers captured)",
      "",
      "Call propose_setup_bundle once. Where the coach stated a value use it (source='coach'); otherwise use the template default (source='template'). Invent nothing.",
    ].join("\n");

    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "extract", // structured -> haiku
        feature: "setup_interview",
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
        tools: [BUNDLE_TOOL],
        tool_choice: { type: "tool", name: "propose_setup_bundle" },
        maxTokens: 1200,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) {
      // Non-fatal for the caller (it falls back to the local template bundle).
      return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);
    }

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls[0] : null;
    if (!call?.input) return json({ error: "Model did not return a bundle." }, 502);

    const bundle = harden(call.input as Record<string, unknown>, template);
    return json({ bundle, model: g?.model ?? null, audit_id: g?.audit?.id ?? null });
  } catch (e) {
    if (e instanceof HttpInputError) return json({ error: e.message }, e.status);
    console.error("setup-interview error:", e);
    return json({ error: "The setup proposal could not be generated." }, 500);
  }
});
