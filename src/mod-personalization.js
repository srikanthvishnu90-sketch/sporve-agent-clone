"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_PERSONALIZATION — Sporv personalization engine (spec 30).

   One layered config per workspace. Templates are pre-filled configs, not
   permission tiers: every add-on module is switchable by any workspace on
   any template (capability parity, owner decision 2026-09-24).

   Pure logic: no DOM, no network, no Supabase. UI modules call into
   window.SporvPersonalization. Safe to load in node via vm for contract
   tests (localStorage access is guarded).

   Layers (low → high precedence):
     1. base template (solo_trainer)
     2. parent templates, left-parent first (diamond precedence)
     3. workspace saved changes
     4. the user's personal overrides
     5. role permissions (hides what the role may not see)

   The chatbox only PROPOSES. Apply is always a human tap, versioned and
   undoable, with compare-and-swap on version.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
const G = typeof globalThis !== "undefined" ? globalThis : this;

/* ---------- small helpers ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function getPath(obj, path){
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (const p of parts){
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function setPath(obj, path, value){
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++){
    const p = parts[i];
    if (!isObj(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}
function delPath(obj, path){
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++){
    cur = cur == null ? undefined : cur[parts[i]];
    if (cur == null) return;
  }
  if (cur != null) delete cur[parts[parts.length - 1]];
}
/* deep merge: source wins on conflicts; arrays are replaced, not merged */
function deepMerge(base, source){
  const out = clone(base);
  for (const k of Object.keys(source || {})){
    if (isObj(source[k]) && isObj(out[k])) out[k] = deepMerge(out[k], source[k]);
    else out[k] = clone(source[k]);
  }
  return out;
}

/* ---------- module catalog ---------- */
const KERNEL = ["calendar","people","payments","inbox","agent","settings"];
const MODULES = {
  /* kernel: always on, cannot be removed */
  calendar:  { kernel:true,  contains:"Sessions and events, availability, recurring bookings, calendar feed" },
  people:    { kernel:true,  contains:"Clients or athletes, parent contacts, notes, tags, history" },
  payments:  { kernel:true,  contains:"Charges, invoices, cash and Venmo logging, refunds, payouts via Stripe Connect" },
  inbox:     { kernel:true,  contains:"Unified email and text threads, agent drafts, one-click send" },
  agent:     { kernel:true,  contains:"Draft queue, rules, activity log, observe and draft mode per job" },
  settings:  { kernel:true,  contains:"Workspace config, connections, vocabulary, roles" },
  /* add-ons: any workspace on any template may switch these on (parity rule) */
  packages:          { contains:"Session bundles, prepaid credits, expiry", requires:["payments"], onByDefault:["solo_trainer"] },
  booking_page:      { contains:"Public link where clients pick open slots", requires:["calendar"], onByDefault:["solo_trainer"] },
  roster:            { contains:"Players per team, positions, jersey numbers, guardians", requires:["people"], onByDefault:["team_coach"] },
  team_messages:     { contains:"Announcements, RSVPs, broadcast by team", requires:["inbox","roster"], onByDefault:["team_coach"] },
  forms_waivers:     { contains:"Waivers, medical forms, e-signatures, expiry tracking", requires:["people"], onByDefault:["team_coach","camp"] },
  registration:      { contains:"Program sign-up forms, deposits, discounts", requires:["payments","forms_waivers"], onByDefault:["camp"] },
  capacity_waitlist: { contains:"Spot limits, waitlist order, auto-offer drafts", requires:["registration"], onByDefault:["camp"] },
  checkin:           { contains:"Daily attendance, pickup authorization", requires:["people"], onByDefault:["camp"] },
  spaces_bookings:   { contains:"Courts, lanes, fields, rental rates, conflicts", requires:["calendar","payments"], onByDefault:["facility"] },
  memberships:       { contains:"Recurring plans, freezes, renewals, failed-payment retry", requires:["payments"], onByDefault:["facility"] },
  multi_team:        { contains:"Team pages, cross-team calendar, conflict detection", requires:["roster"], onByDefault:["club"] },
  staff:             { contains:"Coaches, assignments, eligibility records, pay rates", requires:["people"], onByDefault:["club"] },
  dues_installments: { contains:"Season dues, payment plans, collection tracking", requires:["payments","roster"], onByDefault:["club"] },
  tryouts:           { contains:"Sign-ups, evaluations, offers, accept and decline", requires:["registration","roster"], onByDefault:["club"] },
  gym_finding:       { contains:"Venue list, availability requests, booking records", requires:["calendar"], onByDefault:["club"] },
  approvals:         { contains:"Director sign-off on refunds, discounts, big messages", requires:["agent"], onByDefault:["club"] },
  sites:             { contains:"Multiple locations, each with its own config", requires:["multi_team"], onByDefault:["enterprise"] },
  finance_admin:     { contains:"Roll-up reports, accounting export, audit log, single sign-on", requires:["sites"], onByDefault:["enterprise"] },
  custom_fields:     { contains:"Workspace-defined fields on any object", requires:[], onByDefault:["solo_trainer","team_coach","camp","facility","club","enterprise"] },
};
const ADDON_IDS = Object.keys(MODULES).filter(id => !MODULES[id].kernel);

/* data catalog: the only sources a widget or proposal may reference.
   The model never writes SQL; the server turns specs into parameterized
   queries against these views. */
const DATA_SOURCES = {
  payments: { fields:["id","person","team","amount","status","due_date","paid_at"], filters:["status","team","due_date"], groupBy:["team","status","person"] },
  people:   { fields:["id","name","team","role","tags","guardian","phone","email"], filters:["team","role","tags"], groupBy:["team","role"] },
  sessions: { fields:["id","title","starts_at","ends_at","team","location","attendance"], filters:["team","date"], groupBy:["team","date"] },
  messages: { fields:["id","thread","channel","from","body","needs_reply","draft"], filters:["channel","needs_reply"], groupBy:["channel"] },
  forms:    { fields:["id","person","form","signed","expires_at"], filters:["signed","form"], groupBy:["form"] },
  staff:    { fields:["id","name","role","eligibility","pay_rate"], filters:["role","eligibility"], groupBy:["role"] },
  bookings: { fields:["id","space","starts_at","ends_at","renter","rate","status"], filters:["space","status"], groupBy:["space"] },
};

/* widget primitives: 7 components cover nearly any dashboard request */
const PRIMITIVES = {
  metric:    { shows:"One number with a comparison", options:["source","aggregate","filter","time_range"] },
  table:     { shows:"Rows of records", options:["source","filter","group_by","columns","sort","limit"] },
  chart:     { shows:"Bar or line over time or category", options:["source","aggregate","x","series","time_range"] },
  calendar:  { shows:"Events in day or week view", options:["source","filter","view"] },
  inbox:     { shows:"Message threads with drafts", options:["channel","filter"] },
  checklist: { shows:"Items to complete", options:["source","filter","done_field"] },
};

/* locked paths: the chatbox can never change these (spec §7) */
const LOCKED_PATHS = [
  "agent.autoSend",          /* no auto-send exists; no request can create it */
  "payments.verification",   /* how payment states and badges are calculated */
  "payments.badges",
  "legal.waiverRequired",    /* required parts of legal forms */
  "audit",                   /* the audit log itself */
  "refunds.logic",
  "payouts.settings",
  "roles.owner.removeLast",  /* removing the last Owner or Director */
  "deletion",                /* data deletion happens only in Settings */
];
function isLockedPath(path){
  const p = String(path);
  return LOCKED_PATHS.some(lp => p === lp || p.indexOf(lp + ".") === 0 || p.indexOf(lp + "/") === 0);
}

/* ---------- templates ---------- */
/* A template is a pre-filled config. parents[] order is precedence order:
   the left-most parent wins on diamond conflicts; an explicit child value
   always beats every parent. */
