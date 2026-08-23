"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_COACHOPS — coach operations for the Sporv web portal.
   Four tabs that mount inside the existing coach dash (left rail +
   body): Policies, Waitlist, Recurring slots, Automated messages.

   Host contract used (never redefined here):
     S, render(), toast(), esc(), money(), fmtDate(), slotsFor(),
     modelLabel(), PROGRAMS, SEED, sportColor(), sportGlyph(), ICON.

   The demo clock is pinned to the app's seeded "today" (2026-08-03)
   so that waiting times and offer expiries stay coherent with the
   seeded bookings instead of drifting against the real wall clock.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ── clock ───────────────────────────────────────────────────────── */
const NOW = () => new Date(2026, 7, 3, 9, 30);          // Mon 3 Aug 2026, 9:30am
const iso = d => d.toISOString();
const TODAY = "2026-08-03";

/* ── time helpers (24h "HH:MM" is the storage form) ──────────────── */
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toMin = t => { const m = HHMM.exec(String(t)); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
const fromMin = n => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
const t12 = t => {
  const n = toMin(t); if (isNaN(n)) return String(t);
  let h = Math.floor(n / 60); const m = n % 60, ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ap;
};
const durLabel = mins => {
  if (mins < 60) return mins + " min";
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? h + " hr " + m + " min" : h + " hr";
};
/* elapsed since an ISO stamp, measured against the pinned demo clock */
function since(isoStr){
  const ms = NOW() - new Date(isoStr);
  if (!isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + " min";
  const hr = Math.floor(min / 60);
  if (hr < 48) return hr + " hr";
  const d = Math.floor(hr / 24);
  return d + " d " + (hr - d * 24) + " hr";
}
/* remaining until an ISO stamp; null once it has passed */
function until(isoStr){
  const ms = new Date(isoStr) - NOW();
  if (!isFinite(ms) || ms <= 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + " min";
  return Math.floor(min / 60) + " hr " + (min % 60) + " min";
}
const stamp = d => d.toLocaleString("en-US",
  { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const WD = [
  { n: 1, s: "Mon", l: "Monday" }, { n: 2, s: "Tue", l: "Tuesday" }, { n: 3, s: "Wed", l: "Wednesday" },
  { n: 4, s: "Thu", l: "Thursday" }, { n: 5, s: "Fri", l: "Friday" }, { n: 6, s: "Sat", l: "Saturday" },
  { n: 7, s: "Sun", l: "Sunday" },
];
const wdName = n => (WD.find(w => w.n === n) || { l: "—" }).l;
const wdShort = n => (WD.find(w => w.n === n) || { s: "—" }).s;

/* Resolves against the live catalogue first, then the seeded one. Once
   mod-catalog.js swaps PROGRAMS for live rows, every id this module holds —
   notes, media, roster entries — is a seeded "prog_N" that no live row
   matches, and a bare PROGRAMS.find() would start returning null everywhere. */
const prog = id => PROGRAMS.find(p => p.id === id) ||
                   DEMO_CATALOGUE.find(p => p.id === id) || null;
/* The coach portal is still sample data (Phase E makes it live), so it owns
   seeded listings. Filtering the LIVE catalogue by S.listings returns nothing
   and the `|| PROGRAMS[0]` fallbacks below would then hand this demo coach a
   real provider's listing to manage — one operator shown another operator's
   business. DEMO_CATALOGUE keeps that boundary explicit. */
const myListings = () => DEMO_CATALOGUE.filter(p => S.listings.includes(p.id));

/* ═══════════════════ POLICY VOCABULARY ═══════════════════ */
/* Exactly three cancellation policies; each carries its real consequence. */
const CANCEL = [
  ["flexible", "Flexible",
   "Full refund up to 24 hours before the session starts. Inside 24 hours the session is charged in full."],
  ["moderate", "Moderate",
   "Full refund up to 3 days before the session starts. Within 3 days, 50% of the price is refunded."],
  ["strict", "Strict",
   "50% refund up to 7 days before the session starts. Inside 7 days no refund is issued."],
];
const cancelRow = k => CANCEL.find(c => c[0] === k) || CANCEL[1];

const WEATHER = [
  ["makeup", "Make-up session", "Weather cancellations are rescheduled into the next open slot at no extra charge."],
  ["credit", "Session credit", "Weather cancellations become a session credit, good for 90 days."],
  ["refund", "Full refund", "Weather cancellations are refunded in full within 5 business days."],
  ["discretion", "Case by case", "The coach decides after each cancellation and contacts you directly."],
];
const weatherRow = k => WEATHER.find(w => w[0] === k) || WEATHER[0];

/* ═══════════════════ AUTOMATED MESSAGE VOCABULARY ═══════════════════ */
const PLACEHOLDERS = ["athlete_first_name", "session_date", "session_time", "coach_name", "program_title"];
const TRIGGERS = [
  ["booking_confirmed",    "Booking confirmed",    "Sends the moment checkout completes."],
  ["session_reminder_24h", "Reminder — 24 hours",  "Sends 24 hours before the session start time."],
  ["session_reminder_2h",  "Reminder — 2 hours",   "Sends 2 hours before the session start time."],
  ["post_session_recap",   "Post-session recap",   "Sends 1 hour after the session ends."],
  ["waitlist_offer",       "Waitlist offer",       "Sends when you offer a waitlist spot. The offer expires in 24 hours."],
  ["payment_receipt",      "Payment receipt",      "Sends when a payment or renewal is charged."],
  ["cancellation_notice",  "Cancellation notice",  "Sends when you or the family cancels a booked session."],
];
const trigRow = k => TRIGGERS.find(t => t[0] === k) || [k, k, ""];

/* real values pulled from the seeded booking — never invented */
function sampleValues(){
  const b = (S.bookings && S.bookings[0]) || SEED.bookings[0];
  const u = S.auth && S.auth.user;
  const coach = (u && u.role === "provider" && u.firstName)
    ? (u.firstName + " " + (u.lastName || "")).trim()
    : ((typeof coachBusinessName==="function")?coachBusinessName():SEED.providerProfile.businessName);
  return {
    athlete_first_name: String(b.athlete || "").split(" ")[0] || b.athlete,
    session_date: fmtDate(b.date),
    session_time: b.startTime,
    coach_name: coach,
    program_title: b.program,
  };
}
const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
function unknownTokens(body){
  const bad = [];
  String(body).replace(TOKEN, (_, name) => {
    if (PLACEHOLDERS.indexOf(name) < 0 && bad.indexOf(name) < 0) bad.push(name);
    return _;
  });
  return bad;
}
function substitute(body){
  const v = sampleValues();
  return String(body).replace(TOKEN, (whole, name) =>
    Object.prototype.hasOwnProperty.call(v, name) ? v[name] : whole);
}

/* ═══════════════════ SEEDS ═══════════════════ */

/* Programs at or near capacity — a waitlist only exists where enrolled
   has reached cap - 2 or better. Computed, not hand-picked. */
function nearFull(){
  const byFill = (a, b) => (b.enrolled / b.cap) - (a.enrolled / a.cap);
  const pool = PROGRAMS.filter(p => p.enrolled >= p.cap - 2);
  return (pool.length ? pool : PROGRAMS.slice().sort(byFill).slice(0, 3)).sort(byFill);
}
function seedWaitlist(){
  const pool = nearFull();
  const pick = i => pool[i % pool.length].id;
  const people = [
    ["Renata Okafor", "Nia Okafor", 13, "2026-07-21T14:10:00.000Z", "Both", "waiting"],
    ["Daniel Whitfield", "Cole Whitfield", 12, "2026-07-24T09:05:00.000Z", "Email", "waiting"],
    ["Priya Raman", "Aarav Raman", 14, "2026-07-27T18:40:00.000Z", "Text", "offered"],
    ["Marisol Ibarra", "Sofia Ibarra", 11, "2026-07-29T11:25:00.000Z", "Both", "waiting"],
    ["Grant Feeney", "Owen Feeney", 15, "2026-07-30T20:02:00.000Z", "Email", "accepted"],
    ["Alicia Boateng", "Kwame Boateng", 13, "2026-08-01T08:47:00.000Z", "Text", "expired"],
    ["Tomas Nilsen", "Ida Nilsen", 12, "2026-08-02T16:33:00.000Z", "Both", "waiting"],
  ];
  return people.map((p, i) => {
    const e = {
      id: "wl_" + (i + 1), programId: pick(i), parent: p[0], athlete: p[1],
      athleteAge: p[2], joinedAt: p[3], via: p[4], status: p[5],
      offeredAt: null, expiresAt: null,
    };
    if (e.status === "offered") {                 // live offer, still inside its window
      e.offeredAt = "2026-08-03T02:00:00.000Z";
      e.expiresAt = "2026-08-04T02:00:00.000Z";
    }
    if (e.status === "accepted") {
      e.offeredAt = "2026-08-01T15:00:00.000Z";
      e.expiresAt = "2026-08-02T15:00:00.000Z";
    }
    if (e.status === "expired") {                 // offer sent, window closed unanswered
      e.offeredAt = "2026-08-01T09:00:00.000Z";
      e.expiresAt = "2026-08-02T09:00:00.000Z";
    }
    return e;
  });
}

function seedSlots(){
  const mine = myListings();
  const at = i => (mine[i] || DEMO_CATALOGUE[i] || DEMO_CATALOGUE[0]).id;
  const capOf = i => (mine[i] || DEMO_CATALOGUE[i] || DEMO_CATALOGUE[0]).cap;
  return [
    { id: "rs_1", name: "Monday evening squad", programId: at(0), weekday: 1, start: "17:00", end: "18:30", capacity: capOf(0), effectiveFrom: "2026-08-03", effectiveUntil: "2026-11-27" },
    { id: "rs_2", name: "Midweek evening squad", programId: at(0), weekday: 3, start: "17:00", end: "18:30", capacity: capOf(0), effectiveFrom: "2026-08-03", effectiveUntil: "2026-11-27" },
    { id: "rs_3", name: "Tuesday skills block", programId: at(1), weekday: 2, start: "16:00", end: "17:30", capacity: capOf(1), effectiveFrom: "2026-08-03", effectiveUntil: "2026-12-18" },
    /* deliberately overlaps rs_1 by 30 minutes so the conflict check has something honest to find */
    { id: "rs_4", name: "Monday late session", programId: at(2), weekday: 1, start: "18:00", end: "19:30", capacity: capOf(2), effectiveFrom: "2026-08-10", effectiveUntil: "2026-11-27" },
    { id: "rs_5", name: "Saturday morning club", programId: at(4), weekday: 6, start: "10:00", end: "11:00", capacity: capOf(4), effectiveFrom: "2026-08-08", effectiveUntil: "2026-12-19" },
  ];
}

function seedMessages(){
  const body = {
    booking_confirmed:
      "Hi {{athlete_first_name}} is booked into {{program_title}} on {{session_date}} at {{session_time}}. " +
      "Arrive ten minutes early so we can start on time. — {{coach_name}}",
    session_reminder_24h:
      "Reminder: {{athlete_first_name}} has {{program_title}} tomorrow, {{session_date}}, at {{session_time}}. " +
      "Reply here if anything changes. — {{coach_name}}",
    session_reminder_2h:
      "{{program_title}} starts in about two hours — {{session_time}} today. See {{athlete_first_name}} on the field.",
    post_session_recap:
      "Great work today from {{athlete_first_name}} at {{program_title}}. Your full session note is in the Sporv app. — {{coach_name}}",
    waitlist_offer:
      "A spot just opened in {{program_title}} on {{session_date}} at {{session_time}}. " +
      "It is held for {{athlete_first_name}} for the next 24 hours — accept in the app to claim it.",
    payment_receipt:
      "Payment received for {{program_title}} ({{session_date}}). Your receipt is in the Sporv app under Bookings. — {{coach_name}}",
    cancellation_notice:
      "{{program_title}} on {{session_date}} at {{session_time}} has been cancelled. " +
      "Refunds follow the cancellation policy shown on the listing. — {{coach_name}}",
  };
  const on = { booking_confirmed: true, session_reminder_24h: true, session_reminder_2h: false,
    post_session_recap: true, waitlist_offer: true, payment_receipt: true, cancellation_notice: true };
  return TRIGGERS.map(([k]) => ({ trigger: k, enabled: !!on[k], body: body[k] }));
}

/* ═══════════════════ STATE ═══════════════════ */
const state = {
  policies: {
    cancellation: "moderate",
    graceMinutes: 10,
    noShowFee: 25,
    weather: "makeup",
    minAgeOverride: null,
    equipment: "Athletes bring their own water bottle, shin guards, and molded cleats. Bibs and balls are provided.",
    savedAt: null,
  },
  waitlistEntries: seedWaitlist(),
  recurringSlots: seedSlots(),
  /* Range drawn on the grid, held between pointerup and the naming modal being
     submitted. Nothing is written to recurringSlots until the coach names it,
     so an abandoned modal leaves no half-made rule behind. */
  pendingSlot: null,
  autoMessages: seedMessages(),
};

/* ═══════════════════ DERIVED LOGIC ═══════════════════ */

/* An offer that ran past its 24-hour window reads as expired without
   anyone having to touch the record. */
function effStatus(e){
  if (e.status === "offered" && e.expiresAt && new Date(e.expiresAt) <= NOW()) return "expired";
  return e.status;
}
const STATUS_PILL = { waiting: ["slate", "Waiting"], offered: ["warn", "Offer sent"],
  accepted: ["good", "Accepted"], expired: ["warn", "Offer expired"] };

/* Queue position within a program, oldest first. Only an athlete who
   accepted has left the line — an expired offer keeps its place and can
   be re-offered. */
function position(e){
  const peers = state.waitlistEntries
    .filter(x => x.programId === e.programId && effStatus(x) !== "accepted")
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const i = peers.findIndex(x => x.id === e.id);
  return i < 0 ? null : i + 1;
}
function statusCounts(){
  const c = { waiting: 0, offered: 0, accepted: 0, expired: 0 };
  state.waitlistEntries.forEach(e => { c[effStatus(e)]++; });
  return c;
}

/* Two rules clash when they fall on the same weekday, their effective
   date windows overlap, and their time ranges genuinely intersect.
   The reported overlap is the real intersection, in minutes. */
function windowsOverlap(a, b){
  const aFrom = a.effectiveFrom || "0000-01-01", aTo = a.effectiveUntil || "9999-12-31";
  const bFrom = b.effectiveFrom || "0000-01-01", bTo = b.effectiveUntil || "9999-12-31";
  return aFrom <= bTo && bFrom <= aTo;
}
function conflicts(){
  const out = [], rs = state.recurringSlots;
  for (let i = 0; i < rs.length; i++){
    for (let j = i + 1; j < rs.length; j++){
      const a = rs[i], b = rs[j];
      if (a.weekday !== b.weekday) continue;
      if (!windowsOverlap(a, b)) continue;
      const s = Math.max(toMin(a.start), toMin(b.start));
      const e = Math.min(toMin(a.end), toMin(b.end));
      if (isNaN(s) || isNaN(e) || s >= e) continue;
      out.push({ a: a, b: b, start: fromMin(s), end: fromMin(e), minutes: e - s });
    }
  }
  return out;
}
const covers = (r, weekday, hour) =>
  r.weekday === weekday && toMin(r.start) < (hour + 1) * 60 && toMin(r.end) > hour * 60;
function rulesAt(weekday, hour){ return state.recurringSlots.filter(r => covers(r, weekday, hour)); }
function clashAt(weekday, hour){
  return conflicts().some(c =>
    c.a.weekday === weekday && toMin(c.start) < (hour + 1) * 60 && toMin(c.end) > hour * 60);
}
const GRID_START = 7, GRID_END = 21;                       // 7am → 9pm rows

/* Quarter-hour resolution. The grid used to be one row per hour, so a block
   could only ever start and end on the hour; a session finishing at 9:15 was
   unrepresentable. Rows are now 15 minutes, which makes quarter / half /
   three-quarter fills fall out of the same mechanism as a full hour — a block
   is just a run of consecutive rows. */
const SLOT_MIN = 15;
const coversMin = (r, weekday, mn) =>
  r.weekday === weekday && toMin(r.start) < mn + SLOT_MIN && toMin(r.end) > mn;
function rulesAtMin(weekday, mn){ return state.recurringSlots.filter(r => coversMin(r, weekday, mn)); }
function clashAtMin(weekday, mn){
  return conflicts().some(c =>
    c.a.weekday === weekday && toMin(c.start) < mn + SLOT_MIN && toMin(c.end) > mn);
}

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
.co-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:18px 0 6px;flex-wrap:wrap}
.co-lede{color:var(--muted);font-size:var(--text-base);max-width:64ch;margin-top:5px}
.co-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,360px);gap:20px;align-items:start;margin-top:16px}
.co-note{background:var(--raise);border-radius:var(--r-m);padding:13px 15px;font-size:var(--text-sm);color:var(--ink-2)}
.co-opts{display:flex;flex-direction:column;gap:10px;margin:0 0 18px}
.co-opt{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1.5px solid var(--rule);
  border-radius:var(--r-m);cursor:pointer;transition:border-color .14s,background .14s}
.co-opt:hover{border-color:var(--rule-strong);background:var(--raise)}
.co-opt input{width:17px;height:17px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--slate)}
.co-opt.on{border-color:var(--slate);background:var(--slate-tint)}
.co-opt b{font-size:var(--text-base);letter-spacing:-.015em}
.co-opt span{display:block;font-size:var(--text-sm);color:var(--muted);line-height:1.45;margin-top:2px}
.co-grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.co-help{font-size:var(--text-sm);color:var(--faint);margin-top:-10px;margin-bottom:16px}
.co-prev{position:sticky;top:104px;border:1px solid var(--rule-strong);border-radius:var(--r-l);
  padding:20px;background:var(--paper)}
.co-prevhead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
.co-prevline{padding:11px 0;border-top:1px solid var(--rule);font-size:var(--text-base);color:var(--ink-2)}
.co-prevline:first-of-type{border-top:0}
.co-prevline b{display:block;color:var(--ink);font-size:var(--text-sm);margin-bottom:2px}
.co-pos{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;
  background:var(--raise2);color:var(--ink-2);font-size:var(--text-sm);font-weight:700}
.co-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 4px}
.co-gridwrap{border:1px solid var(--rule);border-radius:var(--r-l);padding:14px;background:var(--paper);margin-top:14px}
.co-week{display:grid;grid-template-columns:64px repeat(7,minmax(74px,1fr));gap:0 4px;min-width:620px}
.co-day{font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);
  text-align:center;padding-bottom:4px}
