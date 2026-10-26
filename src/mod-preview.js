"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_PREVIEW — sample Manage tabs for the signed-out coach preview.

   Why this exists: a prospect browsing the preview saw "Sign in to see this"
   on Money, the roster, Teams, Families, Messages and Organization, so the
   Manage half of the product was invisible before signup. Those tabs were
   locked because a signed-out visitor must never see another business's
   families or money (see COACH_PRIVATE in the host). This module keeps that
   rule and fills the gap with a DISCLOSED sample club instead:

   - It renders only when previewSample() is true in the host: coach portal,
     not verified, no Supabase session, no provider row, queue not live. A
     signed-in coach (or the loading moment before their row lands) never
     reaches these renderers; the host keeps its lock or real page for them.
   - Every page carries the "Sample workspace." callout.
   - Nothing here reads or writes the network. Every write-shaped button is
     data-pvsave and answers "Not saved in the sample workspace."

   The sample is the same club the Queue and Approvals samples describe:
   Northside Flight Basketball, the 14U roster in SEED.teams, a 16U team with
   Marcus Bell, the three missing waivers (Nia O., Marcus B., one more), the
   Fall Classic entry fee, and the Sat 10:00 gym double-booking.

   It deliberately exposes `pages`, not `views`: modView() resolves `views`
   for every MOD_*, and these must never shadow the real teams/families/org
   views for a signed-in coach.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

