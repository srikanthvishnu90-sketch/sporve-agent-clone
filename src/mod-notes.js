"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_NOTES — the COACH-facing authoring side of session notes.

   One coach tab ("Session notes") with three panels:
     · Needs a note — completed sessions with nothing written yet
     · Written notes — grouped by athlete, editable, shareable
     · Athlete progress — a chronological development record per athlete

   The PARENT-facing athlete timeline belongs to MOD_REVIEWS (views.timeline).
   Nothing here defines or duplicates it; this module only writes the notes
   that side reads, and pushes a copy into the family's message thread when
   the coach chooses to share.

   Host contract used, never redefined:
     S, render(), toast(), esc(), money(), fmtDate(), slotsFor(),
     PROGRAMS, SEED, sportColor(), sportGlyph(), ICON.

   HONESTY RULES OBSERVED HERE
     · Every count, gap, and cadence line is computed from real note dates
       and the real session ledger. There is no invented attendance, no
       improvement percentage, and no trend line.
     · "Draft from voice memo" does NOT record or transcribe anything —
       no speech API is wired up. It inserts a labelled generic example and
       refuses to save until the coach has replaced it.
     · A month with no notes reports that plainly and offers nothing to send.

   The demo clock is pinned to the app's seeded "today" (2026-08-03), the
   same pin MOD_COACHOPS uses, so "completed" and "days since" stay coherent
   with the seeded data instead of drifting against the wall clock.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ═══════════════════ CLOCK + DATE HELPERS ═══════════════════ */
const TODAY = "2026-08-03";
const NOW = () => new Date(2026, 7, 3, 9, 30);            // Mon 3 Aug 2026, 9:30am
const isoNow = () => NOW().toISOString();