/* One row per quarter hour: only the :00 row is labelled, and only it carries a
   visible top rule, so an hour still reads as one band of four cells. */
.co-hh{font-size:var(--text-xs);color:var(--faint);text-align:right;padding-right:8px;line-height:15px}
.co-cell{height:15px;border:1px solid transparent;border-top:1px solid var(--rule-soft,rgba(0,0,0,.06));
  background:var(--paper);padding:0;width:100%;
  transition:background .1s,border-color .1s;touch-action:none}
.co-cell.co-hourtop{border-top:1px solid var(--rule)}
.co-cell:hover{background:var(--raise)}
.co-cell.on{border-color:transparent;background:var(--cc);box-shadow:inset 0 0 0 1px var(--rule)}
.co-cell.on.co-hourtop{border-top-color:transparent}
.co-cell.clash{box-shadow:inset 0 0 0 2px var(--danger)}
/* live drag preview — painted directly, without a re-render per pointer move */
.co-cell.sel{background:var(--slate-tint,rgba(83,104,120,.22));box-shadow:inset 0 0 0 1px var(--slate)}
.co-draghint{font-size:var(--text-sm);color:var(--muted);margin-top:10px}
.co-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:var(--text-sm);color:var(--muted)}
.co-legend i{width:11px;height:11px;border-radius:3px;display:inline-block;vertical-align:-1px;margin-right:6px}
.co-alert{border:1px solid var(--danger);border-radius:var(--r-m);padding:14px 16px;margin-top:16px;
  background:color-mix(in srgb,var(--danger) 7%,transparent)}