const TEMPLATES = {
  solo_trainer: {
    name:"Solo Trainer", description:"I train athletes 1-on-1 or in small groups.",
    parents:[], billingShape:"Per session, packages",
    vocabulary:{ person:"client", personPlural:"clients", event:"session", eventPlural:"sessions", group:"group" },
    modulesOn:["packages","booking_page","custom_fields"],
    pages:[
      { id:"home", title:"Home", widgets:["w_today","w_owes","w_inbox","w_drafts","w_earnings","w_slots"] },
      { id:"calendar", title:"Calendar", widgets:["w_cal"] },
      { id:"clients", title:"Clients", widgets:["w_clients"] },
      { id:"payments", title:"Payments", widgets:["w_payments"] },
      { id:"inbox", title:"Inbox", widgets:["w_inbox_full"] },
      { id:"agent", title:"Agent", widgets:["w_agentq"] },
    ],
    widgets:{
      w_today:   { type:"calendar", title:"Today's sessions", source:"sessions", filter:{ date:"today" }, view:"day", logic:"Sessions scheduled for today, in time order." },
      w_owes:    { type:"table", title:"Who owes me", source:"payments", filter:{ status:"unpaid" }, columns:["person","amount","due_date"], actions:["draft_reminder"], logic:"Unpaid payments, soonest due first." },
      w_inbox:   { type:"inbox", title:"Messages needing a reply", source:"messages", filter:{ needs_reply:true }, logic:"Threads waiting on you, with agent drafts attached." },
      w_drafts:  { type:"checklist", title:"Agent drafts awaiting approval", source:"messages", filter:{ draft:true }, done_field:"approved", logic:"Drafts the agent wrote. Nothing sends without your tap." },
      w_earnings:{ type:"metric", title:"This week's earnings", source:"payments", aggregate:"sum", filter:{ status:"paid" }, time_range:"week", logic:"Money collected this week." },
      w_slots:   { type:"table", title:"Open slots this week", source:"sessions", filter:{ open:true }, columns:["starts_at","ends_at"], logic:"Bookable openings on your calendar." },
      w_cal:{ type:"calendar", title:"Calendar", source:"sessions", view:"week", logic:"Your full schedule." },
      w_clients:{ type:"table", title:"Clients", source:"people", columns:["name","phone","tags"], logic:"Everyone you train." },
      w_payments:{ type:"table", title:"Payments", source:"payments", columns:["person","amount","status","due_date"], logic:"Every charge, paid or not." },
      w_inbox_full:{ type:"inbox", title:"Inbox", source:"messages", logic:"All email and text threads." },
      w_agentq:{ type:"checklist", title:"Draft queue", source:"messages", filter:{ draft:true }, done_field:"approved", logic:"Everything the agent drafted, awaiting you." },
    },
    agent:{ jobs:{ booking_reply:"draft", payment_reminder:"draft", session_reminder:"draft", reschedule:"draft", weekly_summary:"draft" }, voice:"calm" },
    roles:{ owner:{ can_see:["*"], can_edit:["*"] } },
  },

  team_coach: {
    name:"Team Coach", description:"I run one or two teams.",
    parents:["solo_trainer"], billingShape:"Season fee or installments",
    vocabulary:{ person:"player", personPlural:"players", event:"practice", eventPlural:"practices", game:"game", group:"team" },
    modulesOn:["roster","team_messages","forms_waivers"],
    pages:[
      { id:"roster", title:"Roster", widgets:["w_roster"] },
      { id:"schedule", title:"Schedule", widgets:["w_schedule"] },
      { id:"team_messages", title:"Team Messages", widgets:["w_teaminbox"] },
      { id:"forms", title:"Forms", widgets:["w_forms"] },
    ],
    widgets:{
      w_rsvp:   { type:"table", title:"RSVPs for the next event", source:"sessions", filter:{ rsvp:"pending" }, columns:["person","team"], logic:"Players who have not answered the next event." },
      w_waivers:{ type:"checklist", title:"Missing waivers", source:"forms", filter:{ signed:false }, done_field:"signed", logic:"Players without a signed waiver." },
      w_unpaid_fees:{ type:"table", title:"Unpaid season fees", source:"payments", filter:{ status:"unpaid" }, columns:["person","amount","due_date"], actions:["draft_reminder"], logic:"Season fees still outstanding." },
      w_gameday:{ type:"calendar", title:"Next game logistics", source:"sessions", filter:{ kind:"game" }, view:"day", logic:"The next game, with time and place." },
      w_roster:{ type:"table", title:"Roster", source:"people", columns:["name","team","guardian","phone"], logic:"Every player and guardian." },
      w_schedule:{ type:"calendar", title:"Schedule", source:"sessions", view:"week", logic:"Practices and games." },
      w_teaminbox:{ type:"inbox", title:"Team Messages", source:"messages", filter:{ channel:"team" }, logic:"Announcements and replies, by team." },
      w_forms:{ type:"checklist", title:"Forms", source:"forms", done_field:"signed", logic:"Waivers and medical forms, signed or not." },
    },
    agent:{ jobs:{ gameday_reminder:"draft", rsvp_chase:"draft", waiver_chase:"draft", weather_change:"draft" } },
    roles:{ assistant_coach:{ can_see:["roster","schedule","team_messages"], can_edit:[] } },
  },

  camp: {
    name:"Camp / Clinic", description:"I run camps, clinics, or seasonal programs.",
    parents:["solo_trainer"], billingShape:"One upfront charge, deposits",
    vocabulary:{ person:"camper", personPlural:"campers", event:"session", eventPlural:"sessions", group:"program", week:"week" },
    modulesOn:["registration","capacity_waitlist","checkin","forms_waivers"],
    pages:[
      { id:"programs", title:"Programs", widgets:["w_programs"] },
      { id:"registration", title:"Registration", widgets:["w_capacity","w_waitlist"] },
      { id:"checkin", title:"Check-in", widgets:["w_checkin"] },
      { id:"forms", title:"Forms", widgets:["w_forms_missing"] },
    ],
    widgets:{
      w_capacity:{ type:"metric", title:"Registrations vs capacity", source:"people", aggregate:"count", filter:{ program:"active" }, logic:"Signed up against spots available, per program." },
      w_waitlist:{ type:"table", title:"Waitlist", source:"people", filter:{ waitlist:true }, columns:["name","guardian","phone"], actions:["draft_offer"], logic:"Waitlisted families in order." },
      w_forms_missing:{ type:"checklist", title:"Missing medical or emergency forms", source:"forms", filter:{ signed:false }, done_field:"signed", logic:"Campers missing required forms." },
      w_checkin:{ type:"checklist", title:"Today's check-in list", source:"sessions", filter:{ date:"today" }, done_field:"attendance", logic:"Who is here today." },
      w_programs:{ type:"table", title:"Programs", source:"sessions", columns:["title","starts_at","location"], logic:"Every camp and clinic." },
    },
    agent:{ jobs:{ waitlist_fill:"draft", precamp_sequence:"draft", registration_qa:"draft" } },
    roles:{ staff:{ can_see:["checkin"], can_edit:[] } },
  },

  facility: {
    name:"Facility / Gym", description:"I rent space or sell memberships.",
    parents:["solo_trainer"], billingShape:"Recurring memberships, rentals",
    vocabulary:{ person:"member", personPlural:"members", event:"booking", eventPlural:"bookings", group:"facility" },
    modulesOn:["spaces_bookings","memberships"],
    pages:[
      { id:"spaces", title:"Spaces", widgets:["w_spaces"] },
      { id:"bookings", title:"Bookings", widgets:["w_rentals"] },
      { id:"memberships", title:"Memberships", widgets:["w_renewals","w_failed"] },
    ],
    widgets:{
      w_space_usage:{ type:"chart", title:"Space usage today", source:"bookings", aggregate:"count", x:"space", time_range:"day", logic:"Bookings per space, today." },
      w_rentals:{ type:"table", title:"Upcoming rentals", source:"bookings", filter:{ status:"confirmed" }, columns:["space","starts_at","renter","rate"], logic:"Confirmed rentals coming up." },
      w_renewals:{ type:"table", title:"Memberships renewing this week", source:"people", filter:{ renews:"week" }, columns:["name","phone"], logic:"Members to remind about renewal." },
      w_failed:{ type:"table", title:"Failed payments", source:"payments", filter:{ status:"failed" }, columns:["person","amount"], actions:["draft_reminder"], logic:"Payments that did not go through." },
      w_spaces:{ type:"table", title:"Spaces", source:"bookings", columns:["space","rate"], logic:"Courts, lanes, fields, and rates." },
    },
    agent:{ jobs:{ rental_inquiry:"draft", renewal_reminder:"draft", fill_slots:"draft" } },
    roles:{ front_desk:{ can_see:["bookings","spaces","memberships"], can_edit:[] } },
  },

  club: {
    name:"Club", description:"I run several teams with staff under me.",
    parents:["team_coach","camp"], billingShape:"Dues in installments",
    vocabulary:{ person:"athlete", personPlural:"athletes", event:"practice", eventPlural:"practices", game:"game", group:"team" },
    modulesOn:["multi_team","staff","dues_installments","tryouts","gym_finding","approvals"],
    pages:[
      { id:"teams", title:"Teams", widgets:["w_teams"] },
      { id:"staff", title:"Staff", widgets:["w_staff"] },
      { id:"dues", title:"Dues", widgets:["w_collection"] },
      { id:"tryouts", title:"Tryouts", widgets:["w_tryouts"] },
      { id:"gyms", title:"Gyms", widgets:["w_gyms"] },
      { id:"approvals", title:"Approvals", widgets:["w_approvals"] },
    ],
    widgets:{
      w_collection:{ type:"chart", title:"Collection rate by team", source:"payments", aggregate:"rate", x:"team", time_range:"season", logic:"Share of dues collected, per team." },
      w_staff_eligibility:{ type:"table", title:"Staff eligibility", source:"staff", columns:["name","role","eligibility"], logic:"Recorded eligibility status per staff member." },
      w_gym_conflicts:{ type:"table", title:"Gym bookings and conflicts", source:"bookings", columns:["space","starts_at","team"], logic:"Bookings across teams, conflicts flagged." },
      w_tryouts:{ type:"table", title:"Tryout pipeline", source:"people", filter:{ tryout:true }, columns:["name","guardian"], logic:"Tryout sign-ups and where each stands." },
      w_agent_queue:{ type:"inbox", title:"Agent queue by team", source:"messages", filter:{ draft:true }, logic:"Drafts grouped by team, awaiting approval." },
      w_teams:{ type:"table", title:"Teams", source:"people", group_by:"team", columns:["name","team"], logic:"Every team and its athletes." },
      w_staff:{ type:"table", title:"Staff", source:"staff", columns:["name","role"], logic:"Coaches and staff." },
      w_approvals:{ type:"checklist", title:"Approvals", source:"messages", filter:{ needs_approval:true }, done_field:"approved", logic:"Refunds, discounts, and big messages waiting on a director." },
      w_gyms:{ type:"table", title:"Gyms", source:"bookings", columns:["space","rate","status"], logic:"Venues, rates, and booking records." },
    },
    agent:{ jobs:{ collections_all:"draft", gym_outreach:"draft", staff_scheduling:"draft", tryout_comms:"draft", director_report:"draft" } },
    roles:{
      director:{ can_see:["*"], can_edit:["*"] },
      treasurer:{ can_see:["dues","payments","finance"], can_edit:["dues"] },
      team_manager:{ can_see:["roster","schedule","team_messages"], can_edit:["roster"] },
      coach:{ can_see:["roster","schedule","team_messages"], can_edit:[] },
    },
  },

  enterprise: {
    name:"Enterprise", description:"I run multiple locations or a league.",
    parents:["club","facility"], billingShape:"All of the above, per site",
    vocabulary:{ person:"athlete", personPlural:"athletes", event:"practice", eventPlural:"practices", group:"site" },
    modulesOn:["sites","finance_admin"],
    governance:{ sso:true, auditLog:true },
    pages:[
      { id:"sites", title:"Sites", widgets:["w_sites"] },
      { id:"finance", title:"Finance", widgets:["w_rollup","w_aging"] },
      { id:"reports", title:"Reports", widgets:["w_reports"] },
      { id:"admin", title:"Admin", widgets:["w_admin"] },
      { id:"leagues", title:"Leagues", widgets:["w_leagues"] },
    ],
    widgets:{
      w_rollup:{ type:"chart", title:"Revenue across sites", source:"payments", aggregate:"sum", x:"site", time_range:"month", logic:"Collected revenue per site this month." },
      w_aging:{ type:"table", title:"Aging of unpaid balances", source:"payments", filter:{ status:"unpaid" }, group_by:"site", columns:["person","amount","due_date"], logic:"How long each unpaid balance has waited, per site." },
      w_compliance:{ type:"checklist", title:"Compliance status per site", source:"forms", done_field:"signed", logic:"Required forms and checks, per site." },
      w_anomalies:{ type:"table", title:"Flagged anomalies", source:"payments", filter:{ anomaly:true }, columns:["site","detail"], logic:"Unusual drops or spikes the agent noticed." },
      w_sites:{ type:"table", title:"Sites", source:"people", group_by:"site", columns:["name","site"], logic:"Every location and its athletes." },
      w_reports:{ type:"table", title:"Reports", source:"payments", columns:["site","amount","status"], logic:"Saved roll-up reports." },
      w_admin:{ type:"checklist", title:"Admin", source:"forms", done_field:"signed", logic:"Org-wide settings and locks." },
      w_leagues:{ type:"table", title:"Leagues", source:"sessions", columns:["title","location"], logic:"Leagues and their schedules." },
    },
    agent:{ jobs:{ site_summaries:"draft", anomaly_flags:"draft", accounting_export:"draft" } },
    roles:{
      org_admin:{ can_see:["*"], can_edit:["*"] },
      site_director:{ can_see:["*"], can_edit:["roster","schedule"] },
      finance:{ can_see:["finance","dues","payments","reports"], can_edit:["finance"] },
      compliance:{ can_see:["forms","staff","admin"], can_edit:[] },
    },
  },
};
const TEMPLATE_IDS = Object.keys(TEMPLATES);

