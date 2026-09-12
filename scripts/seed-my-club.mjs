#!/usr/bin/env node
// seed-my-club.mjs — sign up (or sign in) and land on a WORKING club.
//
// WHY THIS EXISTS. A brand-new signup creates an empty organisation: no season,
// no roster, no dues, so the queue is blank and there is nothing to look at.
// That is honest but useless for seeing where the product actually is. This
// creates one realistic club's worth of data and then runs the REAL agent over
// it, so the review queue fills with drafts the product generated rather than
// drafts a fixture wrote.
//
// It works entirely through the public API as a signed-in user — no service
// key, no secrets. That means RLS applies exactly as it would for a customer,
// so if this script can do it, a customer can, and if it cannot, neither can
// they. It is a test of the product, not a way around it.
//
//   node scripts/seed-my-club.mjs --email you@example.com --password 'something'
//
// Every guardian is addressed at YOUR inbox using Gmail plus-addressing
// (you+ava@gmail.com), so any message the agent drafts is deliverable to you
// and still filterable. Pass --to to override that.
//
// Safe to re-run: everything is get-or-create, and prior agent drafts for this
// org are voided first so a second run is scored on its own.

import { readFileSync } from "node:fs";

const SB   = process.env.SUPABASE_URL || "https://tseszaprvtvqrkfpditu.supabase.co";
// The publishable key is not a secret — it is compiled into index.html and
// served to every visitor, and RLS is what actually protects the data. But
// gitleaks cannot tell a publishable key from a real one by looking, and it is
// right not to try, so this reads it from the environment or from the built
// page rather than carrying a literal that trips every scan.
const ANON = process.env.SUPABASE_ANON_KEY || (() => {
  try {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    return (/SUPABASE_ANON\s*=\s*"([^"]+)"/.exec(html) || [])[1] || "";
  } catch { return ""; }
})();
if (!ANON) {
  console.error("No publishable key. Run from the repo root, or set SUPABASE_ANON_KEY.");
  process.exit(2);
}

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
const EMAIL = arg("email");
const PW    = arg("password");
const CLUB  = arg("club", "Rivertown FC");
if (!EMAIL || !PW) {
  console.error("usage: node scripts/seed-my-club.mjs --email you@example.com --password 'yourpassword' [--club 'Name'] [--to inbox@example.com]");
  process.exit(2);
}
// Plus-addressing only works on Gmail-style hosts; elsewhere fall back to the
// bare address so we never invent an undeliverable recipient.
//
// An earlier version bailed out when the login address ALREADY contained a
// "+", which is exactly the case when you sign up with a tagged address — and
// the result was that every guardian got the identical email, collapsed into
// one row, and the club had one parent instead of two. So strip any existing
// tag and apply our own rather than giving up.
const INBOX = arg("to", EMAIL);
const canPlus = /@(gmail|googlemail)\.com$/i.test(INBOX);
const alias = (tag) => {
  if (!canPlus) return INBOX;
  const [local, host] = INBOX.split("@");
  return `${local.split("+")[0]}+${tag}@${host}`;
};

let TOKEN = null;
const H = (extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...extra });
const rep = { headers: { Prefer: "return=representation" } };

async function auth() {
  const body = JSON.stringify({ email: EMAIL, password: PW });
  const head = { apikey: ANON, "Content-Type": "application/json" };
  let r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: head, body });
  if (!r.ok) {
    // No account yet: create one as a PROVIDER, which is what makes
    // handle_new_user() insert the providers row.
    const s = await fetch(`${SB}/auth/v1/signup`, {
      method: "POST", headers: head,
      body: JSON.stringify({ email: EMAIL, password: PW, data: { role: "provider", business_name: CLUB } }),
    });
    const sj = await s.json().catch(() => ({}));
    if (!s.ok) throw new Error(`signup failed: ${sj.msg || sj.error_description || s.status}`);
    console.log("  created a new account for", EMAIL);
    r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: head, body });
    if (!r.ok) {
      // Email confirmation is on: the account exists but cannot sign in yet.
      console.log("\n  Account created, but this project requires email confirmation.");
      console.log("  Open the confirmation link in your inbox, then run this again.\n");
      process.exit(3);
    }
  } else console.log("  signed in as", EMAIL);
  const j = await r.json();
  TOKEN = j.access_token;
  return j.user.id;
}