.co-alert h4{margin:0 0 8px;font-size:var(--text-base);color:var(--danger);letter-spacing:-.015em}
.co-alert li{font-size:var(--text-sm);color:var(--ink-2);margin-top:5px;line-height:1.5}
.co-row{border:1px solid var(--rule);border-radius:var(--r-l);padding:18px;margin-bottom:14px;background:var(--paper)}
.co-row.off{background:var(--raise)}
.co-row.off .co-body{opacity:.55}
.co-rowhead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.co-trig{font-size:var(--text-sm);color:var(--faint);letter-spacing:.01em}
.co-when{font-size:var(--text-sm);color:var(--muted);margin-top:3px}
.co-sw{display:inline-flex;align-items:center;gap:9px;flex:0 0 auto;cursor:pointer}
.co-sw input{position:absolute;opacity:0;width:44px;height:26px;margin:0;cursor:pointer}
.co-track{position:relative;width:44px;height:26px;border-radius:999px;background:var(--rule-strong);
  transition:background .16s;flex:0 0 auto;display:block}
.co-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:999px;background:var(--paper);
  transition:transform .16s}
.co-sw input:checked + .co-track{background:var(--good)}
.co-sw input:checked + .co-track .co-knob{transform:translateX(18px)}
.co-sw input:focus-visible + .co-track{outline:2px solid var(--slate);outline-offset:2px}
.co-swtxt{font-size:var(--text-sm);font-weight:700;color:var(--muted);min-width:22px}
.co-chips{display:flex;gap:7px;flex-wrap:wrap;margin:-4px 0 12px}
.co-chip{padding:5px 10px;border:1px solid var(--rule);border-radius:999px;font-size:var(--text-sm);
  color:var(--ink-2);transition:.14s}
