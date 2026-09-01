// ============================================================================
// ai-feedback — authenticated, privacy-minimized AI quality feedback
// ============================================================================
// Accepted content is deliberately limited to feature/version metadata, one
// category, one helpfulness value, and an optional short comment. Prompts,
// model responses, message histories, and arbitrary metadata are rejected.
// Authentication happens before the request body is read.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      ...extraHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FEEDBACK_HASH_KEY = Deno.env.get("AI_FEEDBACK_HASH_KEY") ?? "";
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_COMMENT_CHARS = 500;
const encoder = new TextEncoder();

const FEATURES = new Set([
  "coach_discovery",
  "coach_matching",
  "natural_language_search",
  "parent_update_draft",
  "message_draft",
  "draft_approvals",
]);
const CATEGORIES = new Set([
  "accuracy",
  "relevance",
  "stale_listing",
  "safety",
  "technical",
  "other",
]);
const HELPFULNESS = new Set(["yes", "partly", "no"]);
const ACCEPTED_KEYS = new Set(["feature", "version", "category", "helpfulness", "comment"]);

type FeedbackInput = {
  feature: string;
  version: string;
  category: string;
  helpfulness: string;
  comment: string | null;
};

class FeedbackError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "FeedbackError";
  }
}

async function authenticate(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!bearer) {
    throw new FeedbackError(401, "missing_authorization", "Sign in to send feedback.");
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    throw new FeedbackError(401, "not_authenticated", "Sign in to send feedback.");
  }
  return data.user.id;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
  allowed?: Set<string>,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new FeedbackError(400, "invalid_feedback", `${key} is required.`);
  }
  const normalized = value.trim();
  if (allowed && !allowed.has(normalized)) {
    throw new FeedbackError(400, "invalid_feedback", `${key} is not supported.`);
  }
  return normalized;
}

async function readFeedback(req: Request): Promise<FeedbackInput> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new FeedbackError(413, "request_too_large", "Feedback is too large.");
  }
  const raw = await req.text();
  if (encoder.encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new FeedbackError(413, "request_too_large", "Feedback is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new FeedbackError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FeedbackError(400, "invalid_feedback", "Feedback must be a JSON object.");
  }
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ACCEPTED_KEYS.has(key))) {
    throw new FeedbackError(
      400,
      "unsupported_fields",
      "Only structured feedback fields are accepted.",
    );
  }

  const feature = requiredString(body, "feature", FEATURES);
  const version = requiredString(body, "version");
  if (version.length > 32 || !/^[A-Za-z0-9._-]+$/.test(version)) {
    throw new FeedbackError(400, "invalid_feedback", "version is not supported.");
  }
  const category = requiredString(body, "category", CATEGORIES);
  const helpfulness = requiredString(body, "helpfulness", HELPFULNESS);

  if (body.comment != null && typeof body.comment !== "string") {
    throw new FeedbackError(400, "invalid_feedback", "comment must be text.");
  }
  const comment = typeof body.comment === "string"
    ? body.comment.trim().replace(/\r\n?/g, "\n")
    : "";
  if (comment.length > MAX_COMMENT_CHARS) {
    throw new FeedbackError(413, "comment_too_large", "Comment must be 500 characters or fewer.");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(comment)) {
    throw new FeedbackError(400, "invalid_feedback", "Comment contains unsupported characters.");
  }

  return { feature, version, category, helpfulness, comment: comment || null };
}

async function privateActorHash(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(FEEDBACK_HASH_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`sporve-ai-feedback:v1:${userId}`),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  try {
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !FEEDBACK_HASH_KEY) {
      throw new FeedbackError(503, "service_not_configured", "Feedback is temporarily unavailable.");
    }

    const userId = await authenticate(req);
    const feedback = await readFeedback(req);
    const actorHash = await privateActorHash(userId);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc("submit_ai_feedback", {
      p_actor_hash: actorHash,
      p_feature: feedback.feature,
      p_feature_version: feedback.version,
      p_category: feedback.category,
      p_helpfulness: feedback.helpfulness,
      p_comment: feedback.comment,
    });

    if (error) {
      if (error.message?.includes("feedback_rate_limited")) {
        throw new FeedbackError(429, "rate_limited", "Feedback limit reached. Try again later.");
      }
      console.error("ai-feedback storage failed", { code: error.code ?? "unknown" });
      throw new FeedbackError(503, "storage_unavailable", "Feedback is temporarily unavailable.");
    }
    return json({ ok: true }, 201);
  } catch (error) {
    const known = error instanceof FeedbackError
      ? error
      : new FeedbackError(500, "internal_error", "Feedback is temporarily unavailable.");
    if (!(error instanceof FeedbackError)) {
      console.error("ai-feedback failed", { type: (error as Error)?.name ?? "unknown" });
    }
    return json(
      { error: known.message, code: known.code },
      known.status,
      known.status === 429 ? { "Retry-After": "3600" } : {},
    );
  }
});
