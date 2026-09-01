// ============================================================================
// generate-embedding  (Supabase Edge Function)
// ============================================================================
// One internal function: embedText(text) -> number[1536]. The provider is chosen
// by the EMBEDDING_PROVIDER env var (default "openai"), so switching providers
// later is a config change, not a code change. Keys come from secrets — never
// hardcoded, never shipped to the client.
//
//   EMBEDDING_PROVIDER = "openai" (default) | "voyage"
//   OPENAI_API_KEY     = sk-...        (required for the openai path)
//   VOYAGE_API_KEY     = pa-...        (for the voyage path — TODO, stubbed)
//
// Auth: callable by a signed-in user (JWT validated) OR internally with the
// service-role key (used by backfill-embeddings). No anon access.
//
// Request:  { "text": "..." }
// Response: { "embedding": number[1536], "dimensions": 1536, "provider": "openai" }
//        |  { "error": "..." }
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

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

const EMBED_DIM = 1536;
const EMBEDDING_PROVIDER = (Deno.env.get("EMBEDDING_PROVIDER") ?? "openai").toLowerCase();
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// ── Provider implementations (same interface: string -> number[1536]) ────────

async function embedTextOpenAI(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error?.message ?? `OpenAI embeddings error ${resp.status}`);
  }
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
    throw new Error(`Expected a ${EMBED_DIM}-d vector, got length ${vec?.length}`);
  }
  return vec;
}

// TODO(voyage): implement Voyage AI embeddings behind this same signature so the
// provider becomes a config flip (EMBEDDING_PROVIDER=voyage). Sketch:
//   POST https://api.voyageai.com/v1/embeddings
//   headers: Authorization: Bearer ${VOYAGE_API_KEY}
//   body: { model: "<a 1536-d model>", input: [text], input_type: "document" }
//   -> data[0].embedding  (must be length 1536 to match the column / index)
// Keep the 1536-d assertion below so a dimension mismatch fails loudly.
async function embedTextVoyage(_text: string): Promise<number[]> {
  void VOYAGE_API_KEY;
  throw new Error("EMBEDDING_PROVIDER=voyage is not implemented yet (TODO). Use openai.");
}

/** The single internal embedding entry point. Returns a 1536-length vector. */
async function embedText(text: string): Promise<number[]> {
  const t = (text ?? "").toString().trim();
  if (!t) throw new Error("embedText: empty text");
  switch (EMBEDDING_PROVIDER) {
    case "openai": return embedTextOpenAI(t);
    case "voyage": return embedTextVoyage(t);
    default: throw new Error(`Unknown EMBEDDING_PROVIDER: "${EMBEDDING_PROVIDER}"`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    // Auth: a signed-in user, or the service role (internal callers like backfill).
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Missing Authorization header" }, 401);
    const isService = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
    if (!isService) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: u, error } = await userClient.auth.getUser();
      if (error || !u?.user) return json({ error: "Not authenticated" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    if (typeof body?.text !== "string") {
      return json({ error: "Provide `text` (string)." }, 400);
    }

    const embedding = await embedText(body.text);
    return json({ embedding, dimensions: embedding.length, provider: EMBEDDING_PROVIDER });
  } catch (e) {
    console.error("generate-embedding error:", e);
    return json({ error: "Embedding request failed." }, 500);
  }
});
