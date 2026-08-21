"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_COACHONBOARD — the seven-step coach onboarding wizard.

   One step on screen at a time, a persistent rail on the left, and a
   draft that survives every re-render because it lives in S.onboard.

   The rule the whole file is built around: a coach can describe their
   own business, but a coach can never grade it. Every field that a
   family would read as a safety signal — verified, approved,
   background-cleared — is written by this module as unverified /
   pending / none, no matter what arrives from the form. The submit
   path has no branch that can produce any other value.

   Host contract used (never redefined here):
     S, render(), toast(), esc(), money(), isVerified(), PROGRAMS,
     SEED.providerProfile, sportColor(), sportGlyph(), SPORT_COLOR, ICON.

   Mounts as the view named "onboard": as a route (S.route={name:"onboard"})
   in the family portal, or as a coach tab (S.coachTab="onboard").
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ── the app's clock — de-pinned (WF-5). Only bounds age calc + the DOB input
   max, so real "now" is correct and safe. ────────────────────────── */
const TODAY = new Date();
const TODAY_ISO = (d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`)(TODAY);

/* ── platform economics, 2026-08-17 ────────────────────────────────
   Sporv charges the COACH a subscription, not a cut of a booking. So this
   wizard no longer does fee arithmetic at all: the price a family pays is the
   money that reaches the coach, and the only thing to choose is a plan.

   The plan names and prices are NOT declared here. They come from
   SporveCoach.plans() (mod-coachaccount.js), which is the one place they are
   written, so a price cannot drift between the wizard and the billing tab. If
   that module is absent the step still renders — it just states the free plan
   and sends the coach to Billing, rather than inventing a number. */
const plans = () => (window.SporveCoach && window.SporveCoach.plans
  ? window.SporveCoach.plans() : null);
const planPrice = id => { const p = plans(); return p && p[id] ? p[id].price + p[id].per : null; };
const planName  = id => { const p = plans(); return p && p[id] ? p[id].name : (id === "pro" ? "Pro" : "Free"); };

/* ── steps ───────────────────────────────────────────────────────── */
const STEPS = [
  ["Identity",        "Who you are",              "The legal name here is the name that goes to the screening partner. The business name is what families read on your listings."],
  ["Sports",          "What you coach",           "Pick every sport you actually coach. Each one becomes a filter families can find you through."],
  ["Services",        "Services & capacity",      "A service is one thing a family can book. Capacity is the honest ceiling — how many athletes you can coach at once without the session getting worse."],
  ["Pricing",         "Pricing and your plan",    "You set the price and you keep all of it. Sporv charges you a plan, not a share of a booking — start free and change it whenever you want."],
  ["Availability",    "Availability",             "The days and the window you can coach. Exact session times come later, from your schedule — this is the outer boundary."],
  ["Background check","Background check",         "Every person who coaches on Sporv must clear their own check before listings go live. This step collects your consent and the identifiers needed for screening."],
  ["Review",          "Review & submit",          "Everything you entered, read back. Fix anything that is wrong before it goes in."],
];
const LAST = STEPS.length - 1;

/* ── vocabularies ────────────────────────────────────────────────── */
const FORMATS = [
  ["private", "One-on-one", "A single athlete with you for the whole session."],
  ["group",   "Small group","Several athletes coached together in one block."],
  ["camp",    "Camp",       "A multi-day block a family books as one unit."],
  ["team",    "Team",       "A whole roster you coach as a squad."],
];
const FORMAT_CAP = { private: 1, group: 8, camp: 20, team: 16 };
const formatRow = k => FORMATS.find(f => f[0] === k) || FORMATS[0];

/* keys match the host's modelLabel() exactly, so a draft reads the same
   everywhere in the app once it is published */
const MODELS = [
  ["single_session", "Per session", "Charged each time a session is booked."],
  ["monthly",        "Per month",   "Charged monthly for as long as the family stays enrolled."],
  ["package",        "Per package", "One charge covering a fixed block of sessions."],
  ["seasonal",       "Per season",  "One charge covering a whole season."],
];
const MODEL_UNIT = { single_session: "per session", monthly: "per month", package: "per package", seasonal: "per season" };
const modelRow = k => MODELS.find(m => m[0] === k) || MODELS[0];

const WD = [
  ["mon", "Mon", "Monday"], ["tue", "Tue", "Tuesday"], ["wed", "Wed", "Wednesday"],
  ["thu", "Thu", "Thursday"], ["fri", "Fri", "Friday"], ["sat", "Sat", "Saturday"],
  ["sun", "Sun", "Sunday"],
];
const wdLong = k => (WD.find(w => w[0] === k) || ["", "", k])[2];

/* ── small helpers ───────────────────────────────────────────────── */
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toMin = t => { const m = HHMM.exec(String(t)); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
const t12 = t => {
  const n = toMin(t); if (isNaN(n)) return String(t);
  let h = Math.floor(n / 60); const m = n % 60, ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ap;
};
const durLabel = mins => {
  const n = Number(mins);
  if (!isFinite(n)) return "—";
  if (n < 60) return n + " min";
  const h = Math.floor(n / 60), m = n % 60;
  return m ? h + " hr " + m + " min" : h + " hr";
};
const trim = v => String(v == null ? "" : v).trim();
const isBlank = v => trim(v) === "";
const intOf = v => { const n = Number(trim(v)); return isFinite(n) && trim(v) !== "" ? n : NaN; };

/* phone: the shape families dial, plus a real digit count. "(305) 555"
   passes the shape and fails the count, which is the point. */
const PHONE_RE = /^\+?[0-9 ()\-]{7,20}$/;
function phoneDigits(v){ return (trim(v).match(/[0-9]/g) || []).length; }
function phoneOk(v){
  const s = trim(v);
  if (!PHONE_RE.test(s)) return false;
  const n = phoneDigits(s);
  return n >= 7 && n <= 15;
}

/* a real calendar date, and the age it implies against the pinned today */
function ageFrom(dob){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(dob));
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, dd = +m[3];
  const b = new Date(y, mo, dd);
  if (b.getFullYear() !== y || b.getMonth() !== mo || b.getDate() !== dd) return null;
  let a = TODAY.getFullYear() - b.getFullYear();
  const md = TODAY.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && TODAY.getDate() < b.getDate())) a--;
  return a;
}
function prettyDate(d){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(d));
  if (!m) return trim(d);
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/* ═══════════════════ STATE ═══════════════════
   Declared here, deep-copied onto S by the host's bootModules(). Every
   read goes through draft(), so a re-render can never lose a keystroke
   and a missing key can never throw. */
let SVC_SEQ = 0;
function newService(){
  SVC_SEQ += 1;
  return {
    id: "svc_" + SVC_SEQ,
    name: "", format: "private", capacity: FORMAT_CAP.private, minutes: 60,
    price: "", model: "single_session",
  };
}
const BLANK = {
  step: 0,
  legalName: "", businessName: "", phone: "", city: "", region: "", years: "",
  sports: [],
  services: [{ id: "svc_1", name: "", format: "private", capacity: 1, minutes: 60, price: "", model: "single_session" }],
  days: [], startTime: "16:00", endTime: "19:00",
  /* free until the coach says otherwise — a wizard that arrives pre-set to the
     paid plan is a charge nobody chose */
  plan: "free",
  consent: false, dob: "", ssn4: "",
  submittedAt: null, profile: null, drafts: [],
};

function draft(){
  if (!S.onboard || typeof S.onboard !== "object") S.onboard = JSON.parse(JSON.stringify(BLANK));
  const d = S.onboard;
  if (typeof d.step !== "number" || d.step < 0 || d.step > LAST) d.step = 0;
  if (!Array.isArray(d.sports)) d.sports = [];
  if (!Array.isArray(d.days)) d.days = [];
  if (!Array.isArray(d.drafts)) d.drafts = [];
  /* an older draft in sessionStorage has no plan key, and any value that is not
     "pro" resolves to free — the safe side of the only field here that costs money */
  if (d.plan !== "pro") d.plan = "free";
  if (!Array.isArray(d.services) || !d.services.length) d.services = [newService()];
  d.services.forEach((s, i) => {
    if (!s.id) s.id = "svc_" + (i + 1);
    const n = Number(String(s.id).replace(/\D/g, ""));
    if (isFinite(n) && n > SVC_SEQ) SVC_SEQ = n;
  });
  return d;
}
const svc = id => draft().services.find(s => s.id === id) || null;

/* ═══════════════════ VALIDATION ═══════════════════
   One function per step. Each returns null, or the first genuine problem
   with the field that owns it — so the message can sit next to the input
   that has to change. Nothing here is advisory: if it returns a problem,
   Continue stays disabled. */
function checkIdentity(d){
  if (isBlank(d.legalName))
    return { field: "legalName", msg: "Enter your full legal name — it has to match the ID the screening partner will check." };
  if (trim(d.legalName).length < 2)
    return { field: "legalName", msg: "That legal name is too short to be a name." };
  if (isBlank(d.businessName))
    return { field: "businessName", msg: "Enter a business or academy name. Coaching under your own name? Use that." };
  if (isBlank(d.phone))
    return { field: "phone", msg: "Enter a phone number families and the Sporv safety team can reach you on." };
  if (trim(d.phone).length > 20)
    return { field: "phone", msg: "That is " + trim(d.phone).length + " characters long. A phone number, punctuation included, fits in 20." };
  if (!PHONE_RE.test(trim(d.phone)))
    return { field: "phone", msg: "A phone number can only contain digits, spaces, brackets, dashes, and a leading +." };
  if (phoneDigits(d.phone) < 7)
    return { field: "phone", msg: "That number has only " + phoneDigits(d.phone) + " digits — a real phone number has at least 7." };
  if (phoneDigits(d.phone) > 15)
    return { field: "phone", msg: "That number has " + phoneDigits(d.phone) + " digits — no phone number has more than 15." };
  if (isBlank(d.city))
    return { field: "city", msg: "Enter the city you coach in. Families search by where they are." };
  if (isBlank(d.region))
    return { field: "region", msg: "Enter the state or region." };
  if (isBlank(d.years))
    return { field: "years", msg: "Enter how many years you have been coaching. Zero is an honest answer." };
  const y = intOf(d.years);
  if (!isFinite(y) || y < 0)
    return { field: "years", msg: "Years coaching has to be a number, and it cannot be negative." };
  if (y > 70)
    return { field: "years", msg: "Seventy years is the ceiling here — enter the years you have actually coached." };
  return null;
}
function checkSports(d){
  if (!d.sports.length)
    return { field: "sports", msg: "Pick at least one sport. Families reach you through the sport filter, so a coach with none is invisible." };
  return null;
}
function checkServices(d){
  if (!d.services.length)
    return { field: "services", msg: "Add at least one service. A service is the thing a family actually books." };
  for (let i = 0; i < d.services.length; i++){
    const s = d.services[i], n = i + 1;
    if (isBlank(s.name))
      return { field: "name-" + s.id, msg: "Service " + n + " needs a name — what a family sees before they book." };
    if (FORMATS.every(f => f[0] !== s.format))
      return { field: "format-" + s.id, msg: "Service " + n + " needs a format." };
    const cap = intOf(s.capacity);
    if (!isFinite(cap))
      return { field: "capacity-" + s.id, msg: "Service " + n + " needs a maximum capacity." };
    if (cap < 1)
      return { field: "capacity-" + s.id, msg: "Service " + n + " has a capacity of " + cap + ". A service nobody can join is not a service — the minimum is 1." };
    if (cap > 200)
      return { field: "capacity-" + s.id, msg: "Service " + n + " is capped at 200 athletes. Above that, split it into separate services." };
    const mins = intOf(s.minutes);
    if (!isFinite(mins))
      return { field: "minutes-" + s.id, msg: "Service " + n + " needs a session length in minutes." };
    if (mins < 10)
      return { field: "minutes-" + s.id, msg: "Service " + n + " runs " + mins + " minutes. Ten minutes is the shortest session Sporv will list." };
    if (mins > 600)
      return { field: "minutes-" + s.id, msg: "Service " + n + " runs longer than ten hours. Split a multi-day camp into its own service instead." };
  }
  return null;
}
function checkPricing(d){
  for (let i = 0; i < d.services.length; i++){
    const s = d.services[i], n = i + 1;
    if (isBlank(s.price))
      return { field: "price-" + s.id, msg: "Service " + n + " needs a price. Enter 0 if it is genuinely free." };
    const p = Number(trim(s.price));
    if (!isFinite(p))
      return { field: "price-" + s.id, msg: "Service " + n + " needs a number for its price." };
    if (p < 0)
      return { field: "price-" + s.id, msg: "Service " + n + " is priced below zero. A price cannot be negative." };
    if (p > 100000)
      return { field: "price-" + s.id, msg: "Service " + n + " is priced above $100,000. Check that figure." };
    if (MODELS.every(m => m[0] !== s.model))
      return { field: "model-" + s.id, msg: "Service " + n + " needs a pricing model." };
  }
  return null;
}
function checkAvailability(d){
  if (!d.days.length)
    return { field: "days", msg: "Pick at least one day you can coach." };
  const a = toMin(d.startTime), b = toMin(d.endTime);
  if (isNaN(a)) return { field: "startTime", msg: "Enter a start time." };
  if (isNaN(b)) return { field: "endTime", msg: "Enter an end time." };
  if (b === a) return { field: "endTime", msg: "Your window starts and ends at the same minute. It has to be long enough to coach in." };
  if (b < a) return { field: "endTime", msg: "Your window ends before it starts. Set an end time after " + t12(d.startTime) + "." };
  const lengths = d.services.map(s => intOf(s.minutes)).filter(n => isFinite(n) && n > 0);
  const shortest = lengths.length ? Math.min.apply(null, lengths) : 30;
  if (b - a < shortest)
    return { field: "endTime", msg: "That window is " + durLabel(b - a) + " long, shorter than your shortest session (" + durLabel(shortest) + "). Nothing would fit in it." };
  return null;
}
function checkBackground(d){
  if (isBlank(d.dob))
    return { field: "dob", msg: "Enter your date of birth. The screening partner cannot match a record without it." };
  const age = ageFrom(d.dob);
  if (age === null)
    return { field: "dob", msg: "That is not a real calendar date." };
  if (age < 0)
    return { field: "dob", msg: "That date of birth is in the future." };
  if (age < 18)
    return { field: "dob", msg: "Coaches on Sporv have to be 18 or older. That date of birth makes you " + age + "." };
  if (age > 100)
    return { field: "dob", msg: "That date of birth reads as " + age + " years old. Check it." };
  if (isBlank(d.ssn4))
    return { field: "ssn4", msg: "Enter the last four digits of your SSN. It is what separates you from someone with your name." };
  if (!/^\d{4}$/.test(trim(d.ssn4)))
    return { field: "ssn4", msg: "That has to be exactly four digits — the last four, not the whole number." };
  if (!d.consent)
    return { field: "consent", msg: "Sporv cannot run a background check on you without your consent. Tick the box to authorize it." };
  return null;
}
function checkReview(d){
  for (let i = 0; i < LAST; i++){
    const e = checkStep(i, d);
    if (e) return { field: "step-" + i, msg: STEPS[i][0] + " is not finished: " + e.msg };
  }
  return null;
}
const CHECKS = [checkIdentity, checkSports, checkServices, checkPricing, checkAvailability, checkBackground, checkReview];
function checkStep(i, d){
  const fn = CHECKS[i];
  return fn ? fn(d || draft()) : null;
}
/* the lowest step still holding a problem — the furthest the rail may jump */
function firstOpen(d){
  for (let i = 0; i < LAST; i++) if (checkStep(i, d)) return i;
  return LAST;
}
const stepDone = (i, d) => i < LAST && !checkStep(i, d);
/* a step is reachable once everything before it is clean */
const reachable = (i, d) => i <= firstOpen(d);

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
.cob-page{padding:26px 0 84px}
.cob-top{max-width:70ch;margin-bottom:22px}
.cob-lede{color:var(--muted);font-size:var(--text-base);margin-top:8px;line-height:1.6}
.cob-grid{display:grid;grid-template-columns:264px minmax(0,1fr);gap:38px;align-items:start}
.cob-rail{position:sticky;top:104px}
.cob-rail ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.cob-stepitem{position:relative}
.cob-steplink{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;padding:11px 12px;
  border-radius:var(--r-m);transition:background .14s}
.cob-steplink:hover:not(:disabled){background:var(--raise)}
.cob-steplink:disabled{cursor:not-allowed;opacity:.55}
.cob-stepitem.on .cob-steplink{background:var(--slate-tint)}
.cob-dot{width:24px;height:24px;border-radius:999px;flex:0 0 auto;display:grid;place-items:center;
  font-size:var(--text-sm);font-weight:700;border:2px solid var(--rule-strong);color:var(--faint);background:var(--paper)}
.cob-stepitem.done .cob-dot{background:var(--good);border-color:var(--good);color:var(--paper)}
.cob-stepitem.on .cob-dot{border-color:var(--slate);color:var(--slate);background:var(--paper)}
.cob-steptxt{min-width:0}
.cob-steptxt b{display:block;font-size:var(--text-base);letter-spacing:-.012em;color:var(--ink-2);line-height:1.3}
.cob-stepitem.on .cob-steptxt b{color:var(--slate)}
.cob-steptxt span{display:block;font-size:var(--text-xs);color:var(--faint);margin-top:2px}
.cob-railfoot{margin-top:16px;padding:13px 14px;background:var(--raise);border-radius:var(--r-m);
  font-size:var(--text-sm);color:var(--muted);line-height:1.5}
.cob-card{border:1px solid var(--rule);border-radius:var(--r-l);padding:26px;background:var(--paper)}
.cob-head{margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--rule)}
.cob-head h2{letter-spacing:.005em}
.cob-head p{color:var(--muted);font-size:var(--text-base);margin-top:7px;max-width:64ch;line-height:1.58}
.cob-two{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.cob-three{display:grid;grid-template-columns:2fr 1fr 1fr;gap:0 16px}
.cob-help{font-size:var(--text-sm);color:var(--faint);margin:-10px 0 16px;line-height:1.5}
.cob-bad input,.cob-bad select,.cob-bad textarea{border-color:var(--danger)}
.cob-bad label,.cob-bad legend{color:var(--danger)}
.cob-consent.cob-bad,fieldset.cob-bad .cob-picks,fieldset.cob-bad .cob-days{
  border:1px solid var(--danger);border-radius:var(--r-m)}
.cob-picks{display:flex;flex-wrap:wrap;gap:8px;max-height:326px;overflow:auto;padding:3px}
.cob-svc{border:1px solid var(--rule);border-radius:var(--r-l);padding:19px;margin-bottom:14px;background:var(--paper)}
.cob-svchead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:15px}
.cob-svcno{font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.cob-svcsum{font-size:var(--text-sm);color:var(--muted);margin:-6px 0 2px}
.cob-fmt{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px;margin-bottom:16px}
.cob-fmtopt{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1.5px solid var(--rule);
  border-radius:var(--r-m);cursor:pointer;transition:border-color .14s,background .14s}
.cob-fmtopt:hover{border-color:var(--rule-strong);background:var(--raise)}
.cob-fmtopt.on{border-color:var(--slate);background:var(--slate-tint)}
.cob-fmtopt input{width:16px;height:16px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--slate)}
.cob-fmtopt b{font-size:var(--text-sm);letter-spacing:-.012em;display:block}
.cob-fmtopt span{display:block;font-size:var(--text-sm);color:var(--muted);line-height:1.4;margin-top:1px}
.cob-take{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;
  background:var(--raise);border-radius:var(--r-m);padding:13px 15px;margin-top:2px}
.cob-takefig{text-align:right}
.cob-takefig b{display:block;font-size:var(--text-lg);font-weight:700;letter-spacing:-.03em}
.cob-takefig span{display:block;font-size:var(--text-sm);color:var(--muted)}
.cob-takenote{font-size:var(--text-sm);color:var(--muted);max-width:40ch;line-height:1.45}
.cob-days{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.cob-day{padding:9px 16px;border:1px solid var(--rule);border-radius:999px;font-size:var(--text-sm);font-weight:600;
  color:var(--ink-2);transition:.14s}
.cob-day:hover{border-color:var(--ink-2)}
.cob-day.on{border-color:var(--slate);background:var(--slate-tint);color:var(--slate)}
.cob-consent{display:flex;gap:12px;align-items:flex-start;padding:15px;border:1.5px solid var(--rule);
  border-radius:var(--r-m);cursor:pointer;transition:border-color .14s,background .14s;margin-bottom:16px}
.cob-consent:hover{border-color:var(--rule-strong);background:var(--raise)}
.cob-consent.on{border-color:var(--slate);background:var(--slate-tint)}
.cob-consent input{width:18px;height:18px;margin:1px 0 0;flex:0 0 auto;accent-color:var(--slate)}
.cob-consent span{font-size:var(--text-sm);color:var(--ink-2);line-height:1.5}
.cob-plans{display:flex;flex-direction:column;gap:10px}
.cob-plan{display:flex;gap:12px;align-items:flex-start;padding:15px;border:1.5px solid var(--rule);
  border-radius:var(--r-m);cursor:pointer;transition:border-color .14s,background .14s}
.cob-plan:hover{border-color:var(--rule-strong);background:var(--raise)}
.cob-plan.on{border-color:var(--slate);background:var(--slate-tint)}
.cob-plan input{width:18px;height:18px;margin:1px 0 0;flex:0 0 auto;accent-color:var(--slate)}
.cob-plan b{display:block;font-size:var(--text-base);font-weight:600;letter-spacing:-.015em}
.cob-plan span span{display:block;font-size:var(--text-sm);color:var(--muted);line-height:1.5;margin-top:2px}
.cob-truth{border:1px solid var(--rule-strong);border-radius:var(--r-l);padding:18px 20px;background:var(--raise);margin-bottom:20px}
.cob-truth h4{margin:0 0 4px;font-size:var(--text-base);letter-spacing:-.015em}
.cob-truth p{font-size:var(--text-sm);color:var(--ink-2);line-height:1.58;margin-top:9px}
.cob-truth p:first-of-type{margin-top:0}
.cob-lock{display:flex;gap:11px;align-items:flex-start;background:var(--warn-tint);border-radius:var(--r-m);
  padding:14px 16px;margin-bottom:18px}
.cob-lock svg{color:var(--warn);flex:0 0 auto;margin-top:3px}
.cob-lock p{font-size:var(--text-sm);color:var(--ink-2);line-height:1.55}
.cob-rb{border:1px solid var(--rule);border-radius:var(--r-l);padding:18px 20px;margin-bottom:14px}
.cob-rbhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}
.cob-rbhead h4{font-size:var(--text-base);letter-spacing:-.015em}
.cob-rb .linerow b{font-weight:700;color:var(--ink)}
.cob-rb .linerow span:last-child{text-align:right;min-width:0}
.cob-nav{display:flex;align-items:center;gap:14px;margin-top:24px;padding-top:20px;border-top:1px solid var(--rule);flex-wrap:wrap}
.cob-nav .err{flex:1;min-width:180px;line-height:1.45}
.cob-navspacer{flex:1}
.cob-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:4px}
@media(max-width:1020px){
  .cob-grid{grid-template-columns:1fr;gap:22px}
  .cob-rail{position:static}
  .cob-rail ol{flex-direction:row;overflow-x:auto;gap:6px;padding-bottom:6px}
  .cob-stepitem{flex:0 0 auto}
  .cob-two,.cob-three{grid-template-columns:1fr}
  .cob-card{padding:20px}
}
`;

/* ═══════════════════ VIEW PIECES ═══════════════════ */

function railHTML(d){
  const open = firstOpen(d);
  return `<nav class="cob-rail" aria-label="Coach onboarding progress">
    <ol>
      ${STEPS.map((st, i) => {
        const cur = i === d.step, done = stepDone(i, d), can = i <= open;
        const status = cur ? "Current step" : done ? "Complete" : can ? "Not started" : "Locked";
        const label = "Step " + (i + 1) + " of " + STEPS.length + ", " + st[0] + " — " +
          (cur ? "current step" : done ? "complete" : can ? "not started" : "finish the earlier steps first");
        return `<li class="cob-stepitem ${cur ? "on" : ""} ${done ? "done" : ""}" ${cur ? 'aria-current="step"' : ""}>
          <button class="cob-steplink" data-cob-step="${i}" ${can ? "" : "disabled"} aria-label="${esc(label)}">
            <span class="cob-dot ${done ? "" : "num"}" aria-hidden="true">${done ? ICON.check : (i + 1)}</span>
            <span class="cob-steptxt"><b>${esc(st[0])}</b><span>${esc(status)}</span></span>
          </button></li>`;
      }).join("")}
    </ol>
    <p class="cob-railfoot"><span class="num">${open}</span> of <span class="num">${LAST}</span> steps complete.
      Nothing is submitted until the last step, and your answers stay put if you jump back.</p>
  </nav>`;
}

function fieldCls(err, name){ return err && err.field === name ? "field cob-bad" : "field"; }

function identityStep(d, err){
  return `
  <div class="cob-two">
    <div class="${fieldCls(err, "legalName")}" data-cob-field="legalName">
      <label for="cobLegal">Full legal name</label>
      <input id="cobLegal" data-cob-in="legalName" value="${esc(d.legalName)}" placeholder="As printed on your ID" autocomplete="name">
    </div>
    <div class="${fieldCls(err, "businessName")}" data-cob-field="businessName">
      <label for="cobBiz">Business or academy name</label>
      <input id="cobBiz" data-cob-in="businessName" value="${esc(d.businessName)}" placeholder="e.g. ${esc(SEED.providerProfile.businessName)}">
    </div>
  </div>
  <p class="cob-help">Families see the business name. Only Sporv and the screening partner see the legal name.</p>

  <div class="${fieldCls(err, "phone")}" data-cob-field="phone">
    <label for="cobPhone">Phone number</label>
    <input id="cobPhone" type="tel" class="num" data-cob-in="phone" value="${esc(d.phone)}" placeholder="+1 (305) 555-0142" autocomplete="tel">
  </div>
  <p class="cob-help">Digits, spaces, brackets, dashes, and a leading + only —
    <span class="num" data-cob-phonecount>${phoneDigits(d.phone)}</span> digits so far, and it needs between 7 and 15.</p>

  <div class="cob-two">
    <div class="${fieldCls(err, "city")}" data-cob-field="city">
      <label for="cobCity">City</label>
      <input id="cobCity" data-cob-in="city" value="${esc(d.city)}" placeholder="Chicago">
    </div>
    <div class="${fieldCls(err, "region")}" data-cob-field="region">
      <label for="cobRegion">State or region</label>
      <input id="cobRegion" data-cob-in="region" value="${esc(d.region)}" placeholder="FL">
    </div>
  </div>
  <div class="${fieldCls(err, "years")}" data-cob-field="years" style="max-width:220px">
    <label for="cobYears">Years coaching</label>
    <input id="cobYears" type="number" min="0" max="70" step="1" class="num" data-cob-in="years" value="${esc(d.years)}" placeholder="0">
  </div>
  <p class="cob-help">Shown on your profile as experience. It is not a credential and it does not affect verification.</p>`;
}

function sportsStep(d, err){
  const sports = Object.keys(SPORT_COLOR).sort();
  return `
  <fieldset class="${err && err.field === "sports" ? "cob-bad" : ""}" style="border:0;padding:0;margin:0" data-cob-field="sports">
    <legend class="eyebrow" style="padding:0;margin-bottom:11px">Sports you coach</legend>
    <div class="cob-picks">
      ${sports.map(s => {
        const on = d.sports.indexOf(s) >= 0;
        return `<button type="button" class="sportpick ${on ? "on" : ""}" data-cob-sport="${esc(s)}"
          style="--sc:${sportColor(s)}" aria-pressed="${on}"
          aria-label="${esc((on ? "Remove " : "Add ") + s)}">${sportGlyph(s)} ${esc(s)}</button>`;
      }).join("")}
    </div>
  </fieldset>
  <p class="num" style="color:#57606E;font-size:var(--text-sm);margin-top:12px">${d.sports.length} of ${sports.length} selected</p>
  ${d.sports.length ? `<div class="cob-chips" style="margin-top:10px">
    ${d.sports.map(s => `<span class="pill" style="background:${sportColor(s)}1A;color:${sportColor(s)}">${sportGlyph(s)} ${esc(s)}</span>`).join("")}
  </div>` : ""}
  <p class="cob-help" style="margin-top:16px">Pick only what you coach. A sport you list but cannot teach still shows you
    in that sport's results, and the first family who books finds out.</p>`;
}

function svcSummary(s){
  const cap = intOf(s.capacity), mins = intOf(s.minutes);
  const f = formatRow(s.format);
  const who = s.format === "private" ? "one athlete"
    : (isFinite(cap) ? "up to " + cap + " athlete" + (cap === 1 ? "" : "s") : "capacity not set");
  return f[1] + " · " + who + " · " + (isFinite(mins) ? durLabel(mins) : "length not set");
}

function servicesStep(d, err){
  return `
  ${d.services.map((s, i) => `
    <div class="cob-svc" data-cob-svc="${esc(s.id)}">
      <div class="cob-svchead">
        <div style="min-width:0">
          <div class="cob-svcno">Service ${i + 1}</div>
          <div class="cob-svcsum" data-cob-svcsum="${esc(s.id)}" style="margin-top:3px">${esc(svcSummary(s))}</div>
        </div>
        ${d.services.length > 1
          ? `<button class="x" data-cob-delsvc="${esc(s.id)}" aria-label="Remove service ${i + 1}${s.name ? ", " + esc(s.name) : ""}">${ICON.x}</button>`
          : ""}
      </div>

      <div class="${fieldCls(err, "name-" + s.id)}" data-cob-field="name-${esc(s.id)}">
        <label for="cobName-${esc(s.id)}">Service name</label>
        <input id="cobName-${esc(s.id)}" data-cob-svcin="${esc(s.id)}|name" value="${esc(s.name)}"
          placeholder="e.g. Guard Development Lab">
      </div>

      <fieldset style="border:0;padding:0;margin:0" data-cob-field="format-${esc(s.id)}">
        <legend class="eyebrow" style="padding:0;margin-bottom:9px">Format</legend>
        <div class="cob-fmt">
          ${FORMATS.map(([k, label, blurb]) => `
            <label class="cob-fmtopt ${s.format === k ? "on" : ""}">
              <input type="radio" name="cobFmt-${esc(s.id)}" value="${k}" ${s.format === k ? "checked" : ""}
                data-cob-fmt="${esc(s.id)}|${k}">
              <span style="min-width:0"><b>${esc(label)}</b><span>${esc(blurb)}</span></span>
            </label>`).join("")}
        </div>
      </fieldset>

      <div class="cob-two">
        <div class="${fieldCls(err, "capacity-" + s.id)}" data-cob-field="capacity-${esc(s.id)}">
          <label for="cobCap-${esc(s.id)}">Maximum athletes at once</label>
          <input id="cobCap-${esc(s.id)}" type="number" min="1" max="200" step="1" class="num"
            data-cob-svcin="${esc(s.id)}|capacity" value="${esc(s.capacity)}">
        </div>
        <div class="${fieldCls(err, "minutes-" + s.id)}" data-cob-field="minutes-${esc(s.id)}">
          <label for="cobMin-${esc(s.id)}">Session length (minutes)</label>
          <input id="cobMin-${esc(s.id)}" type="number" min="10" max="600" step="5" class="num"
            data-cob-svcin="${esc(s.id)}|minutes" value="${esc(s.minutes)}">
        </div>
      </div>
      <p class="cob-help">${esc(formatRow(s.format)[2])} Capacity is the number Sporv enforces at checkout —
        once it is reached the service stops taking bookings and opens a waitlist.</p>
    </div>`).join("")}

  <button class="btn ghost" data-cob-addsvc="1">+ Add another service</button>
  <p class="cob-help" style="margin-top:14px">Each service becomes its own listing. Two prices for the same
    thing belong in two services, not one.</p>`;
}

function pricingStep(d, err){
  const priced = d.services.filter(s => !isBlank(s.price) && isFinite(Number(s.price)) && Number(s.price) >= 0);
  const gross = priced.reduce((t, s) => t + Number(s.price), 0);
  const proPrice = planPrice("pro");
  return `
  ${d.services.map((s, i) => {
    const p = isBlank(s.price) ? null : Number(s.price);
    const ok = p != null && isFinite(p) && p >= 0;
    return `
    <div class="cob-svc" data-cob-svc="${esc(s.id)}">
      <div class="cob-svchead">
        <div style="min-width:0">
          <div class="cob-svcno">Service ${i + 1}</div>
          <b style="font-size:var(--text-base);letter-spacing:-.02em">${esc(s.name || "Untitled service")}</b>
          <div class="cob-svcsum" style="margin-top:2px">${esc(svcSummary(s))}</div>
        </div>
      </div>
      <div class="cob-two">
        <div class="${fieldCls(err, "price-" + s.id)}" data-cob-field="price-${esc(s.id)}">
          <label for="cobPrice-${esc(s.id)}">Price you charge</label>
          <input id="cobPrice-${esc(s.id)}" type="number" min="0" max="100000" step="1" class="num"
            data-cob-svcin="${esc(s.id)}|price" value="${esc(s.price)}" placeholder="0">
        </div>
        <div class="${fieldCls(err, "model-" + s.id)}" data-cob-field="model-${esc(s.id)}">
          <label for="cobModel-${esc(s.id)}">Pricing model</label>
          <select id="cobModel-${esc(s.id)}" data-cob-model="${esc(s.id)}">
            ${MODELS.map(([k, label]) => `<option value="${k}" ${s.model === k ? "selected" : ""}>${esc(label)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="cob-take">
        <p class="cob-takenote">${esc(modelRow(s.model)[2])}
          Sporv takes no share of this price.</p>
        <div class="cob-takefig">
          <b class="num" data-cob-net="${esc(s.id)}">${ok ? money(p) : "—"}</b>
          <span>you keep${ok ? ", all of it" : " — enter a price"}</span>
        </div>
      </div>
    </div>`;
  }).join("")}

  <div class="panel" style="background:var(--raise);border:0;margin-top:4px">
    <div class="eyebrow">If one of each sold at list price</div>
    <div class="linerow"><span>Families pay</span><span class="num" data-cob-gross>${money(gross)}</span></div>
    <div class="linerow total"><span>Reaches your account</span><span class="num" data-cob-nettotal>${money(gross)}</span></div>
  </div>
  <p class="cob-help" style="margin-top:14px">Stripe settles its own payment-processing charge on top of
    this. Sporv is not part of that number.</p>

  ${/* THE PLAN CHOICE — the step that used to explain a commission.
       Free is pre-selected and stays selected unless the coach changes it: an
       upsell that defaults to the paid tier is how someone finds a charge they
       did not choose. Nothing here takes a payment; see submittedHTML(). */""}
  <fieldset style="border:0;padding:0;margin:26px 0 0" data-cob-field="plan">
    <legend class="eyebrow" style="padding:0;margin-bottom:11px">Your plan</legend>
    <div class="cob-plans">
      ${[["free", "Start free", ((plans()&&plans().free?plans().free.adds:"Three AI actions a month, one seat.")+" No card.")],
         ["pro",  planName("pro") + (proPrice ? " — " + proPrice : ""),
                  "Unlimited AI actions and up to three seats."]]
        .map(([k, label, note]) => `
        <label class="cob-plan ${d.plan === k ? "on" : ""}">
          <input type="radio" name="cobplan" value="${k}" data-cob-plan="${k}"
            ${d.plan === k ? "checked" : ""}>
          <span style="min-width:0"><b>${esc(label)}</b><span>${esc(note)}</span></span>
        </label>`).join("")}
    </div>
    <p class="cob-help" style="margin-top:12px">Either way you keep every dollar a family pays. Pro is
      charged after you submit, from your account page, and you can change plan any time.</p>
  </fieldset>`;
}

function availabilityStep(d, err){
  const a = toMin(d.startTime), b = toMin(d.endTime);
  const span = isFinite(a) && isFinite(b) && b > a ? durLabel(b - a) : null;
  return `
  <fieldset class="${err && err.field === "days" ? "cob-bad" : ""}" style="border:0;padding:0;margin:0 0 6px" data-cob-field="days">
    <legend class="eyebrow" style="padding:0;margin-bottom:11px">Days you can coach</legend>
    <div class="cob-days">
      ${WD.map(([k, short, long]) => {
        const on = d.days.indexOf(k) >= 0;
        return `<button type="button" class="cob-day ${on ? "on" : ""}" data-cob-day="${k}"
          aria-pressed="${on}" aria-label="${esc((on ? "Remove " : "Add ") + long)}">${short}</button>`;
      }).join("")}
    </div>
  </fieldset>
  <p class="cob-help" style="margin-top:10px">
    <span class="num" data-cob-daycount>${d.days.length}</span> day${d.days.length === 1 ? "" : "s"} selected.</p>

  <div class="cob-two" style="max-width:420px">
    <div class="${fieldCls(err, "startTime")}" data-cob-field="startTime">
      <label for="cobStart">Window starts</label>
      <input id="cobStart" type="time" class="num" data-cob-in="startTime" value="${esc(d.startTime)}">
    </div>
    <div class="${fieldCls(err, "endTime")}" data-cob-field="endTime">
      <label for="cobEnd">Window ends</label>
      <input id="cobEnd" type="time" class="num" data-cob-in="endTime" value="${esc(d.endTime)}">
    </div>
  </div>
  <div class="cob-take" data-cob-window>
    <p class="cob-takenote">Families only ever see slots inside this window. You can carve exact
      sessions out of it from the schedule once you are live.</p>
    <div class="cob-takefig">
      <b class="num" data-cob-span>${span ? esc(span) : "—"}</b>
      <span>${span ? "open each selected day" : "end has to be after start"}</span>
    </div>
  </div>`;
}

function backgroundStep(d, err){
  const age = ageFrom(d.dob);
  return `
  <div class="cob-truth">
    <h4>${ICON.shield} What this check is, and what it is not</h4>
    <p><b>It runs on a person, not on a business.</b> The screening partner checks the individual named above —
      an identity match, then criminal and sex-offender registry records.</p>
    <p><b>An approved business never vouches for an individual.</b>
      ${esc(SEED.providerProfile.businessName)} is an approved business on Sporv, and every single coach working
      under it must still clear their own check. Being invited by an approved academy grants nothing.</p>
    <p><b>You cannot mark yourself as checked.</b> This form collects consent and identifiers.
      The result is written by the screening partner, and nothing you enter here can set it.</p>
  </div>

  <div class="cob-lock">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
    <p>Until the check clears, your listings stay <b>hidden and unbookable</b>. They are saved as drafts,
      they do not appear in search, in the map, or to the coach finder, and no family can pay for one.</p>
  </div>

  <div class="cob-two">
    <div class="${fieldCls(err, "dob")}" data-cob-field="dob">
      <label for="cobDob">Date of birth</label>
      <input id="cobDob" type="date" class="num" max="${TODAY_ISO}" data-cob-in="dob" value="${esc(d.dob)}">
    </div>
    <div class="${fieldCls(err, "ssn4")}" data-cob-field="ssn4">
      <label for="cobSsn">Last 4 digits of SSN</label>
      <input id="cobSsn" type="text" inputmode="numeric" maxlength="4" class="num" data-cob-in="ssn4"
        value="${esc(d.ssn4)}" placeholder="0000" autocomplete="off">
    </div>
  </div>
  <p class="cob-help">${age != null && age >= 0
    ? `That date of birth makes you <span class="num">${age}</span>.`
    : "Coaches must be 18 or older."}
    Sporv stores the last four digits only — never a full Social Security number.</p>

  <label class="cob-consent ${d.consent ? "on" : ""} ${err && err.field === "consent" ? "cob-bad" : ""}"
    data-cob-field="consent">
    <input type="checkbox" data-cob-consent="1" ${d.consent ? "checked" : ""}>
    <span>I authorize Sporv's screening partner to run an identity verification and criminal background
      check on <b>${esc(d.legalName || "me")}</b>, and I confirm the date of birth and SSN digits above are mine.
      I understand a false statement here ends the application.</span>
  </label>

  <div class="cob-take">
    <p class="cob-takenote">Checks usually return in 2–5 business days. You will get a notification either way,
      and you can build listings while you wait.</p>
    <div class="cob-takefig">
      <span class="pill warn">Result: pending</span>
      <span style="margin-top:6px">set by the screening partner</span>
    </div>
  </div>
  <p style="margin-top:16px"><button class="btn ghost sm" data-modal="verifyid">What exactly gets checked?</button></p>`;
}

/* ── review ──────────────────────────────────────────────────────── */
function line(label, value){
  return `<div class="linerow"><span>${esc(label)}</span><span><b>${value}</b></span></div>`;
}
function rbHead(title, step){
  return `<div class="cob-rbhead"><h4>${esc(title)}</h4>
    <button class="btn ghost sm" data-cob-step="${step}"
      aria-label="Edit ${esc(title)} — back to step ${step + 1}">Edit</button></div>`;
}
function reviewStep(d, err){
  const priced = d.services.filter(s => !isBlank(s.price) && isFinite(Number(s.price)));
  const gross = priced.reduce((t, s) => t + Number(s.price), 0);
  const proPrice = planPrice("pro");
  const bgSteps = [["Consent given", !!d.consent], ["Submitted to partner", false],
    ["Screening", false], ["Result", false]];
  return `
  <div class="cob-rb">
    ${rbHead("Identity", 0)}
    ${line("Legal name", esc(d.legalName))}
    ${line("Business name", esc(d.businessName))}
    ${line("Phone", `<span class="num">${esc(d.phone)}</span>`)}
    ${line("Based in", esc(trim(d.city) + ", " + trim(d.region)))}
    ${line("Years coaching", `<span class="num">${esc(d.years)}</span>`)}
  </div>

  <div class="cob-rb">
    ${rbHead("Sports", 1)}
    <div class="cob-chips" style="margin:8px 0 2px">
      ${d.sports.map(s => `<span class="pill" style="background:${sportColor(s)}1A;color:${sportColor(s)}">${sportGlyph(s)} ${esc(s)}</span>`).join("")}
    </div>
  </div>

  <div class="cob-rb">
    ${rbHead("Services & capacity", 2)}
    ${d.services.map((s, i) => `
      ${line("Service " + (i + 1), esc(s.name))}
      <div class="linerow" style="padding-top:0"><span style="color:var(--faint)">&nbsp;</span>
        <span class="num" style="color:var(--muted)">${esc(svcSummary(s))}</span></div>`).join("")}
  </div>

  <div class="cob-rb">
    ${rbHead("Pricing and your plan", 3)}
    ${d.services.map(s => line(s.name || "Untitled service",
      `<span class="num">${money(Number(s.price))}</span> <span style="font-weight:500;color:var(--muted)">${esc(MODEL_UNIT[s.model] || s.model)}</span>`)).join("")}
    <div class="linerow total"><span>You keep, across one of each</span><span class="num">${money(gross)}</span></div>
    ${line("Plan", d.plan === "pro"
      ? esc(planName("pro") + (proPrice ? ", " + proPrice : "") + " — starts after you submit")
      : "Free")}
  </div>

  <div class="cob-rb">
    ${rbHead("Availability", 4)}
    ${line("Days", esc(d.days.map(wdLong).join(", ")))}
    ${line("Window", `<span class="num">${esc(t12(d.startTime))} – ${esc(t12(d.endTime))}</span>`)}
  </div>

  <div class="cob-rb">
    ${rbHead("Background check", 5)}
    ${line("Date of birth", `<span class="num">${esc(prettyDate(d.dob))}</span>`)}
    ${line("SSN", `<span class="num">••• •• ${esc(trim(d.ssn4))}</span>`)}
    ${line("Consent", d.consent ? "Given" : "Not given")}
    ${line("Status", `<span class="pill warn">Pending</span>`)}
    <div class="track" aria-label="Background check progress">
      ${bgSteps.map(([l, done], i) => `<div class="step ${done ? "done" : ""}">
        <span class="dot">${done ? ICON.check : ""}</span><span class="lbl">${esc(l)}</span>
        ${i < bgSteps.length - 1 ? '<span class="bar"></span>' : ""}</div>`).join("")}
    </div>
  </div>

  <div class="cob-lock">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
    <p>Submitting creates your coach profile and <span class="num">${d.services.length}</span>
      draft listing${d.services.length === 1 ? "" : "s"}. The profile is created <b>unverified</b>,
      the check is created <b>pending</b>, and the listings are created <b>drafts</b> — unpublished,
      unbookable, and invisible to families until the check clears.</p>
  </div>
  ${isVerified() ? "" : `<p class="cob-help">You are not signed in, so this application is held in this
    session only. Sign in before submitting if you want it kept against your account.</p>`}`;
}

const STEP_VIEW = [identityStep, sportsStep, servicesStep, pricingStep, availabilityStep, backgroundStep, reviewStep];

/* ── the submitted state — the wizard does not offer a second submit ── */
function submittedHTML(d){
  const p = d.profile || {};
  return `<main class="shell cob-page">
    <div class="cob-top">
      <p class="eyebrow">Coach onboarding</p>
      <h1>Application submitted</h1>
      <p class="cob-lede">${esc(p.businessName || d.businessName)} is on file. Nothing about it is live yet —
        and nothing here was marked verified by you or by this form.</p>
    </div>
    <div class="cob-card" style="max-width:760px">
      <div class="linerow"><span>Profile status</span><span><b><span class="pill warn">${esc(p.status || "pending")}</span></b></span></div>
      <div class="linerow"><span>Background check</span><span><b><span class="pill warn">${esc(p.backgroundCheck || "pending")}</span></b></span></div>
      <div class="linerow"><span>Verification</span><span><b><span class="pill slate">${esc(p.verification || "unverified")}</span></b></span></div>
      <div class="linerow"><span>Draft listings</span><span><b class="num">${(d.drafts || []).length}</b></span></div>
      <div class="linerow"><span>Plan</span><span><b>${d.plan === "pro"
        ? esc(planName("pro") + (planPrice("pro") ? " — " + planPrice("pro") : "") + ", not started yet")
        : "Free"}</b></span></div>
      <div class="linerow total"><span>Visible to families</span><span><b>None, until the check clears</b></span></div>
      ${/* The plan the coach picked on step 4, now that there is a coach row
           for the checkout to belong to. Free needs no action and gets a
           sentence, not a button. */""}
      ${d.plan === "pro" ? `
        <p class="cob-help" style="margin:18px 0 10px">You chose ${esc(planName("pro"))}. Nothing has been
          charged — Stripe takes the payment, and your plan changes when it confirms.</p>
        <button class="btn" data-cob-buypro="1">Start ${esc(planName("pro"))}${
          planPrice("pro") ? " — " + esc(planPrice("pro")) : ""}</button>
        <p class="err hide" data-cob-buyerr role="alert" style="margin-top:10px"></p>`
      : `<p class="cob-help" style="margin:18px 0 0">You are on the free plan. Pro is one button in
          Account → Billing whenever you want it.</p>`}
      <div class="cob-lock" style="margin:20px 0 0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
          stroke-linecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
        <p>Your drafts are kept with your application. They are not in the marketplace catalogue,
          so no search, map pin, or assistant answer can surface them.</p>
      </div>
      <div class="cob-nav">
        <button class="btn" data-cob-dash="1">Go to your dashboard</button>
        <span class="cob-navspacer"></span>
        <button class="btn ghost" data-modal="verifyid">What gets checked?</button>
      </div>
    </div>
  </main>`;
}

/* ═══════════════════ THE VIEW ═══════════════════ */
function onboardView(){
  const d = draft();
  if (d.submittedAt) return submittedHTML(d);

  const i = d.step;
  const err = checkStep(i, d);
  const last = i === LAST;
  const st = STEPS[i];

  /* ═══ Owner visual spec, 2026-08-12 ═══════════════════════════════════════
     Airbnb's STRUCTURE, Sporv's look: fixed 72px header, independently
     scrolling middle, fixed footer with the progress bar sitting directly
     above the Back/Next row.

     The seven steps are unchanged — this replaces the CHROME around
     STEP_VIEW[i], not the questions. Rebuilding seven validated steps to
     restyle them would have risked the background-check consent screen, which
     is the one screen in this app where a mistake is a safety problem.

     Progress is per-segment and proportional WITHIN the active segment, as
     specified: three chapters over seven steps, so a chapter is 2–3 steps and
     the active one fills partially rather than jumping.

     overscroll-behavior:contain on .cw-body is deliberate — the spec calls out
     that a scroll at the end of a card grid bouncing the whole page was a real
     bug in the Explore map view. */
  const CHAPTERS = [[0,1],[2,3,4],[5,6]];
  const segs = CHAPTERS.map(ch => {
    const done = ch.filter(x => x < i).length;
    const active = ch.indexOf(i) >= 0;
    return active ? Math.round(((done + 0.5) / ch.length) * 100) : (i > ch[ch.length-1] ? 100 : 0);
  });
  const pct = Math.round((i / LAST) * 100);

  return `<div class="cw" role="group" aria-label="Coach onboarding">
    <header class="cw-top">
      <span class="cg-wordmark" style="font-size:15px;font-weight:800">Sporv</span>
      <span class="cw-topright">
        <a class="cw-help" href="mailto:support@sporve.com">Questions?</a>
        <button class="cw-exit" type="button" data-cob-exit="1">Save &amp; exit</button>
      </span>
    </header>

    <div class="cw-body">
      <div class="cw-wrap cw-screen" key="step-${i}">
        <div>
          <span class="cw-micro">Step ${i + 1} of ${STEPS.length}</span>
          ${/* focus lands here on every screen change so a screen-reader user
               hears the new question rather than staying where they were */""}
          <h1 class="cw-h1" id="cwQ" tabindex="-1">${esc(st[1])}</h1>
          <p class="cw-sub">${esc(st[2])}</p>
        </div>
        <section aria-labelledby="cwQ">
          ${STEP_VIEW[i](d, err)}
          <div class="err ${err ? "" : "hide"}" data-cob-err role="alert"
               style="margin-top:14px">${err ? esc(err.msg) : ""}</div>
        </section>
      </div>
    </div>

    <footer class="cw-foot">
      <div class="cw-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${pct}" aria-label="Onboarding progress">
        ${segs.map(w => `<span class="cw-seg"><i style="width:${w}%"></i></span>`).join("")}
      </div>
      <div class="cw-row">
        <button class="cw-back" type="button" data-cob-back="1"
                ${i === 0 ? "disabled" : ""}>Back</button>
        <button class="cw-next" type="button" data-cob-next="1"
                ${err ? "disabled" : ""}>${last ? "Submit application" : "Next"}</button>
      </div>
    </footer>
  </div>`;
}

/* ═══════════════════ MODAL ═══════════════════ */
const wrap = (title, body) =>
  `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-body">${body}</div></div></div>`;

function verifyIdModal(){
  const d = draft();
  const rows = [
    ["Identity match", "Your legal name, date of birth, and the last four SSN digits are matched against public identity records. A name alone is not enough to identify a person."],
    ["Criminal records search", "County, state, and federal records across every jurisdiction tied to your address history."],
    ["Sex offender registry", "The national registry, plus every state registry."],
    ["Ongoing monitoring", "The check is re-run periodically. Verification is a state you keep, not a badge you earn once."],
  ];
  return wrap("What gets checked", `
    <p style="color:var(--muted);margin-bottom:18px">Run by Sporv's screening partner on
      <b style="color:var(--ink)">${esc(d.legalName || "the individual coach")}</b> — the person, not the business.</p>
    ${rows.map(([h, b]) => `<div class="linerow" style="display:block">
      <b style="display:block;color:var(--ink)">${esc(h)}</b>
      <span style="display:block;color:var(--muted);font-size:var(--text-sm);line-height:1.5;margin-top:3px">${esc(b)}</span>
    </div>`).join("")}
    <div class="panel" style="background:var(--warn-tint);border:0;margin-top:18px">
      <p style="font-size:var(--text-sm);color:var(--ink-2);line-height:1.55">
        Three things this form can never do: mark you verified, approve your business, or publish a listing.
        Those are written by Sporv after the partner returns a result — which is why every field on the
        previous step is stored as <span class="num">pending</span> no matter what you type.</p>
    </div>
    <div class="panel" style="background:var(--raise);border:0;margin-top:12px">
      <div class="eyebrow">Cost and timing</div>
      <p style="font-size:var(--text-sm);color:var(--ink-2);line-height:1.55;margin-top:8px">
        Sporv pays for the check. Results usually return in 2–5 business days; a record that needs a
        court clerk to confirm it can take longer.</p>
    </div>
    <button class="btn wide" data-close="1" style="margin-top:18px">Back to the form</button>`);
}

/* ═══════════════════ SUBMIT ═══════════════════
   The single write path. Note what it does NOT read: there is no input on
   any step that can reach status, verification, or backgroundCheck. They
   are literals. */
function submitApplication(){
  const d = draft();
  const bad = checkReview(d);
  if (bad){
    d.step = Number(String(bad.field).split("-")[1]) || 0;
    render();
    toast("Fix " + STEPS[d.step][0].toLowerCase() + " before submitting");
    return false;
  }

  const now = new Date().toISOString();
  const location = trim(d.city) + ", " + trim(d.region);

  /* profile — created unverified and pending, always */
  d.profile = {
    id: "provider_" + Date.now(),
    legalName: trim(d.legalName),
    businessName: trim(d.businessName),
    phone: trim(d.phone),
    location: location,
    yearsCoaching: intOf(d.years),
    sports: d.sports.slice(),
    bio: "",
    availability: { days: d.days.slice(), start: d.startTime, end: d.endTime },
    status: "pending",              // never "approved"
    verification: "unverified",     // never "verified"
    backgroundCheck: "pending",     // never "clear"
    backgroundConsentAt: d.consent ? now : null,
    onboardingCompleted: true,
    stripeAccountId: null,
    submittedAt: now,
  };

  /* services → draft listings. They are deliberately NOT pushed into
     PROGRAMS or S.listings: everything the family side reads comes from
     PROGRAMS, so a draft that never lands there cannot be searched,
     mapped, recommended, or booked. That is the lock, in one decision. */
  d.drafts = d.services.map((s, i) => ({
    id: "draft_" + Date.now() + "_" + (i + 1),
    providerId: d.profile.id,
    biz: d.profile.businessName,
    title: trim(s.name),
    sport: d.sports[0] || null,
    sports: d.sports.slice(),
    format: s.format,
    cap: intOf(s.capacity),
    enrolled: 0,
    minutes: intOf(s.minutes),
    price: Number(trim(s.price)),
    model: s.model,
    netPerSale: Number(trim(s.price)),   // no marketplace fee — net is the price
    availability: { days: d.days.slice(), start: d.startTime, end: d.endTime },
    status: "draft",                // never "published"
    published: false,
    visible: false,
    bookable: false,
    verified: false,                // never true
    createdAt: now,
  }));

  d.submittedAt = now;

  /* PERSIST. Everything above builds an object inside S and stops there — this
     whole 1,115-line wizard had ZERO references to the API, so a coach filled
     in seven steps, hit submit, and every answer lived only in sessionStorage.
     Close the tab and the application was gone.

     Only the fields the coach owns are sent. `status`, `verification_status`
     and `background_check_status` are deliberately NOT included: they are the
     approval decision, they belong to Sporv, and a client that names those
     columns is one typo from a coach approving themselves. The server defaults
     (pending / unverified / none) stand until a human moves them.

     Fire-and-report, not fire-and-forget: a failed save tells the coach their
     application did not reach us, because silently losing an application is
     how someone waits two weeks for a reply to something we never received. */
  if (window.SporveCoach && window.SporveAuth && window.SporveAuth.isSignedIn()){
    window.SporveCoach.save({
      business_name: trim(d.businessName),
      bio: trim(d.bio || ""),
      location: location,
      sports: d.sports.slice(),
      coach_years_coaching: intOf(d.years) || null,
      credentials: (d.credentials || []).slice(),
    }).then(() => {
      toast("Application saved to your account");
    }).catch(() => {
      toast("Saved on this device, but we could not reach Sporv — reopen to retry");
    });
  }

  S.portal = "coach";
  S.coachTab = "dashboard";
  S.route = { name: "dashboard", arg: null };
  S.modal = null;
  if (typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
  render();
  toast("Application submitted — background check pending, listings held as drafts");
  return true;
}

/* ═══════════════════ IN-PLACE REPAINT ═══════════════════
   The host re-renders the whole DOM on every state change, which would
   take the caret with it. So a keystroke updates state and then repaints
   only the nodes that depend on it: the error line, the Continue button,
   the per-service take-home figures, and the field outlines. */
function sync(){
  if (typeof document === "undefined") return;
  const d = draft();
  if (d.submittedAt) return;
  const err = checkStep(d.step, d);

  const box = document.querySelector("[data-cob-err]");
  if (box){
    box.textContent = err ? err.msg : "";
    if (err) box.classList.remove("hide"); else box.classList.add("hide");
  }
  const next = document.querySelector("[data-cob-next]");
  if (next) next.disabled = !!err;

  document.querySelectorAll("[data-cob-field]").forEach(el => {
    el.classList.toggle("cob-bad", !!err && err.field === el.dataset.cobField);
  });

  const pc = document.querySelector("[data-cob-phonecount]");
  if (pc) pc.textContent = String(phoneDigits(d.phone));

  const dc = document.querySelector("[data-cob-daycount]");
  if (dc) dc.textContent = String(d.days.length);

  d.services.forEach(s => {
    const sum = document.querySelector('[data-cob-svcsum="' + s.id + '"]');
    if (sum) sum.textContent = svcSummary(s);
    const net = document.querySelector('[data-cob-net="' + s.id + '"]');
    if (net){
      const p = isBlank(s.price) ? null : Number(trim(s.price));
      const ok = p != null && isFinite(p) && p >= 0;
      net.textContent = ok ? money(p) : "—";
      const cap = net.parentNode && net.parentNode.querySelector ? net.parentNode.querySelector("span") : null;
      if (cap) cap.textContent = ok ? "you keep, all of it" : "you keep — enter a price";
    }
  });

  const priced = d.services.filter(s => !isBlank(s.price) && isFinite(Number(trim(s.price))) && Number(trim(s.price)) >= 0);
  const gross = priced.reduce((t, s) => t + Number(trim(s.price)), 0);
  const g = document.querySelector("[data-cob-gross]"); if (g) g.textContent = money(gross);
  const n = document.querySelector("[data-cob-nettotal]"); if (n) n.textContent = money(gross);

  const sp = document.querySelector("[data-cob-span]");
  if (sp){
    const a = toMin(d.startTime), b = toMin(d.endTime);
    sp.textContent = isFinite(a) && isFinite(b) && b > a ? durLabel(b - a) : "—";
  }
}

/* ═══════════════════ WIRING ═══════════════════ */
function goStep(i){
  const d = draft();
  const target = Math.max(0, Math.min(LAST, i));
  if (target > d.step && !reachable(target, d)) return;
  d.step = target;
  if (typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
  render();
}

function wire(){
  if (typeof document === "undefined") return;
  const q = s => document.querySelectorAll(s);
  const d = draft();

  /* rail + every "Edit" affordance on the review step */
  q("[data-cob-step]").forEach(b => b.onclick = () => goStep(Number(b.dataset.cobStep)));
  /* Save & exit. The draft already lives in S and S is persisted, so the
     "save" half is real rather than a label — leaving and coming back returns
     to the same step with the same answers. */
  q("[data-cob-exit]").forEach(b => b.onclick = () => {
    if (window.SporveCoach && window.SporveAuth && window.SporveAuth.isSignedIn()){
      const d = draft();
      window.SporveCoach.save({
        business_name: trim(d.businessName || ""),
        sports: (d.sports || []).slice(),
      }).catch(() => {});
    }
    S.coachTab = "dashboard";
    S.route = { name: "dashboard", arg: null };
    toast("Saved — pick up where you left off any time");
    render();
  });

  /* Spec: focus moves to the question headline on every screen change, so a
     screen-reader user hears the new question instead of being left where the
     old one was. preventScroll because the shell scrolls its own middle. */
  const cwq = document.getElementById("cwQ");
  if (cwq && S.cobFocusStep !== draft().step){
    S.cobFocusStep = draft().step;
    try { cwq.focus({ preventScroll: true }); } catch(e){ cwq.focus(); }
  }

  q("[data-cob-back]").forEach(b => b.onclick = () => goStep(draft().step - 1));
  q("[data-cob-next]").forEach(b => b.onclick = () => {
    const cur = draft();
    const err = checkStep(cur.step, cur);
    if (err){ sync(); return; }              // belt and braces: the button is already disabled
    if (cur.step === LAST){ submitApplication(); return; }
    goStep(cur.step + 1);
  });
  q("[data-cob-dash]").forEach(b => b.onclick = () => {
    S.portal = "coach"; S.coachTab = "dashboard"; S.route = { name: "dashboard", arg: null };
    if (typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
    render();
  });

  /* plain draft fields — typed into, so repainted in place, never re-rendered */
  q("[data-cob-in]").forEach(el => el.oninput = () => {
    const k = el.dataset.cobIn;
    draft()[k] = el.value;
    sync();
  });

  /* per-service fields, same rule */
  q("[data-cob-svcin]").forEach(el => el.oninput = () => {
    const parts = String(el.dataset.cobSvcin).split("|");
    const s = svc(parts[0]);
    if (!s) return;
    s[parts[1]] = el.value;
    sync();
  });

  /* format radios: capacity follows the format only while it is still the
     format's default, so a number the coach typed is never overwritten */
  q("[data-cob-fmt]").forEach(el => el.onchange = () => {
    const parts = String(el.dataset.cobFmt).split("|");
    const s = svc(parts[0]);
    if (!s) return;
    const wasDefault = Number(s.capacity) === FORMAT_CAP[s.format];
    s.format = parts[1];
    if (wasDefault) s.capacity = FORMAT_CAP[s.format];
    render();
  });
  q("[data-cob-model]").forEach(el => el.onchange = () => {
    const s = svc(el.dataset.cobModel);
    if (!s) return;
    s.model = el.value;
    render();
  });

  q("[data-cob-addsvc]").forEach(b => b.onclick = () => {
    draft().services.push(newService());
    render();
    toast("Service added — name it and set its capacity");
  });
  q("[data-cob-delsvc]").forEach(b => b.onclick = () => {
    const cur = draft();
    if (cur.services.length <= 1) return;          // at least one service, always
    const gone = svc(b.dataset.cobDelsvc);
    cur.services = cur.services.filter(x => x.id !== b.dataset.cobDelsvc);
    render();
    toast("Removed " + ((gone && trim(gone.name)) || "the service"));
  });

  q("[data-cob-sport]").forEach(b => b.onclick = () => {
    const cur = draft(), s = b.dataset.cobSport;
    cur.sports = cur.sports.indexOf(s) >= 0 ? cur.sports.filter(x => x !== s) : cur.sports.concat([s]);
    render();
  });
  q("[data-cob-day]").forEach(b => b.onclick = () => {
    const cur = draft(), k = b.dataset.cobDay;
    const on = cur.days.indexOf(k) >= 0;
    cur.days = on ? cur.days.filter(x => x !== k)
      : WD.map(w => w[0]).filter(x => x === k || cur.days.indexOf(x) >= 0);   // keeps Mon→Sun order
    render();
  });

  /* The plan choice is recorded, not charged. render() rather than sync()
     because the selected card's outline is part of the step's markup. */
  q("[data-cob-plan]").forEach(r => r.onchange = () => {
    draft().plan = r.dataset.cobPlan === "pro" ? "pro" : "free";
    render();
  });

  /* THE ONE PLACE THIS WIZARD CAN START A PAYMENT, and it is after the
     application is in. Two reasons it is not on the pricing step: Stripe
     Checkout is a full navigation away from a half-finished wizard, and
     billing-create-checkout refuses a caller who is not yet a coach — which,
     before submit, is every one of them. */
  q("[data-cob-buypro]").forEach(b => b.onclick = () => {
    const err = document.querySelector("[data-cob-buyerr]");
    if (err){ err.textContent = ""; err.classList.add("hide"); }
    if (!window.SporveCoach || !window.SporveCoach.startCheckout){
      if (err){ err.textContent = "Billing isn't available in this session — upgrade from your account page."; err.classList.remove("hide"); }
      return;
    }
    b.disabled = true;
    const was = b.textContent;
    b.textContent = "Opening Stripe…";
    window.SporveCoach.startCheckout("pro").catch(e => {
      b.disabled = false; b.textContent = was;
      /* the function's own words — it is the only thing that knows why */
      if (err){ err.textContent = (e && e.message) || "Could not open Stripe checkout."; err.classList.remove("hide"); }
    });
  });

  q("[data-cob-consent]").forEach(cb => cb.onchange = () => {
    draft().consent = !!cb.checked;
    const label = cb.parentNode;
    if (label && label.classList) label.classList.toggle("on", !!cb.checked);
    sync();
  });

  /* first paint of the step's live figures, in case state arrived pre-filled */
  if (!d.submittedAt) sync();
}

/* ═══════════════════ EXPORT ═══════════════════ */
window.MOD_COACHONBOARD = {
  css: CSS,
  views: { onboard: onboardView },
  modals: { verifyid: verifyIdModal },
  wire: wire,
  state: { onboard: BLANK },
};

})();
