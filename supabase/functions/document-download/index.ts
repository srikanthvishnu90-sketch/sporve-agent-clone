// ============================================================================
// document-download  (Supabase Edge Function) — serve a coach's document
// ============================================================================
// F2 real artifact (2026-09-19). Returns the coach's own document as a
// standalone HTML file payload. Authorization: caller must own the provider on
// the row (same owner check as every RLS policy in this repo). The client
// turns the payload into a Blob download — a genuine downloadable file, not a
// note masquerading as one.
//
// Input: { id: string }   Output: { title, filename, html }
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
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/* Minimal markdown -> HTML for handouts. Headings, bold/italic, unordered
   lists, paragraphs. Everything is escaped first; the renderer only adds tags. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
function markdownToHtml(md: string): string {
  const lines = String(md ?? "").split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,3}\s+/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      const level = line.match(/^#+/)![0].length;
      out.push(`<h${level}>${inline(line.replace(/^#+\s+/, ""))}</h${level}>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function pageHtml(title: string, bodyHtml: string, business: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1c1a17;max-width:640px;margin:0 auto;padding:48px 24px;line-height:1.6}
  h1{font-size:28px;margin:0 0 4px} h2{font-size:20px;margin:28px 0 8px} h3{font-size:17px;margin:22px 0 6px}
  p{margin:10px 0} ul{margin:10px 0;padding-left:22px} li{margin:6px 0}
  .brand{font-family:system-ui,sans-serif;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#8a8378;margin-bottom:24px}
  .foot{margin-top:36px;padding-top:16px;border-top:1px solid #e3ded4;font-family:system-ui,sans-serif;font-size:12px;color:#8a8378}
  @media print{body{padding:0}}
</style>
</head>
<body>
<div class="brand">${esc(business || "Sporv")}</div>
<h1>${esc(title)}</h1>
${bodyHtml}
<div class="foot">Prepared with Sporv</div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json({ error: "Not authenticated" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return json({ error: "`id` is required." }, 400);

    // Owner check mirrors the coach_documents RLS policy (defense in depth:
    // the policy already scopes this, but the function must not rely on it).
    const { data: doc, error: dErr } = await userClient
      .from("coach_documents")
      .select("id, title, format, body_markdown, provider_id, providers!inner(owner_id, business_name)")
      .eq("id", id)
      .maybeSingle();
    if (dErr || !doc) return json({ error: "Document not found." }, 404);
    // deno-lint-ignore no-explicit-any
    const owner = ((doc as any).providers ?? {}) as { owner_id?: string; business_name?: string };
    if (owner.owner_id !== uid) return json({ error: "Not authorized." }, 403);

    // deno-lint-ignore no-explicit-any
    const d = doc as any;
    const safeTitle = String(d.title ?? "document").replace(/[^\w\- ]+/g, "").trim() || "document";
    const html = pageHtml(String(d.title ?? "Document"), markdownToHtml(String(d.body_markdown ?? "")), String(owner.business_name ?? ""));
    return json({ title: d.title, filename: `${safeTitle}.html`, html });
  } catch (e) {
    console.error("document-download error:", e);
    return json({ error: "Couldn't load the document." }, 500);
  }
});