.co-chip:hover{border-color:var(--slate);color:var(--slate);background:var(--slate-tint)}
.co-prevbox{border:1px solid var(--rule);border-radius:var(--r-m);padding:13px 15px;background:var(--raise)}
.co-prevbox p{font-size:var(--text-base);color:var(--ink-2);line-height:1.55;margin-top:6px;white-space:pre-wrap}
@media(max-width:1020px){
  .co-two{grid-template-columns:1fr}
  .co-prev{position:static}
  .co-grid2{grid-template-columns:1fr}
}
`;

/* ═══════════════════ VIEWS ═══════════════════ */

/* The Policies/Automated-messages wrapper that briefly lived here was
   superseded by the host-owned Operations tab, which also folds in Reviews
   and Insights. Both views below are still exported and rendered there. */

function policiesView(){
  const p = state.policies;
  const wr = weatherRow(p.weather), cr = cancelRow(p.cancellation);
  return `<div class="co-head"><div>
      <h2>Policies</h2>
      <p class="co-lede">These terms attach to every listing you publish. Families see them before they pay,
        and refunds are calculated from them — so the wording here is the wording that binds.</p></div>
    <button class="btn ghost sm" data-modal="editpolicy">Quick edit</button></div>

  <div class="co-two">
    <div class="panel">
      <form id="coPolicyForm">
        <p class="eyebrow" style="margin-bottom:11px">Cancellation policy</p>
        <div class="co-opts">
          ${CANCEL.map(([k, label, consequence]) => `
            <label class="co-opt ${p.cancellation === k ? "on" : ""}">
              <input type="radio" name="cancellation" value="${k}" ${p.cancellation === k ? "checked" : ""}>
              <span style="min-width:0"><b>${esc(label)}</b><span>${esc(consequence)}</span></span>
            </label>`).join("")}
        </div>

        <div class="co-grid2">
          <div class="field"><label for="coGrace">Late-arrival grace (minutes)</label>
            <input id="coGrace" name="graceMinutes" type="number" min="0" max="60" step="5" class="num" value="${p.graceMinutes}"></div>
          <div class="field"><label for="coNoShow">No-show fee</label>
            <input id="coNoShow" name="noShowFee" type="number" min="0" max="500" step="5" class="num" value="${p.noShowFee}"></div>
        </div>
        <p class="co-help">A no-show is an athlete who never arrives and never cancels. The fee is charged once, per missed session.</p>

        <div class="field"><label for="coWeather">Weather &amp; make-up policy</label>
          <select id="coWeather" name="weather">
            ${WEATHER.map(([k, label]) => `<option value="${k}" ${p.weather === k ? "selected" : ""}>${esc(label)}</option>`).join("")}
          </select></div>
        <p class="co-help">${esc(wr[2])}</p>

        <div class="field"><label for="coMinAge">Minimum age override</label>
          <input id="coMinAge" name="minAgeOverride" type="number" min="4" max="18" class="num"
            placeholder="No override" value="${p.minAgeOverride == null ? "" : p.minAgeOverride}"></div>
        <p class="co-help">Leave blank and each listing keeps its own minimum age. Set a number and it becomes a floor across all of them — it can raise a listing's minimum, never lower it.</p>

        <div class="field"><label for="coEquip">Required equipment</label>
          <textarea id="coEquip" name="equipment" rows="3" placeholder="What every athlete must bring">${esc(p.equipment)}</textarea></div>

        <div id="coPolicyErr" class="err hide" style="margin-bottom:10px"></div>
        <button class="btn" type="submit">Save policies</button>
      </form>
    </div>

    <aside class="co-prev" aria-label="Family-facing preview">
      <div class="co-prevhead">
        <div class="eyebrow">What families will see</div>
        <span class="pill warn hide" id="coDraftFlag">Unsaved</span>
      </div>
      <div class="co-prevline"><b>${esc(cr[1])} cancellation</b>${esc(cr[2])}</div>
      <div class="co-prevline"><b>Late arrival</b>
        ${p.graceMinutes > 0
          ? `Up to <span class="num">${p.graceMinutes}</span> minutes late is fine — the coach waits. After that the session may start without your athlete.`
          : "No grace period. The session starts on time whether or not your athlete has arrived."}</div>
      <div class="co-prevline"><b>No-show fee</b>
        ${p.noShowFee > 0
          ? `<span class="num">${money(p.noShowFee)}</span> if nobody arrives and no cancellation was sent.`
          : "None. A missed session is not charged a separate fee."}</div>
      <div class="co-prevline"><b>${esc(wr[1])}</b>${esc(wr[2])}</div>
      <div class="co-prevline"><b>Minimum age</b>
        ${p.minAgeOverride == null
          ? "Each program keeps the minimum age shown on its own listing."
          : `No athlete under <span class="num">${p.minAgeOverride}</span> is accepted, even where a listing allows younger.`}</div>
      <div class="co-prevline"><b>Bring with you</b>${esc(p.equipment) || "Nothing beyond the usual kit."}</div>
      <p class="eyebrow" style="margin-top:14px">
        ${p.savedAt ? "Saved · " + esc(stamp(new Date(p.savedAt))) : "Never saved — showing defaults"}</p>
    </aside>
  </div>`;
}

function waitlistView(){
  /* Third instance of the same gap: the dashboard's waitlist widget was
     withheld from guests, but this tab view -- which lists the same families
     by name, plus their parents -- was not. S.coachTab persists, so a guest can
     be restored directly onto it. Gate the view, not the route to it. */
  if (typeof isCoachGuest === "function" && isCoachGuest()) {
    return typeof coachLockHTML === "function"
      ? coachLockHTML("Waitlist", "who is waiting on a seat, and the families to contact")
      : `<div class="empty" style="margin-top:18px"><h3>Sign in to see the waitlist</h3></div>`;
  }
  const c = statusCounts();
  const rows = state.waitlistEntries.slice().sort((a, b) => {
    const pa = prog(a.programId), pb = prog(b.programId);
    const t = String(pa && pa.title).localeCompare(String(pb && pb.title));
    return t !== 0 ? t : a.joinedAt.localeCompare(b.joinedAt);
  });
  const tiles = [
    ["Waiting", c.waiting, "in line for a spot"],
    ["Offered", c.offered, "awaiting a reply"],
    ["Accepted", c.accepted, "converted to a booking"],
    ["Expired", c.expired, "offer window closed"],
  ];
  /* h2, not h1: the waitlist is now a section inside the Listings tab, which
     owns the page's single h1. Two h1s on one page is a document-outline bug. */
  return `<div class="co-head"><div>
      <h2>Waitlist</h2>
      <p class="co-lede">Every athlete queued on a program that has reached capacity. Offers are held for
        24 hours — if the family does not accept, the spot passes to the next athlete in line.</p></div></div>

  <div class="stats">
    ${tiles.map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div>
      <div class="v num">${v}</div><div class="d">${d}</div></div>`).join("")}
  </div>

  ${rows.length ? `<div class="tblwrap panel" style="padding:18px;margin-top:16px"><table class="tbl">
    <thead><tr><th>#</th><th>Athlete</th><th>Parent</th><th>Program</th>
      <th>Waiting</th><th>Notify</th><th>Status</th><th>Action</th></tr></thead>
    <tbody>${rows.map(e => {
      const p = prog(e.programId), st = effStatus(e), pill = STATUS_PILL[st];
      const left = st === "offered" ? until(e.expiresAt) : null;
      const pos = position(e);
      return `<tr>
        <td><span class="co-pos num">${pos == null ? "—" : pos}</span></td>
        <td><b>${esc(e.athlete)}</b>
          <div class="num" style="color:var(--muted);font-size:var(--text-sm)">Age ${e.athleteAge}</div></td>
        <td>${esc(e.parent)}</td>
        <td>${p ? `<b style="font-weight:600">${esc(p.title)}</b>
            <div style="margin-top:4px"><span class="pill" style="background:${sportColor(p.sport)}1A;color:${sportColor(p.sport)}">${esc(p.sport)}</span>
            <span class="num" style="color:var(--muted);font-size:var(--text-sm);margin-left:6px">${p.enrolled}/${p.cap} full</span></div>`
          : `<span style="color:var(--muted)">Program removed</span>`}</td>
        <td class="num">${esc(since(e.joinedAt))}
          <div style="color:var(--muted);font-size:var(--text-sm)">joined ${esc(fmtDate(e.joinedAt.slice(0, 10)))}</div></td>
        <td>${esc(e.via)}</td>
        <td><span class="pill ${pill[0]}">${esc(pill[1])}</span>
          ${left ? `<div class="num" style="color:var(--muted);font-size:var(--text-sm);margin-top:3px">${esc(left)} left</div>` : ""}
          ${st === "expired" && e.expiresAt ? `<div style="color:var(--muted);font-size:var(--text-sm);margin-top:3px">no reply</div>` : ""}</td>
        <td>${
          st === "waiting" || st === "expired"
            ? `<button class="btn sm" data-co-offer="${esc(e.id)}">Offer a spot</button>`
            : st === "offered"
              ? `<button class="btn ghost sm" data-co-accept="${esc(e.id)}">Mark accepted</button>`
              : `<span style="color:var(--muted);font-size:var(--text-sm)">Enrolled</span>`
        }</td>
      </tr>`;
    }).join("")}</tbody></table></div>`
  : `<div class="empty" style="border:1px solid var(--rule);border-radius:var(--r-l);margin-top:16px">
      <p>No one is waiting. Waitlists open automatically once a program reaches its capacity.</p></div>`}

  <div class="co-note" style="margin-top:16px">
    Offering a spot never charges the family. It sends a claim link that expires in 24 hours; only when they
    accept and pay does the booking exist and the program count go up.</div>`;
}

