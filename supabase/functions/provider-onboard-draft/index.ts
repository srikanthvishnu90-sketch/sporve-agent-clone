// ============================================================================
// provider-onboard-draft  (Supabase Edge Function)
// ============================================================================
// Turns messy onboarding input (pasted bio, an image, and/or a voice transcript)
// into a STRUCTURED DRAFT for a youth-sports coach profile. Returns a draft only
// — it writes nothing to the profile and never publishes.
//
// Flow:
//   1. Build a user message: image -> image content block; bio+transcript -> text.
//   2. Call ai-gateway (task="draft", feature="provider_onboard") with tool-use
//      forced to the exact schema below (so output is validated structured JSON).
//   3. Post-validate with the HARD GUARDRAIL (guardrail.ts): strip any cert /
//      years-of-experience / background-check / credential claim out of
//      bio/specialties/etc and route it verbatim into claimsToVerify[].
//   4. Benchmark suggestedPriceRange against comparable listings (by sport +
//      geography) and label it explicitly as a suggestion in the rationale.
//   5. Audit logging happens inside ai-gateway (feature="provider_onboard").
//
// Auth: a signed-in user (the prospective coach). Their JWT is forwarded to
// ai-gateway so the call is attributed to them.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { enforceClaimsGuardrail } from "./guardrail.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GATEWAY_FN = Deno.env.get("GATEWAY_FUNCTION_NAME") ?? "ai-gateway";

const DRAFT_TOOL = {
  name: "provider_onboard_draft",
  description: "Return the structured provider onboarding draft. Use this tool only.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      bio: { type: "string", description: "2-4 warm, concrete sentences about coaching approach and what sessions are like. NO credentials/certs/experience claims." },
      specialties: { type: "array", items: { type: "string" }, description: "Short descriptive tags, e.g. 'youth soccer', 'ball control'." },
      ageGroupsServed: { type: "array", items: { type: "string" } },
      sessionTypes: { type: "array", items: { type: "string" } },
      suggestedPriceRange: {
        type: "object",
        additionalProperties: false,
        properties: {
          min: { type: "number" },
          max: { type: "number" },
          rationale: { type: "string", description: "Must state this is a suggestion, not a set price." },
        },
        required: ["min", "max", "rationale"],
      },
      claimsToVerify: { type: "array", items: { type: "string" }, description: "Verbatim certifications / years of experience / background-check / credential claims from the input. These belong ONLY here." },
    },
    required: ["bio", "specialties", "ageGroupsServed", "sessionTypes", "suggestedPriceRange", "claimsToVerify"],
  },
};

const SYSTEM = [
  "You draft a youth-sports coach's onboarding profile from messy inputs (a pasted bio, an image, and/or a voice transcript). Return ONLY the structured draft via the provider_onboard_draft tool.",
  "",
  "HARD RULES (non-negotiable):",
  "- NEVER place certifications, license/credential names, years of experience, academic degrees, CPR/first-aid, or background-check status into bio, specialties, ageGroupsServed, sessionTypes, or the price rationale. These are UNVERIFIED claims.",
  "- If the input states any such claim, copy it VERBATIM into claimsToVerify and do NOT restate it anywhere else.",
  "- bio: warm, concrete, 2-4 sentences about coaching approach and what sessions feel like — no credentials, no numbers of years.",
  "- specialties / ageGroupsServed / sessionTypes: short descriptive tags only.",
  "- suggestedPriceRange: a SUGGESTION only. Provide numeric min/max and a rationale that explicitly says it is a suggestion, not a set price.",
  "- Do not invent facts that the input does not support.",
].join("\n");

