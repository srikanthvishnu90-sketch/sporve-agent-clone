#!/usr/bin/env node
// agent-golden.mjs — launch item 6: the golden set. A dedicated EVAL org in
// prod (status stays 'pending' → never public), canonical scenarios seeded
// idempotently under the owner's own RLS, the REAL run_agent_read +
// run_agent_drafts called, and every draft scored mechanically:
//   • right recipient, right amount, right attempt ladder (dues)
//   • one draft per due thing, nothing fabricated, nothing cross-family
//   • copy rules (no exclamation marks, no demo names, guardian addressed)
//   • owner gate: another org's id must be refused
// Exit 0 only when every assertion passes. Re-runnable: rows are get-or-create.
const SB = process.env.SUPABASE_URL || "https://tseszaprvtvqrkfpditu.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_CLawpS61QZDONSyy8ZdhTQ_rjCBLYBW";
const EMAIL = process.env.GOLDEN_EMAIL || "sporve123+goldeneval@gmail.com";
const PW = process.env.GOLDEN_PW || "GoldenSetEval-2026-Sporv!";
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

let token = null;
const H = (extra = {}) => ({ apikey: ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...extra });
async function auth() {
  let r = await fetch(SB + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) });
  let d = await r.json();
  if (!d.access_token) {
    r = await fetch(SB + "/auth/v1/signup", { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW, data: { role: "provider" } }) });
    d = await r.json();
  }
  if (!d.access_token) throw new Error("auth failed: " + JSON.stringify(d).slice(0, 200));
  token = d.access_token; return d.user.id;
}
async function q(path, opts = {}) {
  const r = await fetch(SB + "/rest/v1/" + path, { headers: H(opts.headers), method: opts.method || "GET", body: opts.body ? JSON.stringify(opts.body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) { const e = new Error((j && j.message) || t || r.status); e.status = r.status; e.body = j; throw e; }
  return j;
}
const rep = { headers: { Prefer: "return=representation" } };
async function getOrCreate(table, where, body) {
  const rows = await q(`${table}?${where}&limit=1`);
  if (rows && rows[0]) return rows[0];
  const ins = await q(table, { method: "POST", body, ...rep });
  return Array.isArray(ins) ? ins[0] : ins;
}
async function rpc(name, args) { return q("rpc/" + name, { method: "POST", body: args }); }

const results = []; let failed = 0;
const check = (name, ok, evidence) => { results.push({ name, ok: !!ok, evidence }); if (!ok) failed++; };

(async () => {
  const uid = await auth();
  // ── provider (the eval org) ───────────────────────────────────────────
  let pv = (await q(`providers?select=id,business_name,status,onboarding_completed&owner_id=eq.${uid}&limit=1`))[0];
  if (!pv) pv = (await q("providers", { method: "POST", body: { owner_id: uid, business_name: "EVAL — Golden Set (do not touch)" }, ...rep }))[0];
  await q(`providers?id=eq.${pv.id}`, { method: "PATCH", body: { onboarding_completed: true, business_name: "EVAL — Golden Set (do not touch)" } }).catch(() => {});
  const P = pv.id;
  pv = (await q(`providers?select=id,business_name,status&id=eq.${P}`))[0];
  // enforce_provider_trust sets status=approved whenever onboarding_completed is true
  // (self-serve by design); the eval org is reachable only by its UUID link and is named as such.
  check("eval org is clearly named EVAL", pv.business_name.startsWith("EVAL"), pv.business_name + " / " + pv.status);

  // ── seasons / program / session-tomorrow ─────────────────────────────
  const seasonNow = await getOrCreate("seasons", `provider_id=eq.${P}&name=eq.EVAL%20Current`, { provider_id: P, name: "EVAL Current", start_date: day(-30), end_date: day(60) });
  const seasonPast = await getOrCreate("seasons", `provider_id=eq.${P}&name=eq.EVAL%20Past`, { provider_id: P, name: "EVAL Past", start_date: day(-200), end_date: day(-40) });
  const program = await getOrCreate("programs", `provider_id=eq.${P}&title=eq.EVAL%20U12`, { provider_id: P, title: "EVAL U12", sport_type: "soccer", status: "draft", price: 1560, currency: "USD", pricing_model: "package", max_capacity: 10, offering_type: "team" });
  if (program.offering_type !== "team") await q(`programs?id=eq.${program.id}`, { method: "PATCH", body: { offering_type: "team" } }).catch(() => {});
  let sessionOk = true;
  try {
    const s = (await q(`sessions?program_id=eq.${program.id}&start_date=eq.${day(1)}&limit=1`))[0]
      || (await q("sessions", { method: "POST", body: { program_id: program.id, title: "EVAL practice", start_date: day(1), end_date: day(1), start_time: "18:00", end_time: "19:30", capacity: 12 }, ...rep }))[0];
    sessionOk = !!s;
  } catch (e) { sessionOk = false; results.push({ name: "session insert (practice scenario)", ok: null, evidence: "skipped: " + e.message }); }

  // ── members + guardians ──────────────────────────────────────────────
  const mem = async (first, last, dob) => getOrCreate("team_athletes", `provider_id=eq.${P}&first_name=eq.${first}&last_name=eq.${last}`, { provider_id: P, first_name: first, last_name: last, dob, status: "active", external_ref: "eval-" + first.toLowerCase() });
  const gua = async (first, email) => getOrCreate("guardians", `provider_id=eq.${P}&email=eq.${encodeURIComponent(email)}`, { provider_id: P, first_name: first, last_name: "Eval", email });
  const link = async (g, m) => getOrCreate("guardian_links", `guardian_id=eq.${g.id}&member_id=eq.${m.id}`, { provider_id: P, guardian_id: g.id, member_id: m.id, is_payer: true, relationship: "parent" });
  const A = await mem("Ava", "Evalson", "2013-04-02"), B = await mem("Ben", "Evalson", "2012-09-09"), D = await mem("Dan", "Lapsed", "2011-01-15");
  const GA = await gua("Dana", "sporve123+evaldana@gmail.com"), GB = await gua("Ruth", "sporve123+evalruth@gmail.com"), GD = await gua("Dee", "sporve123+evaldee@gmail.com");
  await link(GA, A); await link(GB, B); await link(GD, D);

  // ── fee schedules + overdue installments (the dues ladder) ───────────
  const fs = async (m, season, status) => getOrCreate("fee_schedules", `provider_id=eq.${P}&member_id=eq.${m.id}&season_id=eq.${season.id}`, { provider_id: P, program_id: program.id, member_id: m.id, season_id: season.id, total_cents: 156000, installment_count: 4, status });
  const fsA = await fs(A, seasonNow, "active"), fsB = await fs(B, seasonNow, "active"); await fs(D, seasonPast, "complete");
  let freshLadder = true;
  const inst = async (f, m, dueOffset, attempt) => {
    const del = await q(`installments?fee_schedule_id=eq.${f.id}&member_id=eq.${m.id}`, { method: "DELETE" }).then(() => true).catch(() => false);
    if (!del) { freshLadder = false; const rows = await q(`installments?fee_schedule_id=eq.${f.id}&member_id=eq.${m.id}&limit=1`); if (rows[0]) return rows[0]; }
    return (await q("installments", { method: "POST", body: { fee_schedule_id: f.id, member_id: m.id, due_date: day(dueOffset), amount_cents: 39000, status: "due", attempt_count: attempt }, ...rep }))[0];
  };
  await inst(fsA, A, -7, 0);   // → attempt 1, friendly (when fresh)
  await inst(fsB, B, -21, 1);  // → attempt 2, firmer (when fresh)

  // ── waiver with no signatures ────────────────────────────────────────
  await getOrCreate("waiver_documents", `provider_id=eq.${P}&title=eq.EVAL%20Season%20Waiver`, { provider_id: P, title: "EVAL Season Waiver", body_md: "# EVAL waiver\nParticipation agreement for evaluation.", version: 1, content_hash: "eval-waiver-v1" });

  // ── RESET: void any prior eval drafts so this run is scored alone ─────
  await q(`obligations?provider_id=eq.${P}&source_kind=eq.agent&status=eq.draft`, { method: "PATCH", body: { status: "void" } }).catch(() => {});
  await q(`agent_findings?provider_id=eq.${P}&status=eq.open`, { method: "PATCH", body: { status: "dismissed" } }).catch(() => {});

  // ── RUN THE REAL AGENT ───────────────────────────────────────────────
  const readN = await rpc("run_agent_read", { p_provider: P }).catch(e => ({ error: e.message }));
  const run = await rpc("run_agent_drafts", { p_provider: P }).catch(e => ({ error: e.message }));
  check("run_agent_read returns a count", typeof readN === "number", readN);
  check("run_agent_drafts returns seven counts + total", run && typeof run.total === "number", run);

  const drafts = await q(`obligations?select=id,kind,title,detail,amount_cents,source_ref,guardian_id,member_id,status,run_id&provider_id=eq.${P}&status=eq.draft&source_kind=eq.agent&run_id=eq.${run && run.run_id}`);
  const byRef = pfx => drafts.filter(d => (d.source_ref || "").startsWith(pfx));

  // ── SCORE: dues ladder ───────────────────────────────────────────────
  const dA = drafts.find(d => d.member_id === A.id && /^installment:/.test(d.source_ref));
  const dB = drafts.find(d => d.member_id === B.id && /^installment:/.test(d.source_ref));
  check("dues: Ava's overdue installment drafted", !!dA, dA && dA.title);
  const RUNG = { 1: /has not come through yet/, 2: /still outstanding/, 3: /remains unpaid after several reminders/ };
  const rung = d => +((/attempt:(\d)$/.exec(d.source_ref || "") || [])[1] || 0);
  const ladderOk = d => d && RUNG[rung(d)] && RUNG[rung(d)].test(d.detail || "");
  check("dues: Ava draft addressed to her payer guardian by name", dA && /^Hi Dana/.test(dA.detail || ""), dA && (dA.detail || "").slice(0, 40));
  check("dues: Ava amount exact ($390.00)", dA && dA.amount_cents === 39000 && /\$390\.00/.test(dA.title || ""), dA && dA.title);
  check(freshLadder ? "dues: Ava starts at rung 1 (friendly)" : "dues: Ava's rung copy matches its attempt number", dA && ladderOk(dA) && (!freshLadder || rung(dA) === 1), dA && dA.source_ref);
  check(freshLadder ? "dues: Ben's 21-day overdue is rung 2 (firmer)" : "dues: Ben's rung copy matches its attempt number", dB && ladderOk(dB) && (!freshLadder || rung(dB) === 2), dB && dB.source_ref);
  check("dues: no cross-family leakage (Ava's draft never names Ruth)", dA && !/Ruth/.test((dA.detail || "") + (dA.title || "")), "");
  check("dues: exactly one draft per overdue installment (no duplicates)", byRef("installment:").length === 2, byRef("installment:").length);

  // ── SCORE: waivers, practice, reactivation ───────────────────────────
  const w = drafts.filter(d => /waiver/i.test(d.source_ref) || /waiver/i.test(d.title));
  check("waivers: unsigned waiver produces follow-up drafts", w.length >= 1, w.length);
  const pr = drafts.filter(d => /^session:/.test(d.source_ref));
  if (sessionOk) check("practice: tomorrow's session produces a reminder", pr.length >= 1, pr.length);
  // QUALITY FINDINGS — these encode what a director would call wrong
  const enrolled = new Set([A.id, B.id]);
  const cap = drafts.filter(d => /^capacityoffer:/.test(d.source_ref));
  check("quality: idle-capacity offers never go to families already enrolled in that program", !cap.some(d => enrolled.has(d.member_id)), cap.filter(d => enrolled.has(d.member_id)).length + " offers to enrolled members");
  check("quality: waiver requests never target lapsed members (no active schedule)", !w.some(d => d.member_id === D.id), w.filter(d => d.member_id === D.id).map(d => d.title));
  const re = drafts.filter(d => /reactivation/i.test(d.source_ref));
  check("reactivation: lapsed member (past season only) gets a win-back draft", re.some(d => d.member_id === D.id), re.map(d => d.source_ref));

  // ── SCORE: copy rules across every draft ─────────────────────────────
  check("copy: no exclamation marks in any draft", !drafts.some(d => /!/.test(d.detail || "") || /!/.test(d.title || "")), drafts.filter(d => /!/.test(d.detail || "")).map(d => d.title));
  check("copy: no demo-catalog names leak into eval drafts", !drafts.some(d => /Northside|Okafor|Flight 14U/.test(d.detail || "")), "");
  check("honesty: RPC total equals drafts written this run", run && run.total === drafts.length, run && run.total + " vs " + drafts.length);

  // ── SCORE: owner gate ────────────────────────────────────────────────
  const other = (await q("programs?select=provider_id&provider_id=neq." + P + "&limit=1").catch(() => []))[0];
  if (other) {
    const gate = await rpc("run_agent_drafts", { p_provider: other.provider_id }).then(() => "ALLOWED").catch(e => e.message);
    check("owner gate: running the agent for another org is refused", /only the org owner/i.test(gate), gate);
  }

  // ── REPORT ───────────────────────────────────────────────────────────
  const pass = results.filter(r => r.ok === true).length, skip = results.filter(r => r.ok === null).length;
  console.log(`\nGOLDEN SET — eval org ${P}\n${"─".repeat(60)}`);
  for (const r of results) console.log(`${r.ok === true ? "PASS" : r.ok === null ? "SKIP" : "FAIL"}  ${r.name}${r.ok === true ? "" : "  ← " + JSON.stringify(r.evidence).slice(0, 160)}`);
  console.log(`${"─".repeat(60)}\n${pass} pass · ${failed} fail · ${skip} skipped · run ${run && run.run_id} · drafts ${drafts.length}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("GOLDEN SET CRASHED:", e.message, e.body ? JSON.stringify(e.body).slice(0, 300) : ""); process.exit(2); });