/* ---------- layered config resolution ---------- */
/* Template ancestry, base-first (post-order DFS). Diamonds are fine;
   only a true cycle throws. */
function ancestry(templateId){
  const visited = new Set(), visiting = new Set(), order = [];
  const walk = id => {
    if (!TEMPLATES[id]) throw new Error("unknown template: " + id);
    if (visiting.has(id)) throw new Error("template cycle at: " + id);
    if (visited.has(id)) return;
    visiting.add(id);
    TEMPLATES[id].parents.forEach(walk);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  walk(templateId);
  return order;
}

/* Merge template layers with diamond precedence: a child silently beats its
   ancestors; when two sibling parents (neither an ancestor of the other)
   disagree, the left-most parent wins and the path is flagged ambiguous.
   Ambiguous merges are reported, never silent. */
function mergeTemplateLayers(templateId){
  const order = ancestry(templateId); /* base → … → requested */
  const ancestorsOf = id => ancestry(id).slice(0, -1);
  let merged = {};
  const provenance = {}; /* path → template id that set it */
  const ambiguous = [];
  const trackMerge = (target, source, id, prefix) => {
    for (const k of Object.keys(source || {})){
      const path = prefix ? prefix + "." + k : k;
      if (isObj(source[k]) && isObj(target[k])){
        trackMerge(target[k], source[k], id, path);
      } else if (k in target && JSON.stringify(target[k]) !== JSON.stringify(source[k])){
        const holder = provenance[path];
        if (holder && ancestorsOf(id).indexOf(holder) !== -1){
          /* writer is a descendant of the holder: child beats parent */
          target[k] = clone(source[k]);
          provenance[path] = id;
        } else if (holder && holder !== id){
          /* sibling parents disagree: left-most (earlier) wins, flag it */
          ambiguous.push({ path, keptFrom:holder, droppedFrom:id });
        } else {
          target[k] = clone(source[k]);
          provenance[path] = id;
        }
      } else {
        target[k] = clone(source[k]);
        provenance[path] = id;
      }
    }
    return target;
  };
  for (const id of order){
    const t = TEMPLATES[id];
    merged.modulesOn = (merged.modulesOn || []).concat(
      (t.modulesOn || []).filter(m => (merged.modulesOn || []).indexOf(m) === -1));
    merged.pages = (merged.pages || []).concat(
      (t.pages || []).filter(p => (merged.pages || []).map(x => x.id).indexOf(p.id) === -1));
    for (const section of ["vocabulary","widgets","agent","roles","governance","identity"]){
      merged[section] = merged[section] || {};
      trackMerge(merged[section], t[section], id, section);
    }
    merged.billingShape = t.billingShape || merged.billingShape;
    merged.templateName = t.name;
  }
  merged.modulesOn = KERNEL.concat((merged.modulesOn || []).filter(m => KERNEL.indexOf(m) === -1));
  return { merged, ambiguous };
}

/* Full effective config for a user:
   template layers → workspace patch → user overrides → role filter. */
function resolveConfig(opts){
  opts = opts || {};
  const templateId = opts.templateId || "solo_trainer";
  const role = opts.role || "owner";
  const { merged, ambiguous } = mergeTemplateLayers(templateId);
  let config = clone(merged);
  config.templateId = templateId;
  /* workspace saved changes */
  if (opts.workspacePatch) config = applyPatchOps(config, opts.workspacePatch, { skipValidation:true }).config;
  /* personal overrides: layout, notifications, aiProfile — affect one person */
  if (opts.userOverrides){
    const uo = opts.userOverrides;
    if (uo.layout) config.pages = clone(uo.layout.pages || config.pages);
    if (uo.notifications) config.notifications = clone(uo.notifications);
    if (uo.aiProfile) config.agent = deepMerge(config.agent || {}, { voice:uo.aiProfile });
  }
  /* role permissions: hide what the role may not see */
  const roleDef = (config.roles || {})[role];
  if (roleDef && roleDef.can_see && roleDef.can_see.indexOf("*") === -1){
    const allowed = roleDef.can_see;
    config.pages = (config.pages || []).filter(p => allowed.indexOf(p.id) !== -1);
    const widgetIds = {};
    config.pages.forEach(p => (p.widgets || []).forEach(w => { widgetIds[w] = true; }));
    const widgets = {};
    Object.keys(config.widgets || {}).forEach(id => { if (widgetIds[id]) widgets[id] = config.widgets[id]; });
    config.widgets = widgets;
  }
  return { config, mergeReport:{ ambiguous, role } };
}

/* ---------- JSON-patch style ops ---------- */
/* ops: [{op:"add"|"remove"|"replace"|"move", path:"a.b.c", value}]
   Array-valued fields (modulesOn, widgets[], agent.rules, customFields,
   pages) are appended/removed, never overwritten by a scalar. */
function applyPatchOps(config, ops, opts){
  opts = opts || {};
  const out = clone(config);
  for (const op of ops){
    const path = String(op.path || "");
    if (path === "modulesOn"){
      const arr = Array.isArray(out.modulesOn) ? out.modulesOn.slice() : [];
      const id = op.moduleId || op.value;
      if (op.op === "remove"){ const i = arr.indexOf(id); if (i !== -1) arr.splice(i, 1); }
      else if (id && arr.indexOf(id) === -1) arr.push(id);
      out.modulesOn = arr;
      continue;
    }
    if ((path === "customFields" || path === "agent.rules") && op.op === "add"){
      const curArr = getPath(out, path) || [];
      setPath(out, path, curArr.concat([clone(op.value)]));
      continue;
    }
    if (path === "pages" && op.op === "add" && isObj(op.value)){
      out.pages = (out.pages || []).concat([clone(op.value)]);
      continue;
    }
    if (/\.widgets$/.test(path)){
      const arr = getPath(out, path);
      if (Array.isArray(arr)){
        if (op.op === "add" && typeof op.value === "string" && arr.indexOf(op.value) === -1) arr.push(op.value);
        if (op.op === "remove"){
          const i = arr.indexOf(op.widgetId || op.value);
          if (i !== -1) arr.splice(i, 1);
        }
        if (op.op === "move" && op.widgetId){
          const i = arr.indexOf(op.widgetId);
          if (i !== -1){ arr.splice(i, 1); arr.unshift(op.widgetId); }
        }
        continue;
      }
    }
    if (op.op === "add" || op.op === "replace") setPath(out, op.path, clone(op.value));
    else if (op.op === "remove") delPath(out, op.path);
    else if (op.op === "move") { /* non-widget move: no-op, validator flags misuse */ }
    else if (!opts.skipValidation) throw new Error("unknown op: " + op.op);
  }
  return { config:out };
}

/* ---------- the validator ---------- */
/* Every proposal must pass before a preview is shown. Returns
   { ok, errors[], conflicts[] }. A conflict is a question for the user,
   not a refusal. */
const TOP_LEVEL_KEYS = ["identity","modules","modulesOn","vocabulary","pages","widgets","agent","roles","notifications","branding","customFields","governance","templateId","templateName","billingShape"];
const VOCAB_KEYS = ["person","personPlural","event","eventPlural","game","group","week"];
const WORKSPACE_SCOPES = ["modules","modulesOn","vocabulary","agent","roles","branding","customFields","governance","templateId"];
const PERSONAL_SCOPES = ["notifications","aiProfile","layout","pages"];
const MANAGER_ROLES = ["owner","director","org_admin","site_director"];

function topScopeOf(path){
  return String(path).split(".")[0];
}
function requiresManager(path, value){
  const scope = topScopeOf(path);
  if (WORKSPACE_SCOPES.indexOf(scope) !== -1) return true;
  if (scope === "pages" || scope === "widgets") return true; /* shared layout */
  return false;
}
function roleCan(role, path){
  if (MANAGER_ROLES.indexOf(role) !== -1) return true;
  return !requiresManager(path);
}
/* modules a module depends on, transitively */
function moduleDependents(moduleId){
  return ADDON_IDS.filter(id => (MODULES[id].requires || []).indexOf(moduleId) !== -1);
}
function moduleRequirements(moduleId){
  const seen = [];
  const walk = id => {
    (MODULES[id].requires || []).forEach(r => { if (seen.indexOf(r) === -1){ seen.push(r); walk(r); } });
  };
  walk(moduleId);
  return seen;
}

function validateProposal(ops, ctx){
  ctx = ctx || {};
  const errors = [];
  const conflicts = [];
  const role = ctx.role || "owner";
  const config = ctx.config || {};
  const modulesOn = ctx.modulesOn || config.modulesOn || [];
  const existingRules = ((config.agent || {}).rules) || [];
  const lockedSitePaths = ctx.lockedSitePaths || [];

  if (!Array.isArray(ops) || ops.length === 0){
    return { ok:false, errors:["Empty proposal."], conflicts };
  }
  const widgetCount = Object.keys(config.widgets || {}).length; /* informational */
  let addedWidgets = 0;

  for (const op of ops){
    const path = String(op.path || "");
    const scope = topScopeOf(path);
    /* 1. schema: known top-level keys */
    if (TOP_LEVEL_KEYS.indexOf(scope) === -1 && ["add","remove","replace"].indexOf(op.op) !== -1){
      errors.push("Unknown config section: " + scope + ".");
      continue;
    }
    if (["add","remove","replace","move"].indexOf(op.op) === -1){
      errors.push("Unknown operation: " + op.op + ".");
      continue;
    }
    /* 2. locked paths */
    if (isLockedPath(path) || lockedSitePaths.some(lp => path === lp || path.indexOf(lp + ".") === 0)){
      errors.push("That part of the setup is locked and cannot be changed here: " + path + ".");
      continue;
    }
    /* auto-send: there is no auto-send state; any attempt to create one is refused */
    if (/auto.?send/i.test(path) || (typeof op.value === "string" && /auto.?send/i.test(op.value) && /agent/i.test(path))){
      errors.push("There is no auto-send. Drafts always wait for a human tap.");
      continue;
    }
    /* 3. role permission — checked on the server role, never the prompt */
    if (!roleCan(role, path)){
      errors.push("Your role cannot change " + path + ". Ask an owner or director.");
      continue;
    }
    /* 4. module rules */
    if (scope === "templateId"){
      if (!TEMPLATES[op.value]){
        errors.push("Unknown template: " + op.value + ".");
        continue;
      }
    }
    if (scope === "modules" || scope === "modulesOn"){
      const moduleId = op.moduleId || String(op.value || "");
      if (op.op === "remove" || op.value === false){
        if (KERNEL.indexOf(moduleId) !== -1){
          errors.push("The " + moduleId + " module is part of the core and cannot be removed.");
          continue;
        }
        const dependents = moduleDependents(moduleId).filter(d => modulesOn.indexOf(d) !== -1);
        if (dependents.length && !op.cascade){
          errors.push("Turning off " + moduleId + " would break: " + dependents.join(", ") + ". Confirm cascade-off to switch them off too.");
          continue;
        }
      } else {
        if (!MODULES[moduleId]){
          errors.push("Unknown module: " + moduleId + ".");
          continue;
        }
        const missing = moduleRequirements(moduleId).filter(r => modulesOn.indexOf(r) === -1 && KERNEL.indexOf(r) === -1);
        if (missing.length){
          errors.push(moduleId + " needs " + missing.join(", ") + " switched on first.");
          continue;
        }
      }
    }
    /* 5. widget rules */
    if (scope === "widgets" && (op.op === "add" || op.op === "replace")){
      const spec = op.value || {};
      if (!PRIMITIVES[spec.type]){
        errors.push("Unknown widget type: " + spec.type + ".");
        continue;
      }
      if (spec.source && !DATA_SOURCES[spec.source]){
        errors.push("Unknown data source: " + spec.source + ".");
        continue;
      }
      if (spec.columns){
        const fields = (DATA_SOURCES[spec.source] || { fields:[] }).fields;
        const bad = spec.columns.filter(c => fields.indexOf(c) === -1);
        if (bad.length) errors.push("Unknown fields for " + spec.source + ": " + bad.join(", ") + ".");
      }
      addedWidgets++;
    }
    /* 6. vocabulary */
    if (scope === "vocabulary"){
      const key = path.split(".")[1];
      if (key && VOCAB_KEYS.indexOf(key) === -1){
        errors.push("Unknown vocabulary term: " + key + ".");
        continue;
      }
    }
    /* 7. agent rule conflicts → question, not refusal */
    if (scope === "agent" && /rules/.test(path) && typeof op.value === "string"){
      const clash = findRuleConflict(op.value, existingRules);
      if (clash) conflicts.push({ rule:op.value, against:clash, question:"This clashes with an existing rule (" + clash + "). Which should win?" });
    }
  }
  /* 8. limits: 12 widgets per dashboard page; nav capped at max(10,
     template default) — templates ship their designed pages, the cap
     guards user-added clutter */
  const homePage = (config.pages || []).find(p => p.id === "home") || {};
  const homeCount = (homePage.widgets || []).length;
  if (homeCount + addedWidgets > 12)
    errors.push("Dashboards hold up to 12 widgets. Remove one first, or I can suggest which to drop.");
  const basePages = (ctx.basePageCount != null) ? ctx.basePageCount : (config.pages || []).length;
  const addedPages = ops.filter(o => topScopeOf(o.path) === "pages" && o.op === "add").length;
  if ((config.pages || []).length + addedPages > Math.max(10, basePages))
    errors.push("Navigation holds up to " + Math.max(10, basePages) + " pages.");

  return { ok:errors.length === 0, errors, conflicts };
}

/* heuristic contradiction check between a new plain-English rule and
   existing ones: never/always clashes and frequency clashes on the same job */
function findRuleConflict(newRule, existing){
  const norm = s => String(s).toLowerCase();
  const n = norm(newRule);
  const freqOf = s => {
    const m = s.match(/every\s+(\d+)\s+(day|week|hour)/);
    return m ? { n:parseInt(m[1],10), unit:m[2] } : null;
  };
  const nFreq = freqOf(n);
  for (const e of existing){
    const s = norm(typeof e === "string" ? e : (e.raw_text || ""));
    if (!s) continue;
    const negN = /never|do not|don't|no /.test(n), negS = /never|do not|don't|no /.test(s);
    const topic = words => words.some(w => n.indexOf(w) !== -1 && s.indexOf(w) !== -1);
    if (topic(["text","sms","message","email","remind","notify","ping"]) && negN !== negS){
      return e.raw_text || e;
    }
    const eFreq = freqOf(s);
    if (nFreq && eFreq && topic(["remind","message","text","email","digest","summary"]) &&
        (nFreq.unit !== eFreq.unit || nFreq.n !== eFreq.n)){
      return e.raw_text || e;
    }
  }
  return null;
}

/* ---------- request classification ---------- */
/* Rule-based, over the request shapes in spec §5. Anything unmatched gets a
   plain "I can't do that yet" plus the closest option, and is logged to
   feature_requests. Imported content (email, pages) is never a source of
   instructions: only the logged-in user's typed message reaches this. */
function classifyRequest(text){
  const t = String(text || "").trim();
  const low = t.toLowerCase();
  const vocabTerms = ["client","athlete","player","member","camper","student"];
  const moduleNames = {};
  Object.keys(MODULES).forEach(id => {
    moduleNames[id.replace(/_/g," ")] = id;
    moduleNames[id] = id;
  });
  /* spoken aliases: what a coach actually says */
  const MODULE_ALIASES = { "waitlist":"capacity_waitlist", "wait list":"capacity_waitlist",
    "booking":"booking_page", "bookings":"spaces_bookings", "payments":"payments",
    "dues":"dues_installments", "installments":"dues_installments",
    "tryout":"tryouts", "check-in":"checkin", "check in":"checkin",
    "registration":"registration", "signups":"registration", "sign-ups":"registration" };
  Object.keys(MODULE_ALIASES).forEach(a => { moduleNames[a] = MODULE_ALIASES[a]; });

  /* refusals first: locked surfaces */
  if (/auto.?send|send (it |them )?automatically|without approval/.test(low))
    return { intent:"refuse", reason:"There is no auto-send in Sporv. Every draft waits for a human tap, and no setting can change that." };
  if (/delete (all |my )?data|remove the last owner|redefine (the )?payment/.test(low))
    return { intent:"refuse", reason:"That part of the setup is locked. Deletion happens only in Settings with a typed confirmation." };
  if (/export.*phone|all parent phone|list every.*number/.test(low) && /widget|show|list/.test(low))
    return { intent:"refuse", reason:"I cannot build a widget that exports everyone's contact details." };

  /* ambiguous: exactly one clarifying question */
  if (/^show (me )?payments\.?$/.test(low) || low === "payments")
    return { intent:"clarify", question:"This month's income, or who still owes?" };

  let m;
  /* vocabulary: "call them students, not clients" */
  if ((m = low.match(/call them (\w+),?\s+not (\w+)/))){
    const singular = m[1].replace(/s$/, "");
    return { intent:"vocab", person:singular, personPlural:singular + "s",
      summary:"Call them " + singular + "s instead of " + m[2] + "." };
  }
  /* template move: "we're a club now" */
  if ((m = low.match(/(?:we're|we are|switch to|become) an? (\w[\w /-]*?) now/))){
    const tid = TEMPLATE_IDS.find(id => TEMPLATES[id].name.toLowerCase() === m[1].trim() || id === m[1].trim().replace(/ /g,"_"));
    if (tid) return { intent:"template", templateId:tid, summary:"Move to the " + TEMPLATES[tid].name + " template." };
  }
  /* module on/off */
  if ((m = low.match(/(?:switch|turn) on (.+)/))){
    const id = matchModule(m[1]);
    if (id) return { intent:"module_on", moduleId:id, summary:"Switch on " + MODULES[id].contains.split(",")[0] + "." };
  }
  if ((m = low.match(/(?:switch|turn) off (.+)/))){
    const id = matchModule(m[1]);
    if (id) return { intent:"module_off", moduleId:id, summary:"Switch off " + MODULES[id].contains.split(",")[0] + "." };
  }
  if (/starting a summer camp|start.*\bcamp\b/.test(low))
    return { intent:"modules_on", moduleIds:["registration","capacity_waitlist","checkin"], summary:"Switch on Registration, Capacity and Waitlist, and Check-in for the camp." };
  /* agent rule: "never text parents after 8pm" */
  if ((m = low.match(/never (text|message|email|call|ping|notify) (\w+) after (\d+)\s*(pm|am)?/))){
    const hour = parseInt(m[3],10) + (m[4] === "pm" && parseInt(m[3],10) < 12 ? 12 : 0);
    return { intent:"agent_rule", rule:"Never " + m[1] + " " + m[2] + " after " + m[3] + (m[4] || "") + ".",
      compiled:{ channel:m[1], audience:m[2], quietHours:{ start:hour, end:8 } },
      summary:"No " + m[1] + "s to " + m[2] + " after " + m[3] + (m[4] || "") + "." };
  }
  /* agent job off: "stop drafting reminders for private sessions" */
  if ((m = low.match(/stop drafting (.+)/)))
    return { intent:"agent_job", job:m[1].trim(), mode:"off", summary:"Stop drafting " + m[1].trim() + "." };
  /* message style: "sound more casual, sign off as Coach V" */
  if ((m = low.match(/sound more (\w+)/)))
    return { intent:"voice", voice:m[1], summary:"Drafts will sound more " + m[1] + "." };
  if ((m = low.match(/sign off as (.+)/)))
    return { intent:"voice", signoff:m[1].trim().replace(/\.$/,""), summary:"Drafts will sign off as " + m[1].trim().replace(/\.$/,"") + "." };
  /* custom field: "track each player's jersey size" */
  if ((m = low.match(/track (?:each |every )?(\w+)'s (\w[\w ]+)/)))
    return { intent:"custom_field", object:m[1], label:m[2].trim(), summary:"Track " + m[2].trim() + " for each " + m[1] + "." };
  /* role permission: "my assistant can see the schedule but not payments" */
  if ((m = low.match(/my (\w+) can see (.+?) but not (.+)/)))
    return { intent:"role_perm", role:m[1], allow:m[2].trim(), deny:m[3].trim().replace(/\.$/,""), summary:m[1] + " sees " + m[2].trim() + ", not " + m[3].trim().replace(/\.$/,"") + "." };
  /* notification threshold: "only ping me for payments over $200" */
  if ((m = low.match(/only ping me for payments over \$?(\d+)/)))
    return { intent:"notification", threshold:parseInt(m[1],10), summary:"Ping me only for payments over $" + m[1] + "." };
  /* layout: "put the inbox at the top" / "remove earnings" */
  if ((m = low.match(/put (?:the )?(.+?) at the top/))){
    return { intent:"layout_top", widget:m[1].trim(), summary:"Move " + m[1].trim() + " to the top of the dashboard." };
  }
  if ((m = low.match(/remove (.+?) from (?:the )?dashboard/)))
    return { intent:"layout_remove", widget:m[1].trim(), summary:"Remove " + m[1].trim() + " from the dashboard." };
  /* page add: "add a page just for gym bookings" */
  if ((m = low.match(/add a page (?:just )?for (.+)/)))
    return { intent:"page_add", title:m[1].trim(), summary:"Add a page for " + m[1].trim() + "." };
  /* widget: "show who hasn't paid, grouped by team" */
  if (/show who (hasn't|has not) paid/.test(low)){
    const group = /grouped by team/.test(low) ? "team" : undefined;
    return { intent:"widget_add", spec:{ type:"table", title:"Who hasn't paid" + (group ? ", by team" : ""), source:"payments", filter:{ status:"unpaid" }, group_by:group, columns:["person","amount","due_date"], actions:["draft_reminder"], logic:"Unpaid payments" + (group ? ", grouped by team" : "") + ", soonest due first." },
      summary:"A table of unpaid payments" + (group ? ", grouped by team" : "") + "." };
  }
  if (/who owes/.test(low))
    return { intent:"widget_add", spec:{ type:"table", title:"Who owes", source:"payments", filter:{ status:"unpaid" }, columns:["person","amount","due_date"], actions:["draft_reminder"], logic:"Everyone with an unpaid balance." }, summary:"A table of who owes." };
  /* branding */
  if (/logo/.test(low) || /navy|club colou?r|brand/.test(low))
    return { intent:"branding", summary:"Update the club branding." };

  return { intent:"unmatched", closest:"I can change dashboards, pages, modules, wording, agent rules, roles, notifications, and branding. Tell me which one." };

  function matchModule(phrase){
    const p = phrase.toLowerCase().replace(/[.?]$/,"").trim().replace(/^the /,"");
    if (moduleNames[p]) return moduleNames[p];
    const k = Object.keys(moduleNames).find(k => p.indexOf(k) !== -1);
    return k ? moduleNames[k] : null;
  }
}

/* ---------- propose → preview → apply → undo ---------- */
/* Find a widget id on the home dashboard whose title mentions the phrase. */
function findWidgetId(config, phrase){
  const widgets = (config || {}).widgets || {};
  const p = String(phrase || "").toLowerCase();
  const ids = Object.keys(widgets);
  return ids.find(id => (widgets[id].title || "").toLowerCase().indexOf(p) !== -1) || null;
}
function storeGet(){
  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem("sporv:personalization:v1") : null;
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}
function storeSet(state){
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("sporv:personalization:v1", JSON.stringify(state));
  } catch(e){ /* private mode: versioning stays in memory */ }
}
let memStore = null;
let proposalSeq = 0;
function getStore(){
  if (memStore) return memStore;
  memStore = storeGet() || { versions:[], current:0, proposals:[], featureRequests:[] };
  return memStore;
}
function saveStore(){ storeSet(getStore()); }

/* Build ops from a classified intent. Returns { proposal } or
   { refusal } / { clarify } / { unmatched }. */
function proposeChange(text, ctx){
  ctx = ctx || {};
  const role = ctx.role || "owner";
  const config = ctx.config || {};
  const cls = classifyRequest(text);
  if (cls.intent === "refuse") return { refusal:cls.reason };
  if (cls.intent === "clarify") return { clarify:cls.question };
  if (cls.intent === "unmatched"){
    logFeatureRequest(ctx, text, "no matching intent");
    return { unmatched:cls.closest };
  }
  const ops = [];
  let scope = "everyone";
  const wid = "w_" + Math.random().toString(36).slice(2, 8);
  switch (cls.intent){
    case "vocab":
      ops.push({ op:"replace", path:"vocabulary.person", value:cls.person });
      ops.push({ op:"replace", path:"vocabulary.personPlural", value:cls.personPlural });
      break;
    case "template":
      ops.push({ op:"replace", path:"templateId", value:cls.templateId, templateMove:true });
      break;
    case "module_on":
      ops.push({ op:"add", path:"modulesOn", moduleId:cls.moduleId, value:cls.moduleId });
      break;
    case "module_off":
      ops.push({ op:"remove", path:"modulesOn", moduleId:cls.moduleId });
      break;
    case "modules_on":
      cls.moduleIds.forEach(id => ops.push({ op:"add", path:"modulesOn", moduleId:id, value:id }));
      break;
    case "agent_rule":
      ops.push({ op:"add", path:"agent.rules", value:cls.rule, compiled:cls.compiled });
      break;
    case "agent_job":
      ops.push({ op:"replace", path:"agent.jobs." + cls.job.replace(/ /g,"_"), value:cls.mode });
      break;
    case "voice":
      if (cls.voice) ops.push({ op:"replace", path:"agent.voice", value:cls.voice });
      if (cls.signoff) ops.push({ op:"replace", path:"agent.signoff", value:cls.signoff });
      break;
    case "custom_field":
      ops.push({ op:"add", path:"customFields", value:{ object:cls.object, label:cls.label } });
      break;
    case "role_perm": {
      const roleId = cls.role.replace(/ /g,"_");
      ops.push({ op:"replace", path:"roles." + roleId + ".can_see", value:cls.allow.split(/,| and /).map(s => s.trim().replace(/ /g,"_")) });
      break;
    }
    case "notification":
      scope = "just-you";
      ops.push({ op:"replace", path:"notifications.paymentThreshold", value:cls.threshold });
      break;
    case "layout_top": {
      scope = "just-you";
      const wid = findWidgetId(config, cls.widget);
      if (!wid) return { unmatched:"I don't see a widget called \"" + cls.widget + "\" on your dashboard." };
      ops.push({ op:"move", path:"pages.home.widgets", widgetId:wid, to:"top" });
      break;
    }
    case "layout_remove": {
      scope = "just-you";
      const wid = findWidgetId(config, cls.widget);
      if (!wid) return { unmatched:"I don't see a widget called \"" + cls.widget + "\" on your dashboard." };
      ops.push({ op:"remove", path:"pages.home.widgets", widgetId:wid });
      break;
    }
    case "page_add": {
      const id = cls.title.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
      ops.push({ op:"add", path:"pages", value:{ id, title:cls.title, widgets:[] } });
      break;
    }
    case "widget_add":
      ops.push({ op:"add", path:"widgets." + wid, value:cls.spec });
      ops.push({ op:"add", path:"pages.home.widgets", value:wid });
      break;
    case "branding":
      ops.push({ op:"replace", path:"branding.accent", value:"navy" });
      break;
  }
  const basePageCount = (config.templateId && TEMPLATES[config.templateId])
    ? resolveConfig({ templateId:config.templateId }).config.pages.length
    : (config.pages || []).length;
  const validation = validateProposal(ops, { role, config, modulesOn:config.modulesOn || [], basePageCount });
  const store = getStore();
  const proposal = { id:"p_" + Date.now().toString(36) + "_" + (proposalSeq++), request:text, ops, summary:cls.summary,
    scope, baseVersion:store.current, validation, at:new Date().toISOString() };
  store.proposals.push(proposal); saveStore();
  return { proposal };
}

function logFeatureRequest(ctx, text, reason){
  const store = getStore();
  store.featureRequests.push({ workspaceId:ctx.workspaceId || null, request_text:text, reason, at:new Date().toISOString() });
  saveStore();
}

/* Render a proposal as a card: summary, scope line, plain-English ops,
   validation state, Apply / Tweak / Cancel. No emojis, text carries meaning. */
function previewHTML(proposal){
  const v = proposal.validation || { ok:true, errors:[], conflicts:[] };
  const opLines = proposal.ops.map(op => "<li>" + esc(describeOp(op)) + "</li>").join("");
  const errs = (v.errors || []).map(e => "<li>" + esc(e) + "</li>").join("");
  const confs = (v.conflicts || []).map(c => "<li>" + esc(c.question) + "</li>").join("");
  return '<div class="sp-proposal" data-proposal="' + esc(proposal.id) + '">' +
    '<p class="sp-proposal-summary">' + esc(proposal.summary || "") + "</p>" +
    '<p class="sp-proposal-scope">' + (proposal.scope === "just-you" ? "For just you." : "For everyone in the workspace.") + "</p>" +
    "<ul>" + opLines + "</ul>" +
    (errs ? '<p class="sp-proposal-blocked">Cannot apply yet:</p><ul>' + errs + "</ul>" : "") +
    (confs ? '<p class="sp-proposal-conflict">One question:</p><ul>' + confs + "</ul>" : "") +
    (v.ok && !confs ?
      '<div class="sp-proposal-actions"><button type="button" data-apply="' + esc(proposal.id) + '">Apply</button>' +
      '<button type="button" data-tweak="' + esc(proposal.id) + '">Tweak</button>' +
      '<button type="button" data-cancel="' + esc(proposal.id) + '">Cancel</button></div>' : "") +
    "</div>";
}
function describeOp(op){
  if (op.op === "add" && op.moduleId) return "Switch on the " + op.moduleId.replace(/_/g," ") + " module.";
  if (op.op === "remove" && op.moduleId) return "Switch off the " + op.moduleId.replace(/_/g," ") + " module.";
  if (op.path.indexOf("vocabulary.") === 0) return "Rename \"" + op.path.split(".")[1] + "\" to \"" + op.value + "\" everywhere going forward.";
  if (op.path.indexOf("agent.rules") === 0) return "Add agent rule: " + (typeof op.value === "string" ? op.value : "new rule");
  if (op.path.indexOf("agent.jobs.") === 0) return "Set the " + op.path.split(".")[2].replace(/_/g," ") + " job to " + op.value + ".";
  if (op.path === "templateId") return "Move to the " + (TEMPLATES[op.value] ? TEMPLATES[op.value].name : op.value) + " template.";
  return op.op + " " + op.path;
}

/* Apply with compare-and-swap on version. Stale baseVersion → conflict
   with a diff, never a silent overwrite. */
function applyProposal(proposalId, opts){
  opts = opts || {};
  const store = getStore();
  const proposal = store.proposals.find(p => p.id === proposalId);
  if (!proposal) return { ok:false, errors:["Proposal not found."] };
  if (proposal.baseVersion !== store.current){
    return { ok:false, conflict:true,
      message:"The workspace changed since this preview. Review the diff, then merge, overwrite, or cancel.",
      diff:diffVersions(store.versions[proposal.baseVersion], store.versions[store.current]) };
  }
  const cur = store.versions[store.current];
  const base = cur ? cur.config : {};
  const basePageCount = (base.templateId && TEMPLATES[base.templateId])
    ? resolveConfig({ templateId:base.templateId }).config.pages.length
    : (base.pages || []).length;
  const validation = validateProposal(proposal.ops, { role:opts.role || "owner", config:base, modulesOn:base.modulesOn || [], basePageCount });
  if (!validation.ok) return { ok:false, errors:validation.errors };
  const { config:next } = applyPatchOps(base, proposal.ops);
  /* template moves rebuild from the new template, then re-apply the
     workspace's own later patches (downgrade archives, never deletes) */
  const tplOp = proposal.ops.find(o => o.templateMove);
  let finalConfig = next;
  if (tplOp){
    const rebuilt = resolveConfig({ templateId:tplOp.value, role:opts.role || "owner" }).config;
    /* replay every op the workspace applied after its seed, so a template
       move keeps customizations instead of silently dropping them */
    const priorOps = [];
    for (let i = 0; i < store.versions.length; i++){
      const v = store.versions[i];
      if (v.source === "template"){ priorOps.length = 0; continue; }
      (v.ops || []).forEach(o => { if (!o.templateMove) priorOps.push(o); });
    }
    finalConfig = priorOps.length
      ? applyPatchOps(rebuilt, priorOps, { skipValidation:true }).config
      : rebuilt;
    finalConfig._archivedFrom = base.templateId || null;
  }
  store.versions.push({ version:store.versions.length, config:finalConfig,
    author:opts.author || null, source:"chat", request:proposal.request, at:new Date().toISOString(),
    ops:clone(proposal.ops || []) });
  store.current = store.versions.length - 1;
  proposal.status = "applied";
  saveStore();
  return { ok:true, version:store.current };
}
function undo(){
  const store = getStore();
  if (store.current <= 0) return { ok:false, errors:["Nothing to undo."] };
  store.current -= 1;
  saveStore();
  return { ok:true, version:store.current };
}
/* Restore an exact version by index. Appends a new version (audit trail
   stays append-only) instead of moving the pointer, so "current" is always
   the last version and the badge never lies. */
function restoreVersion(idx){
  const store = getStore();
  const v = store.versions[idx];
  if (!v) return { ok:false, errors:["Version " + idx + " does not exist."] };
  store.versions.push({ version:store.versions.length, config:clone(v.config),
    author:null, source:"restore", request:"restore version " + idx, at:new Date().toISOString() });
  store.current = store.versions.length - 1;
  saveStore();
  return { ok:true, version:store.current };
}
function currentVersion(){
  return getStore().current;
}
function versions(){
  const store = getStore();
  return store.versions.map(v => ({ version:v.version, source:v.source, request:v.request || null, at:v.at }));
}
function currentConfig(){
  const store = getStore();
  const v = store.versions[store.current];
  return v ? clone(v.config) : null;
}
function seedWorkspace(templateId, author){
  const { config } = resolveConfig({ templateId });
  const store = getStore();
  store.versions = [{ version:0, config, author:author || null, source:"template", at:new Date().toISOString() }];
  store.current = 0;
  /* A reseed invalidates every pending proposal: their baseVersion indexes
     point at versions that no longer exist. Drop them, never apply stale. */
  store.proposals = [];
  saveStore();
  return clone(config);
}
/* Append an already-computed config as a new version. Used by onboarding
   and settings surfaces that build the config directly instead of going
   through a chat proposal. Every write still lands in the same history. */
function commitConfig(config, meta){
  meta = meta || {};
  const store = getStore();
  store.versions.push({ version:store.versions.length, config:clone(config),
    author:meta.author || null, source:meta.source || "direct",
    request:meta.request || null, at:new Date().toISOString(),
    ops:clone(meta.ops || []) });
  store.current = store.versions.length - 1;
  saveStore();
  return store.current;
}
/* ---------- per-person store (the five personal layers) ----------
   personal = {
     layout: { density:"comfortable", homeTab:"dashboard" },
     notifications: { quietStart:"21:00", quietEnd:"08:00", paymentAlerts:true, draftAlerts:true },
     aiProfile: { tone:"calm", vocabulary:{}, format:"bullets", signoff:"" },
     memory: { enabled:true, items:[ {id, text, at} ] }
   }
   Stored beside the workspace versions, never synced anywhere. */
function getPersonal(){
  const store = getStore();
  if (!store.personal) store.personal = { layout:{ density:"comfortable", homeTab:"dashboard" },
    notifications:{ quietStart:"21:00", quietEnd:"08:00", paymentAlerts:true, draftAlerts:true },
    aiProfile:{ tone:"calm", vocabulary:{}, format:"bullets", signoff:"" },
    memory:{ enabled:true, items:[] } };
  return clone(store.personal);
}
function setPersonal(patch){
  const store = getStore();
  const cur = getPersonal();
  store.personal = deepMerge(cur, patch || {});
  saveStore();
  return clone(store.personal);
}
function memoryItems(){ return getPersonal().memory.items || []; }
function memorySetEnabled(on){
  return setPersonal({ memory:{ enabled:!!on } });
}
function memoryUpdate(id, text){
  const per = getPersonal();
  const it = (per.memory.items || []).find(x => x.id === id);
  if (!it) return { ok:false };
  it.text = String(text).slice(0, 500);
  return setPersonal({ memory:{ items:per.memory.items } }), { ok:true };
}
function memoryDelete(id){
  const per = getPersonal();
  const items = (per.memory.items || []).filter(x => x.id !== id);
  setPersonal({ memory:{ items } });
  return { ok:true };
}
function diffVersions(a, b){
  if (!a || !b) return "One side is missing.";
  const changed = [];
  const cmp = (pa, pb, prefix) => {
    const keys = {};
    Object.keys(pa || {}).concat(Object.keys(pb || {})).forEach(k => { keys[k] = true; });
    Object.keys(keys).forEach(k => {
      const path = prefix ? prefix + "." + k : k;
      const va = (pa || {})[k], vb = (pb || {})[k];
      if (isObj(va) && isObj(vb)) cmp(va, vb, path);
      else if (JSON.stringify(va) !== JSON.stringify(vb)) changed.push(path);
    });
  };
  cmp(a.config, b.config, "");
  return changed.length ? "Changed: " + changed.slice(0, 20).join(", ") : "No differences.";
}

/* ---------- vocabulary ---------- */
/* Forward-looking only: UI labels and new drafts. Historical records are
   never rewritten (spec §6.8 gap closure). */
const DEFAULT_TERMS = { client:"person", clients:"personPlural", session:"event", sessions:"eventPlural",
  practice:"event", practices:"eventPlural", player:"person", players:"personPlural",
  athlete:"person", athletes:"personPlural", member:"person", members:"personPlural",
  camper:"person", campers:"personPlural", team:"group", teams:"group" };
function vocabLookup(text, vocabulary){
  let out = String(text == null ? "" : text);
  vocabulary = vocabulary || {};
  Object.keys(DEFAULT_TERMS).forEach(term => {
    const key = DEFAULT_TERMS[term];
    const replacement = vocabulary[key];
    if (replacement && replacement !== term){
      out = out.replace(new RegExp("\\b" + term + "\\b", "gi"), match =>
        match[0] === match[0].toUpperCase() ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement);
    }
  });
  return out;
}

/* ---------- widget rendering (honest empty states) ---------- */
function renderWidget(id, spec, vocabulary){
  const title = esc(vocabLookup(spec.title || id, vocabulary));
  const logic = esc(spec.logic || "");
  const body = '<p class="sp-widget-empty">Nothing here yet. ' + esc(emptyHint(spec)) + "</p>";
  return '<section class="sp-widget sp-widget--' + esc(spec.type || "table") + '" data-widget="' + esc(id) + '">' +
    '<h3>' + title + "</h3>" + body +
    (logic ? '<p class="sp-widget-logic">' + logic + ' <button type="button" data-edit-widget="' + esc(id) + '">Edit</button></p>' : "") +
    "</section>";
}
function emptyHint(spec){
  switch (spec.source){
    case "payments": return "Payments will appear here once recorded.";
    case "people": return "People will appear here once added.";
    case "sessions": return "Sessions will appear here once scheduled.";
    case "messages": return "Messages will appear here once connected.";
    case "forms": return "Forms will appear here once sent.";
    case "staff": return "Staff will appear here once added.";
    case "bookings": return "Bookings will appear here once made.";
    default: return "Data will appear here once available.";
  }
}

/* ---------- export ---------- */
G.SporvPersonalization = {
  TEMPLATES, TEMPLATE_IDS, MODULES, KERNEL, ADDON_IDS, PRIMITIVES, DATA_SOURCES,
  LOCKED_PATHS, TOP_LEVEL_KEYS,
  ancestry, mergeTemplateLayers, resolveConfig, applyPatchOps,
  validateProposal, findRuleConflict, moduleDependents, moduleRequirements,
  classifyRequest, proposeChange, previewHTML, describeOp, applyProposal,
  undo, restoreVersion, currentVersion, versions, currentConfig, seedWorkspace, commitConfig, diffVersions, logFeatureRequest,
  getPersonal, setPersonal, memoryItems, memorySetEnabled, memoryUpdate, memoryDelete,
  vocabLookup, renderWidget, findWidgetId,
  _helpers:{ clone, getPath, setPath, deepMerge, esc },
};
})();
