"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_RECRUITING — SOURCE pillar, first slice (spec 31 Part II, Phase R1).

   One coach tab, "Recruiting", under a new "Source" rail group. A recruit
   board a college or club coach can run: pipeline by stage, filters, a
   recruit drawer (profile, guardians, evaluations, contact log, film),
   add-recruit, CSV import, roster needs and a rule-based ranking.

   WHERE THE DATA COMES FROM
     · Signed in: the tables in docs/red-drafts/2026-10-22-recruiting-r1.sql
       through window.SporveAPI (PostgREST + two RPCs). Until the owner
       applies that draft, the first read fails with "table not found" and
       the page says so plainly. Nothing is invented for a signed-in coach.
     · Signed-out coach preview (isCoachGuest()): clearly labelled sample
       recruits. Changes made in the preview stay in this tab and are never
       sent anywhere.

   HONESTY RULES OBSERVED HERE
     · Stage changes go through move_recruit_stage(), which returns a
       receipt; the board reloads from the server after every write.
     · Contact-window compliance is NOT checked in R1. Every logged contact
       says "Not checked" rather than implying it was permitted.
     · A minor's date of birth, email, phone and guardians are never in the
       board read. Contact details come from get_recruit_sensitive(), which
       refuses minors to non-admins and writes a receipt. If the server does
       not return guardians, none are shown.
     · No AI. The ranking is arithmetic the page shows in full. Sporv does
       not send recruiting messages yet: "Email" opens the coach's own mail
       app (GATES rule 4: no new AI tool before G4).

   Host contract used, never redefined:
     S, render(), toast(), isCoachGuest(), coachRole(), window.SporveAPI,
     window.COACH_UI.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ── constants ──────────────────────────────────────────────────── */
var STAGES = [
  ["identified", "Identified"], ["evaluated", "Evaluated"], ["contacted", "Contacted"],
  ["visit", "Visit"], ["offer", "Offer"], ["committed", "Committed"], ["signed", "Signed"],
  ["closed", "Closed / lost"],
];
var STAGE_RANK = { identified: 1, evaluated: 2, contacted: 3, visit: 4, offer: 5, committed: 6, signed: 7, enrolled: 8 };
/* Ranking weights — shown verbatim on the Ranking tab. */
var STAGE_WEIGHT = { identified: 0.8, evaluated: 0.9, contacted: 1.0, visit: 1.1, offer: 1.2 };
var NEED_WEIGHT = { open: 1.0, none: 0.6, full: 0.2 };
var CRITERIA = [
  ["athleticism", "Athleticism"], ["technique", "Technique"], ["game_sense", "Game sense"],
  ["competitiveness", "Competitiveness"], ["coachability", "Coachability"],
];
var CONTACT_KINDS = [
  ["phone", "Call"], ["email", "Email"], ["text", "Text"], ["video", "Video call"],
  ["social_dm", "Social message"], ["mail", "Mail"],
  ["in_person_off_campus", "In person, off campus"], ["in_person_on_campus", "Campus visit"],
];
var COUNTERPARTS = [
  ["prospect", "The recruit"], ["guardian", "Parent or guardian"], ["hs_coach", "High school coach"],
  ["club_coach", "Club coach"], ["other", "Someone else"],
];
var CONTEXTS = [
  ["film", "Film"], ["live_game", "Live game"], ["camp", "Camp"], ["visit", "Visit"],
  ["practice", "Practice"], ["interview", "Conversation"],
];
var CLOSED_REASONS = [
  ["not_a_fit", "Not a fit"], ["chose_other_school", "Chose another program"], ["academic", "Academics"],
  ["no_response", "No response"], ["withdrew", "Withdrew"], ["admissions_denied", "Admissions denied"],
  ["other", "Other"],
];
var PROSPECT_TYPES = [
  ["high_school", "High school"], ["juco", "Junior college"], ["transfer_portal", "Transfer"],
  ["international", "International"], ["post_grad", "Post-grad"], ["walk_on", "Walk-on"],
];
/* CSV columns, documented on the Import tab. Header names are matched
   case-insensitively; spaces and dashes count as underscores. */
var CSV_COLUMNS = [
  { key: "first_name", req: true, ex: "Maya", note: "Required." },
  { key: "last_name", req: true, ex: "Torres", note: "Required." },
  { key: "grad_year", req: true, ex: "2027", note: "Required. Four digits." },
  { key: "sport", req: true, ex: "Soccer", note: "Required." },
  { key: "position", req: false, ex: "GK", note: "Primary position." },
  { key: "school", req: false, ex: "Westfield High School", note: "Current school." },
  { key: "club_team", req: false, ex: "Metro FC 08", note: "" },
  { key: "city", req: false, ex: "Naperville", note: "" },
  { key: "state", req: false, ex: "IL", note: "" },
  { key: "gpa", req: false, ex: "3.6", note: "0 to 5." },
  { key: "film_url", req: false, ex: "https://www.hudl.com/video/...", note: "https links only; separate several with a space." },
  { key: "stage", req: false, ex: "identified", note: "Optional. identified, evaluated, contacted, visit, offer, committed or signed." },
  { key: "email", req: false, ex: "maya@example.com", note: "Stored privately. Visible to admins only for under-18s." },
  { key: "phone", req: false, ex: "555-0101", note: "Stored privately, same rule as email." },
];

