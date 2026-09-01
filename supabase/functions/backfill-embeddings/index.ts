// ============================================================================
// backfill-embeddings  (Supabase Edge Function)
// ============================================================================
// Embeds existing listings (public.programs) and stores the vector + a source
// hash. IDEMPOTENT: a row is skipped when the hash of its embeddable content is
// unchanged, so re-running only embeds new/edited listings.
//
// EMBEDDED CONTENT (descriptive only): title, description, sport_type,
// skill_level, age_group, whats_included. NEVER price/location/availability/
// certifications/background-check (hard rule).
//
// Auth modes:
//   • service role (Authorization: Bearer <SERVICE_ROLE_KEY>) → ALL listings.
//   • signed-in user (their JWT)                              → only THEIR own
//     listings (RLS lets an owner update their programs; others are untouched).
//
// Vector generation is delegated to the generate-embedding function (single
// source of truth for the provider). Override its slug with EMBED_FUNCTION_NAME
// if you deployed it under a different name (default "generate-embedding").
//
// Response: { scanned, embedded, skipped, errors: [{id, error}], mode }
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EMBED_FN = Deno.env.get("EMBED_FUNCTION_NAME") ?? "generate-embedding";

type Program = {
  id: string;
  title: string | null;
  description: string | null;
  sport_type: string | null;
  skill_level: string | null;
  age_group: string | null;
  whats_included: string[] | null;
  embedding_source_hash: string | null;
  provider_id: string | null;
};

type Provider = { id: string; bio: string | null; sports: string[] | null };

// The ONLY fields that get embedded — descriptive content: the coach's bio +
// specialties (providers.sports) + the listing's title/description/what's-included
// + its session descriptions (titles). NEVER price, location, availability,
// certifications, or background-check/verification status.
function embeddableText(p: Program, provider: Provider | null, sessionTitles: string[]): string {
  return [
    provider?.bio,
    (provider?.sports ?? []).join(" "),
    p.title,
    p.description,
    p.sport_type,
    p.skill_level,
    p.age_group,
    (p.whats_included ?? []).join(" "),
    sessionTitles.join(" "),
  ].filter((v) => v && v.toString().trim()).join("\n").trim();
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Missing Authorization header" }, 401);

    const isService = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;

    // Pick the DB client: service role sees/writes ALL rows; a user is RLS-scoped
    // to rows they own (reads also include published rows, which we filter out).
    const db = isService
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });

    let ownedProviderIds: string[] | null = null;
    if (!isService) {
      const { data: u, error: uErr } = await db.auth.getUser();
      if (uErr || !u?.user) return json({ error: "Not authenticated" }, 401);
      // Restrict to listings the caller owns (so we don't waste embeds on
      // published-but-not-owned rows the caller can't write anyway).
      const { data: provs, error: pErr } = await db
        .from("providers").select("id").eq("owner_id", u.user.id);
      if (pErr) return json({ error: pErr.message }, 400);
      ownedProviderIds = (provs ?? []).map((r: { id: string }) => r.id);
      if (ownedProviderIds.length === 0) {
        return json({ scanned: 0, embedded: 0, skipped: 0, errors: [], mode: "user" });
      }
    }

    let q = db.from("programs").select(
      "id, provider_id, title, description, sport_type, skill_level, age_group, whats_included, embedding_source_hash",
    );
    if (!isService) q = q.in("provider_id", ownedProviderIds!);
    const { data: rows, error: selErr } = await q;
    if (selErr) return json({ error: selErr.message }, 400);

    // Hydrate provider bio/specialties + session descriptions for embeddable text.
    const provIds = [...new Set((rows ?? []).map((r: Program) => r.provider_id).filter(Boolean))] as string[];
    const provMap = new Map<string, Provider>();
    if (provIds.length) {
      const { data: provs } = await db.from("providers").select("id, bio, sports").in("id", provIds);
      for (const pr of (provs ?? []) as Provider[]) provMap.set(pr.id, pr);
    }
    const progIds = (rows ?? []).map((r: Program) => r.id);
    const sessMap = new Map<string, string[]>();
    if (progIds.length) {
      const { data: sess } = await db.from("sessions").select("program_id, title").in("program_id", progIds);
      for (const s of (sess ?? []) as { program_id: string; title: string | null }[]) {
        if (!s.title) continue;
        const arr = sessMap.get(s.program_id) ?? [];
        arr.push(s.title);
        sessMap.set(s.program_id, arr);
      }
    }

    let embedded = 0;
    let skipped = 0;
    const errors: { id: string; error: string }[] = [];

    for (const p of (rows ?? []) as Program[]) {
      try {
        const provider = p.provider_id ? (provMap.get(p.provider_id) ?? null) : null;
        const text = embeddableText(p, provider, sessMap.get(p.id) ?? []);
        if (!text) { skipped++; continue; }
        const hash = await sha256Hex(text);
        if (hash === p.embedding_source_hash) { skipped++; continue; }

        // Delegate vector generation to generate-embedding (provider lives there).
        const r = await fetch(`${SUPABASE_URL}/functions/v1/${EMBED_FN}`, {
          method: "POST",
          headers: {
            "apikey": ANON_KEY,
            "Authorization": `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
        });
        const ev = await r.json();
        if (!r.ok) throw new Error(ev?.error ?? `embed call failed (${r.status})`);
        const vec: number[] = ev.embedding;
        if (!Array.isArray(vec) || vec.length !== 1536) {
          throw new Error(`bad embedding length ${vec?.length}`);
        }

        // pgvector accepts the text form "[v1,v2,...]"; send as a string so
        // PostgREST casts text -> vector reliably.
        const { error: upErr } = await db
          .from("programs")
          .update({
            embedding: `[${vec.join(",")}]`,
            embedding_updated_at: new Date().toISOString(),
            embedding_source_hash: hash,
          })
          .eq("id", p.id);
        if (upErr) throw new Error(upErr.message);
        embedded++;
      } catch (e) {
        errors.push({ id: p.id, error: (e as Error).message });
      }
    }

    return json({
      scanned: rows?.length ?? 0,
      embedded,
      skipped,
      errors,
      mode: isService ? "service" : "user",
    });
  } catch (e) {
    console.error("backfill-embeddings error:", e);
    return json({ error: "Embedding backfill failed." }, 500);
  }
});
