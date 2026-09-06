// Supabase Edge Function: join-waitlist
// Saves a waitlist signup AND sends a confirmation email via Gmail SMTP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { HttpInputError, readBoundedJson, withHttpDeadline } from "../_shared/http.ts";

// ---- CORS (locked down: reflect only allowlisted origins) -------------------
function allowedOrigins(): string[] {
  const raw = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  }
  const site = (Deno.env.get("SITE_URL") ?? "").trim();
  if (site) {
    try { return [new URL(site).origin]; } catch { return []; }
  }
  return [];
}

function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type, authorization, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const origin = req.headers.get("origin") ?? "";
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "Cache-Control": "no-store", ...cors },
  });

// ---- hCaptcha -------------------------------------------------------------
let warnedNoCaptcha = false;
async function verifyCaptcha(body: Record<string, unknown>): Promise<boolean> {
  const secretKey = (Deno.env.get("HCAPTCHA_SECRET") ?? "").trim();
  if (!secretKey) {
    if (!warnedNoCaptcha) {
      console.warn("HCAPTCHA_SECRET not set — skipping captcha verification");
      warnedNoCaptcha = true;
    }
    return true;
  }
  const token =
    (typeof body.captchaToken === "string" && body.captchaToken) ||
    (typeof body["h-captcha-response"] === "string" && body["h-captcha-response"]) ||
    "";
  if (!token) return false;
  try {
    const params = new URLSearchParams();
    params.set("secret", secretKey);
    params.set("response", token as string);
    return await withHttpDeadline(async signal => {
      const resp = await fetch("https://hcaptcha.com/siteverify", {
        method: "POST", signal,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!resp.ok) throw new Error('captcha unavailable');
      const data = await readBoundedJson(resp, 16_384, signal);
      return data.success === true;
    }, 10_000);
  } catch {
    throw new HttpInputError(503, "Verification unavailable. Please try again later.");
  }
}

// ---- Durable rate limiting (atomic Postgres-backed fixed window) ----------
// The gateway must supply a trusted client IP. Header authenticity still needs
// deployed verification; CORS alone is not an identity or abuse boundary.
async function underRateLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ip: string,
): Promise<boolean> {
  const { data, error } = await withHttpDeadline(async signal => await supabase
    .rpc("consume_edge_rate_limit", {
      p_actor_key: "ip:" + ip, p_scope: "join-waitlist:hour",
      p_limit: 5, p_window_seconds: 3600,
    }).abortSignal(signal), 5000);
  if (error || typeof data !== "boolean") {
    throw new HttpInputError(503, "Signup limit service unavailable. Please try again later.");
  }
  return data;
}

// ---- Handler --------------------------------------------------------------
Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, cors);

  let body: Record<string, unknown>;
  try {
    body = await withHttpDeadline(signal => readBoundedJson(req, 16_384, signal), 5000);
  } catch (error) {
    return json({ ok: false, error: error instanceof HttpInputError ? error.message : "Bad request" },
      error instanceof HttpInputError ? error.status : 400, cors);
  }

  // Honeypot rejects the request; never claim an unrecorded signup succeeded.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return json({ ok: false, error: "Bad request" }, 400, cors);
  }

  const serviceUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceUrl || !serviceKey) return json({ ok: false, error: "Signup unavailable. Please try again later." }, 503, cors);
  const supabase = createClient(
    serviceUrl, serviceKey,
  );

  // Durable IP rate limit (before inserting the signup).
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || "unknown";
  if (ip.length > 128) return json({ ok: false, error: "Bad request" }, 400, cors);
  try {
    if (!(await underRateLimit(supabase, ip))) {
      const retry = 3600 - Math.floor(Date.now() / 1000) % 3600;
      return json({ ok: false, error: "Too many requests. Try again later." }, 429,
        {...cors, "Retry-After": String(retry)});
    }
  } catch (error) {
    return json({ ok: false, error: error instanceof HttpInputError ? error.message : "Signup limit service unavailable." },
      error instanceof HttpInputError ? error.status : 503, cors);
  }

  // Quota precedes captcha network work and all signup/confirmation writes.
  try {
    if (!(await verifyCaptcha(body))) return json({ ok: false, error: "Bad request" }, 400, cors);
  } catch {
    return json({ ok: false, error: "Verification unavailable. Please try again later." }, 503, cors);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: "Enter a valid email address." }, 400, cors);
  }

  const role = body.role === "provider" ? "coach" : "parent";
  const sports = Array.isArray(body.sports) ? body.sports.filter((s): s is string => typeof s === 'string')
    .slice(0, 12).map(s => s.slice(0, 80)) : [];
  const referred_by = typeof body.ref === "string" && body.ref ? body.ref.slice(0, 120) : null;
  const source = typeof body.source === "string" ? body.source.slice(0, 120) : "landing";

  let saved;
  try {
    saved = await withHttpDeadline(async signal => await supabase
      .from("waitlist")
      .insert({ email, role, sports, referred_by, source })
      .select("position, ref_code")
      .abortSignal(signal)
      .single(), 8000);
  } catch {
    return json({ ok: false, error: "We couldn't confirm your signup. Please try again." }, 503, cors);
  }
  const { data, error } = saved;

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      // Another unique key (for example ref_code) can collide too. Confirm
      // this exact normalized email exists before acknowledging idempotency.
      try {
        const existing = await withHttpDeadline(async signal => await supabase
          .from("waitlist").select("id").eq("email", email)
          .abortSignal(signal).maybeSingle(), 5000);
        if (!existing.error && typeof existing.data?.id === "string" && existing.data.id) {
          return json({ ok: true }, 200, cors); // no membership details or re-send
        }
      } catch { /* Ambiguous result remains a failure, never a phantom signup. */ }
      return json({ ok: false, error: "We couldn't confirm your signup. Please try again." }, 503, cors);
    }
    console.error("waitlist insert failed");
    return json({ ok: false, error: "Something went wrong — try again." }, 500, cors);
  }

  if (!data || !Number.isSafeInteger(data.position) || data.position < 1 ||
    typeof data.ref_code !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(data.ref_code)) {
    // Ambiguous result: the insert may have committed, so a retry remains
    // idempotent through the existing unique email constraint; never email here.
    return json({ ok: false, error: "We couldn't confirm your signup. Please try again." }, 502, cors);
  }

  const position: number | undefined = data.position;
  const refCode: string | undefined = data.ref_code;

  if (refCode) {
    try {
      await sendConfirmation(email, role, refCode, position ?? 0);
    } catch {
      console.error("waitlist confirmation delivery not confirmed");
    }
  }

  return json({ ok: true, position, refCode, alreadyOnList: false }, 200, cors);
});

