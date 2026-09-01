// Supabase Edge Function: join-waitlist
// Saves a waitlist signup AND sends a confirmation email via Gmail SMTP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
    headers: { "content-type": "application/json", ...cors },
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
    const resp = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = (await resp.json()) as { success?: boolean };
    return data?.success === true;
  } catch (e) {
    console.error("captcha verify failed", e);
    return false;
  }
}

// ---- Durable rate limiting (Postgres-backed) ------------------------------
async function underRateLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ip: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("waitlist_rate_limit")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("ts", since);
  if (error) {
    console.error("rate limit check error", error);
    return true; // fail open
  }
  if ((count ?? 0) >= 5) return false;
  const { error: insErr } = await supabase.from("waitlist_rate_limit").insert({ ip });
  if (insErr) console.error("rate limit insert error", insErr);
  return true;
}

// ---- Handler --------------------------------------------------------------
Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, cors);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, 400, cors);
  }

  // Honeypot: bots fill hidden "company" field → pretend success, store nothing.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return json({ ok: true, position: 0, refCode: "", alreadyOnList: false }, 200, cors);
  }

  // hCaptcha (after honeypot, before any DB work).
  if (!(await verifyCaptcha(body))) {
    return json({ ok: false, error: "Bad request" }, 400, cors);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Durable IP rate limit (before inserting the signup).
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || "unknown";
  if (!(await underRateLimit(supabase, ip))) {
    return json({ ok: false, error: "Too many requests. Try again later." }, 429, cors);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: "Enter a valid email address." }, 400, cors);
  }

  const role = body.role === "provider" ? "coach" : "parent";
  const sports = Array.isArray(body.sports) ? (body.sports as string[]).slice(0, 12) : [];
  const referred_by = typeof body.ref === "string" && body.ref ? body.ref : null;
  const source = typeof body.source === "string" ? body.source.slice(0, 120) : "landing";

  const { data, error } = await supabase
    .from("waitlist")
    .insert({ email, role, sports, referred_by, source })
    .select("position, ref_code")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return json({ ok: true }, 200, cors); // duplicate: no membership leak
    }
    console.error("insert error", error);
    return json({ ok: false, error: "Something went wrong — try again." }, 500, cors);
  }

  const position: number | undefined = data.position;
  const refCode: string | undefined = data.ref_code;

  if (refCode) {
    try {
      await sendConfirmation(email, role, refCode, position ?? 0);
    } catch (e) {
      console.error("email send failed", e);
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

  await client.send({
    from: `Sporve <${user}>`,
    to,
    subject: "You're on the Sporve waitlist 🎉",
    content,
    html,
  });
  await client.close();
}