async function q(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: opts.method || "GET", headers: H(opts.headers),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${path.split("?")[0]} → ${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : [];
}
const rpc = (fn, body) => q(`rpc/${fn}`, { method: "POST", body });

async function getOrCreate(table, filter, row) {
  const found = await q(`${table}?${filter}&limit=1`);
  if (found[0]) return found[0];
  return (await q(table, { method: "POST", body: row, ...rep }))[0];
}
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  console.log("\nSeeding a club you can actually look at.\n");
  const uid = await auth();

  // ── the organisation ─────────────────────────────────────────────────
  let pv = (await q(`providers?select=id,business_name,onboarding_completed&owner_id=eq.${uid}&limit=1`))[0];
  if (!pv) pv = (await q("providers", { method: "POST", body: { owner_id: uid, business_name: CLUB }, ...rep }))[0];
  const P = pv.id;
  // onboarding_completed gates every agent generator (agent_read_on). Without
  // it the run below returns zero and the queue stays empty — which is the
  // single most confusing way for this to "work" and produce nothing.
  await q(`providers?id=eq.${P}`, { method: "PATCH", body: { business_name: CLUB, onboarding_completed: true } }).catch(() => {});
  console.log(`  club: ${CLUB}  (${P})`);

  // ── season, program, one practice ────────────────────────────────────
  const season = await getOrCreate("seasons", `provider_id=eq.${P}&name=eq.${encodeURIComponent("Fall 2026")}`,
    { provider_id: P, name: "Fall 2026", start_date: day(-30), end_date: day(75) });
  const program = await getOrCreate("programs", `provider_id=eq.${P}&title=eq.${encodeURIComponent("U12 Travel")}`,
    { provider_id: P, title: "U12 Travel", sport_type: "soccer", status: "draft", price: 1560,
      currency: "USD", pricing_model: "package", max_capacity: 12, offering_type: "team" });
  try {
    const have = await q(`sessions?program_id=eq.${program.id}&start_date=eq.${day(2)}&limit=1`);
    if (!have[0]) await q("sessions", { method: "POST", body: {
      program_id: program.id, title: "Tuesday practice", start_date: day(2), end_date: day(2),
      start_time: "18:00", end_time: "19:30", capacity: 14 } });
  } catch { /* sessions are optional for the queue; never fail the seed on it */ }

  // ── roster and families ──────────────────────────────────────────────
  const mem = (first, last, dob) => getOrCreate("team_athletes",
    `provider_id=eq.${P}&first_name=eq.${first}&last_name=eq.${last}`,
    { provider_id: P, first_name: first, last_name: last, dob, status: "active" });
  const gua = (first, email) => getOrCreate("guardians",
    `provider_id=eq.${P}&email=eq.${encodeURIComponent(email)}`,
    { provider_id: P, first_name: first, last_name: "Parent", email });
  const link = (g, m) => getOrCreate("guardian_links", `guardian_id=eq.${g.id}&member_id=eq.${m.id}`,
    { provider_id: P, guardian_id: g.id, member_id: m.id, is_payer: true, relationship: "parent" });

  const ava = await mem("Ava", "Bell", "2013-04-02");
  const ben = await mem("Ben", "Ortiz", "2012-09-09");
  const gAva = await gua("Maria", alias("maria"));
  const gBen = await gua("James", alias("james"));
  await link(gAva, ava); await link(gBen, ben);
  console.log(`  families: ${gAva.email}, ${gBen.email}`);

  // ── dues, one of them genuinely overdue ──────────────────────────────
  const fs = (m) => getOrCreate("fee_schedules", `provider_id=eq.${P}&member_id=eq.${m.id}&season_id=eq.${season.id}`,
    { provider_id: P, program_id: program.id, member_id: m.id, season_id: season.id,
      total_cents: 156000, installment_count: 4, status: "active" });
  const fsAva = await fs(ava), fsBen = await fs(ben);
  const inst = async (f, m, dueOffset, attempt) => {
    const have = await q(`installments?fee_schedule_id=eq.${f.id}&member_id=eq.${m.id}&limit=1`);
    if (have[0]) return have[0];
    return (await q("installments", { method: "POST", body: {
      fee_schedule_id: f.id, member_id: m.id, due_date: day(dueOffset),
      amount_cents: 39000, status: "due", attempt_count: attempt }, ...rep }))[0];
  };
  await inst(fsAva, ava, -9,  0);   // nine days late  → first, friendly reminder
  await inst(fsBen, ben, -23, 1);   // three weeks late → second, firmer one

  // ── a waiver nobody has signed ───────────────────────────────────────
  await getOrCreate("waiver_documents", `provider_id=eq.${P}&title=eq.${encodeURIComponent("Season Waiver")}`,
    { provider_id: P, title: "Season Waiver", version: 1, content_hash: "season-waiver-v1",
      body_md: "# Season Waiver\nParticipation agreement for the season." });

  // ── clear prior agent output so this run stands alone ────────────────
  await q(`obligations?provider_id=eq.${P}&source_kind=eq.agent&status=eq.draft`, { method: "PATCH", body: { status: "void" } }).catch(() => {});
  await q(`agent_findings?provider_id=eq.${P}&status=eq.open`, { method: "PATCH", body: { status: "dismissed" } }).catch(() => {});

  // ── run the REAL agent, not a fixture ────────────────────────────────
  const read = await rpc("run_agent_read", { p_provider: P }).catch((e) => ({ error: e.message }));
  const drafts = await rpc("run_agent_drafts", { p_provider: P }).catch((e) => ({ error: e.message }));

  const findings = await q(`agent_findings?provider_id=eq.${P}&status=eq.open&select=code`);
  const queue = await q(`obligations?provider_id=eq.${P}&status=eq.draft&select=title`);

  console.log(`\n  agent read    → ${JSON.stringify(read)}`);
  console.log(`  agent drafts  → ${JSON.stringify(drafts)}`);
  console.log(`\n  ${findings.length} finding(s), ${queue.length} draft(s) waiting in your queue:`);
  for (const o of queue.slice(0, 8)) console.log("    ·", o.title);

  console.log(`\n  Sign in at https://sporv.ai as ${EMAIL} and open Queue.`);
  if (!queue.length) {
    console.log("\n  NOTE: zero drafts. That is a real result, not a script bug — tell");
    console.log("  Claude and it will find out which generator declined and why.");
  }
  console.log("");
})().catch((e) => { console.error("\n  FAILED:", e.message, "\n"); process.exit(1); });