function secret(name: string): string {
  return (Deno.env.get(name) ?? Deno.env.get(name.toLowerCase()) ?? "").trim();
}

async function sendConfirmation(to: string, role: string, refCode: string, position: number) {
  const user = secret("GMAIL_USER");
  const pass = secret("GMAIL_APP_PASSWORD").replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error(`missing secret (GMAIL_USER set=${!!user}, GMAIL_APP_PASSWORD set=${!!pass})`);
  }
  const site = (secret("SITE_URL") || "https://sporve.com").replace(/\/$/, "");
  const refLink = `${site}/?ref=${refCode}`;
  const unsubLink = `${site}/unsubscribe?email=${encodeURIComponent(to)}`;

  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } },
  });

  const isCoach = role === "coach";
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f1720">
    <div style="padding:28px 4px">
      <div style="font-size:20px;font-weight:800;letter-spacing:-.5px;color:#0f1720">Sporve</div>
    </div>
    <div style="border:1px solid #E2E5E8;border-radius:12px;padding:28px">
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800">You're on the waitlist 🎉</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569">
        ${isCoach
          ? "Thanks for joining as a coach. We'll reach out before launch about founding-coach onboarding and reduced fees."
          : "Thanks for joining. We'll email you the moment Sporve opens in your area — vetted coaches, real availability, secure booking."}
      </p>
      <p style="margin:0 0 6px;font-size:13px;color:#647079">Your spot in line</p>
      <div style="font-size:28px;font-weight:800;color:#536878;margin:0 0 20px">#${position}</div>
      <p style="margin:0 0 10px;font-size:14px;font-weight:700">Move up the list — invite a friend</p>
      <a href="${refLink}" style="display:inline-block;background:#536878;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:8px">Share your link</a>
      <p style="margin:14px 0 0;font-size:12px;color:#9AA7B2;word-break:break-all">${refLink}</p>
    </div>
    <p style="font-size:12px;color:#9AA7B2;padding:18px 4px">
      Launching 2026 · You got this email because you joined the Sporve waitlist.<br>
      <a href="${unsubLink}" style="color:#9AA7B2">Unsubscribe</a><br>
      Sporve · [YOUR BUSINESS MAILING ADDRESS]
    </p>
  </div>`;

  const content =
    "You're on the Sporve waitlist. We'll email you when we launch. " +
    "Your referral link: " + refLink + "\n\n" +
    "Unsubscribe: " + unsubLink + "\n" +
    "Sporve · [YOUR BUSINESS MAILING ADDRESS]";

  try {
    await withHttpDeadline(() => client.send({
      from: `Sporve <${user}>`,
      to,
      subject: "You're on the Sporve waitlist 🎉",
      content,
      html,
    }), 10_000);
  } finally {
    await withHttpDeadline(() => client.close(), 2000);
  }
}
