// ============================================================================
// ai-chat  (Supabase Edge Function)  — Anthropic Claude proxy
// ============================================================================
// Server-side home for the ANTHROPIC_API_KEY. The key is a SECRET: it lives in
// this function's environment ONLY, never in env.json or any Flutter/web code
// (the web build ships to the browser and would leak it). Same security model
// as the Stripe functions: secrets via Deno.env, service-role/keys never client.
//
// WHERE THE KEY GOES (one place):
//   • Deployed:  Supabase dashboard → Edge Functions → Secrets → add
//                ANTHROPIC_API_KEY = sk-ant-...   (see docs/ai-key-setup.md)
//   • Local dev: supabase/functions/.env  (gitignored)  → ANTHROPIC_API_KEY=...
//
// Auth: only signed-in users can call this (their JWT is validated), matching
// how invoke() attaches the caller's session token elsewhere in the app.
//
// Request body:  { "prompt": "..." }              (simple one-shot)
//            or  { "messages": [{role, content}], "system": "...", "maxTokens": 1024 }
// Response:      { "text": "...", "stop_reason": "...", "usage": {...} }  | { "error": "..." }
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

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // The key must be configured as a function secret (see header above).
    if (!ANTHROPIC_API_KEY) {
      return json({
        error:
          "ANTHROPIC_API_KEY is not set. Add it in Supabase → Edge Functions → "
          + "Secrets (or supabase/functions/.env for local dev).",
      }, 500);
    }

    // ── Authenticate the caller (only signed-in users may use AI) ───────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    // ── Build the Claude request from the body ──────────────────────────────
    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages)
      ? body.messages
      : typeof body?.prompt === "string"
        ? [{ role: "user", content: body.prompt }]
        : null;
    if (!messages) {
      return json({ error: "Provide `prompt` (string) or `messages` (array)." }, 400);
    }
    const system = typeof body?.system === "string" ? body.system : undefined;
    const maxTokens = Number.isInteger(body?.maxTokens) ? body.maxTokens : 1024;

    // ── Call Claude (raw Messages API — no SDK dependency to resolve) ───────
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("anthropic error:", data);
      return json({ error: data?.error?.message ?? "Anthropic API error" }, resp.status);
    }

    const text = Array.isArray(data?.content)
      ? data.content.filter((b: { type: string }) => b.type === "text")
          .map((b: { text: string }) => b.text).join("")
      : "";

    return json({ text, stop_reason: data?.stop_reason, usage: data?.usage });
  } catch (e) {
    console.error("ai-chat error:", e);
    return json({ error: (e as Error).message ?? "Unexpected error" }, 500);
  }
});