/* ── tiny helpers ───────────────────────────────────────────────── */
function h(v){
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c){
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function api(){ return window.SporveAPI || null; }
function providerRow(){ return (typeof S !== "undefined" && S.coachProvider) || null; }
function signedIn(){ var a = api(); return !!(a && a.isSignedIn && a.isSignedIn()); }
function guest(){ return typeof isCoachGuest === "function" && isCoachGuest(); }
function isAdmin(){
  if (st.mode === "sample") return true;
  var r = typeof coachRole === "function" ? coachRole() : "owner";
  return r === "owner" || r === "director" || r === "admin";
}
function uuid(){
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  var b = new Uint8Array(16); crypto.getRandomValues(b);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  var x = Array.prototype.map.call(b, function (n){ return (n + 256).toString(16).slice(1); }).join("");
  return x.slice(0, 8) + "-" + x.slice(8, 12) + "-" + x.slice(12, 16) + "-" + x.slice(16, 20) + "-" + x.slice(20);
}
function label(list, key){ for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1]; return key || ""; }
function options(list, sel, blank){
  return (blank ? '<option value="">' + h(blank) + "</option>" : "") + list.map(function (o){
    return '<option value="' + h(o[0]) + '"' + (String(sel) === String(o[0]) ? " selected" : "") + ">" + h(o[1]) + "</option>";
  }).join("");
}
function daysAgo(iso){
  if (!iso) return null;
  var d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return isFinite(d) ? Math.max(0, d) : null;
}
function agoText(iso){
  var d = daysAgo(iso);
  if (d == null) return "No contact yet";
  return "Last contact " + (d === 0 ? "today" : d === 1 ? "1 day ago" : d + " days ago");
}
function shortDate(iso){
  var t = Date.parse(iso); if (!isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fullName(r){ return r ? ((r.preferred_name || r.first_name) + " " + r.last_name) : "Unknown recruit"; }
function norm(s){ return String(s == null ? "" : s).trim().toLowerCase(); }
/** Today's date (YYYY-MM-DD) on the coach's own calendar, not UTC: after 7pm
    in Chicago, toISOString() already reads tomorrow. */
function localDate(d){
  d = d || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function httpsOnly(list){
  return (list || []).filter(function (u){ return /^https:\/\/\S+$/i.test(u) && u.length <= 500; });
}

/* Server messages → what a coach can act on. */
function friendly(e){
  var m = (e && e.message) || "";
  if (/RECRUIT_UNDER_13/.test(m)) return "Recruits must be 13 or older. Younger athletes belong on your club roster, not in recruiting.";
  if (/RECRUIT_STAGE_BACKWARD_NOTE/.test(m)) return "Add a note saying why this recruit is moving back.";
  if (/RECRUIT_CLOSED_REASON/.test(m)) return "Choose why this recruit is closed.";
  if (/RECRUIT_ENROLLED/.test(m)) return "Enrolment is recorded when the recruit joins the roster, not from the board.";
  if (/RECRUIT_EVAL_SCORES/.test(m)) return "Score every criterion from 1 to 5.";
  if (/RECRUIT_MINOR_SENSITIVE/.test(m)) return "This recruit is under 18. Their contact details are visible to organization admins only.";
  if (/row-level security|permission denied|42501/.test(m) || (e && e.code === "42501"))
    return "Your role in this workspace can't do that. Ask an organization admin.";
  if (e && e.code === "23505") return "That already exists.";
  if (e && e.code === "network") return "Could not reach the server. Check your connection and try again.";
  return m || "Something went wrong. Try again.";
}
function isMissingTable(e){
  return !!e && (e.code === "PGRST205" || e.code === "42P01" || e.status === 404 ||
    /Could not find the table|does not exist/i.test(e.message || ""));
}

/* ── module state (view state + the loaded rows) ────────────────── */
var st = {
  phase: "idle",      // idle | loading | ready | off | error
  mode: null,         // sample | live
  key: null,          // identity the data was loaded under
  err: null,
  partial: [],        // secondary reads that failed (named on the page)
  truncated: [],      // reads that hit their row limit (may be cut off; named on the page)
  recruits: [], pipelines: [], evals: [], contacts: [], targets: [], teams: [], guardians: [],
  targetsSource: "local",   // db | local
  filters: { sport: "", grad: "", pos: "", q: "" },
  open: null,         // pipeline id whose drawer is open
  adding: false,      // add-recruit drawer
  section: null,      // eval | contact | stage (expanded form in the drawer)
  stageTo: null,
  sensitive: {},      // recruit_id -> {email, phone, ...} | {refused: msg}
  csv: { text: "", rows: null, fileName: "" },
  editTarget: null,
  focus: null,
};

/* ═══════════════════ SAMPLE WORKSPACE ═══════════════════ */
function sampleData(){
  var now = Date.now(), day = 86400000;
  var ago = function (d){ return new Date(now - d * day).toISOString(); };
  var R = function (id, fn, ln, gy, school, minor, type){
    return { id: id, first_name: fn, last_name: ln, preferred_name: null, prospect_type: type || "high_school", grad_year: gy,
      is_minor: minor, current_school: school, club_team: null, city: null, state_region: null, hs_gpa: null,
      intended_major: null, status: "active", created_at: ago(40), _email: fn.toLowerCase() + "@example.com", _phone: "555-01" + id.slice(-2) };
  };
  var recruits = [
    R("sr01", "Maya", "Torres", 2027, "Westfield High School", true),
    R("sr02", "Jordan", "Ellis", 2027, "Lakeside Prep", true),
    R("sr03", "Sam", "Okafor", 2026, "Riverside Junior College", false, "juco"),
    R("sr04", "Lena", "Brooks", 2028, "North Valley High School", true),
    R("sr05", "Diego", "Ramos", 2027, "Central Catholic", true),
    R("sr06", "Ava", "Chen", 2027, "Hillcrest High School", true),
    R("sr07", "Noah", "Patel", 2026, "Eastbrook High School", false),
    R("sr08", "Ruby", "Owens", 2028, "Pine Ridge High School", true),
    R("sr09", "Marcus", "Hale", 2027, "Bayview High School", true),
    R("sr10", "Isla", "Murphy", 2028, "Summit Academy", true),
  ];
  recruits[0].hs_gpa = 3.8; recruits[0].intended_major = "Biology"; recruits[0].club_team = "Metro FC 08"; recruits[0].city = "Naperville"; recruits[0].state_region = "IL";
  recruits[2].hs_gpa = 3.1; recruits[2].intended_major = "Business";
  var P = function (id, rid, stage, pos, extra){
    var p = { id: id, recruit_id: rid, sport: "Soccer", team_id: null, stage: stage, closed_reason: null, position_primary: pos,
      positions: [pos], film_links: [], priority: null, target_entry_year: null, last_contact_at: null, created_at: ago(40) };
    for (var k in extra) p[k] = extra[k];
    return p;
  };
  var pipelines = [
    P("sp01", "sr01", "visit", "GK", { film_links: ["https://example.com/film/maya-torres-2026-highlights"], last_contact_at: ago(5) }),
    P("sp02", "sr02", "contacted", "CB", { last_contact_at: ago(12) }),
    P("sp03", "sr03", "offer", "ST", { last_contact_at: ago(2) }),
    P("sp04", "sr04", "identified", "CM"),
    P("sp05", "sr05", "evaluated", "GK"),
    P("sp06", "sr06", "committed", "FB", { last_contact_at: ago(9) }),
    P("sp07", "sr07", "signed", "W", { last_contact_at: ago(20) }),
    P("sp08", "sr08", "identified", "CB"),
    P("sp09", "sr09", "closed", "ST", { closed_reason: "chose_other_school", last_contact_at: ago(30) }),
    P("sp10", "sr10", "contacted", "GK", { last_contact_at: ago(16) }),
  ];
  var E = function (id, pid, s, notes, d){
    var sc = {}; CRITERIA.forEach(function (c, i){ sc[c[0]] = s[i]; });
    return { id: id, pipeline_id: pid, evaluator_id: "sample", context: "film", seen_on: ago(d).slice(0, 10), scores: sc,
      overall: overallOf(sc), projection: null, notes: notes, created_at: ago(d) };
  };
  var evals = [
    E("se01", "sp01", [5, 4, 4, 5, 4], "Commands the box; distribution needs work.", 18),
    E("se02", "sp01", [4, 4, 5, 5, 4], "Composed under pressure at the October showcase.", 8),
    E("se03", "sp02", [4, 4, 4, 4, 4], "Reads the game early.", 25),
    E("se04", "sp03", [5, 5, 4, 5, 4], "Two-footed finisher.", 14),
    E("se05", "sp05", [4, 3, 4, 3, 4], "Good reflexes, small frame.", 10),
    E("se06", "sp06", [4, 4, 4, 5, 4], "", 30),
    E("se07", "sp07", [4, 4, 4, 4, 4], "", 60),
    E("se08", "sp10", [4, 4, 3, 4, 4], "", 20),
  ];
  var C = function (id, pid, kind, d, summary){
    return { id: id, pipeline_id: pid, contact_kind: kind, direction: "outbound", counterpart: "prospect", occurred_at: ago(d),
      subject: null, summary: summary, permissible_window_status: "unchecked" };
  };
  var contacts = [
    C("sc01", "sp01", "phone", 5, "Talked through the campus visit plan."),
    C("sc02", "sp01", "email", 21, "Sent camp invitation."),
    C("sc03", "sp02", "email", 12, "Intro email after the showcase."),
    C("sc04", "sp03", "in_person_on_campus", 2, "Official visit with family."),
    C("sc05", "sp06", "phone", 9, "Confirmed commitment."),
    C("sc06", "sp07", "email", 20, "Sent signing paperwork."),
    C("sc07", "sp09", "phone", 30, "Told us he chose another program."),
    C("sc08", "sp10", "text", 16, "Asked for updated film."),
  ];
  var targets = [
    { id: "st01", sport: "Soccer", entry_year: "2027", position: "GK", target_count: 2, priority: 1 },
    { id: "st02", sport: "Soccer", entry_year: "2027", position: "CB", target_count: 1, priority: 2 },
    { id: "st03", sport: "Soccer", entry_year: "2026", position: "ST", target_count: 1, priority: 2 },
    { id: "st04", sport: "Soccer", entry_year: "2028", position: "CM", target_count: 2, priority: 3 },
  ];
  var guardians = [
    { id: "sg01", recruit_id: "sr01", full_name: "Ana Torres", relationship: "Mother", email: "ana.torres@example.com", phone: "555-0111", is_primary: true, consent_status: "granted" },
    { id: "sg02", recruit_id: "sr02", full_name: "Chris Ellis", relationship: "Father", email: "chris.ellis@example.com", phone: null, is_primary: true, consent_status: "requested" },
  ];
  return { recruits: recruits, pipelines: pipelines, evals: evals, contacts: contacts, targets: targets, guardians: guardians, teams: [] };
}
function overallOf(scores){
  var n = 0, t = 0;
  CRITERIA.forEach(function (c){ var v = Number(scores[c[0]]); if (v >= 1 && v <= 5){ n++; t += v; } });
  return n === CRITERIA.length ? Math.round(t / n * 100) / 100 : null;
}

/* ═══════════════════ LOADING ═══════════════════ */
function identity(){
  var pv = providerRow();
  return (guest() ? "g" : signedIn() ? "u" : "x") + ":" + (pv && pv.id ? pv.id : "");
}
function kickLoad(){
  var key = identity();
  if (st.key === key && st.phase !== "idle") return;
  st.key = key;
  st.open = null; st.adding = false; st.section = null; clearSensitive();
  if (guest()){
    var d = sampleData();
    st.mode = "sample"; st.phase = "ready"; st.partial = []; st.truncated = []; st.targetsSource = "local";
    for (var k in d) st[k] = d[k];
    return;
  }
  st.mode = "live"; st.phase = "loading";
  loadLive().then(function (){ st.phase = "ready"; }, function (e){
    if (isMissingTable(e)){ st.phase = "off"; }
    else { st.phase = "error"; st.err = friendly(e); }
  }).then(function (){ if (typeof render === "function") render(); });
}
/* Row limits for each live read. A read that returns exactly its limit may
   have been cut off, so the page names it instead of implying it is complete. */
var LIMITS = { recruits: 1000, pipelines: 2000, evaluations: 5000, contacts: 5000 };
var RCOLS = "id,first_name,last_name,preferred_name,prospect_type,grad_year,is_minor,current_school,club_team,city," +
  "state_region,hs_gpa,intended_major,status,created_at";
/** Read the org's recruiting rows; failed secondary reads land in st.partial, reads at their row limit in st.truncated. */
function loadLive(){
  var a = api(), pv = providerRow();
  if (!(a && signedIn() && pv && pv.id))
    return Promise.reject(new Error("Finish setting up your workspace first. The recruit board attaches to your organization."));
  var pid = "provider_id=eq." + encodeURIComponent(pv.id);
  return Promise.all([
    a.from("recruits", "select=" + RCOLS + "&" + pid + "&status=neq.deleted_pending&order=last_name.asc&limit=" + LIMITS.recruits),
    a.from("recruit_pipelines", "select=*&" + pid + "&limit=" + LIMITS.pipelines),
  ]).then(function (res){
    st.recruits = res[0] || []; st.pipelines = res[1] || [];
    st.partial = []; st.truncated = [];
    if (st.recruits.length >= LIMITS.recruits) st.truncated.push("recruits (first " + LIMITS.recruits + ")");
    if (st.pipelines.length >= LIMITS.pipelines) st.truncated.push("board rows (first " + LIMITS.pipelines + ")");
    var soft = function (name, p){
      return p.then(function (rows){ return rows || []; }, function (){ st.partial.push(name); return []; });
    };
    return Promise.all([
      soft("evaluations", a.from("recruit_evaluations", "select=id,pipeline_id,evaluator_id,context,seen_on,scores,overall,projection,notes,created_at&" + pid + "&order=created_at.desc&limit=" + LIMITS.evaluations)),
      soft("contact log", a.from("recruit_contacts", "select=id,pipeline_id,contact_kind,direction,counterpart,occurred_at,subject,summary,permissible_window_status&" + pid + "&order=occurred_at.desc&limit=" + LIMITS.contacts)),
      soft("recruiting needs", a.from("recruiting_targets", "select=id,sport,team_id,entry_year,position,target_count,priority,note&" + pid + "&limit=500")),
      soft("teams", a.from("teams", "select=id,name,sport&" + pid + "&order=name.asc&limit=200")),
      /* RLS returns guardian rows to org admins only; a coach gets none (I7). */
      a.from("recruit_guardians", "select=id,recruit_id,full_name,relationship,email,phone,is_primary,consent_status&" + pid + "&limit=2000")
        .then(function (rows){ return rows || []; }, function (){ return []; }),
    ]);
  }).then(function (r){
    st.evals = r[0]; st.contacts = r[1]; st.targets = r[2]; st.teams = r[3]; st.guardians = r[4];
    if (st.evals.length >= LIMITS.evaluations) st.truncated.push("evaluations (latest " + LIMITS.evaluations + ")");
    if (st.contacts.length >= LIMITS.contacts) st.truncated.push("contact log (latest " + LIMITS.contacts + ")");
    st.targetsSource = st.partial.indexOf("recruiting needs") >= 0 ? "local" : "db";
  });
}
function reload(){
  if (st.mode !== "live") { render(); return Promise.resolve(); }
  return loadLive().then(function (){ st.phase = "ready"; render(); });
}

/* ═══════════════════ DERIVED ═══════════════════ */
function recruitOf(p){ return st.recruits.find(function (r){ return r.id === p.recruit_id; }) || null; }
function pipelineById(id){ return st.pipelines.find(function (p){ return String(p.id) === String(id); }) || null; }
function evalsOf(pid){ return st.evals.filter(function (e){ return e.pipeline_id === pid; }); }
function contactsOf(pid){
  return st.contacts.filter(function (c){ return c.pipeline_id === pid; })
    .sort(function (a, b){ return String(b.occurred_at).localeCompare(String(a.occurred_at)); });
}
function meanOverall(pid){
  var es = evalsOf(pid).filter(function (e){ return e.overall != null; });
  if (!es.length) return null;
  return Math.round(es.reduce(function (s, e){ return s + Number(e.overall); }, 0) / es.length * 10) / 10;
}
function rows(){
  return st.pipelines.filter(function (p){ return p.stage !== "enrolled"; }).map(function (p){
    return { p: p, r: recruitOf(p) };
  }).filter(function (x){ return !!x.r; });
}
function filtered(){
  var f = st.filters, q = norm(f.q);
  return rows().filter(function (x){
    if (f.sport){
      if (f.sport.indexOf("team:") === 0){ if (String(x.p.team_id) !== f.sport.slice(5)) return false; }
      else if (norm(x.p.sport) !== norm(f.sport)) return false;
    }
    if (f.grad && String(x.r.grad_year) !== f.grad) return false;
    if (f.pos && norm(x.p.position_primary) !== norm(f.pos)) return false;
    if (q){
      var hay = norm([x.r.first_name, x.r.last_name, x.r.preferred_name, x.r.current_school, x.r.club_team, x.p.position_primary].join(" "));
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}
function distinct(list){
  var seen = {}, out = [];
  list.forEach(function (v){ if (v != null && v !== "" && !seen[String(v)]){ seen[String(v)] = 1; out.push(v); } });
  return out.sort();
}
/* Roster need for (sport, position, entry year): target minus committed. */
function needFor(sport, pos, year){
  var t = st.targets.find(function (t){
    return norm(t.sport) === norm(sport) && norm(t.position) === norm(pos) && String(t.entry_year).slice(0, 4) === String(year);
  });
  if (!t) return { kind: "none", target: null, committed: 0, open: null };
  var committed = rows().filter(function (x){
    return (x.p.stage === "committed" || x.p.stage === "signed") && norm(x.p.sport) === norm(sport) &&
      norm(x.p.position_primary) === norm(pos) && String(x.r.grad_year) === String(year);
  }).length;
  var open = Math.max(0, Number(t.target_count) - committed);
  return { kind: open > 0 ? "open" : "full", target: Number(t.target_count), committed: committed, open: open };
}
function ranked(){
  return filtered().filter(function (x){ return STAGE_WEIGHT[x.p.stage] != null; }).map(function (x){
    var ov = meanOverall(x.p.id);
    var need = needFor(x.p.sport, x.p.position_primary, x.r.grad_year);
    var sw = STAGE_WEIGHT[x.p.stage], nw = NEED_WEIGHT[need.kind];
    var score = ov == null ? 0 : Math.round(ov * nw * sw * 100) / 100;
    var pos = x.p.position_primary || "this position";
    var why = [];
    if (need.kind === "open") why.push("Needs " + need.open + " " + pos + " for " + x.r.grad_year);
    else if (need.kind === "full") why.push(pos + " for " + x.r.grad_year + " is filled (" + need.committed + " of " + need.target + ")");
    else why.push("No need set for " + pos + " in " + x.r.grad_year);
    why.push(ov == null ? "not evaluated yet" : "overall " + ov.toFixed(1));
    why.push("stage " + label(STAGES, x.p.stage));
    return { x: x, ov: ov, need: need, sw: sw, nw: nw, score: score, why: why.join("; ") };
  }).sort(function (a, b){ return b.score - a.score || String(a.x.r.last_name).localeCompare(String(b.x.r.last_name)); });
}

/* ═══════════════════ WRITES ═══════════════════ */
function liveCtx(){
  var a = api(), pv = providerRow();
  if (!(a && signedIn() && pv && pv.id)) throw new Error("Sign in to save changes.");
  return { a: a, pid: pv.id };
}
function post(table, body){
  var c = liveCtx();
  return c.a.from(table, "", { method: "POST", headers: { Prefer: "return=minimal" }, body: body });
}

function moveStage(pipelineId, to, note, reason){
  var p = pipelineById(pipelineId);
  if (!p) return Promise.reject(new Error("That recruit is no longer on the board."));
  if (to === "closed" && !reason) return Promise.reject(new Error("RECRUIT_CLOSED_REASON"));
  var back = p.stage === "closed" || (STAGE_RANK[to] && STAGE_RANK[to] < STAGE_RANK[p.stage]);
  if (back && !String(note || "").trim()) return Promise.reject(new Error("RECRUIT_STAGE_BACKWARD_NOTE"));
  if (st.mode === "sample"){
    p.stage = to; p.closed_reason = to === "closed" ? reason : null;
    return Promise.resolve({ from_stage: null, to_stage: to });
  }
  var c = liveCtx();
  return c.a.rpc("move_recruit_stage", { p_pipeline: p.id, p_to: to, p_note: note || null, p_closed_reason: to === "closed" ? reason : null })
    .then(function (receipt){ return reload().then(function (){ return receipt; }); });
}

/* ── identity: normalized last|first|grad year, the same shape as the
   recruits.dedupe_key generated column ──────────────────────────────── */
function identityKey(first, last, gy){ return norm(last) + "|" + norm(first) + "|" + (gy == null || gy === "" ? "" : String(gy)); }
/* Put recruit rows we KNOW exist back into st.recruits when a capped reload
   left them out, so the next attempt reuses their ids instead of inserting
   the same person twice. */
function rememberRecruits(list){
  (list || []).forEach(function (x){
    if (!x || !x.id || st.recruits.some(function (r){ return r.id === x.id; })) return;
    st.recruits.push({ id: x.id, first_name: x.first_name, last_name: x.last_name, preferred_name: null,
      prospect_type: x.prospect_type || "high_school", grad_year: x.grad_year, is_minor: true,
      current_school: x.current_school || null, club_team: x.club_team || null, city: x.city || null,
      state_region: x.state_region || null, hs_gpa: x.hs_gpa == null ? null : x.hs_gpa, intended_major: x.intended_major || null,
      status: "active", created_at: new Date().toISOString() });
  });
}
/* When the recruits read hit its row limit, the local list cannot prove a
   person is new: ask the server by dedupe_key first (50 keys per request). */
function findSavedIdentities(keys){
  var truncated = (st.truncated || []).some(function (t){ return /^recruits/.test(t); });
  if (st.mode !== "live" || !truncated || !keys.length) return Promise.resolve();
  return Promise.resolve().then(function (){ return findSavedIdentitiesLive(keys); });
}
function findSavedIdentitiesLive(keys){
  var c = liveCtx(), uniq = keys.filter(function (k, i){ return keys.indexOf(k) === i; }), chunks = [];
  for (var i = 0; i < uniq.length; i += 50) chunks.push(uniq.slice(i, i + 50));
  return Promise.all(chunks.map(function (ch){
    var list = ch.map(function (k){ return encodeURIComponent('"' + k.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'); }).join(",");
    return c.a.from("recruits", "select=" + RCOLS + "&provider_id=eq." + encodeURIComponent(c.pid) +
      "&status=neq.deleted_pending&dedupe_key=in.(" + list + ")&limit=" + (ch.length * 5));
  })).then(function (res){ res.forEach(function (rows){ rememberRecruits(rows || []); }); });
}

/** Add one recruit (or reuse an identity match) plus its board row; resolves to the new pipeline id. */
function addRecruit(v){
  return findSavedIdentities([identityKey(v.first_name, v.last_name, v.grad_year)]).then(function (){ return addRecruitNow(v); });
}
function addRecruitNow(v){
  var dup = st.recruits.find(function (r){
    return norm(r.first_name) === norm(v.first_name) && norm(r.last_name) === norm(v.last_name) && String(r.grad_year || "") === String(v.grad_year || "");
  });
  if (dup){
    var already = st.pipelines.some(function (p){ return p.recruit_id === dup.id && norm(p.sport) === norm(v.sport); });
    if (already) return Promise.reject(new Error(fullName(dup) + " (" + (dup.grad_year || "no year") + ") is already on the " + v.sport + " board."));
  }
  var rid = dup ? dup.id : uuid(), plid = uuid();
  var recruit = {
    id: rid, first_name: v.first_name, last_name: v.last_name, grad_year: v.grad_year, prospect_type: v.prospect_type || "high_school",
    current_school: v.current_school || null, club_team: v.club_team || null, city: v.city || null, state_region: v.state_region || null,
    hs_gpa: v.hs_gpa, intended_major: v.intended_major || null, date_of_birth: v.date_of_birth || null,
    email: v.email || null, phone: v.phone || null,
  };
  var pipeline = {
    id: plid, recruit_id: rid, sport: v.sport, team_id: v.team_id || null, position_primary: v.position || null,
    positions: v.position ? [v.position] : [], film_links: v.film_links || [], target_entry_year: v.grad_year ? String(v.grad_year) : null,
  };
  var guardian = v.guardian && v.guardian.full_name ? {
    recruit_id: rid, full_name: v.guardian.full_name, relationship: v.guardian.relationship || null,
    email: v.guardian.email || null, phone: v.guardian.phone || null, is_primary: true,
  } : null;
  if (st.mode === "sample"){
    if (!dup){
      var minor = !v.date_of_birth || (Date.now() - Date.parse(v.date_of_birth)) < 18 * 365.25 * 86400000;
      st.recruits.push({ id: rid, first_name: v.first_name, last_name: v.last_name, preferred_name: null, prospect_type: recruit.prospect_type,
        grad_year: v.grad_year, is_minor: minor, current_school: recruit.current_school, club_team: recruit.club_team, city: recruit.city,
        state_region: recruit.state_region, hs_gpa: v.hs_gpa, intended_major: recruit.intended_major, status: "active",
        created_at: new Date().toISOString(), _email: v.email || null, _phone: v.phone || null });
    }
    pipeline.stage = "identified"; pipeline.closed_reason = null; pipeline.last_contact_at = null;
    st.pipelines.push(pipeline);
    if (guardian){ guardian.id = uuid(); guardian.consent_status = "not_requested"; st.guardians.push(guardian); }
    return Promise.resolve(plid);
  }
  var c = liveCtx();
  recruit.provider_id = c.pid; pipeline.provider_id = c.pid;
  var first = dup ? Promise.resolve() : post("recruits", recruit);
  return first.then(function (){
    /* If the board-row write fails after the recruit row landed, reload first so
       st.recruits holds that recruit and a retry reuses it instead of tripping
       the identity dedupe on a second insert; then surface the original error. */
    return post("recruit_pipelines", pipeline).then(null, function (e){
      var landed = dup ? [] : [recruit];
      return reload().then(function (){ rememberRecruits(landed); throw e; }, function (){ rememberRecruits(landed); throw e; });
    });
  })
    .then(function (){
      if (!guardian) return null;
      guardian.provider_id = c.pid;
      /* A failed guardian write must not lose the recruit: report it plainly. */
      return post("recruit_guardians", guardian).then(null, function (e){ return { guardianError: friendly(e) }; });
    }).then(function (g){
      return reload().then(function (){
        if (g && g.guardianError) toast("Recruit saved. The guardian was not saved: " + g.guardianError);
        return plid;
      });
    });
}

function addEval(pipelineId, v){
  var p = pipelineById(pipelineId);
  if (!p) return Promise.reject(new Error("That recruit is no longer on the board."));
  if (overallOf(v.scores) == null) return Promise.reject(new Error("RECRUIT_EVAL_SCORES"));
  var row = { pipeline_id: p.id, recruit_id: p.recruit_id, context: v.context, seen_on: v.seen_on, scores: v.scores,
    overall: overallOf(v.scores), projection: v.projection || null, notes: v.notes || null };
  if (st.mode === "sample"){
    row.id = uuid(); row.evaluator_id = "you"; row.created_at = new Date().toISOString();
    st.evals.unshift(row);
    if (p.stage === "identified") p.stage = "evaluated";   // mirrors the server trigger
    return Promise.resolve();
  }
  var c = liveCtx(); row.provider_id = c.pid;
  return post("recruit_evaluations", row).then(reload);
}

function addContact(pipelineId, v){
  var p = pipelineById(pipelineId);
  if (!p) return Promise.reject(new Error("That recruit is no longer on the board."));
  var row = { pipeline_id: p.id, recruit_id: p.recruit_id, contact_kind: v.contact_kind, direction: v.direction,
    counterpart: v.counterpart, occurred_at: v.occurred_at, summary: v.summary || null };
  if (st.mode === "sample"){
    row.id = uuid(); row.permissible_window_status = "unchecked"; st.contacts.unshift(row);
    if (!p.last_contact_at || p.last_contact_at < row.occurred_at) p.last_contact_at = row.occurred_at;
    if (row.direction === "outbound" && (p.stage === "identified" || p.stage === "evaluated")) p.stage = "contacted";
    return Promise.resolve();
  }
  var c = liveCtx(); row.provider_id = c.pid;
  return post("recruit_contacts", row).then(reload);
}

function saveTarget(v){
  var existing = st.targets.find(function (t){
    return norm(t.sport) === norm(v.sport) && norm(t.position) === norm(v.position) && String(t.entry_year) === String(v.entry_year);
  });
  if (st.mode === "sample" || st.targetsSource !== "db"){
    if (existing){ existing.target_count = v.target_count; }
    else st.targets.push({ id: uuid(), sport: v.sport, entry_year: v.entry_year, position: v.position, target_count: v.target_count, priority: 3 });
    return Promise.resolve();
  }
  var c = liveCtx();
  var req = existing
    ? c.a.from("recruiting_targets", "id=eq." + encodeURIComponent(existing.id) + "&provider_id=eq." + encodeURIComponent(c.pid),
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: { target_count: v.target_count } })
        .then(function (r){ if (!(r && r[0])) throw new Error("42501"); })
    : post("recruiting_targets", { provider_id: c.pid, sport: v.sport, entry_year: v.entry_year, position: v.position, target_count: v.target_count });
  return req.then(reload);
}
function deleteTarget(id){
  if (st.mode === "sample" || st.targetsSource !== "db"){
    st.targets = st.targets.filter(function (t){ return t.id !== id; });
    return Promise.resolve();
  }
  var c = liveCtx();
  return c.a.from("recruiting_targets", "id=eq." + encodeURIComponent(id) + "&provider_id=eq." + encodeURIComponent(c.pid),
    { method: "DELETE", headers: { Prefer: "return=representation" } })
    .then(function (r){ if (!(r && r[0])) throw new Error("42501"); }).then(reload);
}

/* Revealed contact details live only while the drawer that asked for them is
   open. Every clear bumps the generation, so a reveal whose response arrives
   after the drawer closed or switched recruit is dropped, not shown. */
var sensitiveGen = 0;
function clearSensitive(){ sensitiveGen++; st.sensitive = {}; }

/** Reveal one recruit's contact details (server writes the access receipt); a response from a superseded drawer is discarded. */
function loadSensitive(recruitId){
  var r = st.recruits.find(function (x){ return x.id === recruitId; });
  if (!r) return Promise.resolve();
  if (st.mode === "sample"){
    st.sensitive[recruitId] = { email: r._email, phone: r._phone, is_minor: r.is_minor };
    return Promise.resolve();
  }
  var c = liveCtx(), gen = sensitiveGen;
  return c.a.rpc("get_recruit_sensitive", { p_recruit: recruitId }).then(function (rowsOut){
    if (gen !== sensitiveGen || st.open == null) return;   // drawer closed or switched: drop it
    var row = (rowsOut && rowsOut[0]) || null;
    st.sensitive[recruitId] = row ? { email: row.email, phone: row.phone, is_minor: row.is_minor } : { refused: "No contact details are on file." };
  }, function (e){
    if (gen !== sensitiveGen || st.open == null) return;
    st.sensitive[recruitId] = { refused: friendly(e) };
  });
}

/* ═══════════════════ CSV ═══════════════════ */
function parseCSV(text){
  var out = [], row = [], f = "", q = false, i, ch;
  text = String(text || "").replace(/^\uFEFF/, "");
  for (i = 0; i < text.length; i++){
    ch = text[i];
    if (q){
      if (ch === '"'){ if (text[i + 1] === '"'){ f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ","){ row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r"){
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = ""; out.push(row); row = [];
    } else f += ch;
  }
  if (f !== "" || row.length){ row.push(f); out.push(row); }
  return out.filter(function (r){ return r.some(function (c){ return String(c).trim() !== ""; }); });
}
function csvPreview(text){
  var grid = parseCSV(text);
  if (!grid.length) return { error: "The file is empty." };
  var head = grid[0].map(function (c){ return norm(c).replace(/[\s-]+/g, "_"); });
  var alias = { firstname: "first_name", lastname: "last_name", graduation_year: "grad_year", class: "grad_year", class_of: "grad_year",
    pos: "position", high_school: "school", current_school: "school", film: "film_url", film_link: "film_url", state_region: "state" };
  head = head.map(function (k){ return alias[k] || k; });
  var missing = CSV_COLUMNS.filter(function (c){ return c.req && head.indexOf(c.key) < 0; }).map(function (c){ return c.key; });
  if (missing.length) return { error: "Missing required column" + (missing.length > 1 ? "s" : "") + ": " + missing.join(", ") + "." };
  if (grid.length > 501) return { error: "Import up to 500 recruits at a time. This file has " + (grid.length - 1) + "." };
  var seen = {};
  var parsed = grid.slice(1).map(function (cells, n){
    var o = {}; head.forEach(function (k, i){ o[k] = String(cells[i] == null ? "" : cells[i]).trim(); });
    var errs = [];
    if (!o.first_name) errs.push("first name missing");
    if (!o.last_name) errs.push("last name missing");
    var gy = Number(o.grad_year);
    if (!/^\d{4}$/.test(o.grad_year || "") || gy < 2000 || gy > 2100) errs.push("grad year must be four digits");
    if (!o.sport) errs.push("sport missing");
    var gpa = o.gpa ? Number(o.gpa) : null;
    if (o.gpa && !(gpa >= 0 && gpa <= 5)) errs.push("GPA must be 0 to 5");
    var links = (o.film_url || "").split(/\s+/).filter(Boolean);
    var bad = links.filter(function (u){ return !/^https:\/\/\S+$/i.test(u); });
    if (bad.length) errs.push("film links must start with https://");
    var stage = norm(o.stage) || "identified";
    if (!STAGE_RANK[stage] || stage === "enrolled") errs.push("unknown stage “" + o.stage + "”");
    var key = norm(o.first_name) + "|" + norm(o.last_name) + "|" + o.grad_year + "|" + norm(o.sport);
    var status = errs.length ? "error" : "ready";
    var note = errs.join("; ");
    if (status === "ready"){
      var onBoard = rows().some(function (x){
        return norm(x.r.first_name) === norm(o.first_name) && norm(x.r.last_name) === norm(o.last_name) &&
          String(x.r.grad_year) === o.grad_year && norm(x.p.sport) === norm(o.sport);
      });
      if (onBoard){ status = "skip"; note = "already on the board"; }
      else if (seen[key]){ status = "skip"; note = "repeats row " + seen[key]; }
    }
    seen[key] = seen[key] || (n + 2);
    return { line: n + 2, o: o, gy: gy, gpa: gpa, links: links, stage: stage, status: status, note: note };
  });
  return { rows: parsed, unknown: head.filter(function (k){ return k && !CSV_COLUMNS.some(function (c){ return c.key === k; }); }) };
}
/** Write the previewed CSV rows: one recruit per identity, one board row per CSV row; resolves to rows written. */
function runImport(){
  var prev = st.csv.rows;
  if (!prev || !prev.rows) return Promise.reject(new Error("Preview the file first."));
  var ready = prev.rows.filter(function (r){ return r.status === "ready"; });
  if (!ready.length) return Promise.reject(new Error("No rows are ready to import."));
  return findSavedIdentities(ready.map(function (r){ return identityKey(r.o.first_name, r.o.last_name, r.gy); }))
    .then(function (){ return runImportNow(ready); });
}
function runImportNow(ready){
  var recs = [], pipes = [];
  /* Identity = normalized first + last + grad year. One person on two sport
     boards in the same file must become ONE recruit with two board rows, so
     rows queued earlier in this import are matched as well as saved ones. */
  var queued = {};
  ready.forEach(function (r){
    var ident = norm(r.o.first_name) + "|" + norm(r.o.last_name) + "|" + String(r.gy);
    var existing = st.recruits.find(function (x){
      return norm(x.first_name) === norm(r.o.first_name) && norm(x.last_name) === norm(r.o.last_name) && String(x.grad_year) === String(r.gy);
    });
    var rid = existing ? existing.id : queued[ident];
    if (!rid){
      rid = queued[ident] = uuid();
      recs.push({ id: rid, first_name: r.o.first_name, last_name: r.o.last_name, grad_year: r.gy,
      current_school: r.o.school || null, club_team: r.o.club_team || null, city: r.o.city || null, state_region: r.o.state || null,
      hs_gpa: r.gpa, email: r.o.email || null, phone: r.o.phone || null });
    }
    pipes.push({ id: uuid(), recruit_id: rid, sport: r.o.sport, position_primary: r.o.position || null,
      positions: r.o.position ? [r.o.position] : [], film_links: r.links, stage: r.stage, target_entry_year: String(r.gy) });
  });
  if (st.mode === "sample"){
    recs.forEach(function (x){
      st.recruits.push({ id: x.id, first_name: x.first_name, last_name: x.last_name, preferred_name: null, prospect_type: "high_school",
        grad_year: x.grad_year, is_minor: true, current_school: x.current_school, club_team: x.club_team, city: x.city,
        state_region: x.state_region, hs_gpa: x.hs_gpa, intended_major: null, status: "active", created_at: new Date().toISOString(),
        _email: x.email, _phone: x.phone });
    });
    pipes.forEach(function (x){ x.closed_reason = null; x.last_contact_at = null; st.pipelines.push(x); });
    return Promise.resolve(pipes.length);
  }
  var c = liveCtx();
  recs.forEach(function (x){ x.provider_id = c.pid; x.prospect_type = "high_school"; });
  pipes.forEach(function (x){ x.provider_id = c.pid; });
  /* Two bulk writes: identities, then board rows. PostgREST runs each in
     one transaction, so a bad row rejects its whole batch, not half. */
  return (recs.length ? post("recruits", recs) : Promise.resolve())
    .then(function (){
      /* If the identities landed but the board rows did not, reload before
         rethrowing so a retry finds those recruits and reuses their ids. */
      return post("recruit_pipelines", pipes).then(null, function (e){
        return reload().then(function (){ rememberRecruits(recs); throw e; }, function (){ rememberRecruits(recs); throw e; });
      });
    })
    .then(reload).then(function (){ return pipes.length; });
}

/* ═══════════════════ CSS ═══════════════════ */
var CSS = `
.rc-sr{position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.rc-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:0 0 16px}
.rc-filters label{display:flex;flex-direction:column;gap:4px;font-size:14px;color:var(--cui-ink-3)}
.rc-filters select,.rc-filters input{height:40px;min-width:136px;padding:0 12px;font-size:14px}
.rc-filters .rc-q{flex:1 1 220px}
.rc-filters .rc-q input{width:100%}
.rc-needs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.rc-need{padding:8px 12px;border:1px solid var(--cui-line);border-radius:8px;background:var(--cui-panel);font-size:14px;color:var(--cui-ink-2)}
.rc-need b{color:var(--cui-ink);font-weight:600}
.rc-need--open{border-left:3px solid var(--cui-ink)}
.rc-wrap{container-type:inline-size;min-width:0}
.rc-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(216px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px;
  scrollbar-color:var(--cui-line-2) transparent}
@container (max-width:640px){
  .rc-board{display:flex;flex-direction:column;overflow:visible}
  .rc-colempty{padding:0 4px}
}
.rc-col{min-width:0;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:var(--cui-panel-2)}
.rc-col__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 4px}
.rc-col__head h2{margin:0;font-size:14px!important;font-weight:600;color:var(--cui-ink)}
.rc-col__n{font-family:"JetBrains Mono",monospace;font-size:14px;color:var(--cui-ink-3)}
.rc-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.rc-colempty{margin:0;padding:8px 4px;font-size:14px;color:var(--cui-ink-3)}
.rc-card{position:relative;border:1px solid var(--cui-line);border-radius:8px;background:var(--cui-panel)}
.rc-open{display:flex;flex-direction:column;align-items:flex-start;gap:4px;width:100%;padding:12px 12px 8px;border:0;background:transparent;
  text-align:left;cursor:pointer;font-size:14px;line-height:1.4;color:var(--cui-ink-2)}
.rc-open b{color:var(--cui-ink);font-weight:600;font-size:15px}
.rc-open:hover b{text-decoration:underline}
.rc-meta{font-family:"JetBrains Mono",monospace;color:var(--cui-ink-2)}
.rc-sub{color:var(--cui-ink-3)}
.rc-move{display:block;padding:0 12px 12px}
.rc-move select{width:100%;height:40px;padding:0 8px;font-size:14px}
.rc-banner{margin:0 0 16px}
.rc-section{margin:0 0 24px}
.rc-section:last-child{margin-bottom:0}
.rc-section>h3{margin:0 0 8px;font-size:16px!important;font-weight:600;color:var(--cui-ink)}
.rc-dl{display:grid;grid-template-columns:minmax(120px,40%) 1fr;gap:8px 16px;margin:0;font-size:14px}
.rc-dl dt{color:var(--cui-ink-3)}
.rc-dl dd{margin:0;color:var(--cui-ink)}
.rc-log{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:8px}
.rc-log li{padding:12px;border:1px solid var(--cui-line);border-radius:8px;background:var(--cui-panel);font-size:14px;line-height:1.5;color:var(--cui-ink-2)}
.rc-log li b{color:var(--cui-ink);font-weight:600}
.rc-log .rc-sub{display:block}
.rc-form{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--cui-line);border-radius:12px;background:var(--cui-panel)}
.rc-form label{display:flex;flex-direction:column;gap:4px;font-size:14px;color:var(--cui-ink-2)}
.rc-form input,.rc-form select,.rc-form textarea{min-height:40px;padding:8px 12px;font-size:14px}
.rc-form textarea{min-height:88px;resize:vertical}
.rc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.rc-form fieldset{margin:0;padding:0;border:0;display:flex;flex-direction:column;gap:8px}
.rc-form legend{padding:0;margin:0 0 4px;font-size:14px;font-weight:600;color:var(--cui-ink)}
.rc-score{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;color:var(--cui-ink-2)}
.rc-score span:first-child{min-width:120px}
.rc-pick{display:flex;gap:4px}
.rc-pick label{position:relative;flex-direction:row;gap:0}
.rc-pick input{position:absolute;opacity:0;width:1px;height:1px}
.rc-pick span{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--cui-line-2);border-radius:8px;
  font-family:"JetBrains Mono",monospace;font-size:14px;color:var(--cui-ink-2);cursor:pointer}
.rc-pick input:checked+span{background:var(--cui-ink);border-color:var(--cui-ink);color:var(--cui-panel)}
.rc-pick input:focus-visible+span{outline:2px solid var(--cui-ink);outline-offset:2px}
.rc-err{margin:0;padding:8px 12px;border-radius:8px;font-size:14px;color:var(--hv-danger,#A3352A);background:var(--hv-danger-tint,#F8E9E6)}
.rc-err[hidden],.rc-form [hidden]{display:none!important}
.rc-note{margin:0;font-size:14px;line-height:1.5;color:var(--cui-ink-3)}
.rc-actions{display:flex;flex-wrap:wrap;gap:8px}
.rc-why{color:var(--cui-ink-2);font-size:14px}
.rc-csv textarea{width:100%;min-height:160px;font-family:"JetBrains Mono",monospace;font-size:14px}
.rc-film a{color:var(--cui-ink);word-break:break-all}
.rc-status--error{color:var(--hv-danger,#A3352A)}
.rc-loading{min-height:120px;display:grid;place-items:center;color:var(--cui-ink-3);font-size:14px}
@media(max-width:760px){
  .rc-filters label{flex:1 1 calc(50% - 8px)}
  .rc-filters select,.rc-filters input{min-width:0;width:100%}
  .rc-grid2{grid-template-columns:1fr}
  .rc-score{flex-direction:column;align-items:flex-start;gap:4px}
  .rc-dl{grid-template-columns:1fr;gap:2px}
  .rc-dl dd{margin-bottom:8px}
}
`;

/* ═══════════════════ VIEW ═══════════════════ */
function recruitingView(){
  var ui = window.COACH_UI;
  if (!ui) return "";
  kickLoad();
  var tabs = [
    { key: "board", label: "Board", count: st.phase === "ready" ? rows().filter(function (x){ return x.p.stage !== "closed"; }).length : null },
    { key: "ranking", label: "Ranking" },
    { key: "needs", label: "Needs", count: st.phase === "ready" ? st.targets.length : null },
    { key: "import", label: "Import" },
  ];
  var tab = ui.activeTab(tabs, "board", "recruitTab");
  var body;
  if (st.phase === "loading" || st.phase === "idle"){
    body = ui.Card('<div class="rc-loading" role="status">Loading your recruit board…</div>');
  } else if (st.phase === "off"){
    body = ui.Callout({ title: "Recruiting isn't switched on for this workspace yet.",
      body: "The database change is drafted and waiting to be applied. Once it is, your board, evaluations and contact log appear here." });
    tabs = []; tab = null;
  } else if (st.phase === "error"){
    body = ui.Callout({ title: "Could not load the recruit board.", body: st.err || "Try again." }) +
      '<div class="rc-actions">' + ui.Button({ label: "Try again", attrs: 'data-rc-retry="1"' }) + "</div>";
    tabs = []; tab = null;
  } else {
    body = banner(ui) + (tab === "ranking" ? rankingBody(ui) : tab === "needs" ? needsBody(ui) : tab === "import" ? importBody(ui) : boardBody(ui));
  }
  var actions = st.phase === "ready" ? [ui.Button({ label: "Add recruit", size: "lg", variant: "primary", attrs: 'data-rc-add="1"' })] : [];
  return ui.Page({
    page: "recruiting",
    eyebrow: "Source",
    h1: "Recruiting",
    lede: "Every prospect from first look to signed, with the evaluations and contacts behind each move.",
    actions: actions,
    tabs: tabs, active: tab, stateKey: "recruitTab", tabLabel: "Recruiting sections",
    body: body,
  }) + (st.phase === "ready" ? drawer(ui) : "");
}

function banner(ui){
  var out = "";
  if (st.mode === "sample"){
    out += '<div class="rc-banner">' + ui.Callout({ title: "Sample workspace.",
      body: "These recruits are examples so you can see how the board works. Changes you make here are not saved. Sign in to start your own board." }) + "</div>";
  }
  if (st.partial.length){
    out += '<div class="rc-banner">' + ui.Callout({ title: "Part of the board did not load.",
      body: "Could not read your " + st.partial.join(", ") + ". What is shown may be incomplete. Reload the page to try again." }) + "</div>";
  }
  if (st.truncated && st.truncated.length){
    out += '<div class="rc-banner">' + ui.Callout({ title: "Showing only part of your data.",
      body: "This page loads a fixed number of rows and reached that limit for: " + st.truncated.join(", ") + ". Anything past the limit is not shown or counted here." }) + "</div>";
  }
  return out;
}

function filterBar(){
  var all = rows();
  var sports = distinct(all.map(function (x){ return x.p.sport; }));
  var sportOpts = sports.map(function (s){ return [s, s]; }).concat(st.teams.map(function (t){ return ["team:" + t.id, t.name]; }));
  var grads = distinct(all.map(function (x){ return x.r.grad_year; })).map(function (g){ return [String(g), String(g)]; });
  var poss = distinct(all.map(function (x){ return x.p.position_primary; })).map(function (p){ return [p, p]; });
  var f = st.filters;
  return '<div class="rc-filters" role="search" aria-label="Filter recruits">' +
    (sportOpts.length > 1 ? '<label>Sport or team<select data-rc-filter="sport">' + options(sportOpts, f.sport, "All") + "</select></label>" : "") +
    '<label>Grad year<select data-rc-filter="grad">' + options(grads, f.grad, "All") + "</select></label>" +
    '<label>Position<select data-rc-filter="pos">' + options(poss, f.pos, "All") + "</select></label>" +
    '<label class="rc-q">Search<input type="search" data-rc-filter="q" value="' + h(f.q) + '" placeholder="Name, school or club" autocomplete="off"></label>' +
    "</div>";
}

function needsStrip(){
  var list = st.targets.filter(function (t){ return Number(t.target_count) > 0; });
  if (!list.length) return "";
  return '<div class="rc-needs" aria-label="Roster needs">' + list.map(function (t){
    var n = needFor(t.sport, t.position, String(t.entry_year).slice(0, 4));
    return '<span class="rc-need' + (n.kind === "open" ? " rc-need--open" : "") + '"><b>' + h(t.position) + " " + h(String(t.entry_year).slice(0, 4)) +
      "</b> \u00b7 " + n.committed + " of " + n.target + " committed</span>";
  }).join("") + "</div>";
}

function boardBody(ui){
  var all = rows();
  if (!all.length){
    return ui.EmptyState("No recruits yet", "Add your first recruit, or import a list from a spreadsheet on the Import tab.") +
      '<div class="rc-actions" style="justify-content:center;margin-top:16px">' +
      ui.Button({ label: "Add recruit", size: "lg", variant: "primary", attrs: 'data-rc-add="1"' }) + "</div>";
  }
  var list = filtered();
  var cols = STAGES.map(function (s){
    var items = list.filter(function (x){ return x.p.stage === s[0]; })
      .sort(function (a, b){ return String(b.p.last_contact_at || "").localeCompare(String(a.p.last_contact_at || "")) || String(a.r.last_name).localeCompare(String(b.r.last_name)); });
    var id = "rc-col-" + s[0];
    return '<section class="rc-col" aria-labelledby="' + id + '"><div class="rc-col__head"><h2 id="' + id + '">' + h(s[1]) +
      '</h2><span class="rc-col__n" aria-label="' + items.length + ' recruits">' + items.length + "</span></div>" +
      (items.length ? '<ol class="rc-cards">' + items.map(card).join("") + "</ol>" : '<p class="rc-colempty">None</p>') + "</section>";
  }).join("");
  return filterBar() + needsStrip() +
    (list.length ? "" : '<p class="rc-note" style="margin:0 0 16px">No recruits match these filters.</p>') +
    '<div class="rc-wrap"><div class="rc-board">' + cols + "</div></div>";
}

function card(x){
  var ov = meanOverall(x.p.id), n = evalsOf(x.p.id).length, name = fullName(x.r);
  var meta = [x.r.grad_year, x.p.position_primary].filter(Boolean).join(" · ");
  var stageOpts = STAGES.filter(function (s){ return s[0] !== x.p.stage; });
  return '<li class="rc-card"><button type="button" class="rc-open" data-rc-open="' + h(x.p.id) + '">' +
    "<b>" + h(name) + "</b>" +
    (meta ? '<span class="rc-meta">' + h(meta) + "</span>" : "") +
    (x.r.current_school ? "<span>" + h(x.r.current_school) + "</span>" : "") +
    '<span class="rc-sub">' + h(agoText(x.p.last_contact_at)) + "</span>" +
    '<span class="rc-sub">' + (ov == null ? "Not evaluated" : 'Overall <span class="cui-mono">' + ov.toFixed(1) + "</span> from " + n + " evaluation" + (n === 1 ? "" : "s")) + "</span>" +
    "</button>" +
    '<label class="rc-move"><span class="rc-sr">Move ' + h(name) + " to</span>" +
    '<select data-rc-move="' + h(x.p.id) + '"><option value="">Move to…</option>' + options(stageOpts, "") + "</select></label></li>";
}

function rankingBody(ui){
  var list = ranked();
  var explain = ui.Callout({ title: "How the score works.",
    body: "Score = average overall evaluation × need weight × stage weight. Need weight is 1.0 when the recruit's position still has an open target for their grad year, 0.6 when no target is set, and 0.2 when that target is already filled. Stage weight is 0.8 at Identified, 0.9 Evaluated, 1.0 Contacted, 1.1 Visit and 1.2 Offer. Recruits without an evaluation score 0. Committed, signed and closed recruits are not ranked. No AI is involved." });
  if (!list.length) return explain + ui.EmptyState("Nothing to rank yet", "Rankings appear once recruits are on the board. Add evaluations to give them a score.");
  var cols = [
    { key: "n", label: "Rank" }, { key: "who", label: "Recruit" }, { key: "score", label: "Score" },
    { key: "why", label: "Why" }, { key: "act", label: "" },
  ];
  var rowsOut = list.map(function (o, i){
    return {
      n: ui.html('<span class="cui-mono">' + (i + 1) + "</span>"),
      who: ui.html("<b>" + h(fullName(o.x.r)) + "</b><small>" + h([o.x.r.grad_year, o.x.p.position_primary, o.x.r.current_school].filter(Boolean).join(" · ")) + "</small>"),
      score: ui.html('<span class="cui-mono">' + o.score.toFixed(2) + "</span>"),
      why: ui.html('<span class="rc-why">' + h(o.why) + "</span>"),
      act: ui.html(ui.Button({ label: "Open", size: "sm", attrs: 'data-rc-open="' + h(o.x.p.id) + '"' })),
    };
  });
  return explain + filterBar() + ui.DataTable({ columns: cols, rows: rowsOut });
}

function needsBody(ui){
  var sports = distinct(rows().map(function (x){ return x.p.sport; }).concat(st.targets.map(function (t){ return t.sport; })));
  var where = st.mode === "sample" ? "Sample workspace: needs are not saved."
    : st.targetsSource === "db" ? (isAdmin() ? "Saved for everyone in your organization." : "Organization admins set needs. You can view them.")
    : "Needs could not be loaded from the server, so changes here last until you leave the page.";
  var list = st.targets.slice().sort(function (a, b){
    return String(a.entry_year).localeCompare(String(b.entry_year)) || String(a.position).localeCompare(String(b.position));
  });
  var table = list.length ? ui.DataTable({
    columns: [{ key: "pos", label: "Position" }, { key: "yr", label: "Grad year" }, { key: "t", label: "Target" },
      { key: "c", label: "Committed" }, { key: "g", label: "Still needed" }, { key: "on", label: "On board" }, { key: "act", label: "" }],
    rows: list.map(function (t){
      var y = String(t.entry_year).slice(0, 4), n = needFor(t.sport, t.position, y);
      var onBoard = rows().filter(function (x){
        return norm(x.p.sport) === norm(t.sport) && norm(x.p.position_primary) === norm(t.position) && String(x.r.grad_year) === y &&
          x.p.stage !== "closed" && x.p.stage !== "committed" && x.p.stage !== "signed";
      }).length;
      return {
        pos: ui.html("<b>" + h(t.position) + "</b><small>" + h(t.sport) + "</small>"),
        yr: ui.html('<span class="cui-mono">' + h(y) + "</span>"),
        t: ui.html('<span class="cui-mono">' + h(t.target_count) + "</span>"),
        c: ui.html('<span class="cui-mono">' + n.committed + "</span>"),
        g: ui.html('<span class="cui-mono">' + n.open + "</span>"),
        on: ui.html('<span class="cui-mono">' + onBoard + "</span>"),
        act: ui.html((st.mode === "sample" || isAdmin() || st.targetsSource !== "db")
          ? ui.Button({ label: "Remove", size: "sm", attrs: 'data-rc-deltarget="' + h(t.id) + '" aria-label="Remove ' + h(t.position + " " + y) + ' need"' }) : ""),
      };
    }),
  }) : ui.EmptyState("No roster needs set", "Say how many players you need per position and grad year. The board and the ranking use it.");
  var canEdit = st.mode === "sample" || st.targetsSource !== "db" || isAdmin();
  var form = canEdit ? '<form class="rc-form" id="rcTargetForm" style="margin-top:16px" novalidate>' +
    '<p class="rc-note">' + h(where) + "</p>" +
    '<div class="rc-grid2">' +
    '<label>Sport<input name="sport" list="rcSportList" required value="' + h(sports[0] || "") + '" autocomplete="off"></label>' +
    '<label>Position<input name="position" required maxlength="60" placeholder="e.g. GK" autocomplete="off"></label>' +
    '<label>Grad year<input name="entry_year" required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="' + (new Date().getFullYear() + 1) + '"></label>' +
    '<label>How many you need<input name="target_count" type="number" min="0" max="99" step="1" required></label>' +
    "</div>" +
    '<datalist id="rcSportList">' + sports.map(function (s){ return '<option value="' + h(s) + '">'; }).join("") + "</datalist>" +
    '<p class="rc-err" id="rcTargetErr" role="alert" hidden></p>' +
    '<div class="rc-actions"><button type="submit" class="cui-button cui-button--lg cui-button--secondary">Save need</button></div>' +
    "</form>" : '<p class="rc-note" style="margin-top:16px">' + h(where) + "</p>";
  return table + form;
}

function importBody(ui){
  var doc = ui.DataTable({
    columns: [{ key: "c", label: "Column" }, { key: "r", label: "Required" }, { key: "e", label: "Example" }, { key: "n", label: "Notes" }],
    rows: CSV_COLUMNS.map(function (c){
      return { c: ui.html('<span class="cui-mono">' + h(c.key) + "</span>"), r: c.req ? "Yes" : "No", e: c.ex, n: c.note || "—" };
    }),
  });
  var prev = st.csv.rows, preview = "";
  if (prev && prev.error){
    preview = '<p class="rc-err" role="alert">' + h(prev.error) + "</p>";
  } else if (prev && prev.rows){
    var ready = prev.rows.filter(function (r){ return r.status === "ready"; }).length;
    var skip = prev.rows.filter(function (r){ return r.status === "skip"; }).length;
    var bad = prev.rows.filter(function (r){ return r.status === "error"; }).length;
    preview = '<div class="rc-section" style="margin-top:24px"><h3>Preview</h3>' +
      '<p class="rc-note" style="margin-bottom:12px"><span class="cui-mono">' + ready + "</span> ready, <span class=\"cui-mono\">" + skip +
      "</span> skipped, <span class=\"cui-mono\">" + bad + "</span> with errors. Rows with errors or duplicates are not imported." +
      (prev.unknown && prev.unknown.length ? " Ignored columns: " + h(prev.unknown.join(", ")) + "." : "") + "</p>" +
      ui.DataTable({
        columns: [{ key: "l", label: "Row" }, { key: "who", label: "Recruit" }, { key: "s", label: "Status" }],
        rows: prev.rows.slice(0, 200).map(function (r){
          return {
            l: ui.html('<span class="cui-mono">' + r.line + "</span>"),
            who: ui.html("<b>" + h((r.o.first_name || "?") + " " + (r.o.last_name || "?")) + "</b><small>" +
              h([r.o.grad_year, r.o.sport, r.o.position, r.o.school].filter(Boolean).join(" · ")) + "</small>"),
            s: ui.html(r.status === "ready" ? "Ready" : r.status === "skip" ? "Skipped: " + h(r.note)
              : '<span class="rc-status--error">Error: ' + h(r.note) + "</span>"),
          };
        }),
      }) +
      (prev.rows.length > 200 ? '<p class="rc-note">Showing the first 200 rows.</p>' : "") +
      '<p class="rc-err" id="rcImportErr" role="alert" hidden></p>' +
      '<div class="rc-actions" style="margin-top:16px">' +
      ui.Button({ label: "Import " + ready + " recruit" + (ready === 1 ? "" : "s"), size: "lg", variant: "primary",
        attrs: 'data-rc-import="1"' + (ready ? "" : " disabled") }) + "</div></div>";
  }
  return ui.Block({ title: "Columns", subtitle: "The first row of the file must be the column names. Order does not matter.", body: doc }) +
    '<form class="rc-form rc-csv" id="rcCsvForm" novalidate>' +
    '<label>CSV file<input type="file" name="file" accept=".csv,text/csv"></label>' +
    '<label>Or paste the rows<textarea name="text" spellcheck="false" placeholder="first_name,last_name,grad_year,sport,position&#10;Maya,Torres,2027,Soccer,GK">' + h(st.csv.text) + "</textarea></label>" +
    '<div class="rc-actions"><button type="submit" class="cui-button cui-button--lg cui-button--secondary">Preview</button></div>' +
    (st.mode === "sample" ? '<p class="rc-note">Sample workspace: imported rows are not saved.</p>' : "") +
    "</form>" + preview;
}

/* ── drawer: one recruit, or the add form ── */
function drawer(ui){
  if (st.adding) return ui.Drawer({ kicker: "New", title: "Add recruit", headingId: "rc-drawer-title", body: addForm(), actions: "" });
  var p = st.open ? pipelineById(st.open) : null;
  if (!p) return "";
  var r = recruitOf(p);
  if (!r) return "";
  var meta = [r.grad_year, p.position_primary, p.sport].filter(Boolean).join(" · ");
  return ui.Drawer({
    kicker: meta, title: fullName(r), headingId: "rc-drawer-title",
    body: stageSection(p) + profileSection(p, r) + contactSection(r) + guardianSection(r) + filmSection(p) +
      evalSection(p) + contactLogSection(p),
    actions: ui.Button({ label: "Close", attrs: 'data-cui-drawer-close="1"' }),
  });
}
function stageSection(p){
  var cur = label(STAGES, p.stage) + (p.stage === "closed" && p.closed_reason ? " (" + label(CLOSED_REASONS, p.closed_reason) + ")" : "");
  var to = st.section === "stage" ? st.stageTo : "";
  var back = to && (p.stage === "closed" || (STAGE_RANK[to] && STAGE_RANK[to] < STAGE_RANK[p.stage]));
  return '<section class="rc-section"><h3>Stage</h3>' +
    '<form class="rc-form" id="rcStageForm" data-pl="' + h(p.id) + '" novalidate>' +
    '<p class="rc-note">Now: <b>' + h(cur) + "</b>. Moving back or reopening needs a note; closing needs a reason. Every move is recorded.</p>" +
    '<label>Move to<select name="to" required>' + options(STAGES.filter(function (s){ return s[0] !== p.stage; }), to, "Choose a stage") + "</select></label>" +
    '<label' + (to === "closed" ? "" : " hidden") + ' data-rc-reason>Reason<select name="reason">' + options(CLOSED_REASONS, "", "Choose a reason") + "</select></label>" +
    '<label' + (back || to === "closed" ? "" : " hidden") + ' data-rc-notewrap>Note<input name="note" maxlength="300" autocomplete="off"' + (back ? " required" : "") + "></label>" +
    '<p class="rc-err" id="rcStageErr" role="alert" hidden></p>' +
    '<div class="rc-actions"><button type="submit" class="cui-button cui-button--lg cui-button--secondary">Move</button></div></form></section>';
}
function profileSection(p, r){
  var team = p.team_id ? (st.teams.find(function (t){ return t.id === p.team_id; }) || {}).name : null;
  var pairs = [
    ["Prospect type", label(PROSPECT_TYPES, r.prospect_type)],
    ["School", r.current_school], ["Club", r.club_team],
    ["Location", [r.city, r.state_region].filter(Boolean).join(", ")],
    ["Grad year", r.grad_year], ["Sport", p.sport], ["Team", team],
    ["Positions", (p.positions && p.positions.length ? p.positions : [p.position_primary]).filter(Boolean).join(", ")],
    ["GPA", r.hs_gpa != null ? Number(r.hs_gpa).toFixed(2) : null], ["Intended major", r.intended_major],
    ["Age group", r.is_minor ? "Under 18, or date of birth not given" : "18 or older"],
  ].filter(function (x){ return x[1] != null && x[1] !== ""; });
  return '<section class="rc-section"><h3>Profile</h3><dl class="rc-dl">' + pairs.map(function (x){
    return "<dt>" + h(x[0]) + "</dt><dd>" + h(x[1]) + "</dd>";
  }).join("") + "</dl></section>";
}
function contactSection(r){
  var s = st.sensitive[r.id];
  var body;
  if (!s){
    body = '<p class="rc-note">Contact details are kept separately and every view is recorded.' +
      (r.is_minor && !isAdmin() ? " This recruit is under 18, so only organization admins can see them." : "") + "</p>" +
      '<div class="rc-actions"><button type="button" class="cui-button cui-button--lg cui-button--secondary" data-rc-sensitive="' + h(r.id) + '">Show contact details</button></div>';
  } else if (s.refused){
    body = '<p class="rc-note">' + h(s.refused) + "</p>";
  } else {
    var line = [s.email, s.phone].filter(Boolean).join(" · ");
    body = '<dl class="rc-dl"><dt>Email</dt><dd>' + h(s.email || "Not on file") + "</dd><dt>Phone</dt><dd>" + h(s.phone || "Not on file") + "</dd></dl>" +
      '<div class="rc-actions" style="margin-top:12px">' +
      (s.email ? '<a class="cui-button cui-button--lg cui-button--secondary" href="mailto:' + h(encodeURIComponent(s.email).replace(/%40/g, "@")) + '">Email</a>' : "") +
      (line ? '<button type="button" class="cui-button cui-button--lg cui-button--secondary" data-rc-copy="' + h(fullName(r) + " · " + line) + '">Copy contact</button>' : "") +
      "</div>" +
      '<p class="rc-note" style="margin-top:8px">Sporv does not send recruiting messages yet. Email opens your own mail app; log the contact below afterwards.</p>';
  }
  return '<section class="rc-section"><h3>Contact details</h3>' + body + "</section>";
}
function guardianSection(r){
  var gs = st.guardians.filter(function (g){ return g.recruit_id === r.id; });
  var body;
  if (gs.length){
    body = '<ul class="rc-log">' + gs.map(function (g){
      return "<li><b>" + h(g.full_name) + "</b>" + (g.relationship ? " · " + h(g.relationship) : "") + (g.is_primary ? " · primary" : "") +
        '<span class="rc-sub">' + h([g.email, g.phone].filter(Boolean).join(" · ") || "No contact details") + "</span>" +
        '<span class="rc-sub">Consent: ' + h(String(g.consent_status || "not_requested").replace(/_/g, " ")) + "</span></li>";
    }).join("") + "</ul>";
  } else if (!r.is_minor){
    return "";
  } else if (isAdmin()){
    body = '<p class="rc-note">No parent or guardian on file.</p>';
  } else {
    body = '<p class="rc-note">Parent and guardian details for recruits under 18 are visible to organization admins only.</p>';
  }
  return '<section class="rc-section"><h3>Parents and guardians</h3>' + body + "</section>";
}
function filmSection(p){
  var links = httpsOnly(p.film_links);
  if (!links.length) return "";
  return '<section class="rc-section rc-film"><h3>Film</h3><ul class="rc-log">' + links.map(function (u){
    return '<li><a href="' + h(u) + '" target="_blank" rel="noopener noreferrer">' + h(u) + "</a></li>";
  }).join("") + "</ul></section>";
}
function evalSection(p){
  var es = evalsOf(p.id);
  var list = es.length ? '<ul class="rc-log">' + es.map(function (e){
    var detail = CRITERIA.map(function (c){ return c[1] + " " + (e.scores && e.scores[c[0]] != null ? e.scores[c[0]] : "—"); }).join(", ");
    return '<li><b>Overall <span class="cui-mono">' + (e.overall != null ? Number(e.overall).toFixed(2) : "—") + "</span></b> · " +
      h(label(CONTEXTS, e.context)) + " · " + h(shortDate(e.seen_on || e.created_at)) +
      '<span class="rc-sub">' + h(detail) + "</span>" + (e.notes ? '<span class="rc-sub">' + h(e.notes) + "</span>" : "") + "</li>";
  }).join("") + "</ul>" : '<p class="rc-note" style="margin-bottom:12px">No evaluations yet.</p>';
  var form = st.section === "eval" ? '<form class="rc-form" id="rcEvalForm" data-pl="' + h(p.id) + '" novalidate>' +
    CRITERIA.map(function (c){
      return '<fieldset class="rc-score"><legend class="rc-sr">' + h(c[1]) + '</legend><span aria-hidden="true">' + h(c[1]) + '</span><span class="rc-pick">' +
        [1, 2, 3, 4, 5].map(function (n){
          return '<label><input type="radio" name="' + c[0] + '" value="' + n + '" aria-label="' + h(c[1]) + " " + n + ' of 5"><span>' + n + "</span></label>";
        }).join("") + "</span></fieldset>";
    }).join("") +
    '<p class="rc-note">1 is well below your program\'s level, 3 is at it, 5 is well above.</p>' +
    '<div class="rc-grid2"><label>Seen on<select name="context">' + options(CONTEXTS, "film") + "</select></label>" +
    '<label>Date<input type="date" name="seen_on" value="' + localDate() + '"></label></div>' +
    '<label>Notes<textarea name="notes" maxlength="4000"></textarea></label>' +
    '<p class="rc-err" id="rcEvalErr" role="alert" hidden></p>' +
    '<div class="rc-actions"><button type="submit" class="cui-button cui-button--lg cui-button--primary">Save evaluation</button>' +
    '<button type="button" class="cui-button cui-button--lg cui-button--secondary" data-rc-section="">Cancel</button></div></form>'
    : '<div class="rc-actions"><button type="button" class="cui-button cui-button--lg cui-button--secondary" data-rc-section="eval">Add evaluation</button></div>';
  return '<section class="rc-section"><h3>Evaluations</h3>' + list + form + "</section>";
}
function contactLogSection(p){
  var cs = contactsOf(p.id);
  var list = cs.length ? '<ul class="rc-log">' + cs.map(function (c){
    return "<li><b>" + h(label(CONTACT_KINDS, c.contact_kind)) + "</b> · " + (c.direction === "inbound" ? "from " : "with ") +
      h(label(COUNTERPARTS, c.counterpart).toLowerCase()) + " · " + h(shortDate(c.occurred_at)) +
      (c.summary ? '<span class="rc-sub">' + h(c.summary) + "</span>" : "") +
      '<span class="rc-sub">Contact rules: not checked</span></li>';
  }).join("") + "</ul>" : '<p class="rc-note" style="margin-bottom:12px">No contacts logged yet.</p>';
  var now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  var form = st.section === "contact" ? '<form class="rc-form" id="rcContactForm" data-pl="' + h(p.id) + '" novalidate>' +
    '<div class="rc-grid2"><label>Kind<select name="contact_kind">' + options(CONTACT_KINDS, "phone") + "</select></label>" +
    '<label>Direction<select name="direction">' + options([["outbound", "We reached out"], ["inbound", "They reached out"]], "outbound") + "</select></label>" +
    '<label>With<select name="counterpart">' + options(COUNTERPARTS, "prospect") + "</select></label>" +
    '<label>When<input type="datetime-local" name="occurred_at" value="' + now + '"></label></div>' +
    '<label>What was said<textarea name="summary" maxlength="4000"></textarea></label>' +
    '<p class="rc-note">Sporv does not check recruiting contact rules yet. Make sure this contact was allowed for this recruit\'s grad year and the current recruiting period.</p>' +
    '<p class="rc-err" id="rcContactErr" role="alert" hidden></p>' +
    '<div class="rc-actions"><button type="submit" class="cui-button cui-button--lg cui-button--primary">Log contact</button>' +
    '<button type="button" class="cui-button cui-button--lg cui-button--secondary" data-rc-section="">Cancel</button></div></form>'
    : '<div class="rc-actions"><button type="button" class="cui-button cui-button--lg cui-button--secondary" data-rc-section="contact">Log a contact</button></div>';
  return '<section class="rc-section"><h3>Contact log</h3>' + list + form + "</section>";
}
function addForm(){
  var sports = distinct(rows().map(function (x){ return x.p.sport; }).concat(((providerRow() || {}).sports) || []));
  var teamField = st.teams.length ? '<label>Team (optional)<select name="team_id">' +
    options(st.teams.map(function (t){ return [t.id, t.name]; }), "", "No team") + "</select></label>" : "";
  return '<form class="rc-form" id="rcAddForm" novalidate style="border:0;padding:0;background:transparent">' +
    '<div class="rc-grid2">' +
    '<label>First name<input name="first_name" required maxlength="80" autocomplete="off"></label>' +
    '<label>Last name<input name="last_name" required maxlength="80" autocomplete="off"></label>' +
    '<label>Grad year<input name="grad_year" required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="' + (new Date().getFullYear() + 1) + '"></label>' +
    '<label>Sport<input name="sport" required list="rcAddSports" maxlength="60" value="' + h(sports[0] || "") + '" autocomplete="off"></label>' +
    '<label>Position<input name="position" maxlength="60" autocomplete="off"></label>' +
    '<label>Prospect type<select name="prospect_type">' + options(PROSPECT_TYPES, "high_school") + "</select></label>" +
    '<label>Current school<input name="current_school" maxlength="120"></label>' +
    '<label>Club team<input name="club_team" maxlength="120"></label>' +
    '<label>City<input name="city" maxlength="80"></label>' +
    '<label>State<input name="state_region" maxlength="40"></label>' +
    '<label>GPA (optional)<input name="hs_gpa" inputmode="decimal" maxlength="5"></label>' +
    '<label>Intended major<input name="intended_major" maxlength="80"></label>' +
    "</div>" + teamField +
    '<datalist id="rcAddSports">' + sports.map(function (s){ return '<option value="' + h(s) + '">'; }).join("") + "</datalist>" +
    '<label>Film links (one per line, https only)<textarea name="film" spellcheck="false"></textarea></label>' +
    '<fieldset><legend>Private details</legend>' +
    '<p class="rc-note">Stored separately. For anyone under 18, or with no date of birth, only organization admins can see these. Recruits must be 13 or older.</p>' +
    '<div class="rc-grid2"><label>Date of birth (optional)<input type="date" name="date_of_birth"></label>' +
    '<label>Email<input type="email" name="email" maxlength="200" autocomplete="off"></label>' +
    '<label>Phone<input type="tel" name="phone" maxlength="40" autocomplete="off"></label></div></fieldset>' +
    '<fieldset><legend>Parent or guardian (for recruits under 18)</legend><div class="rc-grid2">' +
    '<label>Full name<input name="g_name" maxlength="120" autocomplete="off"></label>' +
    '<label>Relationship<input name="g_rel" maxlength="40" autocomplete="off"></label>' +
    '<label>Email<input type="email" name="g_email" maxlength="200" autocomplete="off"></label>' +
    '<label>Phone<input type="tel" name="g_phone" maxlength="40" autocomplete="off"></label></div></fieldset>' +
    (st.mode === "sample" ? '<p class="rc-note">Sample workspace: this recruit is not saved.</p>' : "") +
    '<p class="rc-err" id="rcAddErr" role="alert" hidden></p>' +
    '<div class="rc-actions"><button type="submit" class="cui-button cui-button--lg cui-button--primary">Add to board</button>' +
    '<button type="button" class="cui-button cui-button--lg cui-button--secondary" data-cui-drawer-close="1">Cancel</button></div></form>';
}

/* ═══════════════════ WIRING ═══════════════════ */
function showErr(id, msg){
  var el = document.getElementById(id);
  if (el){ el.textContent = msg; el.hidden = false; }
  return false;
}
function busy(form, on){
  Array.prototype.forEach.call(form.querySelectorAll("button"), function (b){ b.disabled = !!on; });
}
function val(fd, k){ return String(fd.get(k) == null ? "" : fd.get(k)).trim(); }
var keyBound = false;

function wire(){
  if (typeof document === "undefined" || !document.querySelector('[data-cui-page-root="recruiting"]')) return;
  var q = function (s){ return document.querySelectorAll(s); };

  if (!keyBound){
    keyBound = true;
    document.addEventListener("keydown", function (ev){
      if (ev.key === "Escape" && (st.open || st.adding) && typeof S !== "undefined" && S.coachTab === "recruiting"){
        st.open = null; st.adding = false; st.section = null; clearSensitive(); render();
      }
    });
  }

  q("[data-rc-retry]").forEach(function (b){ b.onclick = function (){ st.key = null; st.phase = "idle"; render(); }; });
  q("[data-rc-add]").forEach(function (b){ b.onclick = function (){ st.adding = true; st.open = null; clearSensitive(); st.focus = "drawer"; render(); }; });
  q("[data-rc-open]").forEach(function (b){
    b.onclick = function (){ st.open = b.dataset.rcOpen; st.adding = false; st.section = null; clearSensitive(); st.focus = "drawer"; render(); };
  });
  q("[data-cui-drawer-close]").forEach(function (b){
    b.onclick = function (){
      var back = st.open;
      st.open = null; st.adding = false; st.section = null; clearSensitive(); render();
      if (back){ var t = document.querySelector('[data-rc-open="' + back + '"]'); if (t) t.focus(); }
    };
  });
  q("[data-rc-section]").forEach(function (b){ b.onclick = function (){ st.section = b.dataset.rcSection || null; render(); }; });

  /* filters: selects re-render at once; search re-renders and keeps the caret */
  q("[data-rc-filter]").forEach(function (el){
    var k = el.dataset.rcFilter;
    if (el.tagName === "SELECT") el.onchange = function (){ st.filters[k] = el.value; render(); };
    else el.oninput = function (){
      st.filters[k] = el.value; st.focus = { filter: k, pos: el.selectionStart };
      render();
    };
  });
  if (st.focus && st.focus.filter){
    var f = document.querySelector('[data-rc-filter="' + st.focus.filter + '"]');
    if (f){ f.focus(); try { f.setSelectionRange(st.focus.pos, st.focus.pos); } catch (e) {} }
    st.focus = null;
  }
  if (st.focus === "drawer"){
    var head = document.getElementById("rc-drawer-title"); if (head) head.focus();
    st.focus = null;
  }

  /* card quick move: forward moves go straight through; back / close opens the stage form */
  q("[data-rc-move]").forEach(function (sel){
    sel.onchange = function (){
      var id = sel.dataset.rcMove, to = sel.value, p = pipelineById(id);
      if (!to || !p) return;
      var needsMore = to === "closed" || p.stage === "closed" || (STAGE_RANK[to] < STAGE_RANK[p.stage]);
      if (needsMore){ if (st.open !== id) clearSensitive(); st.open = id; st.section = "stage"; st.stageTo = to; st.focus = "drawer"; render(); return; }
      sel.disabled = true;
      var name = fullName(recruitOf(p));
      moveStage(id, to).then(function (){
        render(); toast(name + " moved to " + label(STAGES, to) + (st.mode === "sample" ? " (sample, not saved)." : "."));
      }, function (e){ sel.disabled = false; sel.value = ""; toast("Could not move " + name + ": " + friendly(e)); });
    };
  });

  var sf = document.getElementById("rcStageForm");
  if (sf){
    var toSel = sf.querySelector('[name="to"]');
    toSel.onchange = function (){
      var p = pipelineById(sf.dataset.pl), to = toSel.value;
      var back = to && (p.stage === "closed" || (STAGE_RANK[to] && STAGE_RANK[to] < STAGE_RANK[p.stage]));
      sf.querySelector("[data-rc-reason]").hidden = to !== "closed";
      sf.querySelector("[data-rc-notewrap]").hidden = !(back || to === "closed");
    };
    sf.onsubmit = function (ev){
      ev.preventDefault();
      var fd = new FormData(sf), to = val(fd, "to");
      if (!to) return showErr("rcStageErr", "Choose a stage.");
      busy(sf, true);
      moveStage(sf.dataset.pl, to, val(fd, "note"), val(fd, "reason") || null).then(function (){
        st.section = null; st.stageTo = null; render();
        toast("Moved to " + label(STAGES, to) + (st.mode === "sample" ? " (sample, not saved)." : "."));
      }, function (e){ busy(sf, false); showErr("rcStageErr", friendly(e)); });
      return false;
    };
  }

  var ef = document.getElementById("rcEvalForm");
  if (ef) ef.onsubmit = function (ev){
    ev.preventDefault();
    var fd = new FormData(ef), scores = {};
    CRITERIA.forEach(function (c){ var v = Number(fd.get(c[0])); if (v) scores[c[0]] = v; });
    if (overallOf(scores) == null) return showErr("rcEvalErr", "Score every criterion from 1 to 5.");
    var seen = val(fd, "seen_on") || localDate();
    busy(ef, true);
    addEval(ef.dataset.pl, { scores: scores, context: val(fd, "context") || "film", seen_on: seen, notes: val(fd, "notes") }).then(function (){
      st.section = null; render(); toast("Evaluation saved" + (st.mode === "sample" ? " (sample, not saved)." : "."));
    }, function (e){ busy(ef, false); showErr("rcEvalErr", friendly(e)); });
    return false;
  };

  var cf = document.getElementById("rcContactForm");
  if (cf) cf.onsubmit = function (ev){
    ev.preventDefault();
    var fd = new FormData(cf), when = val(fd, "occurred_at");
    var t = when ? Date.parse(when) : Date.now();
    if (!isFinite(t)) return showErr("rcContactErr", "Enter when the contact happened.");
    if (t > Date.now() + 5 * 60000) return showErr("rcContactErr", "A contact can't be logged in the future.");
    busy(cf, true);
    addContact(cf.dataset.pl, { contact_kind: val(fd, "contact_kind"), direction: val(fd, "direction"), counterpart: val(fd, "counterpart"),
      occurred_at: new Date(t).toISOString(), summary: val(fd, "summary") }).then(function (){
      st.section = null; render(); toast("Contact logged" + (st.mode === "sample" ? " (sample, not saved)." : "."));
    }, function (e){ busy(cf, false); showErr("rcContactErr", friendly(e)); });
    return false;
  };

  var af = document.getElementById("rcAddForm");
  if (af) af.onsubmit = function (ev){
    ev.preventDefault();
    var fd = new FormData(af);
    var v = {
      first_name: val(fd, "first_name"), last_name: val(fd, "last_name"), sport: val(fd, "sport"), position: val(fd, "position"),
      prospect_type: val(fd, "prospect_type"), current_school: val(fd, "current_school"), club_team: val(fd, "club_team"),
      city: val(fd, "city"), state_region: val(fd, "state_region"), intended_major: val(fd, "intended_major"),
      date_of_birth: val(fd, "date_of_birth"), email: val(fd, "email"), phone: val(fd, "phone"), team_id: val(fd, "team_id"),
      guardian: { full_name: val(fd, "g_name"), relationship: val(fd, "g_rel"), email: val(fd, "g_email"), phone: val(fd, "g_phone") },
    };
    if (!v.first_name || !v.last_name) return showErr("rcAddErr", "Enter the recruit's first and last name.");
    if (!/^\d{4}$/.test(val(fd, "grad_year"))) return showErr("rcAddErr", "Grad year must be four digits, for example 2027.");
    v.grad_year = Number(val(fd, "grad_year"));
    if (v.grad_year < 2000 || v.grad_year > 2100) return showErr("rcAddErr", "Grad year must be between 2000 and 2100.");
    if (!v.sport) return showErr("rcAddErr", "Enter the sport.");
    var gpa = val(fd, "hs_gpa");
    v.hs_gpa = gpa ? Number(gpa) : null;
    if (gpa && !(v.hs_gpa >= 0 && v.hs_gpa <= 5)) return showErr("rcAddErr", "GPA must be between 0 and 5.");
    if (v.date_of_birth){
      var age = (Date.now() - Date.parse(v.date_of_birth)) / (365.25 * 86400000);
      if (!(age >= 13)) return showErr("rcAddErr", friendly({ message: "RECRUIT_UNDER_13" }));
    }
    var links = val(fd, "film").split(/\s+/).filter(Boolean);
    if (links.some(function (u){ return !/^https:\/\/\S+$/i.test(u); })) return showErr("rcAddErr", "Film links must start with https://.");
    v.film_links = links;
    busy(af, true);
    addRecruit(v).then(function (plid){
      st.adding = false; st.open = plid; clearSensitive(); st.focus = "drawer"; render();
      toast(v.first_name + " " + v.last_name + " added" + (st.mode === "sample" ? " (sample, not saved)." : "."));
    }, function (e){ busy(af, false); showErr("rcAddErr", friendly(e)); });
    return false;
  };

  q("[data-rc-sensitive]").forEach(function (b){
    b.onclick = function (){
      b.disabled = true;
      loadSensitive(b.dataset.rcSensitive).then(function (){ render(); });
    };
  });
  q("[data-rc-copy]").forEach(function (b){
    b.onclick = function (){
      var text = b.dataset.rcCopy;
      var done = function (){ toast("Contact copied."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function (){ toast("Copy failed. Select the details and copy them by hand."); });
      else toast("Copy is not available in this browser.");
    };
  });

  var tf = document.getElementById("rcTargetForm");
  if (tf) tf.onsubmit = function (ev){
    ev.preventDefault();
    var fd = new FormData(tf);
    var v = { sport: val(fd, "sport"), position: val(fd, "position"), entry_year: val(fd, "entry_year"), target_count: Number(val(fd, "target_count")) };
    if (!v.sport || !v.position) return showErr("rcTargetErr", "Enter the sport and position.");
    if (!/^\d{4}$/.test(v.entry_year)) return showErr("rcTargetErr", "Grad year must be four digits.");
    if (val(fd, "target_count") === "" || !(v.target_count >= 0 && v.target_count <= 99) || Math.floor(v.target_count) !== v.target_count)
      return showErr("rcTargetErr", "How many you need must be a whole number from 0 to 99.");
    busy(tf, true);
    saveTarget(v).then(function (){ render(); toast("Need saved" + (st.mode === "sample" ? " (sample, not saved)." : "."));
    }, function (e){ busy(tf, false); showErr("rcTargetErr", friendly(e)); });
    return false;
  };
  q("[data-rc-deltarget]").forEach(function (b){
    b.onclick = function (){
      b.disabled = true;
      deleteTarget(b.dataset.rcDeltarget).then(function (){ render(); toast("Need removed."); },
        function (e){ b.disabled = false; toast("Could not remove the need: " + friendly(e)); });
    };
  });

  var csvf = document.getElementById("rcCsvForm");
  if (csvf) csvf.onsubmit = function (ev){
    ev.preventDefault();
    var fd = new FormData(csvf), file = fd.get("file");
    var go = function (text){ st.csv.text = text; st.csv.rows = csvPreview(text); render(); };
    if (file && file.size){
      if (file.size > 2 * 1024 * 1024){ st.csv.rows = { error: "That file is larger than 2 MB. Split it and import in parts." }; render(); return false; }
      file.text().then(go, function (){ st.csv.rows = { error: "Could not read that file." }; render(); });
    } else go(val(fd, "text"));
    return false;
  };
  q("[data-rc-import]").forEach(function (b){
    b.onclick = function (){
      b.disabled = true;
      runImport().then(function (n){
        st.csv = { text: "", rows: null, fileName: "" }; S.recruitTab = "board";
        try { window.COACH_UI.writeTab("board"); } catch (e) {}
        render(); toast(n + " recruit" + (n === 1 ? "" : "s") + " imported" + (st.mode === "sample" ? " (sample, not saved)." : "."));
      }, function (e){ b.disabled = false; showErr("rcImportErr", friendly(e)); });
    };
  });
}

/* ═══════════════════ EXPORT ═══════════════════ */
window.MOD_RECRUITING = {
  css: CSS,
  tabs: { recruiting: "Recruiting" },
  views: { recruiting: recruitingView },
  wire: wire,
  state: { recruitTab: "board" },
  /* the sample board's records, read-only, for the preview assistant's
     deterministic answers (mod-sample-answers.js) — a fresh copy each call */
  sampleData: sampleData,
  /* test seam: pure helpers, no side effects */
  _test: { parseCSV: parseCSV, overallOf: overallOf, csvPreview: csvPreview, state: function (){ return st; }, addRecruit: addRecruit, identityKey: identityKey },
};

})();