function slotsView(){
  const cl = conflicts();
  const rules = state.recurringSlots.slice().sort((a, b) =>
    a.weekday - b.weekday || toMin(a.start) - toMin(b.start));
  const steps = [];
  for (let mn = GRID_START * 60; mn < GRID_END * 60; mn += SLOT_MIN) steps.push(mn);

  /* h2: this view is now a panel inside the Schedule tab, which owns the h1. */
  return `<div class="co-head"><div>
      <h2>Recurring slots</h2>
      <p class="co-lede">Blocks you hold open week after week. Each row is 15 minutes — click one for a
        quarter hour, or press and drag down a column to hold any run of them, so a block can end at
        9:15 as easily as 10:00. Drag from a held cell to clear a stretch. The rules list below is the
        same data, written out in full.</p></div>
    <button class="btn" data-modal="addslot">+ Add recurring block</button></div>

  ${cl.length ? `<div class="co-alert" role="alert">
    <h4>${cl.length} scheduling conflict${cl.length > 1 ? "s" : ""}</h4>
    <ul style="margin:0;padding-left:18px">${cl.map(c => {
      const pa = prog(c.a.programId), pb = prog(c.b.programId);
      return `<li><b>${esc(wdName(c.a.weekday))}</b> —
        ${esc(pa ? pa.title : c.a.programId)} <span class="num">${esc(t12(c.a.start))}–${esc(t12(c.a.end))}</span>
        overlaps ${esc(pb ? pb.title : c.b.programId)} <span class="num">${esc(t12(c.b.start))}–${esc(t12(c.b.end))}</span>
        by <span class="num">${esc(durLabel(c.minutes))}</span>
        (<span class="num">${esc(t12(c.start))}–${esc(t12(c.end))}</span>). One coach cannot run both.</li>`;
    }).join("")}</ul></div>` : ""}

  <div class="co-gridwrap">
    <div class="tblwrap">
      <div class="co-week" role="group" aria-label="Weekly recurring availability">
        <div></div>
        ${WD.map(w => `<div class="co-day">${w.s}</div>`).join("")}
        ${steps.map(mn => {
          const onHour = mn % 60 === 0;
          return `
          <div class="co-hh num">${onHour ? esc(t12(fromMin(mn))) : ""}</div>
          ${WD.map(w => {
            const rs = rulesAtMin(w.n, mn), on = rs.length > 0, clash = on && clashAtMin(w.n, mn);
            const p = on ? prog(rs[0].programId) : null;
            const tint = p ? `color-mix(in srgb,${sportColor(p.sport)} 22%,transparent)` : "transparent";
            const span = t12(fromMin(mn)) + "–" + t12(fromMin(mn + SLOT_MIN));
            const label = on
              ? `${w.l} ${span} — ${rs.map(r => (prog(r.programId) || {}).title || r.programId).join(", ")}. Drag to clear.`
              : `${w.l} ${span} — open. Click or drag to hold.`;
            return `<button class="co-cell${on ? " on" : ""}${clash ? " clash" : ""}${onHour ? " co-hourtop" : ""}"
              style="--cc:${tint}" data-co-cell="${w.n}-${mn}" aria-pressed="${on}"
              aria-label="${esc(label)}" title="${esc(label)}"></button>`;
          }).join("")}`;
        }).join("")}
      </div>
    </div>
    <div class="co-legend">
      <span><i style="background:var(--raise2);border:1px solid var(--rule)"></i>Open</span>
      ${[...new Set(rules.map(r => r.programId))].slice(0, 4).map(id => {
        const p = prog(id); if (!p) return "";
        return `<span><i style="background:color-mix(in srgb,${sportColor(p.sport)} 22%,transparent)"></i>${esc(p.title)}</span>`;
      }).join("")}
      <span><i style="background:transparent;box-shadow:inset 0 0 0 2px var(--danger)"></i>Conflict</span>
    </div>
    <p class="co-draghint">Each row is 15 minutes. Press and drag down a day to hold a longer block —
      two rows is a half hour, three is 45 minutes, four is a full hour.</p>
  </div>

  <div class="sec-head" style="margin:26px 0 12px"><h3>Recurring rules</h3>
    <span class="num" style="color:var(--muted);font-size:var(--text-sm)">${rules.length} rule${rules.length === 1 ? "" : "s"}</span></div>

  ${rules.length ? `<div class="tblwrap panel" style="padding:18px"><table class="tbl">
    <thead><tr><th>Block</th><th>Program</th><th>Day</th><th>Time</th><th>Capacity</th><th>Effective</th><th>Status</th><th></th></tr></thead>
    <tbody>${rules.map(r => {
      const p = prog(r.programId);
      const bad = cl.some(c => c.a.id === r.id || c.b.id === r.id);
      return `<tr>
        ${/* rules seeded before names existed fall back to the day + time, so a
             nameless row still reads as something rather than an empty cell */""}
        <td><b style="font-weight:700">${esc(r.name || (wdShort(r.weekday) + " " + t12(r.start)))}</b></td>
        <td>${p ? `<b style="font-weight:600">${esc(p.title)}</b>
          <div style="margin-top:4px"><span class="pill" style="background:${sportColor(p.sport)}1A;color:${sportColor(p.sport)}">${esc(p.sport)}</span></div>`
          : `<span style="color:var(--muted)">${esc(r.programId)}</span>`}</td>
        <td>${esc(wdName(r.weekday))}</td>
        <td class="num">${esc(t12(r.start))} – ${esc(t12(r.end))}
          <div style="color:var(--muted);font-size:var(--text-sm)">${esc(durLabel(toMin(r.end) - toMin(r.start)))}</div></td>
        <td class="num">${r.capacity}</td>
        <td class="num">${esc(fmtDate(r.effectiveFrom))}
          <div style="color:var(--muted);font-size:var(--text-sm)">through ${esc(r.effectiveUntil ? fmtDate(r.effectiveUntil) : "no end date")}</div></td>
        <td>${bad ? `<span class="pill warn">Conflict</span>` : `<span class="pill good">Clear</span>`}</td>
        <td><button class="x" data-co-delslot="${esc(r.id)}"
          aria-label="Delete the ${esc(wdName(r.weekday))} ${esc(t12(r.start))} block">${ICON.x}</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>`
  : `<div class="empty" style="border:1px solid var(--rule);border-radius:var(--r-l)">
      <p>No recurring blocks yet. Click any cell above, or add one with the full form.</p></div>`}`;
}

function messagesView(){
  const v = sampleValues();
  const onCount = state.autoMessages.filter(m => m.enabled).length;
  return `<div class="co-head"><div>
      <h2>Automated messages</h2>
      <p class="co-lede">One template per trigger. Placeholders are filled from the real booking at send time —
        the preview below uses ${esc(v.athlete_first_name)}'s ${esc(v.program_title)} booking.</p></div>
    <span class="pill slate num">${onCount} of ${state.autoMessages.length} on</span></div>

  <div class="co-note" style="margin-top:14px">Allowed placeholders:
    ${PLACEHOLDERS.map(p => `<code class="num">{{${esc(p)}}}</code>`).join(" · ")}.
    Anything else is left as raw text in the message the family receives.</div>

  <div style="margin-top:18px">
    ${state.autoMessages.map(m => {
      const [k, label, when] = trigRow(m.trigger);
      const bad = unknownTokens(m.body);
      return `<div class="co-row ${m.enabled ? "" : "off"}" data-co-rowfor="${esc(k)}">
        <div class="co-rowhead">
          <div style="min-width:0">
            <b style="font-size:var(--text-base);letter-spacing:-.02em">${esc(label)}</b>
            <div class="co-trig num">${esc(k)}</div>
            <div class="co-when">${esc(when)}</div>
          </div>
          <label class="co-sw">
            <input type="checkbox" data-co-toggle="${esc(k)}" ${m.enabled ? "checked" : ""}
              aria-label="Send the ${esc(label)} message automatically">
            <span class="co-track" aria-hidden="true"><span class="co-knob"></span></span>
            <span class="co-swtxt" data-co-swtxt="${esc(k)}">${m.enabled ? "On" : "Off"}</span>
          </label>
        </div>
        <div class="co-body">
          <div class="field" style="margin-bottom:10px">
            <label for="coTa-${esc(k)}">Message body</label>
            <textarea id="coTa-${esc(k)}" rows="4" data-co-body="${esc(k)}">${esc(m.body)}</textarea>
          </div>
          <div class="co-chips">
            ${PLACEHOLDERS.map(ph => `<button type="button" class="co-chip num" data-co-ins="${esc(k)}|${esc(ph)}"
              aria-label="Insert ${esc(ph)} into the ${esc(label)} message">{{${esc(ph)}}}</button>`).join("")}
            <button type="button" class="co-chip" data-co-reset="${esc(k)}"
              aria-label="Reset the ${esc(label)} message to its default wording">Reset to default</button>
          </div>
          <div class="err ${bad.length ? "" : "hide"}" data-co-warn="${esc(k)}">${
            bad.length ? esc("Unknown placeholder" + (bad.length > 1 ? "s" : "") + ": " + bad.map(b => "{{" + b + "}}").join(", ") + " — this will send as literal text.") : ""}</div>
          <div class="co-prevbox">
            <div class="eyebrow">Preview</div>
            <p data-co-preview="${esc(k)}">${esc(substitute(m.body))}</p>
          </div>
        </div>
      </div>`;
    }).join("")}
  </div>
  <button class="btn" data-co-savemsg="1">Save message settings</button>`;
}

/* ═══════════════════ MODALS ═══════════════════ */
const wrap = (title, body) =>
  `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-body">${body}</div></div></div>`;

function editPolicyModal(){
  const p = state.policies;
  return wrap("Edit policy", `
    <p style="color:var(--muted);margin-bottom:18px">The refund rule and the two fees, in one place.
      Everything else lives on the full Policies tab.</p>
    <form id="coQuickForm">
      <p class="eyebrow" style="margin-bottom:11px">Cancellation policy</p>
      <div class="co-opts">
        ${CANCEL.map(([k, label, consequence]) => `
          <label class="co-opt ${p.cancellation === k ? "on" : ""}">
            <input type="radio" name="cancellation" value="${k}" ${p.cancellation === k ? "checked" : ""}>
            <span style="min-width:0"><b>${esc(label)}</b><span>${esc(consequence)}</span></span>
          </label>`).join("")}
      </div>
      <div class="co-grid2">
        <div class="field"><label for="coQGrace">Grace (minutes)</label>
          <input id="coQGrace" name="graceMinutes" type="number" min="0" max="60" step="5" class="num" value="${p.graceMinutes}"></div>
        <div class="field"><label for="coQFee">No-show fee</label>
          <input id="coQFee" name="noShowFee" type="number" min="0" max="500" step="5" class="num" value="${p.noShowFee}"></div>
      </div>
      <div id="coQuickErr" class="err hide" style="margin-bottom:10px"></div>
      <button class="btn wide" type="submit">Save policy</button>
    </form>`);
}

/* Asks what the block drawn on the grid should be called. The range and the
   program are already decided by the gesture, so this is a single field plus a
   read-back of what was drawn — a coach should be able to confirm they selected
   the hours they meant before it is committed. */
function nameSlotModal(){
  const d = state.pendingSlot;
  if (!d) return wrap("Name this block", `<p style="color:var(--muted)">That selection has expired — draw it again on the grid.</p>`);
  const mine = myListings();
  const list = mine.length ? mine : PROGRAMS.slice(0, 5);
  const mins = toMin(d.end) - toMin(d.start);
  return wrap("Name this block", `
    <p style="color:var(--muted);margin-bottom:16px;font-size:var(--text-sm)">
      <b>${esc(wdName(d.weekday))} ${esc(t12(d.start))}–${esc(t12(d.end))}</b> · ${esc(durLabel(mins))}</p>
    <form id="coNameForm">
      <div class="field"><label for="coNameField">Block name</label>
        <input id="coNameField" name="name" placeholder="Monday evening squad" autocomplete="off" required></div>
      <div class="field"><label for="coNameProg">Program</label>
        <select id="coNameProg" name="programId">
          ${list.map(p => `<option value="${esc(p.id)}"${p.id === d.programId ? " selected" : ""}>${esc(p.title)}</option>`).join("")}
        </select></div>
      <div id="coNameErr" class="err hide" style="margin:8px 0"></div>
      <button class="btn wide" type="submit" style="margin-top:6px">Save block</button>
    </form>`);
}

function addSlotModal(){
  const mine = myListings();
  const list = mine.length ? mine : PROGRAMS.slice(0, 5);
  return wrap("Add a recurring block", `
    <form id="coSlotForm">
      <div class="field"><label for="coSlotName">Block name</label>
        <input id="coSlotName" name="name" placeholder="Monday evening squad" autocomplete="off" required></div>
      <div class="field"><label for="coSlotProg">Program</label>
        <select id="coSlotProg" name="programId">
          ${list.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("")}
        </select></div>
      <div class="field"><label for="coSlotDay">Day of the week</label>
        <select id="coSlotDay" name="weekday">
          ${WD.map(w => `<option value="${w.n}">${w.l}</option>`).join("")}
        </select></div>
      <div class="co-grid2">
        <div class="field"><label for="coSlotStart">Start</label>
          <input id="coSlotStart" name="start" type="time" value="17:00" required></div>
        <div class="field"><label for="coSlotEnd">End</label>
          <input id="coSlotEnd" name="end" type="time" value="18:30" required></div>
      </div>
      <div class="field"><label for="coSlotCap">Capacity for this block</label>
        <input id="coSlotCap" name="capacity" type="number" min="1" max="60" class="num" value="12" required></div>
      <div class="co-grid2">
        <div class="field"><label for="coSlotFrom">Effective from</label>
          <input id="coSlotFrom" name="effectiveFrom" type="date" value="${TODAY}" required></div>
        <div class="field"><label for="coSlotUntil">Effective until</label>
          <input id="coSlotUntil" name="effectiveUntil" type="date" value="2026-12-18"></div>
      </div>
      <div id="coSlotErr" class="err hide" style="margin-bottom:10px"></div>
      <p class="co-help" style="margin-top:0">A block repeats every week inside its effective window.
        If it lands on top of another block, both stay — the conflict is flagged so you can decide.</p>
      <button class="btn wide" type="submit">Add block</button>
    </form>`);
}

function offerSpotModal(){
  const e = state.waitlistEntries.find(x => x.id === (S.modal && S.modal.entryId));
  if (!e) return wrap("Offer a spot", `<p style="color:var(--muted)">That waitlist entry no longer exists.</p>`);
  const p = prog(e.programId);
  const expiry = new Date(NOW().getTime() + 24 * 3600 * 1000);
  const pos = position(e);
  return wrap("Offer a spot", `
    <div class="panel" style="background:var(--raise);border:0;margin-bottom:18px">
      <b>${esc(e.athlete)}</b><span class="num" style="color:var(--muted)"> · age ${e.athleteAge}</span>
      <div style="color:var(--muted);font-size:var(--text-sm);margin-top:3px">
        Parent ${esc(e.parent)} · waiting <span class="num">${esc(since(e.joinedAt))}</span>${pos ? ` · position <span class="num">${pos}</span>` : ""}</div>
      ${p ? `<div style="margin-top:9px"><b style="font-weight:600">${esc(p.title)}</b>
        <div class="num" style="color:var(--muted);font-size:var(--text-sm)">${p.enrolled}/${p.cap} enrolled · ${money(p.price)} ${esc(modelLabel(p.model))}</div></div>` : ""}
    </div>
    <div class="panel" style="background:var(--warn-tint);border:0;margin-bottom:18px">
      <p style="font-size:var(--text-base);color:var(--ink-2)">
        This offer <b>expires 24 hours after you send it</b> — at
        <span class="num">${esc(stamp(expiry))}</span>. If ${esc(e.athlete.split(" ")[0])}'s family has not
        accepted and paid by then, the hold is released and the spot passes to the next athlete in line.</p>
    </div>
    <form id="coOfferForm">
      <div class="field"><label for="coOfferVia">Send by</label>
        <select id="coOfferVia" name="via">
          ${["Email", "Text", "Both"].map(v => `<option value="${v}" ${e.via === v ? "selected" : ""}>${v}</option>`).join("")}
        </select></div>
      <div class="field"><label for="coOfferNote">Note to the family (optional)</label>
        <textarea id="coOfferNote" name="note" rows="3" placeholder="Anything they should know before they claim the spot"></textarea></div>
      <button class="btn wide" type="submit">${ICON.send} Send the offer</button>
    </form>`);
}

/* ═══════════════════ WIRING ═══════════════════ */
function ensureCSS(){
  if (document.getElementById("mod-coachops-css")) return;
  const el = document.createElement("style");
  el.id = "mod-coachops-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* Message previews repaint in place. A full render() would blow away the
   caret in the textarea the coach is typing into. */
function paint(trigger){
  const m = state.autoMessages.find(x => x.trigger === trigger);
  if (!m) return;
  const pv = document.querySelector('[data-co-preview="' + trigger + '"]');
  if (pv) pv.textContent = substitute(m.body);
  const wn = document.querySelector('[data-co-warn="' + trigger + '"]');
  if (wn){
    const bad = unknownTokens(m.body);
    if (bad.length){
      wn.textContent = "Unknown placeholder" + (bad.length > 1 ? "s" : "") + ": " +
        bad.map(b => "{{" + b + "}}").join(", ") + " — this will send as literal text.";
      wn.classList.remove("hide");
    } else {
      wn.textContent = "";
      wn.classList.add("hide");
    }
  }
}

function wire(){
  ensureCSS();
  const q = s => document.querySelectorAll(s);

  /* ── policies ─────────────────────────────────────────────────── */
  const readPolicy = (form, errId, partial) => {
    const d = Object.fromEntries(new FormData(form));
    const err = document.getElementById(errId);
    const show = msg => { if (err){ err.textContent = msg; err.classList.remove("hide"); } return false; };
    if (CANCEL.every(c => c[0] !== d.cancellation)) return show("Pick a cancellation policy.");
    const grace = Number(d.graceMinutes), fee = Number(d.noShowFee);
    if (!isFinite(grace) || grace < 0 || grace > 60) return show("Grace period must be between 0 and 60 minutes.");
    if (!isFinite(fee) || fee < 0) return show("A no-show fee cannot be negative.");
    const next = { cancellation: d.cancellation, graceMinutes: Math.round(grace), noShowFee: Math.round(fee) };
    if (!partial){
      const equip = String(d.equipment || "").trim();
      if (!equip) return show("Tell families what equipment they need to bring — this note is required.");
      const raw = String(d.minAgeOverride || "").trim();
      let minAge = null;
      if (raw !== ""){
        minAge = Number(raw);
        if (!isFinite(minAge) || minAge < 4 || minAge > 18) return show("A minimum age override must be between 4 and 18.");
        minAge = Math.round(minAge);
      }
      if (WEATHER.every(w => w[0] !== d.weather)) return show("Pick a weather and make-up policy.");
      next.weather = d.weather;
      next.minAgeOverride = minAge;
      next.equipment = equip;
    }
    Object.assign(state.policies, next, { savedAt: iso(NOW()) });
    if (err) err.classList.add("hide");
    return true;
  };

  const pf = document.getElementById("coPolicyForm");
  if (pf){
    pf.onsubmit = ev => {
      ev.preventDefault();
      if (readPolicy(pf, "coPolicyErr", false)){ render(); toast("Policies saved — families see the new terms"); }
    };
    pf.oninput = () => {
      const flag = document.getElementById("coDraftFlag");
      if (flag) flag.classList.remove("hide");
    };
  }
  const qf = document.getElementById("coQuickForm");
  if (qf) qf.onsubmit = ev => {
    ev.preventDefault();
    if (readPolicy(qf, "coQuickErr", true)){
      /* via the host normalizer, so "policies" resolves to its new home */
      S.modal = null; setCoachTab("policies"); render(); toast("Policy updated");
    }
  };

  /* ── waitlist ─────────────────────────────────────────────────── */
  q("[data-co-offer]").forEach(b => b.onclick = () => {
    S.modal = { type: "offerspot", entryId: b.dataset.coOffer };
    render();
  });
  q("[data-co-accept]").forEach(b => b.onclick = () => {
    const e = state.waitlistEntries.find(x => x.id === b.dataset.coAccept);
    if (!e || effStatus(e) !== "offered") return;
    e.status = "accepted";
    const p = prog(e.programId);
    if (p && p.enrolled < p.cap) p.enrolled += 1;      // the spot is now genuinely taken
    render();
    toast(e.athlete.split(" ")[0] + " accepted — enrolled");
  });
  const of = document.getElementById("coOfferForm");
  if (of) of.onsubmit = ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(of));
    const e = state.waitlistEntries.find(x => x.id === S.modal.entryId);
    if (!e){ S.modal = null; render(); return; }
    const now = NOW();
    e.status = "offered";
    e.via = d.via;
    e.note = String(d.note || "").trim() || null;
    e.offeredAt = iso(now);
    e.expiresAt = iso(new Date(now.getTime() + 24 * 3600 * 1000));
    S.modal = null;
    render();
    toast("Spot offered to " + e.athlete.split(" ")[0] + " — expires in 24 hours");
  };

  /* ── recurring slots ──────────────────────────────────────────── */
  /* Drag-selection over the quarter-hour grid.
     A click is just a drag of length one, so both gestures share one code path.
     The preview is painted by toggling a class on the cells rather than calling
     render() per pointermove — a re-render would rebuild the grid and destroy
     the element the pointer is currently captured on, ending the drag.
     Direction is intent-preserving: a gesture that STARTS on a held cell clears
     the range it covers, one that starts on an open cell holds it. */
  const cells = [].slice.call(document.querySelectorAll("[data-co-cell]"));
  const parseCell = el => {
    const p = String(el.dataset.coCell).split("-");
    return { wd: Number(p[0]), mn: Number(p[1]) };
  };
  let drag = null;
  const paint = () => {
    cells.forEach(el => {
      const c = parseCell(el);
      let inSel = false;
      if (drag && c.wd === drag.wd){
        inSel = c.mn >= Math.min(drag.a, drag.b) && c.mn <= Math.max(drag.a, drag.b);
      }
      el.classList.toggle("sel", inSel);
    });
  };
  cells.forEach(el => {
    el.addEventListener("pointerdown", e => {
      e.preventDefault();                       // don't start a text selection
      const c = parseCell(el);
      drag = { wd: c.wd, a: c.mn, b: c.mn, clearing: rulesAtMin(c.wd, c.mn).length > 0 };
      paint();
    });
    /* pointerenter, not pointerover: fires once per cell and doesn't bubble */
    el.addEventListener("pointerenter", () => {
      if (!drag) return;
      const c = parseCell(el);
      if (c.wd !== drag.wd) return;             // a block belongs to one weekday
      drag.b = c.mn;
      paint();
    });
  });
  /* Assigned, not addEventListener: wire() runs on every render, and assignment
     replaces the previous handler instead of stacking a new one each time. */
  document.onpointerup = () => {
    if (!drag) return;
    const d = drag; drag = null;
    const lo = Math.min(d.a, d.b), hi = Math.max(d.a, d.b) + SLOT_MIN;
    if (d.clearing){
      const hit = state.recurringSlots.filter(r =>
        r.weekday === d.wd && toMin(r.start) < hi && toMin(r.end) > lo);
      if (hit.length){
        state.recurringSlots = state.recurringSlots.filter(r => hit.indexOf(r) < 0);
        render();
        toast("Cleared " + hit.length + " block" + (hit.length > 1 ? "s" : "") +
          " on " + wdShort(d.wd));
        return;
      }
    }
    const base = myListings()[0] || DEMO_CATALOGUE[0];
    if (!base){ render(); return; }
    /* Holding availability writes to the coach's real schedule — a guest gets
       the sheet instead, and the drawn range is discarded rather than half-kept. */
    if (typeof isVerified === "function" && !isVerified()){ requireAuth(function(){}); return; }
    /* Hold the range and ask for a name — nothing is written until the coach
       confirms, so cancelling the modal leaves the grid exactly as it was. */
    state.pendingSlot = {
      weekday: d.wd,
      start: fromMin(lo),
      end: fromMin(hi),
      programId: base.id,
      capacity: base.cap,
    };
    S.modal = { type: "nameslot" };
    render();
  };
  q("[data-co-delslot]").forEach(b => b.onclick = () => {
    const r = state.recurringSlots.find(x => x.id === b.dataset.coDelslot);
    if (!r) return;
    state.recurringSlots = state.recurringSlots.filter(x => x.id !== r.id);
    render();
    toast("Removed the " + wdShort(r.weekday) + " " + t12(r.start) + " block");
  });
  /* Commits the drawn range once it has a name. Absorbs any rule wholly inside
     the range so redrawing over a block replaces it rather than stacking. */
  const nf2 = document.getElementById("coNameForm");
  if (nf2) nf2.onsubmit = ev => {
    ev.preventDefault();
    const d = state.pendingSlot;
    if (!d){ S.modal = null; render(); return; }
    const f = Object.fromEntries(new FormData(nf2));
    const name = String(f.name || "").trim();
    const err = document.getElementById("coNameErr");
    if (!name){ err.textContent = "Give this block a name."; err.classList.remove("hide"); return; }
    const lo = toMin(d.start), hi = toMin(d.end);
    const p = prog(f.programId) || prog(d.programId);
    state.recurringSlots = state.recurringSlots
      .filter(r => !(r.weekday === d.weekday && toMin(r.start) >= lo && toMin(r.end) <= hi))
      .concat([{
        id: "rs_" + Date.now(),
        name: name,
        programId: f.programId || d.programId,
        weekday: d.weekday,
        start: d.start,
        end: d.end,
        capacity: (p && p.cap) || d.capacity,
        effectiveFrom: TODAY,
        effectiveUntil: "2026-12-18",
      }]);
    state.pendingSlot = null;
    S.modal = null;
    render();
    toast('"' + name + '" held ' + wdShort(d.weekday) + " " + t12(d.start) + "–" + t12(d.end));
  };

  const sf = document.getElementById("coSlotForm");
  if (sf) sf.onsubmit = ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(sf));
    const err = document.getElementById("coSlotErr");
    const show = msg => { err.textContent = msg; err.classList.remove("hide"); return null; };
    const s = toMin(d.start), e = toMin(d.end);
    if (isNaN(s) || isNaN(e)) return show("Enter a start and an end time.");
    if (e <= s) return show("The block has to end after it starts.");
    const cap = Number(d.capacity);
    if (!isFinite(cap) || cap < 1) return show("Capacity must be at least 1.");
    if (d.effectiveUntil && d.effectiveUntil < d.effectiveFrom) return show("The end date falls before the start date.");
    const nm = String(d.name || "").trim();
    if (!nm) return show("Give this block a name.");
    const rule = {
      id: "rs_" + Date.now(),
      name: nm,
      programId: d.programId,
      weekday: Number(d.weekday),
      start: fromMin(s),
      end: fromMin(e),
      capacity: Math.round(cap),
      effectiveFrom: d.effectiveFrom,
      effectiveUntil: d.effectiveUntil || null,
    };
    const before = conflicts().length;
    state.recurringSlots = state.recurringSlots.concat([rule]);
    const added = conflicts().length - before;
    S.modal = null; S.coachTab = "slots"; render();
    toast(added > 0
      ? "Block added — it conflicts with " + added + " existing block" + (added > 1 ? "s" : "")
      : "Recurring block added");
  };

  /* ── automated messages ───────────────────────────────────────── */
  q("[data-co-toggle]").forEach(cb => cb.onchange = () => {
    const k = cb.dataset.coToggle;
    const m = state.autoMessages.find(x => x.trigger === k);
    if (!m) return;
    m.enabled = cb.checked;
    const row = document.querySelector('[data-co-rowfor="' + k + '"]');
    if (row) row.classList.toggle("off", !m.enabled);
    const txt = document.querySelector('[data-co-swtxt="' + k + '"]');
    if (txt) txt.textContent = m.enabled ? "On" : "Off";
    toast(trigRow(k)[1] + (m.enabled ? " — on" : " — off"));
  });
  q("[data-co-body]").forEach(ta => ta.oninput = () => {
    const m = state.autoMessages.find(x => x.trigger === ta.dataset.coBody);
    if (!m) return;
    m.body = ta.value;
    paint(m.trigger);
  });
  q("[data-co-ins]").forEach(b => b.onclick = () => {
    const parts = String(b.dataset.coIns).split("|");
    const k = parts[0], token = "{{" + parts[1] + "}}";
    const ta = document.getElementById("coTa-" + k);
    const m = state.autoMessages.find(x => x.trigger === k);
    if (!ta || !m) return;
    const a = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const z = ta.selectionEnd == null ? a : ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + token + ta.value.slice(z);
    m.body = ta.value;
    ta.focus();
    ta.setSelectionRange(a + token.length, a + token.length);
    paint(k);
  });
  q("[data-co-reset]").forEach(b => b.onclick = () => {
    const k = b.dataset.coReset;
    const def = seedMessages().find(x => x.trigger === k);
    const m = state.autoMessages.find(x => x.trigger === k);
    if (!def || !m) return;
    m.body = def.body;
    render();
    toast(trigRow(k)[1] + " reset to default");
  });
  q("[data-co-savemsg]").forEach(b => b.onclick = () => {
    const broken = state.autoMessages.filter(m => m.enabled && unknownTokens(m.body).length);
    if (broken.length){
      toast(broken.length + " enabled template" + (broken.length > 1 ? "s" : "") + " still use an unknown placeholder");
      return;
    }
    toast("Message settings saved");
  });
}

/* ═══════════════════ EXPORT ═══════════════════ */
window.MOD_COACHOPS = {
  css: CSS,
  /* `waitlist` is deliberately absent from `tabs` but present in `views`: the
     tab button is gone, while the view is still resolvable via modView() so the
     Listings tab can render it inline. */
  /* `slots` joins `waitlist` as view-only: the rail button is gone because the
     grid now lives as a sub-tab of Schedule, but modView("slots") still
     resolves so that tab can render it. */
  /* No rail tabs of its own any more: policies + messages live under the host
     Operations tab, waitlist under Listings, slots under Schedule. Views stay
     exported so those hosts can render them. */
  tabs: {},
  views: { policies: policiesView, waitlist: waitlistView,
           slots: slotsView, messages: messagesView },
  modals: { editpolicy: editPolicyModal, addslot: addSlotModal, offerspot: offerSpotModal,
            nameslot: nameSlotModal },
  wire: wire,
  state: state,
};

})();