function dayNum(d){
  const p = String(d).slice(0, 10).split("-").map(Number);
  return Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1);
}
const daysBetween = (a, b) => Math.round((dayNum(b) - dayNum(a)) / 86400000);
const monthKey = d => String(d).slice(0, 7);
function monthLabel(k){
  const p = String(k).split("-").map(Number);
  return new Date(p[0], (p[1] || 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function nextMonthKey(k){
  const p = String(k).split("-").map(Number);
  const d = new Date(p[0], p[1], 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
const firstName = n => (String(n || "").trim().split(/\s+/)[0] || String(n || ""));
const plural = (n, one, many) => n + " " + (n === 1 ? one : (many || one + "s"));

/* ═══════════════════ SPORT SKILL VOCABULARY ═══════════════════ */
/* Candidate chips for the note form. Derived from the session's sport so a
   soccer coach is never offered "flip turns". */
const SKILLS = {
  Soccer:        ["First touch", "Passing", "Dribbling", "Spatial awareness", "Finishing", "Defending 1v1"],
  Basketball:    ["Ball-handling", "Shooting form", "Finishing at the rim", "Court vision", "Defensive stance", "Rebounding"],
  Tennis:        ["Forehand", "Backhand", "Serve", "Footwork", "Volley", "Point construction"],
  Volleyball:    ["Serving", "Platform passing", "Setting", "Approach and attack", "Blocking", "Rotation"],
  Swimming:      ["Freestyle technique", "Backstroke", "Breathing rhythm", "Streamline push", "Flip turns", "Race pacing"],
  Diving:        ["Approach", "Hurdle", "Entry", "Body line", "Board timing"],
  "Water Polo":  ["Eggbeater", "Ball control", "Shooting", "Passing under pressure", "Field awareness"],
  Surfing:       ["Paddling", "Pop-up", "Wave reading", "Ocean safety", "Balance"],
  Baseball:      ["Swing mechanics", "Fielding", "Throwing accuracy", "Baserunning", "Pitch selection"],
  Softball:      ["Pitching", "Slapping", "Infield defense", "Swing mechanics", "Baserunning"],
  Football:      ["Route running", "Catching", "Coverage", "Footwork", "Game IQ"],
  Lacrosse:      ["Cradling", "Passing", "Dodging", "Shooting", "Ground balls"],
  Cricket:       ["Batting technique", "Seam bowling", "Fielding", "Footwork", "Shot selection"],
  Badminton:     ["Clears", "Drops", "Shadow footwork", "Net play", "Serve"],
  Pickleball:    ["Dinks", "Third-shot drop", "Court positioning", "Serve", "Volley"],
  Squash:        ["Racquet prep", "Length", "Movement", "Boast", "Volley"],
  "Table Tennis":["Loop", "Push", "Serve variation", "Footwork", "Spin reading"],
  Boxing:        ["Stance", "Footwork", "Jab", "Guard", "Pad work"],
  Wrestling:     ["Takedowns", "Escapes", "Sprawl", "Conditioning", "Hand fighting"],
  "Martial Arts":["Striking", "Grappling", "Movement", "Guard", "Control"],
  Karate:        ["Kata", "Kihon", "Stance", "Kumite timing", "Focus"],
  Judo:          ["Nage-waza", "Ne-waza", "Grip fighting", "Breakfalls", "Balance"],
  Dance:         ["Choreography", "Rhythm", "Isolation", "Performance", "Musicality"],
  Gymnastics:    ["Body line", "Tumbling", "Beam balance", "Bar swing", "Landings"],
  "Track & Field":["Sprint mechanics", "Acceleration", "Plyometrics", "Start position", "Stride length"],
  "Cross Country":["Pacing", "Hill running", "Breathing", "Cadence", "Race strategy"],
};
const skillsFor = sport =>
  SKILLS[sport] || ["Technique", "Conditioning", "Game awareness", "Consistency", "Confidence"];

/* ═══════════════════ ROSTER + SESSION LEDGER ═══════════════════ */
/* Live catalogue first, seeded second — see the note in mod-coachops.js. */
const prog = id => PROGRAMS.find(p => p.id === id) ||
                   DEMO_CATALOGUE.find(p => p.id === id) || null;
const sportOf = id => { const p = prog(id); return p ? p.sport : ""; };

/* DEMO_CATALOGUE, not PROGRAMS — see the note in mod-coachops.js. */
function myListings(){
  const ids = (S && S.listings) || [];
  const mine = DEMO_CATALOGUE.filter(p => ids.indexOf(p.id) >= 0);
  return mine.length ? mine : DEMO_CATALOGUE.slice(0, 5);
}

/* Families this coach actually works with, and the real dates they trained.
   Julian Mercer is the app's seeded athlete (athlete_1) — the other three are
   demo families on the same published programs. */
function roster(){
  const m = myListings();
  const pid = i => (m[i] || m[m.length - 1] || DEMO_CATALOGUE[0]).id;
  return [
    { id: "athlete_1", name: "Julian Mercer", parent: "Alex Mercer", programId: pid(0),
      dates: ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29",
              "2026-07-06", "2026-07-13", "2026-07-20"] },
    { id: "nt_ath_2", name: "Nia Okafor", parent: "Renata Okafor", programId: pid(0),
      dates: ["2026-06-17", "2026-07-01", "2026-07-15", "2026-07-29"] },
    { id: "nt_ath_3", name: "Aarav Raman", parent: "Priya Raman", programId: pid(2),
      dates: ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"] },
    { id: "nt_ath_4", name: "Sofia Ibarra", parent: "Marisol Ibarra", programId: pid(1),
      dates: ["2026-06-25", "2026-07-09", "2026-07-23"] },
  ];
}
function athleteById(id){ return roster().find(a => a.id === id) || null; }
function athleteByName(name){
  const n = String(name || "").trim().toLowerCase();
  return roster().find(a => a.name.toLowerCase() === n) || null;
}

/* AI-command athlete resolution. The coach types "note for Nia to …"; the
   assistant hands back a name string, and this maps it to a REAL roster row —
   never inventing one. Returns {athlete} on a single confident match, {ambiguous}
   when a first name hits two people, {} when nothing matches. The chat card gates
   its Approve button on {athlete} being present, so an unresolved name can never
   write a note against a fabricated athlete. */
function resolveAthlete(name){
  const q = String(name || "").trim().toLowerCase();
  if (!q) return {};
  const r = roster();
  const exact = r.filter(a => a.name.toLowerCase() === q);
  if (exact.length === 1) return { athlete: exact[0] };
  const partial = r.filter(a => {
    const full = a.name.toLowerCase();
    return full.split(/\s+/)[0] === q || full.includes(q);
  });
  if (partial.length === 1) return { athlete: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return {};
}

/* The write rail behind an approved create_note proposal. It resolves the
   athlete, refuses to invent one, and appends a REAL note row to the same
   S.sessionNotes array the Session-notes tab reads — the exact store saveNote()
   writes, so an AI-drafted note is indistinguishable from a hand-written one.
   The drafted content lands in `worked` (the primary, always-first note field);
   win/next stay empty and the row renderer skips empty fields. Throws loudly on
   an unresolved/ambiguous name or empty body — the host's approveProposal turns
   a throw into an honest failure bubble and reopens the card. */
function createFromAI(spec){
  spec = spec || {};
  const hit = resolveAthlete(spec.athleteName);
  if (hit.ambiguous)
    throw new Error("More than one athlete matches “" + String(spec.athleteName || "").trim() + "” — name one exactly.");
  if (!hit.athlete)
    throw new Error("No athlete named “" + String(spec.athleteName || "").trim() + "” on your roster.");
  const content = String(spec.body || "").trim();
  if (!content) throw new Error("The note is empty.");
  const a = hit.athlete;
  const now = isoNow();
  const n = {
    id: "nt_ai_" + a.id + "_" + Date.now(),
    sessionId: "ai_" + Date.now(),
    athleteId: a.id, athlete: a.name, programId: a.programId,
    date: now.slice(0, 10),
    title: String(spec.title || "").trim().slice(0, 120),
    worked: content, win: "", next: "",
    skills: [], shared: false, sharedAt: null, source: "ai",
    createdAt: now, updatedAt: now,
  };
  notes().push(n);
  return { note: n, athlete: a.name };
}

/* Every session this coach has run or has on the books, from two real
   sources: the roster above, and the host's own S.bookings. */
function ledger(){
  const out = [];
  roster().forEach(a => a.dates.forEach(d => out.push({
    id: "nt_s_" + a.id + "_" + d,
    athleteId: a.id, athlete: a.name, parent: a.parent,
    programId: a.programId, date: d, source: "session",
  })));
  ((S && S.bookings) || []).forEach(b => {
    if (b.status === "cancelled") return;
    const a = athleteByName(b.athlete);
    out.push({
      id: b.id,
      athleteId: a ? a.id : "nt_b_" + b.id, athlete: b.athlete, parent: a ? a.parent : "",
      programId: b.programId, date: b.date, source: "booking",
    });
  });
  const seen = {}, uniq = [];
  out.forEach(r => { if (!seen[r.id]){ seen[r.id] = 1; uniq.push(r); } });
  uniq.sort((x, y) => y.date.localeCompare(x.date) || x.athlete.localeCompare(y.athlete));
  return uniq;
}
const completed = () => ledger().filter(s => s.date < TODAY);
const sessionById = id => ledger().find(s => s.id === id) || null;

/* ═══════════════════ SEEDED NOTES ═══════════════════ */
/* Real prose against real dates. The last one or two sessions per athlete are
   deliberately unwritten so the queue has honest work in it. */
function seedNotes(){
  const r = roster();
  const A = r[0], B = r[1], C = r[2], D = r[3];
  const mk = (a, date, worked, win, next, skills, shared) => ({
    id: "nt_" + a.id + "_" + date,
    sessionId: "nt_s_" + a.id + "_" + date,
    athleteId: a.id, athlete: a.name, programId: a.programId, date: date,
    worked: worked, win: win, next: next, skills: skills,
    shared: !!shared, sharedAt: shared ? date + "T19:30:00.000Z" : null,
    createdAt: date + "T18:45:00.000Z", updatedAt: date + "T18:45:00.000Z",
  });
  return [
    mk(A, "2026-06-01",
      "Two-touch passing in a tight grid, then first touch away from pressure with a defender closing.",
      "Took his first touch across his body instead of straight into his feet on the last six reps.",
      "Receiving on the half-turn so he can see the far side before the ball arrives.",
      ["First touch", "Passing", "Spatial awareness"], true),
    mk(A, "2026-06-08",
      "Half-turn receiving from a server, progressing to a live defender at half speed.",
      "Checked his shoulder before three of five receptions without being reminded.",
      "Keeping the same shoulder check when the pace goes up to game speed.",
      ["First touch", "Spatial awareness"], true),
    mk(A, "2026-06-15",
      "Dribbling in traffic: four-goal game in a 20x20 box, two touches maximum out of pressure.",
      "Beat the same defender twice with an outside-foot push instead of forcing it through the middle.",
      "Using his weak foot to exit pressure rather than always cutting back to his right.",
      ["Dribbling", "First touch"], false),
    mk(A, "2026-06-22",
      "Weak-foot work: wall passes, then left-foot only in the small-sided game.",
      "Played six clean left-footed passes in the game before he reverted to his right.",
      "Left-foot passes over 15 yards, which still drop short.",
      ["Passing", "First touch"], false),
    mk(A, "2026-06-29",
      "Finishing from the top of the box after a lay-off, both feet, with a goalkeeper.",
      "Kept his head steady over the ball on the strikes he hit low and hard.",
      "Deciding earlier where the shot is going instead of adjusting at the last step.",
      ["Finishing", "First touch"], false),
    mk(A, "2026-07-06",
      "Pressing shape and defending 1v1: angle of approach, then delay and recover.",
      "Approached on a curve twice and forced the attacker onto his weaker side.",
      "Staying on his feet longer instead of committing to an early tackle.",
      ["Defending 1v1", "Spatial awareness"], false),

    mk(B, "2026-06-17",
      "Introduction session: passing accuracy over ten and twenty yards, plus receiving on the move.",
      "Struck eight of ten ten-yard passes into the target gate on her first attempt at the drill.",
      "Receiving while moving forward rather than stopping the ball dead.",
      ["Passing", "First touch"], false),
    mk(B, "2026-07-01",
      "Receiving on the move, then a possession game where a stopped ball loses the point.",
      "Kept the ball moving through the whole second possession game without a single dead touch.",
      "Scanning before the ball arrives so the first touch has somewhere to go.",
      ["First touch", "Spatial awareness"], false),
    mk(B, "2026-07-15",
      "Dribbling at speed down a channel, then a 1v1 ladder against rotating defenders.",
      "Won four of six 1v1s by pushing the ball past the defender rather than dancing in front of them.",
      "Head up between touches so she can see the second defender arriving.",
      ["Dribbling", "Spatial awareness"], false),

    mk(C, "2026-07-04",
      "Ball-handling circuit: pound dribbles, crossovers, and between-the-legs at three tempos.",
      "Completed the full circuit with his eyes up on the last two rounds.",
      "Keeping the dribble below the knee when he changes direction under pressure.",
      ["Ball-handling", "Court vision"], false),
    mk(C, "2026-07-11",
      "Shooting mechanics from the elbow: feet, hand placement, and follow-through, 60 reps.",
      "Held his follow-through on every rep of the second set without being told.",
      "Getting the same mechanics off the catch rather than only off a stationary start.",
      ["Shooting form"], false),
    mk(C, "2026-07-18",
      "Finishing off two feet at the rim, both hands, with contact from a pad.",
      "Finished left-handed through contact three times, which he could not do two weeks ago.",
      "Reading the help defender before he leaves the floor.",
      ["Finishing at the rim", "Court vision"], false),

    mk(D, "2026-06-25",
      "Forehand depth and shape: cross-court rally targets, then a controlled feed with recovery steps.",
      "Landed eleven straight forehands past the service line in the cross-court rally.",
      "Recovering to the middle after the shot instead of admiring it.",
      ["Forehand", "Footwork"], false),
    mk(D, "2026-07-09",
      "Serve mechanics: toss consistency, trophy position, and first-serve placement to the body.",
      "Her toss landed inside the target zone on nine of twelve attempts by the end of the hour.",
      "Keeping the same toss height when she adds pace to the first serve.",
      ["Serve", "Footwork"], false),
  ];
}

/* ═══════════════════ STATE ACCESSORS ═══════════════════ */
/* The host copies module state onto S at boot, so S is the live store.
   These accessors also make the module work standalone under a test harness. */
function notes(){
  if (!S.sessionNotes || !Array.isArray(S.sessionNotes)) S.sessionNotes = seedNotes();
  return S.sessionNotes;
}
function reports(){
  if (!S.progressReports || !Array.isArray(S.progressReports)) S.progressReports = [];
  return S.progressReports;
}
function noteById(id){ return notes().find(n => n.id === id) || null; }
function noteForSession(sid){ return notes().find(n => n.sessionId === sid) || null; }

/* Completed sessions that still have nothing written against them. */
function pendingList(){
  const have = {};
  notes().forEach(n => { have[n.sessionId] = 1; });
  return completed().filter(s => !have[s.id]);
}
function pendingNotes(){ return pendingList().length; }

/* ═══════════════════ DERIVED READS (all from real note dates) ═══════════════════ */

/* A frequency read, not a trend line. Every number below is measured off the
   note dates themselves — nothing is modelled, projected, or scored. */
function cadence(dates){
  const d = dates.slice().sort();
  const n = d.length;
  if (n === 0) return { line: "No notes written yet — nothing to read a pattern from.", gap: null };
  if (n === 1) return {
    line: "1 session logged, on " + fmtDate(d[0]) + ". One note is not a pattern yet.",
    gap: null,
  };
  const span = daysBetween(d[0], d[n - 1]);
  const gap = span / (n - 1);
  let word;
  if (gap <= 4.5) word = "about twice a week";
  else if (gap <= 9) word = "roughly weekly";
  else if (gap <= 17) word = "roughly every two weeks";
  else word = "about every " + Math.round(gap) + " days";
  return { line: n + " sessions since " + fmtDate(d[0]) + ", " + word + ".", gap: gap };
}
function longestGap(dates){
  const d = dates.slice().sort();
  let worst = 0, pair = null;
  for (let i = 1; i < d.length; i++){
    const g = daysBetween(d[i - 1], d[i]);
    if (g > worst){ worst = g; pair = [d[i - 1], d[i]]; }
  }
  return { days: worst, pair: pair };
}

/* Athletes who have at least one completed session or one note. */
function athleteIds(){
  const out = [];
  completed().forEach(s => { if (out.indexOf(s.athleteId) < 0) out.push(s.athleteId); });
  notes().forEach(n => { if (out.indexOf(n.athleteId) < 0) out.push(n.athleteId); });
  return out;
}
function athleteName(id){
  const a = athleteById(id);
  if (a) return a.name;
  const n = notes().find(x => x.athleteId === id) || completed().find(x => x.athleteId === id);
  return n ? n.athlete : id;
}
function athleteProgramId(id){
  const a = athleteById(id);
  if (a) return a.programId;
  const n = notes().find(x => x.athleteId === id) || completed().find(x => x.athleteId === id);
  return n ? n.programId : (myListings()[0] || DEMO_CATALOGUE[0]).id;
}
function notesFor(id){
  return notes().filter(n => n.athleteId === id).sort((a, b) => a.date.localeCompare(b.date));
}

/* Months an athlete has any real record in, newest first. */
function monthsFor(id){
  const ks = [];
  completed().filter(s => s.athleteId === id).forEach(s => {
    const k = monthKey(s.date); if (ks.indexOf(k) < 0) ks.push(k);
  });
  notesFor(id).forEach(n => { const k = monthKey(n.date); if (ks.indexOf(k) < 0) ks.push(k); });
  const cur = monthKey(TODAY);
  if (ks.indexOf(cur) < 0) ks.push(cur);
  return ks.sort().reverse();
}
function defaultMonth(id){
  const ns = notesFor(id);
  if (ns.length) return monthKey(ns[ns.length - 1].date);
  const ms = monthsFor(id);
  return ms[0] || monthKey(TODAY);
}

/* Compile one month for one athlete. Zero notes is a real, reportable answer. */
function compile(athleteId, month){
  const ns = notesFor(athleteId).filter(n => monthKey(n.date) === month);
  const attended = completed().filter(s => s.athleteId === athleteId && monthKey(s.date) === month).length;
  const skills = [];
  ns.forEach(n => (n.skills || []).forEach(s => { if (skills.indexOf(s) < 0) skills.push(s); }));
  const wins = ns.map(n => ({ date: n.date, text: n.win }));
  const focus = [];
  ns.slice().reverse().forEach(n => {
    const t = String(n.next || "").trim();
    if (t && focus.indexOf(t) < 0 && focus.length < 3) focus.push(t);
  });
  return {
    athleteId: athleteId, name: athleteName(athleteId), month: month,
    notes: ns, attended: attended, skills: skills, wins: wins, focus: focus,
  };
}
function reportFor(athleteId, month){
  return reports().find(r => r.athleteId === athleteId && r.month === month) || null;
}

/* ═══════════════════ SHARING INTO THE FAMILY THREAD ═══════════════════ */
/* One note or one report becomes exactly one message. Both paths refuse to
   run twice, so a re-click can never double-post into the family's thread. */
function threadFor(programId){
  if (!S.conversations) S.conversations = [];
  if (!S.messages) S.messages = {};
  let c = S.conversations.find(x => x.programId === programId) || S.conversations[0] || null;
  if (!c){
    c = {
      id: "conv_nt_" + Date.now(), with: SEED.providerProfile.businessName,
      programId: programId, last: "", at: isoNow(),
    };
    S.conversations = [c].concat(S.conversations);
  }
  if (!S.messages[c.id]) S.messages[c.id] = [];
  return c;
}
function post(programId, text){
  const c = threadFor(programId);
  S.messages[c.id] = S.messages[c.id].concat([{
    id: "m_nt_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    me: false, text: text, at: isoNow(),
  }]);
  c.last = text;
  c.at = isoNow();
  return c;
}
function noteMessage(n){
  const p = prog(n.programId);
  return "Session note — " + fmtDate(n.date) + (p ? " · " + p.title : "") +
    ". What we worked on: " + n.worked +
    " One win: " + n.win +
    " Next focus: " + n.next +
    ((n.skills && n.skills.length) ? " Skills worked: " + n.skills.join(", ") + "." : "");
}
function reportMessage(r){
  const parts = [
    "Progress report — " + firstName(r.name) + ", " + monthLabel(r.month) + ".",
    plural(r.attended, "session") + " attended, " + r.notes.length + " with a written note.",
  ];
  if (r.skills.length) parts.push("Skills worked: " + r.skills.join(", ") + ".");
  if (r.wins.length) parts.push("Wins: " + r.wins.map(w => fmtDate(w.date) + " — " + w.text).join(" | "));
  if (r.focus.length) parts.push("Focus for " + monthLabel(nextMonthKey(r.month)) + ": " + r.focus.join(" | "));
  return parts.join(" ");
}

/* Returns true only when a message was genuinely appended. */
function shareNote(noteId){
  const n = noteById(noteId);
  if (!n || n.shared) return false;
  post(n.programId, noteMessage(n));
  n.shared = true;
  n.sharedAt = isoNow();
  return true;
}
function sendReport(athleteId, month){
  if (reportFor(athleteId, month)) return false;
  const r = compile(athleteId, month);
  if (!r.notes.length) return false;              // nothing real to send
  post(athleteProgramId(athleteId), reportMessage(r));
  reports().push({
    id: "pr_" + athleteId + "_" + month,
    athleteId: athleteId, athlete: r.name, month: month,
    sessionsAttended: r.attended, notesWritten: r.notes.length,
    skills: r.skills.slice(), wins: r.wins.slice(), focus: r.focus.slice(),
    sentAt: isoNow(),
  });
  return true;
}

/* ═══════════════════ THE VOICE-MEMO DRAFT ═══════════════════ */
/* There is no speech API here. Nothing is recorded and nothing is
   transcribed. The button below inserts a generic example so the coach has
   something to cut down — and saving is blocked until it has been replaced. */
const DRAFT_MARK = "EXAMPLE DRAFT — replace this.";
const EXAMPLE = {
  worked: DRAFT_MARK + " Ninety minutes on ball striking: two-touch passing in a grid, then finishing from the top of the box.",
  win:    DRAFT_MARK + " Kept her head up through the last rep of the passing grid instead of watching her feet.",
  next:   DRAFT_MARK + " Weak-foot passing under light pressure.",
};
const isExample = v => String(v).indexOf(DRAFT_MARK) >= 0;

/* ═══════════════════ LOCAL UI STATE ═══════════════════ */
/* Panel + filter selection. Deliberately module-local: it is view state, not
   product data, so it never lands in S. */
const ui = { panel: "queue", athlete: "all" };
const PANELS = [["queue", "Needs a note"], ["written", "Written notes"], ["progress", "Athlete progress"]];

const FIELDS = [
  ["worked", "What we worked on", "The drills, the focus, the shape of the session."],
  ["win",    "One win",           "One thing that went right today — be specific enough that a parent can picture it."],
  ["next",   "Next focus",        "The single thing you will pick up next session."],
];
const MIN = 3, MAX = 500;

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
/* ── Page architecture ────────────────────────────────────────────
   This tab is a short page, not one flat panel. Three grounds, top to
   bottom: a slate hero that states what the surface is for, a white
   workspace holding the three panels, and one dark block at the foot
   carrying the three limits the module enforces in code.

   Same band vocabulary as productHTML(), scoped to the coach column —
   the bands run the width of the content column rather than the window,
   because the rail beside them is part of the workspace and a true
   full-bleed band would run underneath it.

   No register class: the serious register (Hanken) is for finances and
   media only, so this tab stays on the default Syne/Jakarta. */
.nt-lede{color:var(--muted);font-size:var(--text-md);max-width:56ch;margin-top:14px;line-height:1.5}
.nt-heroact{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:24px}
.nt-stats{display:flex;gap:40px;flex-wrap:wrap;margin-top:26px;padding-top:20px;border-top:1px solid var(--rule)}
.nt-stat span{display:block;font-size:var(--text-xs);font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;color:var(--faint)}
.nt-stat b{display:block;margin-top:7px;font-family:var(--display);font-weight:800;
  font-size:var(--text-xl);letter-spacing:-.02em;line-height:1;color:var(--ink)}
.nt-bar{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin:0 0 18px}
.nt-seg{display:flex;background:var(--raise2);border-radius:999px;padding:4px;gap:3px;flex-wrap:wrap}
.nt-segbtn{padding:8px 15px;border-radius:999px;font-size:var(--text-sm);font-weight:700;color:var(--muted);transition:.15s}
.nt-segbtn:hover{color:var(--ink)}
.nt-segbtn.on{background:var(--paper);color:var(--ink);font-weight:700}
.nt-segbtn .nt-badge{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;
  margin-left:7px;border-radius:999px;background:var(--slate);color:var(--paper);font-size:var(--text-xs);font-weight:700}
.nt-filter{display:flex;flex-direction:column;gap:6px;min-width:220px}
.nt-filter label{font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.nt-filter select{padding:10px 12px;border:1px solid var(--rule-strong);border-radius:var(--r-m);
  background:var(--paper);color:var(--ink);font:inherit;font-size:var(--text-base)}
.nt-filter select:focus{outline:none;border-color:var(--slate);box-shadow:0 0 0 3px var(--slate-ring)}
.nt-note{border:1px solid var(--rule);border-radius:var(--r-l);padding:16px 18px;background:var(--paper);margin-bottom:12px}
.nt-note.pending{border-style:dashed}
.nt-notehead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
.nt-when{font-size:var(--text-base);font-weight:700;letter-spacing:-.015em;color:var(--ink)}
.nt-sub{font-size:var(--text-sm);color:var(--muted);margin-top:2px}
.nt-tag{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;
  font-size:var(--text-xs);font-weight:700;letter-spacing:-.005em}
.nt-f{margin-top:12px}
.nt-flabel{font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.nt-ftext{font-size:var(--text-base);color:var(--ink-2);line-height:1.55;margin-top:3px}
.nt-chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.nt-chip{padding:4px 11px;border-radius:999px;font-size:var(--text-sm);font-weight:700;letter-spacing:-.005em}
.nt-pick{padding:7px 13px;border:1px solid var(--rule);border-radius:999px;font-size:var(--text-sm);font-weight:600;
  color:var(--ink-2);background:var(--paper);transition:.14s}
.nt-pick:hover{border-color:var(--ink-2);background:var(--raise)}
.nt-pick[aria-pressed="true"]{border-color:var(--slate);background:var(--slate-tint);color:var(--slate)}
.nt-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:13px;border-top:1px solid var(--rule)}
.nt-group{margin-top:22px}
.nt-grouphead{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;
  padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid var(--rule)}
.nt-freq{background:var(--raise);border-radius:var(--r-m);padding:13px 15px;font-size:var(--text-sm);color:var(--ink-2);
  line-height:1.55;margin-bottom:14px}
.nt-freq b{color:var(--ink)}
.nt-freq .nt-meta{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;font-size:var(--text-sm);color:var(--muted)}
.nt-tl{display:flex;flex-direction:column;gap:0;border-left:2px solid var(--rule);margin-left:6px;padding-left:18px}
.nt-tlrow{position:relative;padding:0 0 20px}
.nt-tlrow:last-child{padding-bottom:2px}
.nt-tlrow::before{content:"";position:absolute;left:-25px;top:5px;width:10px;height:10px;border-radius:999px;
  background:var(--paper);border:2px solid var(--rule-strong)}
.nt-tlrow.shared::before{background:var(--good);border-color:var(--good)}
.nt-tldate{font-size:var(--text-sm);font-weight:700;color:var(--ink);letter-spacing:-.01em}
.nt-tlline{font-size:var(--text-base);color:var(--ink-2);line-height:1.5;margin-top:4px}
.nt-tlline span{color:var(--faint);font-weight:700;font-size:var(--text-xs);letter-spacing:.08em;text-transform:uppercase;
  display:block;margin-bottom:1px}
.nt-warn{border:1px solid var(--warn);border-radius:var(--r-m);padding:14px 16px;background:var(--warn-tint);
  font-size:var(--text-sm);color:var(--ink-2);line-height:1.55;margin-bottom:16px}
.nt-warn b{display:block;color:var(--warn);font-size:var(--text-sm);margin-bottom:4px}
.nt-count{font-size:var(--text-sm);color:var(--faint);font-weight:600}
.nt-count.nt-bad{color:var(--danger)}
.nt-fieldhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.nt-hint{font-size:var(--text-sm);color:var(--faint);margin:-10px 0 16px;line-height:1.45}
.nt-repline{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--rule);
  font-size:var(--text-base);color:var(--ink-2)}
.nt-repline:first-of-type{border-top:0}
.nt-list{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:9px}
.nt-list li{font-size:var(--text-base);color:var(--ink-2);line-height:1.5}
.nt-list li b{display:block;font-size:var(--text-sm);color:var(--faint);font-weight:700;letter-spacing:.02em}
.nt-blank{border:1px dashed var(--rule-strong);border-radius:var(--r-l);padding:22px;text-align:center;
  color:var(--muted);font-size:var(--text-base);line-height:1.6}
@media(max-width:760px){
  .nt-bar{flex-direction:column;align-items:stretch}
  .nt-filter{min-width:0}
}
`;

/* ═══════════════════ SMALL RENDER HELPERS ═══════════════════ */
function sportTag(programId){
  const p = prog(programId);
  if (!p) return "";
  const c = sportColor(p.sport);
  return `<span class="nt-tag" style="background:color-mix(in srgb,${c} 14%,transparent);color:${c}">${esc(p.sport)}</span>`;
}
function skillChips(list, programId){
  if (!list || !list.length) return "";
  const c = sportColor(sportOf(programId));
  return `<div class="nt-chips">${list.map(s =>
    `<span class="nt-chip" style="background:color-mix(in srgb,${c} 13%,transparent);color:${c}">${esc(s)}</span>`
  ).join("")}</div>`;
}
function athleteOptions(sel){
  const ids = athleteIds();
  return [`<option value="all" ${sel === "all" ? "selected" : ""}>All athletes</option>`].concat(
    ids.map(id => {
      const n = notesFor(id).length;
      return `<option value="${esc(id)}" ${sel === id ? "selected" : ""}>${esc(athleteName(id))} · ${n} note${n === 1 ? "" : "s"}</option>`;
    })
  ).join("");
}
const passesFilter = id => ui.athlete === "all" || ui.athlete === id;

/* ═══════════════════ VIEW: SESSION NOTES ═══════════════════ */
/* The three limits below are statements about this file, not marketing:
   shareNote() returns false on an already-shared note, the voice button
   inserts EXAMPLE and validate() refuses to save it, and cadence()/
   longestGap() only subtract dates. Nothing here is aspirational. */
const LIMITS = [
  ["check", "A note is sent once",
   "Sharing posts one message into the family thread. A second click cannot post again."],
  ["note", "Nothing is transcribed",
   "The draft button inserts a labelled example. No audio is captured in this build."],
  ["chart", "No score is invented",
   "Cadence and gaps are counted off your note dates. Nothing is modelled."],
];

function notesView(){
  if (athleteIds().indexOf(ui.athlete) < 0 && ui.athlete !== "all") ui.athlete = "all";
  const queue = pendingList();
  const pending = queue.length;
  const written = notes().length;
  const sent = notes().filter(n => n.shared).length;
  /* pendingList() inherits the ledger's newest-first order, so the last row is
     the session that has been waiting longest. The hero button is a shortcut
     onto the existing [data-nt-write] handler — same composer, same session. */
  const oldest = queue.length ? queue[queue.length - 1] : null;
  const stat = (label, value) => `<div class="nt-stat"><span>${label}</span><b class="num">${value}</b></div>`;

  return `
  <section class="band alt" style="padding:40px 0 36px">
    <div class="shell" data-rev>
      <div class="eyebrow">Session notes</div>
      <h1 style="margin-top:14px;max-width:20ch">Write it once. The parent gets it.</h1>
      <p class="nt-lede">Each note is attached to the session it came from, and stays private
        until you send it.</p>
      <div class="nt-heroact">
        ${oldest ? `<button class="btn" data-nt-write="${esc(oldest.id)}">Write the oldest note</button>` : ""}
        <span class="pill ${pending ? "warn" : "good"} num">${pending} waiting</span>
      </div>
      <div class="nt-stats">
        ${stat("Notes written", written)}
        ${stat("Sent to families", sent)}
        ${stat("Sessions on record", completed().length)}
      </div>
    </div>
  </section>

  <section class="band" style="padding:34px 0 40px">
    <div class="shell" data-rev>
      <div class="nt-bar">
        <div class="nt-seg" role="tablist" aria-label="Session note panels">
          ${PANELS.map(([k, label]) => `<button class="nt-segbtn ${ui.panel === k ? "on" : ""}" role="tab"
            aria-selected="${ui.panel === k}" data-nt-panel="${k}">${esc(label)}${
              k === "queue" && pending ? `<span class="nt-badge num">${pending}</span>` : ""}</button>`).join("")}
        </div>
        <div class="nt-filter">
          <label for="ntAthlete">Filter by athlete</label>
          <select id="ntAthlete">${athleteOptions(ui.athlete)}</select>
        </div>
      </div>
      ${ui.panel === "queue" ? queuePanel() : ui.panel === "written" ? writtenPanel() : progressPanel()}
    </div>
  </section>

  ${/* One dark block per page, at the foot. White cards on black rather than
        text on black — the ground invariant holds either way, and the card is
        the same component the product page uses for the platform rules. */""}
  <section class="band dark" style="padding:44px 0 48px">
    <div class="shell" data-rev>
      <div class="prodsec" style="padding:0 0 6px">
        <h2>What this page will not do</h2>
        <p class="sub">Held in the code, not in a policy.</p>
      </div>
      <div class="prodgrid">
        ${LIMITS.map(([icon, t, d]) => `<div class="prodcard" style="cursor:default">
          <span class="ic" aria-hidden="true">${PICON[icon]}</span>
          <b>${esc(t)}</b><span>${esc(d)}</span></div>`).join("")}
      </div>
    </div>
  </section>`;
}

function queuePanel(){
  const rows = pendingList().filter(s => passesFilter(s.athleteId));
  if (!rows.length) return `<div class="nt-blank">
    Nothing waiting. Every completed session${ui.athlete === "all" ? "" : " for this athlete"} has a note.</div>`;
  return `<div class="tblwrap panel" style="padding:18px"><table class="tbl">
    <thead><tr><th>Date</th><th>Athlete</th><th>Sport</th><th>Program</th><th>Waiting</th><th></th></tr></thead>
    <tbody>${rows.map(s => {
      const p = prog(s.programId);
      const age = daysBetween(s.date, TODAY);
      return `<tr>
        <td class="num">${esc(fmtDate(s.date))}</td>
        <td><b>${esc(firstName(s.athlete))}</b>
          <div class="nt-sub">${esc(s.athlete)}</div></td>
        <td>${sportTag(s.programId)}</td>
        <td>${p ? esc(p.title) : `<span style="color:var(--muted)">${esc(s.programId)}</span>`}</td>
        <td class="num">${age} day${age === 1 ? "" : "s"}</td>
        ${/* Ghost, not filled: the accent is the page's single primary CTA, and a
             column of ten filled buttons would have spent it ten times over. */""}
        <td><button class="btn ghost sm" data-nt-write="${esc(s.id)}">Write note</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>
  <p class="nt-hint" style="margin-top:14px">Every past session with an empty note.
    Nothing here is ranked or scored.</p>`;
}

function writtenPanel(){
  const ids = athleteIds().filter(passesFilter).filter(id => notesFor(id).length);
  if (!ids.length) return `<div class="nt-blank">No notes yet${
    ui.athlete === "all" ? "" : " for this athlete"}. Start from the “Needs a note” panel.</div>`;
  return ids.map(id => {
    const list = notesFor(id).slice().reverse();
    const shared = list.filter(n => n.shared).length;
    return `<div class="nt-group">
      <div class="nt-grouphead">
        <div><h3>${esc(athleteName(id))}</h3>
          <div class="nt-sub">${sportTag(athleteProgramId(id))}
            <span class="num" style="margin-left:6px">${list.length} note${list.length === 1 ? "" : "s"} ·
            ${shared} shared with the family</span></div></div>
        <button class="btn ghost sm" data-nt-report="${esc(id)}">Monthly report</button>
      </div>
      ${list.map(noteCard).join("")}
    </div>`;
  }).join("");
}

function noteCard(n){
  return `<div class="nt-note">
    <div class="nt-notehead">
      <div><div class="nt-when num">${esc(fmtDate(n.date))}</div>
        <div class="nt-sub">${esc(firstName(n.athlete))} · ${esc((prog(n.programId) || {}).title || n.programId)}</div></div>
      ${n.shared
        ? `<span class="pill good">Shared with the family</span>`
        : `<span class="pill slate">Private to you</span>`}
    </div>
    ${FIELDS.filter(([k]) => String(n[k] || "").trim()).map(([k, label]) => `<div class="nt-f">
      <div class="nt-flabel">${esc(label)}</div>
      <div class="nt-ftext">${esc(n[k])}</div></div>`).join("")}
    ${skillChips(n.skills, n.programId)}
    <div class="nt-acts">
      <button class="btn ghost sm" data-nt-edit="${esc(n.id)}">Edit</button>
      ${n.shared
        ? `<span class="nt-sub" style="align-self:center">Sent ${esc(fmtDate(String(n.sharedAt || n.date).slice(0, 10)))}</span>`
        : `<button class="btn ghost sm" data-nt-share="${esc(n.id)}">${ICON.send} Share to parent</button>`}
    </div>
  </div>`;
}

function progressPanel(){
  const ids = athleteIds().filter(passesFilter);
  if (!ids.length) return `<div class="nt-blank">No athletes on record yet.</div>`;
  return ids.map(id => {
    const list = notesFor(id);
    const dates = list.map(n => n.date);
    const cad = cadence(dates);
    const gap = longestGap(dates);
    const sinceLast = dates.length ? daysBetween(dates[dates.length - 1], TODAY) : null;
    const skills = [];
    list.forEach(n => (n.skills || []).forEach(s => { if (skills.indexOf(s) < 0) skills.push(s); }));
    const sessions = completed().filter(s => s.athleteId === id).length;

    return `<div class="nt-group">
      <div class="nt-grouphead">
        <div><h3>${esc(athleteName(id))}</h3>
          <div class="nt-sub">${sportTag(athleteProgramId(id))}
            <span class="num" style="margin-left:6px">${sessions} completed session${sessions === 1 ? "" : "s"} ·
            ${list.length} with a note</span></div></div>
        <button class="btn ghost sm" data-nt-report="${esc(id)}">Monthly report</button>
      </div>

      <div class="nt-freq">
        <b>${esc(cad.line)}</b>
        <div class="nt-meta">
          ${sinceLast == null ? "" : `<span class="num">Last note ${sinceLast} day${sinceLast === 1 ? "" : "s"} ago</span>`}
          ${gap.pair ? `<span class="num">Longest gap ${gap.days} days (${esc(fmtDate(gap.pair[0]))} to ${esc(fmtDate(gap.pair[1]))})</span>` : ""}
          ${list.length < sessions ? `<span class="num">${sessions - list.length} completed session${sessions - list.length === 1 ? "" : "s"} still unwritten</span>` : ""}
        </div>
        <div class="nt-sub" style="margin-top:8px">Counted off your note dates. Nothing here is scored.</div>
      </div>

      ${skills.length ? `<div class="nt-flabel">Skills worked across all notes</div>${skillChips(skills, athleteProgramId(id))}` : ""}

      ${list.length ? `<div class="nt-tl" style="margin-top:16px">
        ${list.slice().reverse().map(n => `<div class="nt-tlrow ${n.shared ? "shared" : ""}">
          <div class="nt-tldate num">${esc(fmtDate(n.date))}${n.shared ? " · shared" : ""}</div>
          ${(n.skills && n.skills.length) ? skillChips(n.skills, n.programId) : ""}
          <div class="nt-tlline"><span>Win</span>${esc(n.win)}</div>
          <div class="nt-tlline"><span>Next focus</span>${esc(n.next)}</div>
        </div>`).join("")}
      </div>` : `<div class="nt-blank">No notes yet, so there is no record to show.</div>`}
    </div>`;
  }).join("");
}

/* ═══════════════════ MODALS ═══════════════════ */
const wrap = (title, body) =>
  `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-body">${body}</div></div></div>`;

function writeNoteModal(){
  const m = S.modal || {};
  const existing = m.noteId ? noteById(m.noteId) : (m.bookingId ? noteForSession(m.bookingId) : null);
  const sess = sessionById(m.bookingId) ||
    (existing ? { id: existing.sessionId, athlete: existing.athlete, athleteId: existing.athleteId,
                  programId: existing.programId, date: existing.date } : null);
  if (!sess) return wrap("Session note",
    `<p style="color:var(--muted)">That session is no longer on your schedule, so there is nothing to write against.</p>`);

  const p = prog(sess.programId);
  const cands = skillsFor(sess.sport || sportOf(sess.programId));
  const chosen = existing ? (existing.skills || []) : [];
  const title = existing ? "Edit session note" : "Session note";

  return wrap(title, `
    <div class="panel" style="background:var(--raise);border:0;margin-bottom:18px">
      <b>${esc(firstName(sess.athlete))}</b>
      <span class="nt-sub"> · ${esc(sess.athlete)}</span>
      <div class="nt-sub" style="margin-top:4px">
        <span class="num">${esc(fmtDate(sess.date))}</span>${p ? " · " + esc(p.title) : ""}</div>
      <div style="margin-top:9px">${sportTag(sess.programId)}</div>
    </div>

    <div class="nt-warn hide" id="ntDraftWarn" role="status">
      <b>Nothing was recorded</b>
      No audio was captured and nothing was transcribed — this build has no speech capture wired up at all.
      The three fields below now hold a generic example so you have something to cut down. Every line in it is
      invented, not yours. Replace all three before you save; the form will not accept the example text.
    </div>

    <form id="ntNoteForm">
      ${FIELDS.map(([k, label, hint]) => {
        const v = existing ? existing[k] : "";
        return `<div class="field" style="margin-bottom:6px">
          <div class="nt-fieldhead">
            <label for="ntF-${k}">${esc(label)}</label>
            <span class="nt-count num" data-nt-count="${k}">${String(v).trim().length} / ${MAX}</span>
          </div>
          <textarea id="ntF-${k}" name="${k}" rows="3" data-nt-field="${k}"
            placeholder="${esc(hint)}">${esc(v)}</textarea>
        </div>
        <p class="nt-hint">${esc(hint)}</p>`;
      }).join("")}

      <div class="field" style="margin-bottom:8px">
        <label id="ntSkillsLabel">Skills worked (optional)</label>
        <div class="nt-chips" role="group" aria-labelledby="ntSkillsLabel" style="margin-top:2px">
          ${cands.map(s => `<button type="button" class="nt-pick" data-nt-skill="${esc(s)}"
            aria-pressed="${chosen.indexOf(s) >= 0}">${esc(s)}</button>`).join("")}
        </div>
      </div>
      <p class="nt-hint">Drawn from ${esc(sportOf(sess.programId) || "this sport")}. Tap what you actually
        covered — leaving them all off is fine.</p>

      <div id="ntNoteErr" class="err hide" style="margin-bottom:12px"></div>

      <button class="btn wide" type="submit">${existing ? "Save changes" : "Save note"}</button>
      <button class="btn ghost wide" type="button" id="ntVoice" style="margin-top:9px">Draft from voice memo</button>
      <p class="nt-hint" style="margin-top:9px;margin-bottom:0">The draft button does not record you. It fills
        the fields with a labelled example you must rewrite — Sporv has no transcription in this build.</p>
    </form>`);
}

function progressReportModal(){
  const m = S.modal || {};
  const id = m.athleteId;
  if (!id || athleteIds().indexOf(id) < 0) return wrap("Monthly report",
    `<p style="color:var(--muted)">That athlete is no longer on your roster.</p>`);

  const months = monthsFor(id);
  const month = (m.month && months.indexOf(m.month) >= 0) ? m.month : defaultMonth(id);
  const r = compile(id, month);
  const already = reportFor(id, month);
  const c = sportColor(sportOf(athleteProgramId(id)));

  const picker = `<div class="field">
      <label for="ntMonth">Month</label>
      <select id="ntMonth">${months.map(k =>
        `<option value="${esc(k)}" ${k === month ? "selected" : ""}>${esc(monthLabel(k))}</option>`).join("")}
      </select></div>`;

  if (!r.notes.length){
    return wrap("Monthly report", `
      <div class="panel" style="background:var(--raise);border:0;margin-bottom:18px">
        <b>${esc(r.name)}</b>
        <div class="nt-sub" style="margin-top:3px">${esc(monthLabel(month))}</div>
      </div>
      ${picker}
      <div class="nt-blank" style="text-align:left">
        <b style="display:block;color:var(--ink);margin-bottom:6px">No notes were written in ${esc(monthLabel(month))}.</b>
        ${r.attended > 0
          ? `There ${r.attended === 1 ? "was" : "were"} <span class="num">${r.attended}</span> completed
             session${r.attended === 1 ? "" : "s"} that month, but nothing was written against
             ${r.attended === 1 ? "it" : "them"}. A report built from zero notes would be a report about nothing,
             so there is nothing here to send. Write the notes first and this page fills itself in.`
          : `There were no completed sessions that month either, so there is nothing to report.`}
      </div>
      <p class="nt-hint" style="margin-top:14px;margin-bottom:0">Sporv will not compose a summary out of
        sessions it has no record of.</p>`);
  }

  return wrap("Monthly report", `
    <div class="panel" style="background:var(--raise);border:0;margin-bottom:18px">
      <b>${esc(r.name)}</b>
      <div class="nt-sub" style="margin-top:3px">${esc(monthLabel(month))} ·
        ${esc((prog(athleteProgramId(id)) || {}).title || "")}</div>
    </div>
    ${picker}

    <div class="nt-repline"><span>Sessions attended</span>
      <b class="num">${r.attended}</b></div>
    <div class="nt-repline"><span>Sessions with a written note</span>
      <b class="num">${r.notes.length}</b></div>
    <div class="nt-repline"><span>Distinct skills worked</span>
      <b class="num">${r.skills.length}</b></div>
    ${r.attended > r.notes.length ? `<p class="nt-hint" style="margin-top:10px">
      <span class="num">${r.attended - r.notes.length}</span> session${r.attended - r.notes.length === 1 ? "" : "s"}
      that month ${r.attended - r.notes.length === 1 ? "has" : "have"} no note, so nothing from
      ${r.attended - r.notes.length === 1 ? "it" : "them"} appears below.</p>` : ""}

    ${r.skills.length ? `<div style="margin-top:16px">
      <div class="nt-flabel">Skills worked</div>
      <div class="nt-chips">${r.skills.map(s =>
        `<span class="nt-chip" style="background:color-mix(in srgb,${c} 13%,transparent);color:${c}">${esc(s)}</span>`).join("")}
      </div></div>` : ""}

    <div style="margin-top:18px">
      <div class="nt-flabel">Wins this month</div>
      <ul class="nt-list">${r.wins.map(w =>
        `<li><b class="num">${esc(fmtDate(w.date))}</b>${esc(w.text)}</li>`).join("")}</ul>
    </div>

    <div style="margin-top:18px">
      <div class="nt-flabel">Focus for ${esc(monthLabel(nextMonthKey(month)))}</div>
      <ul class="nt-list">${r.focus.map(f => `<li>${esc(f)}</li>`).join("")}</ul>
      <p class="nt-hint" style="margin-top:8px">Taken verbatim from the most recent next-focus lines you wrote —
        newest first, duplicates dropped. Nothing here was generated.</p>
    </div>

    <div style="margin-top:22px">
      ${already
        ? `<p class="nt-hint" style="margin:0">Sent to the family already. A month is only sent once, so there is
             nothing further to send here.</p>`
        : `<button class="btn wide" id="ntSendReport">${ICON.send} Send to ${esc(firstName(r.name))}'s family</button>
           <p class="nt-hint" style="margin-top:9px;margin-bottom:0">Sending posts this summary once into the
             family's message thread and files it under your progress reports.</p>`}
    </div>`);
}

/* ═══════════════════ WIRING ═══════════════════ */
function ensureCSS(){
  if (typeof document === "undefined" || document.getElementById("mod-notes-css")) return;
  const el = document.createElement("style");
  el.id = "mod-notes-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* Repaint the character counter in place. A full render() here would rebuild
   the modal and take the caret out of the textarea the coach is typing in. */
function paintCount(key){
  const ta = document.getElementById("ntF-" + key);
  const out = document.querySelector('[data-nt-count="' + key + '"]');
  if (!ta || !out) return;
  const n = ta.value.trim().length;
  out.textContent = n + " / " + MAX;
  out.classList.toggle("nt-bad", n > 0 && (n < MIN || n > MAX));
}
function pickedSkills(){
  const out = [];
  document.querySelectorAll('[data-nt-skill]').forEach(b => {
    if (b.getAttribute("aria-pressed") === "true") out.push(b.dataset.ntSkill);
  });
  return out;
}
/* Returns an error string, or null when the three fields are good. */
function validate(vals){
  for (let i = 0; i < FIELDS.length; i++){
    const k = FIELDS[i][0], label = FIELDS[i][1];
    const v = String(vals[k] == null ? "" : vals[k]).trim();
    if (isExample(v)) return "“" + label + "” still holds the example draft. That text is invented, not a " +
      "transcript of anything you said — rewrite it in your own words before saving.";
    if (v.length < MIN) return "“" + label + "” needs at least " + MIN + " characters.";
    if (v.length > MAX) return "“" + label + "” is " + v.length + " characters — keep it under " + MAX + ".";
  }
  return null;
}
/* Create or update. Returns the saved note. */
function saveNote(sess, vals, skills, noteId){
  const now = isoNow();
  const existing = noteId ? noteById(noteId) : noteForSession(sess.id);
  if (existing){
    existing.worked = String(vals.worked).trim();
    existing.win = String(vals.win).trim();
    existing.next = String(vals.next).trim();
    existing.skills = skills.slice();
    existing.updatedAt = now;
    return existing;
  }
  const n = {
    id: "nt_" + sess.athleteId + "_" + sess.date + "_" + Date.now(),
    sessionId: sess.id, athleteId: sess.athleteId, athlete: sess.athlete,
    programId: sess.programId, date: sess.date,
    worked: String(vals.worked).trim(), win: String(vals.win).trim(), next: String(vals.next).trim(),
    skills: skills.slice(), shared: false, sharedAt: null,
    createdAt: now, updatedAt: now,
  };
  notes().push(n);
  return n;
}

function wire(){
  ensureCSS();
  if (typeof document === "undefined") return;
  const q = s => document.querySelectorAll(s);

  /* ── workspace ─────────────────────────────────────────────────── */
  q("[data-nt-panel]").forEach(b => b.onclick = () => { ui.panel = b.dataset.ntPanel; render(); });
  const sel = document.getElementById("ntAthlete");
  if (sel) sel.onchange = () => { ui.athlete = sel.value; render(); };

  q("[data-nt-write]").forEach(b => b.onclick = () => {
    S.modal = { type: "writenote", bookingId: b.dataset.ntWrite };
    render();
  });
  q("[data-nt-edit]").forEach(b => b.onclick = () => {
    const n = noteById(b.dataset.ntEdit);
    if (!n) return;
    S.modal = { type: "writenote", bookingId: n.sessionId, noteId: n.id };
    render();
  });
  q("[data-nt-share]").forEach(b => b.onclick = () => {
    const n = noteById(b.dataset.ntShare);
    if (!n) return;
    if (!shareNote(n.id)){ toast("That note has already been shared"); return; }
    render();
    toast("Note shared with " + firstName(n.athlete) + "'s family");
  });
  q("[data-nt-report]").forEach(b => b.onclick = () => {
    const id = b.dataset.ntReport;
    S.modal = { type: "progressreport", athleteId: id, month: defaultMonth(id) };
    render();
  });

  /* ── write-note modal ─────────────────────────────────────────── */
  q("[data-nt-field]").forEach(ta => ta.oninput = () => paintCount(ta.dataset.ntField));
  q("[data-nt-skill]").forEach(b => b.onclick = () => {
    /* Toggled in place: a render() would rebuild the form and throw away
       whatever the coach has already typed but not yet saved. */
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });

  const voice = document.getElementById("ntVoice");
  if (voice) voice.onclick = () => {
    FIELDS.forEach(([k]) => {
      const ta = document.getElementById("ntF-" + k);
      if (ta){ ta.value = EXAMPLE[k]; paintCount(k); }
    });
    const warn = document.getElementById("ntDraftWarn");
    if (warn) warn.classList.remove("hide");
    const err = document.getElementById("ntNoteErr");
    if (err) err.classList.add("hide");
    toast("Example draft inserted — nothing was recorded");
  };

  const form = document.getElementById("ntNoteForm");
  if (form) form.onsubmit = ev => {
    ev.preventDefault();
    const m = S.modal || {};
    const existing = m.noteId ? noteById(m.noteId) : null;
    const sess = sessionById(m.bookingId) ||
      (existing ? { id: existing.sessionId, athlete: existing.athlete, athleteId: existing.athleteId,
                    programId: existing.programId, date: existing.date } : null);
    const err = document.getElementById("ntNoteErr");
    const show = msg => { if (err){ err.textContent = msg; err.classList.remove("hide"); } return false; };
    if (!sess) return show("That session is no longer on your schedule.");

    const d = {};
    FIELDS.forEach(([k]) => {
      const ta = document.getElementById("ntF-" + k);
      d[k] = ta ? ta.value : "";
    });
    const bad = validate(d);
    if (bad) return show(bad);

    const saved = saveNote(sess, d, pickedSkills(), m.noteId);
    S.modal = null;
    S.coachTab = "notes";
    ui.panel = existing ? ui.panel : "written";
    render();
    toast(existing
      ? "Note updated for " + firstName(saved.athlete)
      : "Note saved — " + firstName(saved.athlete) + ", " + fmtDate(saved.date));
    return true;
  };

  /* ── monthly report modal ─────────────────────────────────────── */
  const mo = document.getElementById("ntMonth");
  if (mo) mo.onchange = () => {
    S.modal = { type: "progressreport", athleteId: S.modal.athleteId, month: mo.value };
    render();
  };
  const send = document.getElementById("ntSendReport");
  if (send) send.onclick = () => {
    const m = S.modal || {};
    const month = m.month || defaultMonth(m.athleteId);
    if (!sendReport(m.athleteId, month)){ toast("Nothing to send for that month"); return; }
    const name = firstName(athleteName(m.athleteId));
    S.modal = null;
    render();
    toast(monthLabel(month) + " report sent to " + name + "'s family");
  };
}

/* ═══════════════════ EXPORT ═══════════════════ */
window.MOD_NOTES = {
  css: CSS,
  tabs: { notes: "Session notes" },
  views: { notes: notesView },
  modals: { writenote: writeNoteModal, progressreport: progressReportModal },
  wire: wire,
  state: { sessionNotes: seedNotes(), progressReports: [] },
  pendingNotes: pendingNotes,
  /* Agentic AI-command rails (used by the coach chatbox create_note proposal). */
  resolveAthlete: resolveAthlete,
  createFromAI: createFromAI,
};

})();