// Comparable-listing price benchmark (best-effort; never fails the request).
async function priceBenchmark(sport?: string, city?: string, state?: string) {
  if (!sport || !SERVICE_ROLE_KEY) return null;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let q = admin.from("programs").select("price, city, state, sport_type")
      .ilike("sport_type", `%${sport}%`).gt("price", 0);
    if (city) q = q.ilike("city", `%${city}%`);
    if (state) q = q.ilike("state", `%${state}%`);
    const { data, error } = await q.limit(500);
    if (error || !data || data.length === 0) return null;
    const prices = data.map((r: { price: number }) => Number(r.price)).filter((n) => n > 0).sort((a, b) => a - b);
    if (prices.length === 0) return null;
    return {
      sport, city: city ?? null, state: state ?? null,
      comps_count: prices.length,
      comp_min: prices[0],
      comp_max: prices[prices.length - 1],
      comp_median: prices[Math.floor(prices.length / 2)],
    };
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    // Auth — only a signed-in user may draft (their own onboarding).
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const pastedBio: string = typeof body?.pastedBio === "string" ? body.pastedBio : "";
    const voiceTranscript: string = typeof body?.voiceTranscript === "string" ? body.voiceTranscript : "";
    const imageBase64: string = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    if (!pastedBio && !voiceTranscript && !imageBase64) {
      return json({ error: "Provide at least one of pastedBio, voiceTranscript, imageBase64." }, 400);
    }

    // Build the multimodal user message.
    const content: unknown[] = [];
    if (imageBase64) {
      // Accept a raw base64 string or a data URL; default media type to jpeg.
      let mediaType = typeof body?.imageMediaType === "string" ? body.imageMediaType : "image/jpeg";
      let data = imageBase64;
      const m = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      if (m) { mediaType = m[1]; data = m[2]; }
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
    }
    const textParts: string[] = [];
    if (pastedBio) textParts.push(`PASTED BIO:\n${pastedBio}`);
    if (voiceTranscript) textParts.push(`VOICE TRANSCRIPT:\n${voiceTranscript}`);
    textParts.push("Draft the structured onboarding profile from the above. Follow the HARD RULES exactly.");
    content.push({ type: "text", text: textParts.join("\n\n") });

    // Call the gateway with tool-use forced to the schema.
    const gResp = await fetch(`${SUPABASE_URL}/functions/v1/${GATEWAY_FN}`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "draft",
        feature: "provider_onboard",
        system: SYSTEM,
        messages: [{ role: "user", content }],
        tools: [DRAFT_TOOL],
        tool_choice: { type: "tool", name: "provider_onboard_draft" },
        maxTokens: 1500,
      }),
    });
    const g = await gResp.json();
    if (!gResp.ok) return json({ error: g?.error ?? `ai-gateway error (${gResp.status})`, audit_id: g?.audit?.id ?? null }, 502);

    const call = Array.isArray(g?.toolCalls) ? g.toolCalls.find((c: { name: string }) => c.name === "provider_onboard_draft") : null;
    if (!call?.input) {
      return json({ error: "Model did not return the draft tool output.", raw: g }, 502);
    }

    // HARD GUARDRAIL post-validation (defense in depth).
    const rawInputText = [pastedBio, voiceTranscript].filter(Boolean).join("\n");
    const { draft, moved } = enforceClaimsGuardrail(call.input, rawInputText);

    // Price benchmark + always label the range as a suggestion.
    const bench = await priceBenchmark(body?.sport, body?.city, body?.state);
    if (draft.suggestedPriceRange && typeof draft.suggestedPriceRange === "object") {
      let r = String(draft.suggestedPriceRange.rationale ?? "");
      if (!/suggest/i.test(r)) r = (r ? r + " " : "") + "This is a suggestion, not a set price.";
      if (bench) {
        r += ` Benchmark: ${bench.comps_count} comparable ${bench.sport} listing(s) priced ~$${bench.comp_min}–$${bench.comp_max} (median $${bench.comp_median}). Suggestion only — you set your own price.`;
      }
      draft.suggestedPriceRange.rationale = r.trim();
    }

    return json({
      draft,                       // DRAFT ONLY — nothing is written or published
      model: g?.model ?? null,
      audit_id: g?.audit?.id ?? null,
      benchmark: bench,
      moved_claims: moved,         // what post-validation pulled out of descriptive fields
      note: "Draft only — not saved to the profile and not published.",
    });
  } catch (e) {
    console.error("provider-onboard-draft error:", e);
    return json({ error: "Provider draft could not be generated." }, 500);
  }
});