function esc(v){
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
function on(){ return typeof previewSample === "function" && previewSample(); }
function ui(){ return window.COACH_UI; }
function usd(n){ return "$" + Number(n).toLocaleString("en-US"); }
function day(n){ return typeof dayAfter === "function" ? dayAfter(n) : ""; }
function fmt(iso){
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", timeZone:"UTC" }); }
  catch(_e){ return iso; }
}

/* ── The sample club ─────────────────────────────────────────────── */
var DUES = 600, INSTALLMENT = 200;
/* Three installments. The first two are past due relative to TODAY, the
   third is upcoming, so the sample shows paid, overdue and not-yet-due. */
var INST = [ { n:1, due:-33 }, { n:2, due:-12 }, { n:3, due:17 } ];

var TEAMS = [
  { id:"t14", name:"Northside Flight 14U", short:"14U", coach:"Marcus Vale",
    practice:"Tue and Thu, 6:00–7:30 PM", venue:"Northside Community Gym" },
  { id:"t16", name:"Northside Flight 16U", short:"16U", coach:"Dana Ruiz",
    practice:"Mon and Wed, 7:00–8:30 PM; Sat 10:00 AM", venue:"Lakeview Fieldhouse; Saturdays at Northside Community Gym" },
];

/* [athlete, team, jersey, guardian, guardian email, unpaid installments, waiver signed] */
var ROSTER = [
  ["Julian Mercer",  "t14", "3",  "Alex Mercer",     "a.mercer@example.com",    [],     true ],
  ["Nia Okafor",     "t14", "5",  "Renata Okafor",   "r.okafor@example.com",    [],     false],
  ["Cole Whitfield", "t14", "8",  "Grace Whitfield", "g.whitfield@example.com", [],     true ],
  ["Sofia Ibarra",   "t14", "11", "Luis Ibarra",     "l.ibarra@example.com",    [],     true ],
  ["Aarav Raman",    "t14", "14", "Meera Raman",     "m.raman@example.com",     [],     true ],
  ["Ida Nilsen",     "t14", "21", "Tomas Nilsen",    "t.nilsen@example.com",    [2],    true ],
  ["Maya Brooks",    "t14", "24", "Kim Brooks",      "k.brooks@example.com",    [],     true ],
  ["Eli Carter",     "t14", "30", "Jordan Carter",   "j.carter@example.com",    [1, 2], true ],
  ["Marcus Bell",    "t16", "2",  "Keisha Bell",     "k.bell@example.com",      [2],    false],
  ["Jalen Ortiz",    "t16", "4",  "Ana Ortiz",       "a.ortiz@example.com",     [],     true ],
  ["Priya Nair",     "t16", "10", "Suresh Nair",     "s.nair@example.com",      [],     true ],
  ["Owen Kowalski",  "t16", "12", "Beth Kowalski",   "b.kowalski@example.com",  [],     false],
  ["Talia Reyes",    "t16", "22", "Carlos Reyes",    "c.reyes@example.com",     [],     true ],
  ["Sam Dorsey",     "t16", "33", "Lauren Dorsey",   "l.dorsey@example.com",    [],     true ],
].map(function (r){
  return { name:r[0], team:r[1], jersey:r[2], guardian:r[3], email:r[4], unpaid:r[5], waiver:r[6] };
});

function teamOf(id){ for (var i = 0; i < TEAMS.length; i++) if (TEAMS[i].id === id) return TEAMS[i]; return null; }

function installments(){
  var out = [];
  ROSTER.forEach(function (a){
    INST.forEach(function (i){
      var past = i.due < 0;
      var status = !past ? "upcoming" : a.unpaid.indexOf(i.n) >= 0 ? "overdue" : "paid";
      out.push({ athlete:a, n:i.n, due:day(i.due), daysLate:past ? -i.due : 0, status:status, amount:INSTALLMENT });
    });
  });
  return out;
}
function totals(){
  var t = { billed:ROSTER.length * DUES, collected:0, overdue:0, upcoming:0, overdueFamilies:0 };
  installments().forEach(function (i){ t[i.status === "paid" ? "collected" : i.status] += i.amount; });
  t.overdueFamilies = ROSTER.filter(function (a){ return a.unpaid.length; }).length;
  return t;
}
function balanceOf(a){ return a.unpaid.length * INSTALLMENT; }
function oldestLate(a){ return a.unpaid.length ? -INST[a.unpaid[0] - 1].due : 0; }

/* Events, relative to TODAY. The Sat 10:00 16U practice carries the same
   court conflict the Queue sample drafted a fix for. */
function events(){
  return [
    { d:1,  time:"6:00 PM",  kind:"Practice",   team:"14U", title:"14U practice", where:"Northside Community Gym" },
    { d:2,  time:"7:00 PM",  kind:"Practice",   team:"16U", title:"16U practice", where:"Lakeview Fieldhouse" },
    { d:3,  time:"6:00 PM",  kind:"Practice",   team:"14U", title:"14U practice", where:"Northside Community Gym",
      note:"Moved from Wednesday. A reminder to 8 families is waiting in Queue." },
    { d:5,  time:"10:00 AM", kind:"Practice",   team:"16U", title:"16U practice", where:"Northside Community Gym",
      note:"Conflict: the gym double-booked this court. A move to 11:30 is waiting in Queue.", conflict:true },
    { d:5,  time:"1:00 PM",  kind:"Game",       team:"14U", title:"14U vs. Westside Hoops", where:"Northside Community Gym" },
    { d:7,  time:"7:00 PM",  kind:"Practice",   team:"16U", title:"16U practice", where:"Lakeview Fieldhouse" },
    { d:47, time:"8:00 AM",  kind:"Tournament", team:"14U", title:"Fall Classic, day 1", where:"Tournament site, per the operator's packet",
      note:"$150 entry per athlete. The charge to 8 families is a draft in Queue." },
  ].map(function (e){ e.date = day(e.d); return e; });
}

/* ── Shared pieces ───────────────────────────────────────────────── */
function banner(nouns){
  return ui().Callout({ title:"Sample workspace.",
    body:"These are example " + nouns + " so you can see how it works. Nothing here is saved." });
}
function badge(text, tone){
  return '<span class="cui-badge' + (tone ? " cui-badge--" + tone : "") + '">' + esc(text) + "</span>";
}
function saveBtn(label, what){
  return ui().Button({ label:label, size:"sm", variant:"secondary", attrs:'data-pvsave="' + esc(what || label) + '"' });
}
function page(o){
  var u = ui();
  return u.Page({ page:"pv-" + o.key, eyebrow:o.eyebrow, h1:o.h1, lede:o.lede, actions:o.actions || [],
    tabs:o.tabs, active:o.active, stateKey:o.stateKey, tabLabel:o.tabLabel, body:banner(o.nouns) + o.body });
}
function duesCell(a){
  if (!a.unpaid.length) return badge("Paid to date", "good");
  return badge("Overdue " + usd(balanceOf(a)), "warn");
}

/* ── Money ───────────────────────────────────────────────────────── */
function moneyPage(){
  var u = ui(), t = totals();
  var tabs = [
    { key:"owes", label:"Who owes", count:t.overdueFamilies },
    { key:"installments", label:"Installments", count:installments().length },
  ];
  var active = u.activeTab(tabs, "owes", "pvMoneyTab");
  var stats = u.StatGrid([
    { label:"Collected", value:usd(t.collected), context:"of " + usd(t.billed) + " billed this season" },
    { label:"Overdue", value:usd(t.overdue), context:t.overdueFamilies + " families past due" },
    { label:"Not yet due", value:usd(t.upcoming), context:"Third installment, due " + fmt(day(INST[2].due)) },
    { label:"Season dues", value:usd(DUES), context:"Per athlete, 3 installments of " + usd(INSTALLMENT) },
  ]);
  var body;
  if (active === "owes"){
    var late = ROSTER.filter(function (a){ return a.unpaid.length; })
      .sort(function (x, y){ return oldestLate(y) - oldestLate(x); });
    body = u.Block({ title:"Who owes", subtitle:"Families with an installment past its due date, longest overdue first.",
      body:u.DataTable({
        columns:[{ key:"family", label:"Family" }, { key:"team", label:"Team" }, { key:"owed", label:"Owed", mono:true },
                 { key:"late", label:"Days late", mono:true }, { key:"act", label:"Actions" }],
        rows:late.map(function (a){
          return {
            family:u.html("<b>" + esc(a.guardian) + "</b><small>" + esc(a.name) + "</small>"),
            team:teamOf(a.team).short, owed:usd(balanceOf(a)), late:String(oldestLate(a)),
            act:u.html(saveBtn(oldestLate(a) >= 30 ? "Draft payment plan" : "Draft reminder")),
          };
        }),
      }) });
  } else {
    body = u.Block({ title:"Installments", subtitle:"Every installment this season, by athlete.",
      body:u.DataTable({
        columns:[{ key:"athlete", label:"Athlete" }, { key:"n", label:"Installment", mono:true }, { key:"due", label:"Due", mono:true },
                 { key:"amount", label:"Amount", mono:true }, { key:"status", label:"Status" }],
        rows:installments().map(function (i){
          return {
            athlete:u.html("<b>" + esc(i.athlete.name) + "</b><small>" + esc(teamOf(i.athlete.team).short + " · " + i.athlete.guardian) + "</small>"),
            n:i.n + " of 3", due:fmt(i.due), amount:usd(i.amount),
            status:u.html(i.status === "paid" ? badge("Paid", "good") : i.status === "overdue" ? badge(i.daysLate + " days late", "warn") : badge("Upcoming")),
          };
        }),
      }) });
  }
  return page({ key:"money", eyebrow:"Business", h1:"Money", nouns:"families and amounts",
    lede:"Dues billed, collected and overdue across both teams.",
    tabs:tabs, active:active, stateKey:"pvMoneyTab", tabLabel:"Money sections",
    body:u.Block({ title:"This season", subtitle:"Fall 2026 dues for 14U and 16U.", body:stats }) + body });
}

/* ── Roster ──────────────────────────────────────────────────────── */
function rosterPage(){
  var u = ui();
  var label = typeof rosterLabel === "function" ? rosterLabel() : "Roster";
  var body = TEAMS.map(function (team){
    var rows = ROSTER.filter(function (a){ return a.team === team.id; });
    return u.Block({ title:team.name, subtitle:rows.length + " athletes. Dues and waiver status for each.",
      body:u.DataTable({
        columns:[{ key:"athlete", label:"Athlete" }, { key:"jersey", label:"Jersey", mono:true }, { key:"guardian", label:"Guardian" },
                 { key:"dues", label:"Dues" }, { key:"waiver", label:"Waiver" }],
        rows:rows.map(function (a){
          return {
            athlete:u.html("<b>" + esc(a.name) + "</b>"), jersey:"#" + a.jersey,
            guardian:u.html(esc(a.guardian) + "<small>" + esc(a.email) + "</small>"),
            dues:u.html(duesCell(a)), waiver:u.html(a.waiver ? badge("Signed", "good") : badge("Missing", "warn")),
          };
        }),
      }) });
  }).join("");
  return page({ key:"roster", eyebrow:label, h1:label, nouns:"athletes, families and amounts",
    lede:"Every athlete on both teams, with dues and waiver status.",
    actions:[u.Button({ label:"Add athlete", size:"lg", variant:"primary", attrs:'data-pvsave="Add athlete"' })],
    body:body });
}

/* ── Teams ───────────────────────────────────────────────────────── */
function teamsPage(){
  var u = ui();
  var rows = TEAMS.map(function (team){
    var members = ROSTER.filter(function (a){ return a.team === team.id; });
    var paid = members.filter(function (a){ return !a.unpaid.length; }).length;
    var waivers = members.filter(function (a){ return !a.waiver; }).length;
    return {
      team:u.html("<b>" + esc(team.name) + "</b><small>Fall 2026 season</small>"),
      coach:team.coach, athletes:String(members.length),
      practice:u.html(esc(team.practice) + "<small>" + esc(team.venue) + "</small>"),
      dues:u.html(paid + " of " + members.length + " paid to date" + (waivers ? "<small>" + waivers + " waiver" + (waivers === 1 ? "" : "s") + " missing</small>" : "")),
    };
  });
  return page({ key:"teams", eyebrow:"Organization", h1:"Teams", nouns:"teams and rosters",
    lede:"Every team, its coach, its practice times and where its families stand.",
    actions:[u.Button({ label:"Add team", size:"lg", variant:"primary", attrs:'data-pvsave="Add team"' })],
    body:u.Block({ title:"Fall 2026", subtitle:"Two teams, one season.",
      body:u.DataTable({
        columns:[{ key:"team", label:"Team" }, { key:"coach", label:"Head coach" }, { key:"athletes", label:"Athletes", mono:true },
                 { key:"practice", label:"Practice" }, { key:"dues", label:"Dues" }],
        rows:rows,
      }) }) });
}

/* ── Families ────────────────────────────────────────────────────── */
function familiesPage(){
  var u = ui();
  return page({ key:"families", eyebrow:"Organization", h1:"Families", nouns:"families and amounts",
    lede:"Guardians linked to their athletes: who pays, who signs, and who to contact.",
    actions:[u.Button({ label:"Invite family", size:"lg", variant:"primary", attrs:'data-pvsave="Invite family"' })],
    body:u.Block({ title:"Guardians", subtitle:ROSTER.length + " families across 14U and 16U.",
      body:u.DataTable({
        columns:[{ key:"guardian", label:"Guardian" }, { key:"athlete", label:"Athlete" }, { key:"balance", label:"Balance", mono:true },
                 { key:"waiver", label:"Waiver" }, { key:"act", label:"Actions" }],
        rows:ROSTER.map(function (a){
          return {
            guardian:u.html("<b>" + esc(a.guardian) + "</b><small>" + esc(a.email) + "</small>"),
            athlete:u.html(esc(a.name) + "<small>" + esc(teamOf(a.team).short) + "</small>"),
            balance:a.unpaid.length ? usd(balanceOf(a)) + " overdue" : "$0",
            waiver:u.html(a.waiver ? badge("Signed", "good") : badge("Missing", "warn")),
            act:u.html(saveBtn("Message", "Message " + a.guardian)),
          };
        }),
      }) }) });
}

/* ── Messages ────────────────────────────────────────────────────── */
var THREADS = [
  { id:"okafor", who:"Renata Okafor", about:"Nia Okafor · 14U", msgs:[
    { me:false, text:"Is there a form Nia needs before Saturday's game?" },
    { me:true,  text:"Yes, the season waiver. I will resend the link tonight so it is signed before first whistle." } ] },
  { id:"carter", who:"Jordan Carter", about:"Eli Carter · 14U", msgs:[
    { me:false, text:"We fell behind on Eli's dues. Can we split the remaining $400 over the next two months?" },
    { me:true,  text:"That works. I will send a two-payment plan for you to confirm." } ] },
  { id:"bell", who:"Keisha Bell", about:"Marcus Bell · 16U", msgs:[
    { me:true,  text:"Hi Keisha, Marcus's second installment of $200 is 12 days past due. The payment link is in your email." },
    { me:false, text:"Saw it, thank you. I will pay it Friday." } ] },
  { id:"g16", who:"16U families", about:"Group · 6 families", group:true, msgs:[
    { me:true,  text:"Heads up: the gym may move our Saturday 10:00 practice. I will confirm the time by Thursday." },
    { me:false, text:"Thanks. If it moves to 11:30 we can still make it.", from:"Ana Ortiz" } ] },
];
function inboxPage(){
  var u = ui();
  var cur = null;
  for (var i = 0; i < THREADS.length; i++) if (THREADS[i].id === S.pvThread) cur = THREADS[i];
  cur = cur || THREADS[0];
  var list = '<div class="pv-threads" role="list">' + THREADS.map(function (t){
    var last = t.msgs[t.msgs.length - 1];
    return '<button type="button" role="listitem" class="pv-thread' + (t === cur ? " on" : "") + '" data-pvthread="' + esc(t.id) + '"' +
      (t === cur ? ' aria-current="true"' : "") + '><b>' + esc(t.who) + "</b><small>" + esc(t.about) + "</small><span>" + esc(last.text) + "</span></button>";
  }).join("") + "</div>";
  var pane = '<div class="cui-card pv-pane"><div class="pv-pane__head"><b>' + esc(cur.who) + "</b><small>" + esc(cur.about) + "</small></div>" +
    '<div class="pv-msgs">' + cur.msgs.map(function (m){
      return '<div class="pv-msg' + (m.me ? " pv-msg--me" : "") + '">' + (m.from ? "<small>" + esc(m.from) + "</small>" : "") + esc(m.text) + "</div>";
    }).join("") + "</div>" +
    '<form class="pv-compose" data-pvcompose="1"><label class="pv-sr" for="pvReply">Reply to ' + esc(cur.who) + '</label>' +
    '<textarea id="pvReply" rows="2" placeholder="Write a reply"></textarea>' +
    u.Button({ label:"Send", size:"sm", variant:"primary", type:"submit" }) + "</form></div>";
  return page({ key:"inbox", eyebrow:typeof rosterLabel === "function" ? rosterLabel() : "Clients", h1:"Messages", nouns:"families and messages",
    lede:"Every conversation with a family or a whole team, in one place.",
    actions:[u.Button({ label:"New group", size:"lg", variant:"primary", attrs:'data-pvsave="New group"' })],
    body:'<div class="pv-inbox">' + list + pane + "</div>" });
}

/* ── Organization ────────────────────────────────────────────────── */
function orgPage(){
  var u = ui();
  var staff = [
    ["Marcus Vale", "Director, 14U head coach", "verified"],
    ["Dana Ruiz", "16U head coach", "pending"],
    ["Theo Lang", "Strength and conditioning", "none"],
  ];
  var bgBadge = function (s){ return s === "verified" ? badge("Cleared", "good") : s === "pending" ? badge("In progress", "warn") : badge("Not started"); };
  return page({ key:"organization", eyebrow:"Organization", h1:"Organization", nouns:"staff, locations and records",
    lede:"Who runs the club, where the teams practice, and the staff behind them.",
    body:
      u.Block({ title:"Profile", subtitle:"How the club appears to its families.",
        body:u.ListCard([
          { label:u.html("<b>Name</b>"), value:"Northside Flight Basketball", mono:false },
          { label:u.html("<b>Home city</b>"), value:"Chicago, IL", mono:false },
          { label:u.html("<b>Sport</b>"), value:"Basketball", mono:false },
          { label:u.html("<b>Teams</b>"), value:"14U, 16U", mono:false },
        ]),
        action:saveBtn("Edit profile") }) +
      u.Block({ title:"Locations", subtitle:"Where practices and home games happen.",
        body:u.DataTable({
          columns:[{ key:"name", label:"Location" }, { key:"use", label:"Used by" }],
          rows:[
            { name:u.html("<b>Northside Community Gym</b><small>Chicago, IL</small>"), use:"14U practices, home games, 16U Saturday practice" },
            { name:u.html("<b>Lakeview Fieldhouse</b><small>Chicago, IL</small>"), use:"16U weeknight practices" },
          ],
        }) }) +
      u.Block({ title:"Staff", subtitle:"Roles and background-check status. In this sample, the statuses are examples, not real screening results.",
        action:saveBtn("Invite staff"),
        body:u.DataTable({
          columns:[{ key:"name", label:"Name" }, { key:"role", label:"Role" }, { key:"bg", label:"Background check" }],
          rows:staff.map(function (s){ return { name:u.html("<b>" + esc(s[0]) + "</b>"), role:s[1], bg:u.html(bgBadge(s[2])) }; }),
        }) }) });
}

/* ── Hooks the host calls for Home and Schedule ──────────────────── */
function upcoming(){ return events().filter(function (e){ return e.d >= 0; }); }
function homeStats(){
  var t = totals();
  return [
    { label:"Teams", value:String(TEAMS.length), context:"14U and 16U" },
    { label:"Athletes", value:String(ROSTER.length), context:"On current rosters" },
    { label:"Upcoming events", value:String(upcoming().length), context:"Practices, games and a tournament" },
    { label:"Dues collected", value:usd(t.collected), context:"of " + usd(t.billed) + " billed, " + usd(t.overdue) + " overdue" },
  ];
}
function todayRows(){
  var u = ui();
  return upcoming().slice(0, 6).map(function (e){
    return { label:u.html("<b>" + esc(e.title) + "</b><small>" + esc(fmt(e.date) + " · " + e.where) + "</small>"), value:e.time };
  });
}
function scheduleBlock(){
  var u = ui();
  return banner("teams and events") + u.Block({ title:"Upcoming events", subtitle:"Practices, games and tournaments across both teams, soonest first.",
    body:u.DataTable({
      columns:[{ key:"date", label:"Date", mono:true }, { key:"time", label:"Time", mono:true }, { key:"event", label:"Event" },
               { key:"team", label:"Team" }, { key:"where", label:"Location" }],
      rows:upcoming().map(function (e){
        return {
          date:fmt(e.date), time:e.time,
          event:u.html("<b>" + esc(e.title) + "</b>" + (e.conflict ? " " + badge("Conflict", "warn") : "") + (e.note ? "<small>" + esc(e.note) + "</small>" : "")),
          team:e.team, where:e.where,
        };
      }),
    }) });
}

/* ── Wiring: local only, never the network ───────────────────────── */
function wire(){
  if (!on()) return;
  Array.prototype.forEach.call(document.querySelectorAll("[data-pvsave]"), function (b){
    b.onclick = function (ev){ ev.preventDefault(); if (typeof toast === "function") toast("Not saved in the sample workspace."); };
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-pvthread]"), function (b){
    b.onclick = function (){ S.pvThread = b.dataset.pvthread; render(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-pvcompose]"), function (f){
    f.onsubmit = function (ev){ ev.preventDefault(); if (typeof toast === "function") toast("Not saved in the sample workspace."); };
  });
}

var CSS = `
.pv-inbox{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:16px;align-items:start}
.pv-threads{display:flex;flex-direction:column;gap:8px}
.pv-thread{display:flex;flex-direction:column;gap:4px;padding:12px 16px;text-align:left;cursor:pointer;
  border:1px solid var(--cui-line);border-radius:12px;background:var(--cui-panel)}
.pv-thread.on{border-color:var(--cui-steel)}
.pv-thread b{color:var(--cui-ink);font-weight:600}
.pv-thread small{color:var(--cui-ink-3);font-size:var(--fs-fine)}
.pv-thread span{color:var(--cui-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-pane{display:flex;flex-direction:column;gap:16px}
.pv-pane__head{display:flex;flex-direction:column;gap:4px;padding-bottom:12px;border-bottom:1px solid var(--cui-line)}
.pv-pane__head small{color:var(--cui-ink-3);font-size:var(--fs-fine)}
.pv-msgs{display:flex;flex-direction:column;gap:8px}
.pv-msg{max-width:60ch;padding:8px 12px;border:1px solid var(--cui-line);border-radius:12px;color:var(--cui-ink-2);line-height:1.5}
.pv-msg small{display:block;color:var(--cui-ink-3);font-size:var(--fs-fine)}
.pv-msg--me{margin-left:auto;background:var(--cui-panel-2);color:var(--cui-ink)}
.pv-compose{display:flex;gap:8px;align-items:flex-end}
.pv-compose textarea{flex:1;min-width:0;padding:8px 12px;border:1px solid var(--cui-line-2);border-radius:8px;background:transparent;resize:vertical}
.pv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media(max-width:760px){.pv-inbox{grid-template-columns:1fr}}
`;

window.MOD_PREVIEW = {
  css:CSS,
  wire:wire,
  state:{ pvThread:null, pvMoneyTab:"owes" },
  /* host-called; NOT `views` (see header) */
  pages:{ finances:moneyPage, roster:rosterPage, teams:teamsPage, families:familiesPage, inbox:inboxPage, organization:orgPage },
  homeStats:homeStats, todayRows:todayRows, scheduleBlock:scheduleBlock,
  eventCount:function (){ return upcoming().length; },
  _test:{ totals:totals, installments:installments, events:events, roster:ROSTER },
};

})();
