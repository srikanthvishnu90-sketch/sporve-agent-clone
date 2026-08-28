"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_MEDIA — the coach's media library, and the consent that governs it.

   Mounts one tab inside the existing coach dash (left rail + body):
   "Media". Four local panes keep presentation, files, consent, and
   performance distinct while sharing one consent-enforced library.

   These are photographs of children. Consent is therefore not a label
   on the item, it is a gate in front of every outbound action. Each
   athlete carries exactly one of three values:

     public_profile — may be sent to that family AND shown publicly
     private_share  — may be sent to that family, never shown publicly
     none           — no photos or clips of this athlete, anywhere

   Two invariants hold in code, not just in copy:
     1. Consent is granted by a parent in the family app. Nothing in
        this module writes to the consent map — it is frozen at load,
        so a self-grant would throw rather than silently succeed.
     2. Every share and publish path re-evaluates the gate at the
        moment of the action. The disabled buttons are the courtesy;
        the refusal in the handler is the enforcement.

   Host contract used (never redefined here):
     S, render(), toast(), esc(), fmtDate(), slotsFor(),
     PROGRAMS, SEED, sportColor(), ICON.

   The demo clock is pinned to the app's seeded "today" (2026-08-03).
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ── clock ───────────────────────────────────────────────────────── */
const NOW   = () => new Date(2026, 7, 3, 9, 30);      // Mon 3 Aug 2026, 9:30am
const TODAY = "2026-08-03";
const iso   = d => d.toISOString();
const day   = d => d.toISOString().slice(0, 10);

/* ── small language helpers ──────────────────────────────────────── */
const plural = (n, one, many) => (n === 1 ? one : many);
const countOf = (n, one) => n + " " + plural(n, one, one + "s");
/* "1 athlete in this photo" / "2 athletes in this clip" — never a name.
   Naming the child who lacks consent would shame a family for a choice
   that is entirely theirs to make. */
const subject = (n, noun) => (n === 1 ? "1 athlete in this " + noun : n + " athletes in this " + noun);
const hasnt   = n => plural(n, "hasn't", "haven't");

/* ── product rules, stated once and referenced everywhere ────────── */
const RULE = {
  featurePhotos: 5,     // Sporv's listing guideline: 5+ profile photos
  introMin: 30,         // intro video runs 30–60 seconds
  introMax: 60,
  facilityMin: 2,
  actionMin: 2,
  captionMax: 280,
};

/* ═══════════════════ CONSENT VOCABULARY ═══════════════════ */
/* Exactly three values. Anything unknown resolves to "none" — an absent
   record is a refusal, never a permission. */
const CONSENT = [
  ["public_profile", "Profile + private", "good",
   "Photos and clips may be sent to this family and may also appear on your public profile."],
  ["private_share", "Private share only", "slate",
   "Photos and clips may be sent to this family's own thread. They may never appear anywhere public."],
  ["none", "No media", "warn",
   "No photos or clips of this athlete may be sent to anyone or published."],
];
const consentRow = k => CONSENT.find(c => c[0] === k) || CONSENT[2];
const consentLabel = k => consentRow(k)[1];
const consentPill = k => consentRow(k)[2];

/* ═══════════════════ PROFILE SLOTS ═══════════════════ */
const SLOTS = [
  { key: "headshot", label: "Headshot", need: 1, format: "photo",
    why: "Shoulders up, one clear photo. The first thing a family sees." },
  { key: "intro_video", label: "Intro video", need: 1, format: "video",
    why: RULE.introMin + "–" + RULE.introMax + " seconds on a phone: who you coach, how a session runs." },
  { key: "facility", label: "Facility & courts", need: RULE.facilityMin, format: "photo",
    why: "Where you train. Parents look for parking, fencing, and shade." },
  { key: "action", label: "Action shots", need: RULE.actionMin, format: "photo",
    why: "Athletes mid-session. Each one needs profile consent to go public." },
];
const slotRow = k => SLOTS.find(s => s.key === k) || SLOTS[0];

/* ═══════════════════ SEEDS ═══════════════════ */
/* Live catalogue first, seeded second — see the note in mod-coachops.js. */
const prog = id => PROGRAMS.find(p => p.id === id) ||
                   DEMO_CATALOGUE.find(p => p.id === id) || null;
const myListings = () => DEMO_CATALOGUE.filter(p => S.listings.includes(p.id));

const AGE_REF = new Date(2026, 7, 3);
function ageFromDob(dob){
  const b = new Date(dob);
  if (isNaN(b)) return null;
  let a = AGE_REF.getFullYear() - b.getFullYear();
  const m = AGE_REF.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && AGE_REF.getDate() < b.getDate())) a--;
  return a;
}

/* The coach's own sessions, read from the host's real slot data. */
function seedSessions(){
  const mine = myListings();
  const out = [];
  mine.forEach(p => {
    let sl = [];
    if (typeof slotsFor === "function"){ try { sl = slotsFor(p.id) || []; } catch (e) { sl = []; } }
    if (!sl.length) sl = [{ id: p.id + "_s1", title: "Training Session", date: "2026-07-29", startTime: "05:00 PM" }];
    sl.slice(0, 2).forEach(s => out.push({
      id: s.id, programId: p.id, title: s.title, date: s.date, startTime: s.startTime,
    }));
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* Athletes this coach actually trains. The first row is the host's real
   seeded athlete; the rest carry the parent names already used by the
   waitlist elsewhere in the portal, so one family reads the same in
   both places. */
function seedRoster(){
  const mine = myListings();
  const at = i => (mine[i] || DEMO_CATALOGUE[i] || DEMO_CATALOGUE[0]).id;
  const host = (S.athletes && S.athletes[0]) || null;
  const first = host
    ? { id: host.id,
        name: (host.firstName + " " + (host.lastName || "")).trim(),
        age: ageFromDob(host.dob),
        parent: (host.emergency && host.emergency.name) || "Parent",
        programId: at(0),
        consentAt: host.consentAt || "2026-05-01T10:00:00.000Z" }
    : { id: "athlete_1", name: "Julian Mercer", age: 13, parent: "Alex Mercer",
        programId: at(0), consentAt: "2026-05-01T10:00:00.000Z" };
  return [
    first,
    { id: "athlete_2", name: "Nia Okafor",     age: 13, parent: "Renata Okafor",    programId: at(0), consentAt: "2026-07-22T09:15:00.000Z" },
    { id: "athlete_3", name: "Cole Whitfield", age: 12, parent: "Daniel Whitfield", programId: at(2), consentAt: null },
    { id: "athlete_4", name: "Sofia Ibarra",   age: 11, parent: "Marisol Ibarra",   programId: at(3), consentAt: "2026-06-30T17:40:00.000Z" },
    { id: "athlete_5", name: "Aarav Raman",    age: 14, parent: "Priya Raman",      programId: at(1), consentAt: "2026-07-11T12:05:00.000Z" },
    { id: "athlete_6", name: "Ida Nilsen",     age: 12, parent: "Tomas Nilsen",     programId: at(4), consentAt: null },
  ];
}

/* The consent map. Written once here, then frozen — see the header. */
function seedConsent(){
  return {
    athlete_1: "public_profile",
    athlete_2: "private_share",
    athlete_3: "none",
    athlete_4: "public_profile",
    athlete_5: "private_share",
    athlete_6: "none",
  };
}

const SESSIONS = seedSessions();
const ROSTER = seedRoster();
const sessAt = i => SESSIONS[i % SESSIONS.length];

function seedItems(){
  const s0 = sessAt(0), s1 = sessAt(1), s2 = sessAt(2), s3 = sessAt(3);
  const base = { published: false, shareable: false, sharedWith: [] };
  const mk = o => Object.assign({}, base, o, { sharedWith: (o.sharedWith || []).slice() });
  return [
    /* ── profile ──────────────────────────────────────────────── */
    mk({ id: "md_1", kind: "profile", slot: "headshot", mediaType: "photo", durationSec: null,
      sessionId: null, programId: null, athleteIds: [],
      caption: "Head coach, Northside Flight Basketball", createdAt: "2026-06-02T14:00:00.000Z",
      published: true }),
    mk({ id: "md_2", kind: "profile", slot: "intro_video", mediaType: "video", durationSec: 72,
      sessionId: null, programId: null, athleteIds: [],
      caption: "Who we coach and how a session runs", createdAt: "2026-06-02T14:20:00.000Z",
      published: true }),
    mk({ id: "md_3", kind: "profile", slot: "facility", mediaType: "photo", durationSec: null,
      sessionId: null, programId: (myListings()[0] || DEMO_CATALOGUE[0]).id, athleteIds: [],
      caption: "Northside Community Gym — court and parent seating",
      createdAt: "2026-06-09T16:10:00.000Z", published: true }),
    mk({ id: "md_4", kind: "profile", slot: "action", mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1"],
      caption: "Closeout footwork under pressure", createdAt: "2026-07-14T18:05:00.000Z",
      published: true, shareable: true }),
    /* mixed tagging: one athlete has profile consent, one does not */
    mk({ id: "md_5", kind: "profile", slot: "action", mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1", "athlete_2"],
      caption: "Small-sided game, final ten minutes", createdAt: "2026-07-14T18:22:00.000Z" }),

    /* ── session ──────────────────────────────────────────────── */
    mk({ id: "md_6", kind: "session", slot: null, mediaType: "video", durationSec: 24,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1"],
      caption: "Off-hand finishing — six clean reps in a row", createdAt: "2026-07-14T18:40:00.000Z",
      shareable: true, sharedWith: [{ athleteId: "athlete_1", at: "2026-07-14T19:02:00.000Z" }] }),
    mk({ id: "md_7", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_2"],
      caption: "Catch-and-shoot footwork", createdAt: "2026-07-14T18:44:00.000Z",
      shareable: true }),
    mk({ id: "md_8", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s1.id, programId: s1.programId, athleteIds: ["athlete_3"],
      caption: "Shooting form from the elbow", createdAt: "2026-07-21T17:30:00.000Z" }),
    mk({ id: "md_9", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1", "athlete_2"],
      caption: "Shell drill before the scrimmage", createdAt: "2026-07-14T18:51:00.000Z",
      shareable: true }),
    mk({ id: "md_10", kind: "session", slot: null, mediaType: "video", durationSec: 31,
      sessionId: s2.id, programId: s2.programId, athleteIds: ["athlete_5"],
      caption: "Free-throw release, slow motion", createdAt: "2026-07-28T16:15:00.000Z",
      shareable: true }),
    mk({ id: "md_11", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s3.id, programId: s3.programId, athleteIds: ["athlete_4"],
      caption: "Outlet pass, first clean read", createdAt: "2026-07-30T17:05:00.000Z",
      shareable: true, sharedWith: [{ athleteId: "athlete_4", at: "2026-07-30T18:00:00.000Z" }] }),
  ];
}

/* ═══════════════════ STATE ═══════════════════ */
const state = {
  mediaItems: seedItems(),
  mediaConsent: seedConsent(),
};
/* A coach can never grant consent on a family's behalf. There is no
   code path that writes this map, and the freeze makes an accidental
   one throw in strict mode instead of quietly succeeding. */
Object.freeze(state.mediaConsent);

/* Not consent — just a record of having asked. Local to the module so
   the exported state stays exactly the two documented keys. */
const consentRequests = {};
/* Session-media grouping. View preference, not data. */
let grouping = "session";
/* The supplied Media format is one surface with four local tabs. These are
   view preferences only, so they stay out of the exported/persisted state. */
let mediaPane = "profile";
let mediaFilter = "all";
let analyzedVid = null;  // id of the video whose AI analysis is shown
/* Org-bio drafter state — module-local demo persistence (survives re-renders
   this session). A real coach's approve also writes the providers bio via
   SporveCoach.save; durable persistence for all is the RED media/bio path. */
let bioText = null;
let bioLive = false;
let headlineText = null;
function bioDraft(){
  const pp = SEED.providerProfile || {};
  const biz = pp.businessName || "This program";
  const sp = (pp.sports && pp.sports.length ? pp.sports : ["soccer","basketball","tennis"]);
  const sports = sp.length > 1 ? sp.slice(0,-1).join(", ") + " and " + sp.slice(-1) : sp[0];
  return biz + " trains " + ROSTER.length + "+ athletes across " + sports + " on Chicago's North Side. "
    + "Every coach clears a background check before they can be booked, and every family controls exactly "
    + "where their athlete's photos go. Small groups, honest progress after each session, and a schedule that holds.";
}

/* ═══════════════════ DERIVED LOGIC ═══════════════════ */
const athleteById = id => ROSTER.find(a => a.id === id) || null;
const athleteName = id => { const a = athleteById(id); return a ? a.name : "Removed athlete"; };
const sessionById = id => SESSIONS.find(s => s.id === id) || null;
const itemById = id => state.mediaItems.find(i => i.id === id) || null;

/* Unknown athlete, missing record, typo — all resolve to "none". */
function consentOf(athleteId){
  const v = state.mediaConsent[athleteId];
  return (v === "public_profile" || v === "private_share") ? v : "none";
}

/* ── THE GATE ─────────────────────────────────────────────────────
   Everything outbound goes through here. Returns what may happen and,
   when something may not, the reason in the words the coach will see. */
function evaluate(item){
  const ids = (item && item.athleteIds) || [];
  const noun = (item && item.mediaType === "video") ? "clip" : "photo";
  const noneIds = ids.filter(id => consentOf(id) === "none");
  const privIds = ids.filter(id => consentOf(id) === "private_share");

  const v = {
    athleteIds: ids.slice(),
    noneCount: noneIds.length,
    privateCount: privIds.length,
    canShare: true, shareReason: null,
    canPublish: true, publishReason: null,
    blockKind: null,          // "consent" | "untagged" | null
  };

  /* One athlete without consent blocks the whole item — the others in
     the frame do not outvote the child who said no. */
  if (noneIds.length){
    const why = subject(noneIds.length, noun) + " " + hasnt(noneIds.length) +
      " granted media consent. This " + noun + " can't be sent or published.";
    v.canShare = false; v.shareReason = why;
    v.canPublish = false; v.publishReason = why;
    v.blockKind = "consent";
    return v;
  }
  if (privIds.length){
    v.canPublish = false;
    v.publishReason = subject(privIds.length, noun) + " " + hasnt(privIds.length) +
      " granted profile consent. Send it to their family; it can't go public.";
    v.blockKind = "consent";
  }
  /* Nothing to send when nobody is in the frame: not a consent block,
     just an empty recipient list. */
  if (!ids.length){
    v.canShare = false;
    v.shareReason = "No athlete is tagged, so there is no family thread to send to.";
    if (!v.blockKind) v.blockKind = "untagged";
  }
  return v;
}

/* ── counts, all computed, none hand-written ─────────────────────── */
const profileItems  = () => state.mediaItems.filter(i => i.kind === "profile");
const sessionItems  = () => state.mediaItems.filter(i => i.kind === "session");
const profilePhotos = () => profileItems().filter(i => i.mediaType === "photo");
const slotItems     = k => profileItems().filter(i => i.slot === k);
const introItem     = () => slotItems("intro_video")[0] || null;
const introOk = () => {
  const v = introItem();
  return !!(v && v.durationSec >= RULE.introMin && v.durationSec <= RULE.introMax);
};
const itemsForSession = id => sessionItems().filter(i => i.sessionId === id);
const itemsForAthlete = id => sessionItems().filter(i => i.athleteIds.indexOf(id) >= 0);
const taggedCount = id => state.mediaItems.filter(i => i.athleteIds.indexOf(id) >= 0).length;
function consentCounts(){
  const c = { public_profile: 0, private_share: 0, none: 0 };
  ROSTER.forEach(a => { c[consentOf(a.id)]++; });
  return c;
}
const publishedCount = () => state.mediaItems.filter(i => i.published).length;
/* Every item the gate is currently refusing. These are SHOWN, never filtered
   out: a library that quietly drops the blocked photos teaches the coach
   nothing, and the refusal is the most useful thing on the page. */
const heldItems = () => state.mediaItems.filter(i => evaluate(i).blockKind === "consent");

/* ── profile strength: media's contribution, and the next best move ─ */
function strength(){
  const photos = profilePhotos().length;
  const fac = slotItems("facility").length;
  const act = slotItems("action").length;
  const intro = introItem();
  const need = (have, want) => Math.max(0, want - have);

  const steps = [
    { w: 25, met: slotItems("headshot").length > 0,
      next: "Add a coach headshot — it is the first thing a family sees in search." },
    { w: 25, met: introOk(),
      next: intro
        ? "Re-cut your intro video to " + RULE.introMin + "–" + RULE.introMax + " seconds — the one on file runs " + intro.durationSec + "s."
        : "Record a " + RULE.introMin + "–" + RULE.introMax + " second intro video." },
    { w: 15, met: fac >= RULE.facilityMin,
      next: "Add " + countOf(need(fac, RULE.facilityMin), "facility photo") + " so families can see where you train." },
    { w: 15, met: act >= RULE.actionMin,
      next: "Add " + countOf(need(act, RULE.actionMin), "action shot") + " from a session — every athlete in one needs profile consent." },
    { w: 20, met: photos >= RULE.featurePhotos,
      next: "Sporv's listing guideline asks for " + RULE.featurePhotos + " or more profile photos. You have " +
        photos + " — add " + countOf(need(photos, RULE.featurePhotos), "more") + "." },
  ];
  const pct = steps.reduce((n, s) => n + (s.met ? s.w : 0), 0);
  const first = steps.filter(s => !s.met)[0];
  return {
    pct: pct,
    next: first ? first.next
      : "Profile media is complete. Keep sending session clips — families read those as proof the coaching is working.",
  };
}

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
/* ── SECTION GROUNDS ──────────────────────────────────────────────
   The page is a vertical stack of section blocks, top to bottom:

       slate  →  black  →  white  →  white

   It cannot use full-bleed <section class="band"> the way the
   marketing pages do: this view renders inside the coach dash's
   216px-rail grid column, so nothing here can reach the viewport
   edge. It does not need to. The serious register already paints
   the whole page slate (#app.reg-serious sets --raise), so an
   UNPAINTED section is the slate ground, and the painted ones are
   white and black panels floating on it — the same figure/ground
   relationship the register was built for.

   The black block carries the .band.dark class as well, so it
   inherits the host's dark-ground invariant (headings #FFFFFF,
   body #AEB8C4, eyebrows #8B97A5, focus ring #E8EDF3) rather than
   re-deriving it. Everything the invariant does NOT cover — bare
   <b>, <span>, and any white card dropped onto the black — is
   pinned explicitly below, because an unset colour inherits
   var(--ink) and would land black on black. */
.md-band{margin:0 0 18px}
.md-band:last-child{margin-bottom:0}
.md-band.paper,.md-band.dark{padding:26px 26px 30px;border-radius:var(--r-l)}
.md-band.paper{background:var(--paper);border:1px solid var(--rule)}
.md-band.dark{color:#AEB8C4;border:0}
.md-band .stat{background:var(--paper)}
.md-sub{font-size:var(--text-base);line-height:1.5;max-width:60ch;margin-top:9px;color:var(--muted)}
.md-band.dark .md-sub{color:#AEB8C4}
/* A white card on the black ground is a card, not text on black — so its
   own type goes back to the light-ground palette. (0,3,0) beats the host's
   .band.dark p at (0,2,0); without these the caption inside would resolve
   to #AEB8C4 on white, 2.1:1. */
.md-card{background:var(--paper);border-radius:var(--r-m);padding:17px 18px;
  display:flex;gap:12px;align-items:flex-start}
.md-card > .ic{flex:0 0 auto;color:var(--slate);margin-top:1px}
.md-card > .ic svg{width:19px;height:19px;display:block}
.md-cardbody{flex:1;min-width:0}
.md-cardbody > b{font-size:var(--text-base);letter-spacing:-.015em}
.md-band.dark .md-card{color:var(--ink)}
.md-band.dark .md-card p{color:var(--ink-2)}
.md-band.dark .md-card b{color:var(--ink)}
.md-band.dark .md-card .md-why{color:var(--muted)}
.md-band.dark .md-card .eyebrow{color:var(--faint)}
.md-holds{display:flex;flex-direction:column;gap:0;margin-top:13px}
.md-hold{border-top:1px solid var(--rule);padding:11px 0 0;margin-top:11px}
.md-hold b{display:block;font-size:var(--text-sm);letter-spacing:-.01em}
.md-tally{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:16px;margin-top:22px}
.md-tally div{border-top:1px solid #242B35;padding-top:11px}
.md-tally b{display:block;font-size:var(--text-xl);font-weight:800;letter-spacing:-.03em;color:#FFFFFF}
.md-tally span{display:block;font-size:var(--text-sm);margin-top:2px;color:#8B97A5}
.md-foot{font-size:var(--text-sm);margin-top:16px;line-height:1.5}
.md-band.dark .md-foot{color:#8B97A5}

.md-band .eyebrow + h1,.md-band .eyebrow + h2{margin-top:13px}
.md-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin:0 0 22px;flex-wrap:wrap}
.md-lede{color:var(--ink-2);font-size:var(--text-md);max-width:52ch;margin-top:12px;line-height:1.5}
.md-head h1{max-width:18ch}
.md-actions{display:flex;gap:8px;flex-wrap:wrap}
.md-note{background:var(--raise);border-radius:var(--r-m);padding:13px 15px;font-size:var(--text-sm);
  color:var(--ink-2);line-height:1.5}
.md-note.warn{background:var(--warn-tint)}
.md-note b{color:var(--ink)}
/* Slate inset inside the white band: the meter is a read-out on the section,
   not another card floating beside it. */
.md-meter{border:0;border-radius:var(--r-m);padding:16px 18px;margin:0 0 22px;background:var(--raise)}
.md-biobox{margin-top:12px;background:var(--raise);border:1px solid var(--rule);border-radius:var(--r-m);
  padding:14px 16px;font-size:var(--text-base);line-height:1.6;color:var(--ink);min-height:78px;outline:none}
.md-biobox:focus{border-color:var(--slate-border)}
.md-bioacts{display:flex;gap:10px;margin-top:14px}
.md-biolive{margin-top:10px;color:var(--slate-ink);font-size:var(--text-sm);display:none}
.md-biolive.on{display:block}
.md-meterhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.md-pct{font-size:var(--text-xl);font-weight:700;letter-spacing:-.03em}
.md-bar{height:8px;border-radius:999px;background:var(--raise2);overflow:hidden;margin:12px 0 10px}
.md-bar i{display:block;height:100%;border-radius:999px;background:var(--slate)}
.md-next{font-size:var(--text-base);color:var(--ink-2);line-height:1.5}
.md-secline{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin:0 0 18px}
.md-secline p{color:var(--muted);font-size:var(--text-base);max-width:56ch;margin-top:7px;line-height:1.5}

/* 220px, not 250: at the coach dash's ~990px column the wider floor gave
   three columns for four slots, so Action shots sat alone under a half-empty
   row. Four fit across, and the four required slots read as one row. */
.md-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;align-items:start}
.md-slot{border:1px solid var(--rule);border-radius:var(--r-l);padding:16px;background:var(--paper);
  display:flex;flex-direction:column;gap:11px}
.md-slothead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.md-slot h4{margin:0;font-size:var(--text-base);letter-spacing:-.015em;font-weight:700}
.md-why{font-size:var(--text-sm);color:var(--muted);line-height:1.45}
.md-hint{font-size:var(--text-sm);line-height:1.45;color:var(--faint)}
.md-hint.todo{color:var(--gold-ink)}

.md-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:14px;align-items:start}
.md-tile{border:1px solid var(--rule);border-radius:var(--r-m);background:var(--paper);
  display:flex;flex-direction:column;overflow:hidden;margin:0}
.md-ph{position:relative;aspect-ratio:4/3;display:grid;place-items:center;
  background:linear-gradient(148deg,color-mix(in srgb,var(--tc) 34%,var(--paper)),
                                    color-mix(in srgb,var(--tc) 9%,var(--paper)));
  border-bottom:1px solid var(--rule)}
/* Initials in --ink-2, not the sport colour. The sport already reads from the
   gradient behind them, and --tc on its own 9-34% tint measured 3.35:1 at
   --text-lg — under the 4.5 bar at the small end of the clamp. */
.md-ini{font-size:var(--text-lg);font-weight:700;letter-spacing:-.03em;color:var(--ink-2)}
.md-play{width:34px;height:34px;border-radius:999px;background:var(--paper);display:grid;place-items:center;
  color:var(--ink);box-shadow:0 0 0 1px var(--rule)}
.md-dur{position:absolute;right:7px;bottom:7px;background:var(--ink);color:var(--paper);
  font-size:var(--text-xs);font-weight:700;padding:2px 7px;border-radius:999px}
.md-flag{position:absolute;left:7px;top:7px;background:var(--paper);border:1px solid var(--rule);
  font-size:var(--text-xs);font-weight:700;letter-spacing:.02em;padding:2px 7px;border-radius:999px;color:var(--ink-2)}
.md-body{padding:11px 12px 13px;display:flex;flex-direction:column;gap:8px;flex:1}
.md-cap{font-size:var(--text-sm);color:var(--ink-2);line-height:1.45;margin:0}
.md-tags{display:flex;gap:5px;flex-wrap:wrap}
/* --warn (#B87800) and --good (#13A240) measure 3.67:1 and 3.35:1 on white,
   both under the 4.5 bar for 12px body. The refusal keeps its amber but takes
   the darker --gold-ink (6.1:1); the cleared line goes --muted, which is also
   the right volume — "nothing is stopping you" is not news. */
.md-verdict{font-size:var(--text-sm);line-height:1.45;color:var(--muted)}
.md-verdict.block{color:var(--gold-ink)}
.md-verdict.ok{color:var(--muted)}
.md-sent{font-size:var(--text-sm);color:var(--faint)}
.md-acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:auto;padding-top:4px}
.md-del{width:28px;height:28px}
.md-del:hover{color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent)}
/* Was a 4/3 dashed square, which made an empty slot card as tall as a filled
   one and put a large hole in the middle of the profile grid. A bar states
   the same affordance in a sixth of the height. */
.md-add{width:100%;grid-column:1/-1;height:46px;border:1.5px dashed var(--rule-strong);border-radius:var(--r-m);
  display:grid;place-items:center;font-size:var(--text-sm);font-weight:700;color:var(--muted);
  background:var(--paper);transition:border-color .14s,color .14s,background .14s}
.md-add:hover{border-color:var(--slate);color:var(--slate);background:var(--slate-tint)}

.md-seg{display:inline-flex;background:var(--raise2);border-radius:999px;padding:3px;gap:2px}
.md-seg button{padding:7px 14px;border-radius:999px;font-size:var(--text-sm);font-weight:700;color:var(--muted);transition:.14s}
.md-seg button.on{background:var(--paper);color:var(--ink)}
/* Inside the white session band a group is a chapter, not a card — a rule
   above it does the separating, so the page does not stack white on white. */
.md-groups{margin-top:4px}
.md-group{border:0;border-radius:0;background:transparent;padding:20px 0 0;margin-top:20px;
  border-top:1px solid var(--rule)}
.md-group:first-child{border-top:0;padding-top:0;margin-top:0}
.md-grouphead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.md-grouphead b{font-size:var(--text-base);letter-spacing:-.02em}
.md-groupmeta{font-size:var(--text-sm);color:var(--muted);margin-top:3px}
.md-who{display:flex;align-items:center;gap:11px;min-width:0}

.md-opts{display:flex;flex-direction:column;gap:10px;margin:0 0 18px}
.md-opt{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1.5px solid var(--rule);
  border-radius:var(--r-m);cursor:pointer;transition:border-color .14s,background .14s}
.md-opt:hover{border-color:var(--rule-strong);background:var(--raise)}
.md-opt input{width:17px;height:17px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--slate)}
.md-opt b{font-size:var(--text-base);letter-spacing:-.015em}
.md-opt span span{display:block;font-size:var(--text-sm);color:var(--muted);line-height:1.45;margin-top:2px}
.md-checks{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px}
.md-check{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--rule);
  border-radius:var(--r-m);cursor:pointer;transition:border-color .14s,background .14s}
.md-check:hover{border-color:var(--rule-strong);background:var(--raise)}
.md-check input{width:16px;height:16px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--slate)}
.md-check b{display:block;font-size:var(--text-sm);letter-spacing:-.01em}
.md-gate{border:1px solid var(--rule);border-radius:var(--r-m);padding:13px 15px;background:var(--raise);
  margin:16px 0;font-size:var(--text-sm);line-height:1.5;color:var(--ink-2)}
.md-gate.block{background:var(--warn-tint);border-color:transparent}
.md-gatehead{margin-bottom:6px}
.md-cnt{font-size:var(--text-sm);color:var(--faint);align-self:flex-end}
.md-cnt.over{color:var(--danger);font-weight:700}
.md-strip{display:flex;gap:9px;align-items:flex-start;padding:13px 15px;border-radius:var(--r-m);
  background:var(--raise);font-size:var(--text-sm);color:var(--ink-2);line-height:1.5;margin-top:14px}
.md-legend{display:flex;flex-direction:column;gap:9px;margin-top:14px}
.md-legend div{font-size:var(--text-sm);color:var(--muted);line-height:1.45}
.md-legend b{color:var(--ink);font-weight:700}
.md-empty{border:1px dashed var(--rule-strong);border-radius:var(--r-l);padding:26px;text-align:center;
  color:var(--muted);font-size:var(--text-sm)}
.md-seg button:focus-visible,.md-add:focus-visible{outline:2px solid var(--slate);outline-offset:2px}
@media(max-width:760px){
  .md-checks{grid-template-columns:1fr}
  .md-tiles{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
}

/* ── 2026-08-27 MEDIA FORMAT ─────────────────────────────────────
   The reference is a dark operations surface with a compact header, sticky
   local tabs, quiet cards, and mono read-outs. It mounts inside the existing
   Sporv coach chrome, so this wrapper owns the exact inner-page ground and
   recaptures the host gutter without duplicating the global header or rail. */
.mfmt{
  --mfmt-bg:#0E0E0F;--mfmt-panel:#121315;--mfmt-panel-2:#17191C;
  --mfmt-line:#1F2226;--mfmt-line-2:#2A3138;--mfmt-ink:#F5F5F2;
  /* The reference's #6E7680 tertiary text misses AA on #0E0E0F. Use the
     coach register's established quiet slate while preserving its hierarchy. */
  --mfmt-ink-2:#A3A3AB;--mfmt-ink-3:#8B98A6;--mfmt-steel:#6B7F9E;
  --mfmt-warn:#C9A227;--mfmt-good:#8FD19E;--mfmt-shell-pad:32px;
  min-height:calc(100vh - 60px);margin:0 calc(var(--mfmt-shell-pad) * -1);
  padding-bottom:60px;background:var(--mfmt-bg);color:var(--mfmt-ink);
  color-scheme:dark;font-family:var(--sans)
}
/* The reference has one 60px global bar. Media does not need the coach-wide
   import/support utility strip, so remove that second header on this route. */
#app:has(.mfmt) .coachtop{display:none}
.mfmt button,.mfmt input,.mfmt textarea{font:inherit;color:inherit}
.mfmt button:focus-visible,.mfmt input:focus-visible,.mfmt textarea:focus-visible{
  outline:2px solid var(--mfmt-steel);outline-offset:2px
}
.mfmt-num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.mfmt-display{font-family:var(--display);text-transform:uppercase}
.mfmt-head{padding:22px 28px 0}
.mfmt-headrow{display:flex;align-items:flex-start;gap:24px}
.mfmt-headcopy{min-width:0}
.mfmt-eyebrow{margin:0 0 8px;font-family:var(--display);font-size:12px;font-weight:600;
  letter-spacing:.06em;text-transform:uppercase;color:var(--mfmt-ink-3)}
.mfmt .mfmt-title{margin:0 0 6px;font-family:var(--display);font-size:24px;font-weight:500;
  letter-spacing:.01em;line-height:1.15;text-transform:uppercase;color:var(--mfmt-ink)}
.mfmt-lede{max-width:64ch;margin:0;color:var(--mfmt-ink-2);font-size:14px;line-height:1.55}
.mfmt-actions{display:flex;flex:none;gap:8px;margin-left:auto}
.mfmt-btn{min-height:36px;padding:0 14px;border:1px solid var(--mfmt-line-2);border-radius:8px;
  display:inline-flex;align-items:center;justify-content:center;gap:7px;background:transparent;
  color:var(--mfmt-ink);font-family:var(--display);font-size:13px;font-weight:700;
  letter-spacing:.04em;line-height:1;text-transform:uppercase;transition:background .14s,border-color .14s,color .14s}
.mfmt-btn:hover{background:var(--mfmt-panel-2);border-color:#3B424B}
.mfmt-btn.primary{background:#FFFFFF;border-color:#FFFFFF;color:#0E0E0F}
.mfmt-btn.primary:hover{background:#E9E9E6;border-color:#E9E9E6}
.mfmt-btn.small{min-height:30px;padding:0 10px;font-size:12px}
.mfmt-btn:disabled{opacity:.42;cursor:not-allowed}
.mfmt-tabs{position:sticky;top:60px;z-index:42;display:flex;gap:0;margin-top:18px;
  padding:0 28px;border-bottom:1px solid var(--mfmt-line);background:rgba(14,14,15,.97);
  backdrop-filter:blur(10px)}
.mfmt-tab{min-height:43px;margin-bottom:-1px;padding:0 16px;border-bottom:2px solid transparent;
  display:flex;align-items:center;gap:8px;color:var(--mfmt-ink-3);font-family:var(--display);
  font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.mfmt-tab:hover{color:var(--mfmt-ink-2)}
.mfmt-tab.on{border-color:var(--mfmt-ink);color:var(--mfmt-ink)}
.mfmt-count{padding:2px 7px;border-radius:999px;background:var(--mfmt-panel-2);
  color:var(--mfmt-ink-3);font-family:var(--mono);font-size:11px;letter-spacing:0}
.mfmt-pane{padding:24px 28px 0;animation:mfmt-in .16s ease-out}
@keyframes mfmt-in{from{opacity:.72;transform:translateY(2px)}to{opacity:1;transform:none}}
.mfmt-block{margin-bottom:28px}
.mfmt-block:last-child{margin-bottom:0}
.mfmt-section-title{margin:0 0 4px;color:var(--mfmt-ink);font-family:var(--display);
  font-size:14px;font-weight:600;letter-spacing:.04em;line-height:1.25;text-transform:uppercase}
.mfmt-section-sub{margin:0 0 14px;color:var(--mfmt-ink-3);font-size:12px;line-height:1.5}
.mfmt-card{padding:18px;border:1px solid var(--mfmt-line);border-radius:12px;
  background:var(--mfmt-panel)}

/* Profile */
.mfmt-profile-card{display:grid;grid-template-columns:220px minmax(0,1fr);gap:20px}
.mfmt-cover{position:relative;aspect-ratio:3/4;border-radius:12px;overflow:hidden;
  display:grid;place-items:center;background:#1A1D21;color:var(--mfmt-ink-3);
  font-family:var(--mono);font-size:11px}
.mfmt-covermark{font-family:var(--display);font-size:28px;font-weight:700;letter-spacing:.02em;color:var(--mfmt-ink-2)}
.mfmt-cover-tag{position:absolute;bottom:10px;left:10px;padding:4px 8px;border-radius:6px;
  background:rgba(0,0,0,.66);color:var(--mfmt-ink);font-family:var(--mono);font-size:11px}
.mfmt-full{width:100%;margin-top:10px}
.mfmt-field{margin-bottom:16px}
.mfmt-field:last-child{margin-bottom:0}
.mfmt-field label{display:block;margin-bottom:6px;color:var(--mfmt-ink-3);font-size:12px}
.mfmt-field input,.mfmt-field textarea{width:100%;padding:10px 12px;border:1px solid var(--mfmt-line-2);
  border-radius:8px;background:var(--mfmt-bg);color:var(--mfmt-ink);font-size:15px}
.mfmt-field input{min-height:42px}
.mfmt-field textarea{min-height:96px;resize:vertical;line-height:1.55}
.mfmt-field input:hover,.mfmt-field textarea:hover{border-color:#3B424B}
.mfmt-fieldmeta{display:flex;justify-content:space-between;gap:16px;margin-top:6px;
  color:var(--mfmt-ink-3);font-size:12px;line-height:1.45}
.mfmt-bio-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.mfmt-live{display:none;color:var(--mfmt-good);font-size:12px}
.mfmt-live.on{display:inline}
.mfmt-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
.mfmt-video-card{padding:14px}
.mfmt-video{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;
  display:grid;place-items:center;background:#1A1D21;color:var(--mfmt-ink-3);
  font-family:var(--mono);font-size:12px}
.mfmt-video-play{width:44px;height:44px;border:1px solid var(--mfmt-line-2);border-radius:999px;
  display:grid;place-items:center;background:rgba(14,14,15,.84);color:var(--mfmt-ink)}
.mfmt-video-play:hover{background:var(--mfmt-panel-2)}
.mfmt-video-length{position:absolute;right:10px;bottom:9px;padding:3px 7px;border-radius:5px;
  background:rgba(0,0,0,.66);color:var(--mfmt-ink);font-size:11px}
.mfmt-stat-label{color:var(--mfmt-ink-3);font-family:var(--display);font-size:12px;font-weight:600;
  letter-spacing:.06em;text-transform:uppercase}
.mfmt-stat-value{margin:8px 0 2px;color:var(--mfmt-ink);font-family:var(--mono);font-size:26px}
.mfmt-stat-detail{color:var(--mfmt-ink-3);font-size:12px;line-height:1.45}
.mfmt-inline-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.mfmt-analysis{margin-top:14px}
.mfmt-analysis .md-vidanalysis{padding:14px 16px;border:1px solid var(--mfmt-line);
  border-radius:10px;background:var(--mfmt-panel)}

/* Asset grid */
.mfmt-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.mfmt-chip{min-height:30px;padding:0 12px;border:1px solid var(--mfmt-line-2);border-radius:999px;
  display:inline-flex;align-items:center;gap:7px;color:var(--mfmt-ink-2);font-size:13px}
.mfmt-chip:hover{border-color:#3B424B;color:var(--mfmt-ink)}
.mfmt-chip.on{background:#FFFFFF;border-color:#FFFFFF;color:#0E0E0F;font-weight:500}
.mfmt-chip .mfmt-num{font-size:11px}
.mfmt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
.mfmt-asset{min-width:0;overflow:hidden;border:1px solid var(--mfmt-line);border-radius:10px;
  background:var(--mfmt-panel)}
.mfmt-thumb{position:relative;aspect-ratio:4/3;display:grid;place-items:center;background:#1A1D21;
  color:var(--mfmt-ink-3);font-family:var(--mono);font-size:11px}
.mfmt-thumbmark{display:flex;align-items:center;gap:6px}
.mfmt-thumbplay{width:34px;height:34px;border:1px solid var(--mfmt-line-2);border-radius:999px;
  display:grid;place-items:center;background:rgba(14,14,15,.84);color:var(--mfmt-ink)}
.mfmt-thumbplay:hover{background:var(--mfmt-panel-2)}
.mfmt-order{position:absolute;right:8px;top:8px;color:var(--mfmt-ink-2);font-size:10px}
.mfmt-status{position:absolute;top:8px;left:8px;padding:3px 7px;border-radius:5px;
  background:rgba(0,0,0,.68);font-family:var(--display);font-size:10px;font-weight:600;
  letter-spacing:.08em;text-transform:uppercase}
.mfmt-status.live{color:var(--mfmt-good)}
.mfmt-status.held{color:var(--mfmt-warn)}
.mfmt-status.private,.mfmt-status.shared{color:#AABAD0}
.mfmt-status.unused{color:var(--mfmt-ink-2)}
.mfmt-assetmeta{padding:9px 10px;color:var(--mfmt-ink);font-size:13px;line-height:1.35}
.mfmt-assetmeta b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.mfmt-assetmeta small{display:block;margin-top:2px;color:var(--mfmt-ink-3);font-size:12px;line-height:1.4}
.mfmt-assetacts{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:0 10px 10px}
.mfmt-iconbtn{width:30px;min-width:30px;height:30px;margin-left:auto;border:1px solid transparent;
  border-radius:7px;display:grid;place-items:center;color:var(--mfmt-ink-3)}
.mfmt-iconbtn:hover{border-color:var(--mfmt-line-2);background:var(--mfmt-panel-2);color:#F08A8A}
.mfmt-empty{padding:28px;border:1px dashed var(--mfmt-line-2);border-radius:10px;
  grid-column:1/-1;text-align:center;color:var(--mfmt-ink-3);font-size:13px}

/* Consent */
.mfmt-note{display:flex;align-items:flex-start;gap:11px;margin-bottom:18px;padding:14px 16px;
  border:1px solid var(--mfmt-line);border-radius:10px;background:var(--mfmt-panel);
  color:var(--mfmt-ink-2);font-size:13px;line-height:1.55}
.mfmt-note svg{width:18px;height:18px;flex:0 0 auto;margin-top:1px;color:var(--mfmt-steel)}
.mfmt-note b{color:var(--mfmt-ink);font-weight:600}
.mfmt-consent{overflow:hidden;border:1px solid var(--mfmt-line);border-radius:12px}
.mfmt-consent-head,.mfmt-consent-row{display:grid;grid-template-columns:2fr 1fr 1fr 110px;
  gap:16px;align-items:center;padding:10px 16px}
.mfmt-consent-head{background:var(--mfmt-panel-2);color:var(--mfmt-ink-3);
  font-family:var(--display);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.mfmt-consent-row{min-height:58px;border-top:1px solid var(--mfmt-line)}
.mfmt-consent-name{min-width:0;color:var(--mfmt-ink);font-size:13px}
.mfmt-consent-name small{display:block;margin-top:2px;color:var(--mfmt-ink-3);font-size:12px}
.mfmt-pill{width:max-content;max-width:100%;padding:3px 9px;border:1px solid var(--mfmt-line-2);
  border-radius:999px;color:var(--mfmt-ink-3);font-size:12px;white-space:nowrap}
.mfmt-pill.allowed{border-color:#2C4433;color:var(--mfmt-good)}
.mfmt-pill.held{border-color:#4A3F16;color:var(--mfmt-warn)}
.mfmt-pill.private{border-color:#344154;color:#AABAD0}
.mfmt-date{color:var(--mfmt-ink-3);font-family:var(--mono);font-size:12px}
.mfmt-list{padding:6px 18px}
.mfmt-list-row{display:flex;justify-content:space-between;gap:20px;padding:12px 0;
  border-bottom:1px solid var(--mfmt-line);color:var(--mfmt-ink-2);font-size:13px;line-height:1.45}
.mfmt-list-row:last-child{border-bottom:0}
.mfmt-list-row .mfmt-num{flex:none;color:var(--mfmt-ink-3);font-size:12px}

/* Performance */
.mfmt-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.mfmt-progress-head{display:flex;justify-content:space-between;gap:16px;color:var(--mfmt-ink-2);font-size:13px}
.mfmt-progress{height:6px;margin-top:10px;overflow:hidden;border-radius:3px;background:var(--mfmt-panel-2)}
.mfmt-progress i{display:block;height:100%;background:var(--mfmt-ink)}

@media(max-width:1000px){
  .mfmt-profile-card{grid-template-columns:1fr}
  .mfmt-profile-cover{width:min(220px,100%)}
  .mfmt-stats{grid-template-columns:1fr 1fr}
  .mfmt-consent-head,.mfmt-consent-row{grid-template-columns:1.6fr 1fr 100px}
  .mfmt-consent-head span:nth-child(3),.mfmt-consent-row > :nth-child(3){display:none}
}
@media(max-width:760px){
  .mfmt{--mfmt-shell-pad:16px}
  .mfmt-head{padding:20px 18px 0}
  .mfmt-headrow{flex-direction:column;gap:16px}
  .mfmt-actions{width:100%;margin-left:0}
  .mfmt-actions .mfmt-btn{flex:1}
  .mfmt-tabs{top:65px;padding:0 8px;overflow-x:auto;scrollbar-width:none}
  .mfmt-tabs::-webkit-scrollbar{display:none}
  .mfmt-tab{min-height:46px;padding:0 12px;white-space:nowrap}
  .mfmt-pane{padding:20px 18px 0}
  .mfmt-two,.mfmt-stats{grid-template-columns:1fr}
  .mfmt-fieldmeta{flex-direction:column;gap:4px}
  .mfmt-consent-head{display:none}
  .mfmt-consent-row{grid-template-columns:1fr auto;padding:14px}
  .mfmt-consent-row > :nth-child(2){justify-self:end}
  .mfmt-consent-row > :nth-child(4){grid-column:1/-1}
  .mfmt-consent-row .mfmt-btn{width:100%}
}
@media(max-width:480px){
  .mfmt-grid{grid-template-columns:1fr 1fr;gap:9px}
  .mfmt-assetacts{align-items:stretch}
  .mfmt-assetacts .mfmt-btn{flex:1;padding-inline:7px}
  .mfmt-list-row{flex-direction:column;gap:5px}
}
@media(prefers-reduced-motion:reduce){
  .mfmt-pane{animation:none}
  .mfmt-btn,.mfmt-chip{transition:none}
}
`;

/* ═══════════════════ TILE RENDERING ═══════════════════ */
/* No image assets exist and nothing may be fetched, so every tile is
   drawn: a gradient in the program's sport colour with the initials of
   whoever is in the frame. */
const PLAY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l12 7-12 7z"/></svg>';

function initialsOf(text){
  return String(text).trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
}
function tileInitials(it){
  if (it.athleteIds.length){
    const base = initialsOf(athleteName(it.athleteIds[0]));
    return it.athleteIds.length > 1 ? base + " +" + (it.athleteIds.length - 1) : base;
  }
  if (it.slot === "headshot" || it.slot === "intro_video") return initialsOf(SEED.providerProfile.businessName);
  const p = prog(it.programId);
  return p ? initialsOf(p.sport) : "AP";
}
function tileColor(it){
  const p = prog(it.programId);
  return p ? sportColor(p.sport) : "var(--slate)";
}
function tileAlt(it){
  const who = it.athleteIds.length
    ? it.athleteIds.map(athleteName).join(" and ")
    : SEED.providerProfile.businessName;
  return (it.mediaType === "video" ? "Video" : "Photo") + " — " + it.caption + " — " + who +
    ". Shown as a placeholder tile; no image file is stored in this demo.";
}
function placeholder(it){
  return `<div class="md-ph" style="--tc:${tileColor(it)}" role="img" aria-label="${esc(tileAlt(it))}">
    ${it.mediaType === "video"
      ? `<span class="md-play">${PLAY}</span>
         <span class="md-dur num">${esc(String(it.durationSec == null ? "--" : it.durationSec))}s</span>`
      : `<span class="md-ini">${esc(tileInitials(it))}</span>`}
    ${it.published ? `<span class="md-flag">On profile</span>` : ""}
  </div>`;
}

function athletePill(id){
  const k = consentOf(id);
  return `<span class="pill ${consentPill(k)}" title="${esc(consentLabel(k))}">${esc(athleteName(id))}</span>`;
}

function verdictLine(v){
  if (v.blockKind === "consent"){
    return `<p class="md-verdict block">${esc(v.canShare ? v.publishReason : v.shareReason)}</p>`;
  }
  if (!v.canShare && v.shareReason){
    return `<p class="md-verdict">${esc(v.shareReason)}</p>`;
  }
  return `<p class="md-verdict ok">Cleared to send and publish.</p>`;
}

/* Publish is a ghost button, not a filled one. The accent is reserved for the
   page's single primary CTA (Add media); a grid of eleven filled orange
   buttons read as an advertisement for publishing children's photographs. */
function itemTile(it){
  const v = evaluate(it);
  const sent = it.sharedWith.length;
  return `<figure class="md-tile">
    ${placeholder(it)}
    <div class="md-body">
      <figcaption class="md-cap">${esc(it.caption)}</figcaption>
      ${it.athleteIds.length ? `<div class="md-tags">${it.athleteIds.map(athletePill).join("")}</div>` : ""}
      ${verdictLine(v)}
      ${sent ? `<p class="md-sent num">Sent to ${esc(countOf(sent, "family thread"))} · ${esc(fmtDate(it.sharedWith[sent - 1].at.slice(0, 10)))}</p>` : ""}
      <div class="md-acts">
        <button class="btn ghost sm" data-md-share="${esc(it.id)}" ${v.canShare ? "" : `disabled aria-disabled="true"`}
          title="${esc(v.canShare ? "Send to the family thread" : v.shareReason)}">Send to family</button>
        ${it.published
          ? `<button class="btn ghost sm" data-md-unpublish="${esc(it.id)}">Remove from profile</button>`
          : `<button class="btn ghost sm" data-md-publish="${esc(it.id)}" ${v.canPublish ? "" : `disabled aria-disabled="true"`}
              title="${esc(v.canPublish ? "Publish to your public profile" : v.publishReason)}">Publish</button>`}
        <button class="x md-del" data-md-del="${esc(it.id)}"
          aria-label="Delete ${esc(it.caption)}">${ICON.x}</button>
      </div>
    </div>
  </figure>`;
}

/* ═══════════════════ VIEWS ═══════════════════ */

function slotCard(sl){
  const items = slotItems(sl.key);
  const have = items.length, short = Math.max(0, sl.need - have);
  const ok = have >= sl.need && (sl.key !== "intro_video" || introOk());
  const hint = sl.key === "intro_video"
    ? (have === 0
        ? `Nothing on file. Sporv asks for ${RULE.introMin}–${RULE.introMax} seconds.`
        : introOk()
          ? `On file — ${items[0].durationSec}s, inside the ${RULE.introMin}–${RULE.introMax} second window.`
          : `On file, but it runs ${items[0].durationSec}s. Sporv asks for ${RULE.introMin}–${RULE.introMax} seconds.`)
    : short === 0
      ? `Complete — ${countOf(have, "on file")}.`
      : `${have} of ${sl.need} on file. Add ${countOf(short, "more")}.`;

  return `<div class="md-slot">
    <div class="md-slothead">
      <h4>${esc(sl.label)}</h4>
      <span class="pill ${ok ? "good" : "warn"} num">${have}/${sl.need}</span>
    </div>
    <p class="md-why">${esc(sl.why)}</p>
    <p class="md-hint ${ok ? "" : "todo"}">${esc(hint)}</p>
    <div class="md-tiles">
      ${items.map(itemTile).join("")}
      <button class="md-add" data-md-upload="${esc(sl.key)}"
        aria-label="Add ${esc(sl.label.toLowerCase())}">+ Add ${esc(sl.format)}</button>
    </div>
  </div>`;
}

function sessionGroups(){
  const used = SESSIONS.filter(s => itemsForSession(s.id).length);
  if (!used.length) return `<div class="md-empty">No session media yet. Anything you capture at a session lands here first.</div>`;
  return used.map(s => {
    const p = prog(s.programId);
    const items = itemsForSession(s.id);
    const blocked = items.filter(i => evaluate(i).blockKind === "consent").length;
    return `<section class="md-group">
      <div class="md-grouphead">
        <div style="min-width:0">
          <b>${esc(s.title)}</b>
          <div class="md-groupmeta num">${esc(fmtDate(s.date))} · ${esc(s.startTime)}${p ? " · " + esc(p.title) : ""}</div>
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
          ${p ? `<span class="pill" style="background:${sportColor(p.sport)}1A;color:${sportColor(p.sport)}">${esc(p.sport)}</span>` : ""}
          <span class="pill slate num">${esc(countOf(items.length, "item"))}</span>
          ${blocked ? `<span class="pill warn num">${blocked} held by consent</span>` : ""}
        </div>
      </div>
      <div class="md-tiles">${items.map(itemTile).join("")}</div>
    </section>`;
  }).join("");
}

function athleteGroups(){
  const used = ROSTER.filter(a => itemsForAthlete(a.id).length);
  if (!used.length) return `<div class="md-empty">No session media is tagged to an athlete yet.</div>`;
  return used.map(a => {
    const items = itemsForAthlete(a.id);
    const k = consentOf(a.id);
    const p = prog(a.programId);
    return `<section class="md-group">
      <div class="md-grouphead">
        <div class="md-who">
          <span class="avatar" style="width:36px;height:36px">${esc(initialsOf(a.name))}</span>
          <div style="min-width:0">
            <b>${esc(a.name)}</b>
            <div class="md-groupmeta num">Age ${a.age == null ? "—" : a.age}${p ? " · " + esc(p.title) : ""}</div>
          </div>
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
          <span class="pill ${consentPill(k)}">${esc(consentLabel(k))}</span>
          <span class="pill slate num">${esc(countOf(items.length, "item"))}</span>
        </div>
      </div>
      <div class="md-tiles">${items.map(itemTile).join("")}</div>
    </section>`;
  }).join("");
}

/* Four section blocks, grounds top to bottom: slate → black → white → white.
   The black block is second, not last, because it is the page's thesis: the
   library refuses on the family's behalf, and the refusals are listed by name
   rather than counted and hidden. Everything below it is inventory. */
function legacyMediaView(){
  const st = strength();
  const photos = profilePhotos().length;
  const shortPhotos = Math.max(0, RULE.featurePhotos - photos);
  const cc = consentCounts();
  const sItems = sessionItems();
  const sessionsUsed = SESSIONS.filter(s => itemsForSession(s.id).length).length;
  const held = heldItems();
  const shield = (typeof PICON === "object" && PICON.shield) || "";

  const tiles = [
    ["Profile photos", String(photos), `guideline is ${RULE.featurePhotos}`],
    ["Intro video", introItem() ? introItem().durationSec + "s" : "None", `${RULE.introMin}–${RULE.introMax} seconds`],
    ["Session media", String(sItems.length), `across ${countOf(sessionsUsed, "session")}`],
    ["On your profile", String(publishedCount()), `of ${state.mediaItems.length} in the library`],
  ];

  return `
  <section class="md-band">
    <div data-rev>
      <div class="md-head">
        <div>
          <div class="eyebrow">Media &amp; consent</div>
          <h1>Consent decides what leaves.</h1>
          <p class="md-lede">Photos of an athlete move only where that athlete's parent allowed. You can ask
            for consent — never grant it.</p>
        </div>
        <div class="md-actions">
          <button class="btn ghost" data-modal="consent">Consent roster</button>
          <button class="btn" data-md-upload="new">Add media</button>
        </div>
      </div>
      <div class="stats">
        ${tiles.map(([k, v, d]) => `<div class="stat"><div class="k">${esc(k)}</div>
          <div class="v num">${esc(v)}</div><div class="d num">${esc(d)}</div></div>`).join("")}
      </div>
    </div>
  </section>

  <section class="md-band band dark">
    <div data-rev>
      <div class="eyebrow">What the library enforces</div>
      <h2>Consent is per athlete, and revocable.</h2>
      <p class="md-sub">A parent sets it in their own app. Nothing in this tab can write to it.</p>

      <div class="md-card" style="margin-top:22px">
        <span class="ic">${shield}</span>
        <div class="md-cardbody">
          ${held.length
            ? `<b>${esc(countOf(held.length, "item"))} held by consent.</b>
               <p class="md-why">${held.length === 1 ? "It stays" : "They stay"} in your library, visible
                 only to you. Nothing was deleted.</p>`
            : `<b>Nothing is held right now.</b>
               <p class="md-why">Every item clears the consent on file for the athletes in it.</p>`}
          ${held.length ? `<div class="md-holds">${held.map(it => {
            const v = evaluate(it);
            return `<div class="md-hold">
              <b>${esc(it.caption)}</b>
              <p class="md-why">${esc(v.canShare ? v.publishReason : v.shareReason)}</p>
            </div>`;
          }).join("")}</div>` : ""}
        </div>
      </div>

      <div class="md-tally">
        <div><b class="num">${cc.public_profile}</b><span>Profile + private</span></div>
        <div><b class="num">${cc.private_share}</b><span>Private only</span></div>
        <div><b class="num">${cc.none}</b><span>No media</span></div>
      </div>
      <p class="md-foot">Across ${esc(countOf(ROSTER.length, "athlete"))}. A withdrawal pulls the media
        down immediately.</p>
    </div>
  </section>

  <section class="md-band paper">
    <div data-rev>
      <div class="md-secline"><div>
        <h2>Profile media</h2>
        <p>What families see on your listing. Sporv asks for ${RULE.featurePhotos} photos; you have
          <span class="num">${photos}</span>${shortPhotos
            ? `, so add <span class="num">${shortPhotos}</span> more.`
            : `, which meets it.`}</p>
      </div></div>

      <div class="md-meter">
        <div class="md-meterhead">
          <div class="eyebrow">Profile media strength</div>
          <div class="md-pct num">${st.pct}%</div>
        </div>
        <div class="md-bar" role="img" aria-label="Profile media is ${st.pct} percent complete">
          <i style="width:${st.pct}%"></i></div>
        <p class="md-next"><b>Next:</b> ${esc(st.next)}</p>
      </div>

      <div class="md-slots">${SLOTS.map(slotCard).join("")}</div>
    </div>
  </section>

  <section class="md-band paper">
    <div data-rev>
      <div class="md-secline">
        <div>
          <h2>Session media</h2>
          <p>Attached to the athletes in it — which is what makes the gate enforceable.</p>
        </div>
        <div class="md-seg" role="group" aria-label="Group session media by">
          <button class="${grouping === "session" ? "on" : ""}" data-md-group="session"
            aria-pressed="${grouping === "session"}">By session</button>
          <button class="${grouping === "athlete" ? "on" : ""}" data-md-group="athlete"
            aria-pressed="${grouping === "athlete"}">By athlete</button>
        </div>
      </div>

      <div class="md-groups">${grouping === "session" ? sessionGroups() : athleteGroups()}</div>
      ${grouping === "athlete"
        ? `<p class="md-hint" style="margin-top:14px">Media with two athletes appears under each of them.</p>`
        : ""}
    </div>
  </section>

  <section class="md-band paper">
    <div data-rev>
      <div class="md-secline"><div>
        <h2>Videos</h2>
        <p>Every clip and your intro video in one place — play them, or have the assistant analyze the technique.</p>
      </div></div>
      ${(()=>{const vids=state.mediaItems.filter(i=>i.mediaType==="video");
        return vids.length?`<div class="md-vids">${vids.map(v=>`<div class="md-vid">
          <button class="md-vidposter" data-md-play="${esc(v.id)}" aria-label="Play ${esc(v.caption)}">
            <span class="md-vidplay" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
            <span class="md-viddur num">${esc(String(v.durationSec==null?"--":v.durationSec))}s</span>
          </button>
          <div class="md-vidmeta">
            <b>${esc(v.caption)}</b>
            <p>${v.kind==="profile"?"Intro video":"Session clip"}${v.durationSec!=null?` · ${v.durationSec}s`:""}</p>
            <button class="btn ghost sm" data-md-analyze="${esc(v.id)}">Analyze with AI</button>
          </div>
        </div>`).join("")}</div>
        <div id="mdVidAnalysis">${analyzedVid?vidAnalysisHTML(analyzedVid):""}</div>`
        :`<p style="color:var(--muted);font-size:var(--text-base);margin-top:12px">No videos yet — add a clip or your intro video above.</p>`;})()}
    </div>
  </section>

  <section class="md-band paper">
    <div data-rev>
      <div class="md-secline"><div>
        <div class="eyebrow">Organization bio</div>
        <h2>Your story, drafted from your facts.</h2>
        <p>The assistant drafts from your real profile — sports, roster size, verification. It only claims what your profile proves.</p>
      </div></div>
      <div class="md-biobox" id="mdBio" contenteditable="true" spellcheck="false" role="textbox" aria-label="Organization bio">${
        esc(bioText || "Tap Write it for me and the assistant drafts your bio from your real profile. You approve before anything goes live.")}</div>
      <div class="md-biolive${bioLive ? " on" : ""}">${esc("Approved — live on your marketplace listing, public page, and booking confirmations.")}</div>
      <div class="md-bioacts">
        <button class="btn ghost" data-md-biodraft="1">Write it for me</button>
        <button class="btn" data-md-bioapprove="1">Approve</button>
      </div>
    </div>
  </section>`;
}

/* ═══════════════════ 2026-08-27 MEDIA FORMAT ═══════════════════ */
function profileBioValue(){
  return bioText == null
    ? String((SEED.providerProfile && SEED.providerProfile.bio) || bioDraft())
    : String(bioText);
}

function profileHeadlineValue(){
  if (headlineText != null) return headlineText;
  const sports = (SEED.providerProfile && SEED.providerProfile.sports) || [];
  return (sports.length ? sports.join(" · ") : "Youth sports") + " training · Ages 8–17";
}

function itemStatus(it){
  const v = evaluate(it);
  if (it.published) return { key: "live", label: "On profile" };
  if (!v.canShare) return { key: "held", label: "Held" };
  if (!v.canPublish) return { key: "private", label: "Private only" };
  if (it.sharedWith.length) return { key: "shared", label: "Shared" };
  return { key: "unused", label: "Unused" };
}

function assetMeta(it){
  const people = it.athleteIds.length
    ? countOf(it.athleteIds.length, "athlete")
    : "no athletes";
  return (it.mediaType === "video" ? "Video" : "Photo") + " · " +
    fmtDate(it.createdAt.slice(0, 10)) + " · " + people;
}

function assetThumb(it, status, order){
  return `<div class="mfmt-thumb" role="img" aria-label="${esc(tileAlt(it))}">
    <span class="mfmt-status ${esc(status.key)}">${esc(status.label)}</span>
    ${order ? `<span class="mfmt-order mfmt-num">${esc(String(order))}</span>` : ""}
    ${it.mediaType === "video"
      ? `<button class="mfmt-thumbplay" data-md-play="${esc(it.id)}"
           aria-label="Play ${esc(it.caption)}">${PLAY}</button>
         <span class="mfmt-video-length mfmt-num">${esc(String(it.durationSec == null ? "--" : it.durationSec))}s</span>`
      : `<span class="mfmt-thumbmark">4:3</span>`}
  </div>`;
}

function assetCard(it, opts){
  const options = opts || {};
  const v = evaluate(it);
  const status = itemStatus(it);
  const actions = options.actions !== false;
  return `<article class="mfmt-asset">
    ${assetThumb(it, status, options.order || 0)}
    <div class="mfmt-assetmeta">
      <b title="${esc(it.caption)}">${esc(it.caption)}</b>
      <small>${esc(assetMeta(it))}</small>
    </div>
    ${actions ? `<div class="mfmt-assetacts">
      ${it.athleteIds.length ? `<button class="mfmt-btn small" data-md-share="${esc(it.id)}"
        ${v.canShare ? "" : `disabled aria-disabled="true"`}
        title="${esc(v.canShare ? "Send to the tagged family thread" : v.shareReason)}">Send</button>` : ""}
      ${it.published
        ? `<button class="mfmt-btn small" data-md-unpublish="${esc(it.id)}">Remove</button>`
        : `<button class="mfmt-btn small" data-md-publish="${esc(it.id)}"
             ${v.canPublish ? "" : `disabled aria-disabled="true"`}
             title="${esc(v.canPublish ? "Publish to your profile" : v.publishReason)}">Publish</button>`}
      <button class="mfmt-iconbtn" data-md-del="${esc(it.id)}"
        aria-label="Delete ${esc(it.caption)}">${ICON.x}</button>
    </div>` : ""}
  </article>`;
}

function profilePaneHTML(){
  const pp = SEED.providerProfile || {};
  const cover = slotItems("headshot")[0] || null;
  const intro = introItem();
  const gallery = state.mediaItems.filter(i => i.published).slice(0, 4);
  const bio = profileBioValue();
  const initials = initialsOf(pp.businessName || "Your profile");
  return `<div class="mfmt-block">
    <h2 class="mfmt-section-title">What parents see</h2>
    <p class="mfmt-section-sub">This is the only tab that changes your public profile. Everything approved here is live now.</p>
    <div class="mfmt-card mfmt-profile-card">
      <div class="mfmt-profile-cover">
        <div class="mfmt-cover" role="img" aria-label="${esc(cover ? tileAlt(cover) : "Profile cover photo placeholder")}">
          <span class="mfmt-covermark">${esc(initials)}</span>
          <span class="mfmt-cover-tag">Cover photo</span>
        </div>
        <button class="mfmt-btn small mfmt-full" data-md-upload="headshot">Replace</button>
      </div>
      <div>
        <div class="mfmt-field">
          <label for="mdDisplayName">Display name</label>
          <input id="mdDisplayName" data-md-display-name value="${esc(pp.businessName || "")}" autocomplete="organization">
        </div>
        <div class="mfmt-field">
          <label for="mdBio">Bio</label>
          <textarea id="mdBio" maxlength="400">${esc(bio)}</textarea>
          <div class="mfmt-fieldmeta"><span>Shown on your profile and every listing card.</span>
            <span id="mdBioCount" class="mfmt-num">${esc(String(bio.length))} / 400</span></div>
          <div class="mfmt-bio-actions">
            <button class="mfmt-btn small" data-md-biodraft="1">Write it for me</button>
            <button class="mfmt-btn small primary" data-md-bioapprove="1">Approve</button>
            <span class="mfmt-live${bioLive ? " on" : ""}">Approved and live</span>
          </div>
        </div>
        <div class="mfmt-field">
          <label for="mdHeadline">Headline</label>
          <input id="mdHeadline" data-md-headline value="${esc(profileHeadlineValue())}">
        </div>
      </div>
    </div>
  </div>

  <div class="mfmt-block">
    <h2 class="mfmt-section-title">Intro video</h2>
    <p class="mfmt-section-sub">Optional. Coaches with an intro video get more profile views; 30–60 seconds works best.</p>
    <div class="mfmt-two">
      <div class="mfmt-card mfmt-video-card">
        <div class="mfmt-video" role="img" aria-label="${esc(intro ? tileAlt(intro) : "Intro video placeholder")}">
          ${intro ? `<button class="mfmt-video-play" data-md-play="${esc(intro.id)}"
              aria-label="Play ${esc(intro.caption)}">${PLAY}</button>
            <span class="mfmt-video-length mfmt-num">${esc(String(intro.durationSec == null ? "--" : intro.durationSec))}s · 16:9</span>`
            : `<span>No intro video</span>`}
        </div>
      </div>
      <div class="mfmt-card">
        <div class="mfmt-stat-label">Length</div>
        <div class="mfmt-stat-value">${intro && intro.durationSec != null ? esc(String(intro.durationSec)) + "s" : "—"}</div>
        <div class="mfmt-stat-detail">Guideline is ${RULE.introMin}–${RULE.introMax} seconds</div>
        <div class="mfmt-inline-actions">
          <button class="mfmt-btn small" data-md-upload="intro_video">Replace</button>
          ${intro ? `<button class="mfmt-btn small" data-md-trim="${esc(intro.id)}">Trim</button>
            ${intro.published
              ? `<button class="mfmt-btn small" data-md-unpublish="${esc(intro.id)}">Remove</button>`
              : `<button class="mfmt-btn small" data-md-publish="${esc(intro.id)}">Publish</button>`}
            <button class="mfmt-btn small" data-md-analyze="${esc(intro.id)}">Analyze with AI</button>` : ""}
        </div>
      </div>
    </div>
    ${analyzedVid ? `<div class="mfmt-analysis" id="mdVidAnalysis">${vidAnalysisHTML(analyzedVid)}</div>` : ""}
  </div>

  <div class="mfmt-block">
    <h2 class="mfmt-section-title">Gallery order</h2>
    <p class="mfmt-section-sub">${esc(countOf(gallery.length, "item"))} are on your profile. Published media appears here in order; consent is checked again before anything can be added.</p>
    <div class="mfmt-grid">
      ${gallery.length ? gallery.map((it, i) => assetCard(it, { actions: false, order: i + 1 })).join("")
        : `<div class="mfmt-empty">No media is published to your profile yet.</div>`}
    </div>
  </div>`;
}

function libraryFilterOptions(){
  const filters = [
    ["all", "All", state.mediaItems.length],
    ["photos", "Photos", state.mediaItems.filter(i => i.mediaType === "photo").length],
    ["video", "Video", state.mediaItems.filter(i => i.mediaType === "video").length],
    ["profile", "On profile", state.mediaItems.filter(i => i.published).length],
    ["held", "Held by consent", state.mediaItems.filter(i => evaluate(i).blockKind === "consent").length],
    ["unused", "Unused", state.mediaItems.filter(i => itemStatus(i).key === "unused").length],
  ];
  return filters;
}

function filteredLibraryItems(){
  if (mediaFilter === "photos") return state.mediaItems.filter(i => i.mediaType === "photo");
  if (mediaFilter === "video") return state.mediaItems.filter(i => i.mediaType === "video");
  if (mediaFilter === "profile") return state.mediaItems.filter(i => i.published);
  if (mediaFilter === "held") return state.mediaItems.filter(i => evaluate(i).blockKind === "consent");
  if (mediaFilter === "unused") return state.mediaItems.filter(i => itemStatus(i).key === "unused");
  return state.mediaItems;
}

function libraryPaneHTML(){
  const items = filteredLibraryItems();
  return `<div class="mfmt-block">
    <h2 class="mfmt-section-title">All uploads</h2>
    <p class="mfmt-section-sub">Every file you've added, whether or not it can be published. A consent change never deletes the original.</p>
    <div class="mfmt-filters" role="group" aria-label="Filter media library">
      ${libraryFilterOptions().map(([key, label, n]) => `<button class="mfmt-chip${mediaFilter === key ? " on" : ""}"
        data-md-filter="${esc(key)}" aria-pressed="${mediaFilter === key}">${esc(label)}
        <span class="mfmt-num">${esc(String(n))}</span></button>`).join("")}
    </div>
    <div class="mfmt-grid">
      ${items.length ? items.map(it => assetCard(it)).join("")
        : `<div class="mfmt-empty">No media matches this filter.</div>`}
    </div>
  </div>`;
}

function consentStatusFor(a){
  const kind = consentOf(a.id);
  const limited = state.mediaItems.filter(i => i.athleteIds.indexOf(a.id) >= 0 &&
    evaluate(i).blockKind === "consent").length;
  if (kind === "public_profile") return { key: "allowed", label: "Allowed" };
  if (kind === "private_share") return { key: "private", label: "Private only" + (limited ? " · " + limited : "") };
  if (!a.consentAt) return { key: "none", label: "Not asked" };
  return { key: "held", label: "Held" + (limited ? " · " + limited : "") };
}

function recentConsentChanges(){
  const changes = [];
  ROSTER.forEach(a => {
    if (!a.consentAt) return;
    const kind = consentOf(a.id);
    const action = kind === "public_profile"
      ? "allowed profile and private media for"
      : kind === "private_share"
        ? "limited media to private family sharing for"
        : "withheld media consent for";
    changes.push({ at: a.consentAt, text: a.parent + " " + action + " " + a.name + "." });
  });
  Object.keys(consentRequests).forEach(id => {
    const a = athleteById(id);
    if (a) changes.push({ at: consentRequests[id], text: "Consent request sent to " + a.parent + " for " + a.name + "." });
  });
  return changes.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
}

function consentPaneHTML(){
  const shield = (typeof PICON === "object" && PICON.shield) || "";
  const changes = recentConsentChanges();
  const limited = heldItems().length;
  return `<div class="mfmt-note">${shield}<span><b>Consent is per athlete, and revocable.</b>
    A parent sets it in their own app. Nothing in this tab can write to it — you can request consent, never grant it.
    Fully held items stay visible only to you; private-only items can still go to that athlete's family.</span></div>
  <div class="mfmt-block">
    <h2 class="mfmt-section-title">By athlete</h2>
    <p class="mfmt-section-sub">${esc(countOf(limited, "item"))} currently have a consent limit. A request notifies the parent once in this demo.</p>
    <div class="mfmt-consent" role="table" aria-label="Media consent by athlete">
      <div class="mfmt-consent-head" role="row"><span role="columnheader">Athlete</span><span role="columnheader">Items</span>
        <span role="columnheader">Last updated</span><span role="columnheader"></span></div>
      ${ROSTER.map(a => { const cs = consentStatusFor(a); const asked = !!consentRequests[a.id];
        return `<div class="mfmt-consent-row" role="row">
          <span class="mfmt-consent-name" role="cell">${esc(a.name)}<small>Guardian: ${esc(a.parent)}</small></span>
          <span class="mfmt-pill ${esc(cs.key)}" role="cell">${esc(cs.label)}</span>
          <span class="mfmt-date" role="cell">${a.consentAt ? esc(fmtDate(a.consentAt.slice(0, 10))) : "—"}</span>
          <span role="cell">${consentOf(a.id) === "public_profile" ? "" : `<button class="mfmt-btn small"
            data-md-request="${esc(a.id)}" ${asked ? `disabled aria-disabled="true"` : ""}>${asked ? "Sent" : "Request"}</button>`}</span>
        </div>`; }).join("")}
    </div>
  </div>
  <div class="mfmt-block">
    <h2 class="mfmt-section-title">Recent changes</h2>
    <p class="mfmt-section-sub">Read-only history. Sporv records who changed consent and when.</p>
    <div class="mfmt-card mfmt-list">
      ${changes.length ? changes.map(c => `<div class="mfmt-list-row"><span>${esc(c.text)}</span>
        <span class="mfmt-num">${esc(fmtDate(c.at.slice(0, 10)))}</span></div>`).join("")
        : `<div class="mfmt-list-row"><span>No consent changes recorded yet.</span><span class="mfmt-num">—</span></div>`}
    </div>
  </div>`;
}

function profileChecklist(){
  const published = publishedCount();
  const intro = introItem();
  return [
    ["Cover photo", slotItems("headshot").length > 0, "Done"],
    ["Bio", profileBioValue().trim().length > 0, "Done"],
    ["Intro video", !!intro, intro && intro.durationSec > RULE.introMax ? "Done · trim to 60s" : "Done"],
    ["Published media, 4 items", published >= 4, published >= 4 ? "Done" : published + " of 4"],
    ["Fifth published item", published >= 5, published >= 5 ? "Done" : "Missing"],
  ];
}

function performancePaneHTML(){
  /* The seeded Northside Flight workspace is the product demo, even after the demo login
     marks it verified. Real provider rows never receive invented analytics. */
  const demo = typeof coachState === "function" ? !coachState().isReal : true;
  const stats = demo
    ? [["Profile views", "248", "+18% vs prior 30 days"], ["Video plays", "96", "39% of viewers"],
       ["Avg. watch", "41s", "of 72s"], ["Gallery opens", "73", "29% of viewers"]]
    : [["Profile views", "—", "Analytics is not connected yet"], ["Video plays", "—", "Analytics is not connected yet"],
       ["Avg. watch", "—", "Analytics is not connected yet"], ["Gallery opens", "—", "Analytics is not connected yet"]];
  const checks = profileChecklist();
  const done = checks.filter(c => c[1]).length;
  const pct = Math.round(done / checks.length * 100);
  const most = state.mediaItems.filter(i => i.published).slice(0, 4);
  const views = [1102, 847, 612, 288];
  return `<div class="mfmt-block">
    <h2 class="mfmt-section-title">How your media is doing</h2>
    <p class="mfmt-section-sub">Last 30 days. ${demo ? "Sample workspace metrics;" : "Once analytics is connected,"} parent-facing views only; your own visits are excluded.</p>
    <div class="mfmt-stats">
      ${stats.map(([label, value, detail]) => `<div class="mfmt-card">
        <div class="mfmt-stat-label">${esc(label)}</div><div class="mfmt-stat-value">${esc(value)}</div>
        <div class="mfmt-stat-detail">${esc(detail)}</div></div>`).join("")}
    </div>
  </div>
  <div class="mfmt-block">
    <h2 class="mfmt-section-title">Profile completeness</h2>
    <p class="mfmt-section-sub">What is still missing from the presentation parents see.</p>
    <div class="mfmt-card">
      <div class="mfmt-progress-head"><span>${done} of ${checks.length} recommended items</span><span class="mfmt-num">${pct}%</span></div>
      <div class="mfmt-progress" role="img" aria-label="Profile is ${pct} percent complete"><i style="width:${pct}%"></i></div>
      <div class="mfmt-list" style="margin-top:14px;padding:0">
        ${checks.map(([label, met, detail]) => `<div class="mfmt-list-row"><span>${esc(label)}</span>
          <span class="mfmt-num">${esc(detail)}</span></div>`).join("")}
      </div>
    </div>
  </div>
  <div class="mfmt-block">
    <h2 class="mfmt-section-title">Most viewed</h2>
    <p class="mfmt-section-sub">Published items ordered by the parent-facing view records available to this workspace.</p>
    <div class="mfmt-card mfmt-list">
      ${most.length ? most.map((it, i) => `<div class="mfmt-list-row"><span>${esc(it.caption)}</span>
        <span class="mfmt-num">${demo ? esc(views[i].toLocaleString()) : "—"}</span></div>`).join("")
        : `<div class="mfmt-list-row"><span>Publish media to start collecting views.</span><span class="mfmt-num">—</span></div>`}
    </div>
  </div>`;
}

function mediaView(){
  /* Shared coach pages keep their local pane in ?tab=. Media remains the
     approved reference implementation, but follows the same deep-link rule. */
  let hasUrlPane = false;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (["profile", "library", "consent", "performance"].indexOf(fromUrl) >= 0){ mediaPane = fromUrl; hasUrlPane = true; }
  } catch (_e) {}
  if (!hasUrlPane && window.COACH_UI && window.COACH_UI.writeTab) window.COACH_UI.writeTab(mediaPane);
  const panes = [
    ["profile", "Profile", "", profilePaneHTML],
    ["library", "Library", String(state.mediaItems.length), libraryPaneHTML],
    ["consent", "Consent", String(heldItems().length), consentPaneHTML],
    ["performance", "Performance", "", performancePaneHTML],
  ];
  return `<section class="mfmt" aria-labelledby="mfmtTitle">
    <header class="mfmt-head">
      <div class="mfmt-headrow">
        <div class="mfmt-headcopy">
          <p class="mfmt-eyebrow">Catalog</p>
          <h1 class="mfmt-title" id="mfmtTitle">Media</h1>
          <p class="mfmt-lede">Your profile presentation, every file you've uploaded, and the consent state that decides where each one can appear.</p>
        </div>
        <div class="mfmt-actions">
          <button class="mfmt-btn" data-md-pane="consent">Consent roster</button>
          <button class="mfmt-btn primary" data-md-upload="new">Add media</button>
        </div>
      </div>
    </header>
    <nav class="mfmt-tabs" role="tablist" aria-label="Media sections">
      ${panes.map(([key, label, count]) => `<button class="mfmt-tab${mediaPane === key ? " on" : ""}"
        id="mfmt-tab-${esc(key)}" role="tab" aria-selected="${mediaPane === key}"
        aria-controls="mfmt-panel-${esc(key)}" tabindex="${mediaPane === key ? "0" : "-1"}"
        data-md-pane="${esc(key)}">${esc(label)}${count ? `<span class="mfmt-count">${esc(count)}</span>` : ""}</button>`).join("")}
    </nav>
    ${panes.map(([key, label, count, pane]) => `<div class="mfmt-pane" id="mfmt-panel-${esc(key)}"
      role="tabpanel" aria-labelledby="mfmt-tab-${esc(key)}" ${mediaPane === key ? "" : "hidden"}>${pane()}</div>`).join("")}
  </section>`;
}

/* ═══════════════════ MODALS ═══════════════════ */
const wrap = (title, body) =>
  `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-body">${body}</div></div></div>`;

/* Live gate copy, shared by the upload modal and its repaint. */
function gateHTML(draft){
  const v = evaluate(draft);
  const kids = draft.athleteIds.length;
  const lines = [];
  if (!kids){
    lines.push(draft.kind === "session"
      ? "No athlete tagged yet. Session media must name the athletes in it before it can be sent anywhere."
      : "No athlete tagged. This can go on your public profile without anyone's consent, and there is no family thread to send it to.");
  } else if (v.canShare && v.canPublish){
    lines.push("All " + countOf(kids, "tagged athlete") + " have profile consent. This can be sent to their families and published on your profile.");
  } else if (v.canShare){
    lines.push(v.publishReason);
    lines.push("You can still send it privately to the tagged families.");
  } else {
    lines.push(v.shareReason);
  }
  return `<div class="eyebrow md-gatehead">Consent check</div>${lines.map(l => `<div>${esc(l)}</div>`).join("")}`;
}

function uploadModal(){
  const preset = (S.modal && S.modal.mdSlot) || null;
  const kind = preset && preset !== "new" ? "profile" : "session";
  const slotKey = preset && preset !== "new" ? preset : "headshot";
  const draft = { kind: kind, mediaType: slotRow(slotKey).format, athleteIds: [] };

  return wrap("Add media", `
    <p style="color:var(--muted);margin-bottom:18px">Tag the athletes who are actually in the frame. The consent
      check below runs before anything can be marked shareable — and it runs again when you press send.</p>
    <form id="mdUploadForm" novalidate>
      <p class="eyebrow" style="margin-bottom:11px">What is this?</p>
      <div class="md-opts">
        <label class="md-opt">
          <input type="radio" name="kind" value="profile" ${kind === "profile" ? "checked" : ""}>
          <span style="min-width:0"><b>Profile media</b>
            <span>Lives on your public listing — headshot, intro video, facility, action shots.</span></span>
        </label>
        <label class="md-opt">
          <input type="radio" name="kind" value="session" ${kind === "session" ? "checked" : ""}>
          <span style="min-width:0"><b>Session media</b>
            <span>Captured at one session and attached to the athletes who were there.</span></span>
        </label>
      </div>

      <div id="mdProfileWrap" class="${kind === "profile" ? "" : "hide"}">
        <div class="field"><label for="mdSlot">Where it sits on your profile</label>
          <select id="mdSlot" name="slot">
            ${SLOTS.map(s => `<option value="${esc(s.key)}" ${s.key === slotKey ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
          </select></div>
      </div>

      <div id="mdSessionWrap" class="${kind === "session" ? "" : "hide"}">
        <div class="field"><label for="mdSession">Session</label>
          <select id="mdSession" name="sessionId">
            <option value="">Pick a session</option>
            ${SESSIONS.map(s => {
              const p = prog(s.programId);
              return `<option value="${esc(s.id)}">${esc(s.title)} · ${esc(fmtDate(s.date))}${p ? " · " + esc(p.title) : ""}</option>`;
            }).join("")}
          </select></div>
      </div>

      <div class="field"><label for="mdType">Format</label>
        <select id="mdType" name="mediaType">
          <option value="photo" ${draft.mediaType === "photo" ? "selected" : ""}>Photo</option>
          <option value="video" ${draft.mediaType === "video" ? "selected" : ""}>Video</option>
        </select></div>

      <div class="field ${draft.mediaType === "video" ? "" : "hide"}" id="mdDurWrap">
        <label for="mdDur">Length in seconds</label>
        <input id="mdDur" name="durationSec" type="number" min="1" max="600" step="1" class="num" value="45">
      </div>

      <p class="eyebrow" style="margin-bottom:6px">Athletes in this media</p>
      <p class="md-why" style="margin-bottom:10px">Required for session media. Optional for profile media — but an
        action shot with a child in it counts as media of that child.</p>
      <div class="md-checks">
        ${ROSTER.map(a => {
          const k = consentOf(a.id);
          return `<label class="md-check">
            <input type="checkbox" name="athlete" value="${esc(a.id)}" data-md-tag="1">
            <span style="min-width:0"><b>${esc(a.name)}</b>
              <span class="pill ${consentPill(k)}" style="margin-top:4px">${esc(consentLabel(k))}</span></span>
          </label>`;
        }).join("")}
      </div>

      <div class="field" style="margin-top:16px"><label for="mdCap">Caption</label>
        <textarea id="mdCap" name="caption" rows="3" maxlength="400"
          placeholder="What the family is looking at"></textarea>
        <span class="md-cnt num" id="mdCnt">0 / ${RULE.captionMax}</span></div>

      <div class="md-gate" id="mdGate">${gateHTML(draft)}</div>

      <label class="md-check" id="mdShareWrap" style="margin-bottom:16px">
        <input type="checkbox" id="mdShareable" name="shareable" disabled>
        <span style="min-width:0"><b>Mark as shareable with the tagged families</b>
          <span class="md-why" id="mdShareWhy">Tag at least one athlete with consent to enable this.</span></span>
      </label>

      <div id="mdUpErr" class="err hide" style="margin-bottom:10px"></div>
      <button class="btn wide" type="submit">Add to library</button>
    </form>`);
}

function consentModal(){
  const cc = consentCounts();
  return wrap("Media consent", `
    <div class="md-note warn" style="margin-bottom:18px">
      <b>Only a parent can grant this.</b> Consent is set by the family in their own Sporv app, against a
      named athlete. You can see what they chose and ask them to reconsider — there is no control here, and no
      code path in this app, that lets a coach answer on a family's behalf.</div>

    <div class="tblwrap"><table class="tbl">
      <thead><tr><th>Athlete</th><th>Program</th><th>Tagged</th><th>Consent</th><th>Action</th></tr></thead>
      <tbody>${ROSTER.map(a => {
        const k = consentOf(a.id);
        const p = prog(a.programId);
        const req = consentRequests[a.id] || null;
        return `<tr>
          <td><b>${esc(a.name)}</b>
            <div class="num" style="color:var(--muted);font-size:var(--text-sm)">Age ${a.age == null ? "—" : a.age} · ${esc(a.parent)}</div></td>
          <td>${p ? esc(p.title) : `<span style="color:var(--muted)">—</span>`}</td>
          <td class="num">${taggedCount(a.id)}</td>
          <td><span class="pill ${consentPill(k)}">${esc(consentLabel(k))}</span>
            ${a.consentAt
              ? `<div class="num" style="color:var(--muted);font-size:var(--text-sm);margin-top:3px">set ${esc(fmtDate(a.consentAt.slice(0, 10)))}</div>`
              : `<div style="color:var(--muted);font-size:var(--text-sm);margin-top:3px">never set</div>`}</td>
          <td>${k === "public_profile"
            ? `<span style="color:var(--muted);font-size:var(--text-sm)">Nothing to ask for</span>`
            : `<button class="btn ghost sm" data-md-request="${esc(a.id)}">${req ? "Ask again" : "Request consent"}</button>
               ${req ? `<div class="num" style="color:var(--muted);font-size:var(--text-sm);margin-top:4px">asked ${esc(fmtDate(req.slice(0, 10)))}</div>` : ""}`}</td>
        </tr>`;
      }).join("")}</tbody></table></div>

    <p class="eyebrow" style="margin-top:20px">What the three settings mean</p>
    <div class="md-legend">
      ${CONSENT.map(([k, label, , meaning]) =>
        `<div><b>${esc(label)}</b> — ${esc(meaning)}</div>`).join("")}
    </div>
    <div class="md-strip">
      <span>Counts: <span class="num">${cc.public_profile}</span> profile + private,
        <span class="num">${cc.private_share}</span> private only,
        <span class="num">${cc.none}</span> no media. A family can change or withdraw at any time.</span>
    </div>`);
}

function shareMediaModal(){
  const it = itemById(S.modal && S.modal.itemId);
  if (!it) return wrap("Send to family", `<p style="color:var(--muted)">That media item no longer exists.</p>`);
  const v = evaluate(it);
  const noun = it.mediaType === "video" ? "clip" : "photo";
  const s = it.sessionId ? sessionById(it.sessionId) : null;

  const head = `<figure class="md-tile" style="max-width:210px;margin:0 0 18px">
      ${placeholder(it)}
      <div class="md-body"><figcaption class="md-cap">${esc(it.caption)}</figcaption>
        ${s ? `<p class="md-sent num">${esc(s.title)} · ${esc(fmtDate(s.date))}</p>` : ""}</div>
    </figure>`;

  if (!v.canShare){
    return wrap("Send to family", head + `
      <div class="md-note warn" style="margin-bottom:18px">
        <b>This ${esc(noun)} can't be sent.</b> ${esc(v.shareReason)}</div>
      ${v.athleteIds.length ? `<p class="eyebrow" style="margin-bottom:8px">Tagged</p>
        <div class="md-tags" style="margin-bottom:18px">${v.athleteIds.map(athletePill).join("")}</div>` : ""}
      <p style="color:var(--muted);font-size:var(--text-sm);margin-bottom:18px">
        Sending is blocked in code, not just in this dialog — the same check runs again on the send itself.</p>
      <button class="btn wide" data-modal="consent">Open the consent roster</button>`);
  }

  const recipients = it.athleteIds.map(id => {
    const a = athleteById(id), k = consentOf(id);
    return `<div class="linerow"><span>${esc(a ? a.parent : "Parent")}
        <span style="color:var(--muted)"> · ${esc(athleteName(id))}</span></span>
      <span class="pill ${consentPill(k)}">${esc(consentLabel(k))}</span></div>`;
  }).join("");

  return wrap("Send to family", head + `
    <p class="eyebrow" style="margin-bottom:4px">Goes to</p>
    ${recipients}
    ${v.canPublish ? "" : `<div class="md-note warn" style="margin-top:14px">
      Private send only. ${esc(v.publishReason)}</div>`}
    <form id="mdShareForm" style="margin-top:18px">
      <div class="field"><label for="mdShareNote">Note to the family (optional)</label>
        <textarea id="mdShareNote" name="note" rows="3" maxlength="400"
          placeholder="What you want them to notice"></textarea>
        <span class="md-cnt num" id="mdShareCnt">0 / ${RULE.captionMax}</span></div>
      <div id="mdShareErr" class="err hide" style="margin-bottom:10px"></div>
      <button class="btn wide" type="submit">${ICON.send} Send to ${esc(countOf(it.athleteIds.length, "family thread"))}</button>
    </form>`);
}

/* ═══════════════════ WIRING ═══════════════════ */
function ensureCSS(){
  if (document.getElementById("mod-media-css")) return;
  const el = document.createElement("style");
  el.id = "mod-media-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* Read the upload form's current draft without touching state. */
function readDraft(form){
  const kindEl = form.querySelector('input[name="kind"]:checked');
  const typeEl = form.querySelector('#mdType');
  const ids = [];
  form.querySelectorAll('input[name="athlete"]:checked').forEach(c => ids.push(c.value));
  return {
    kind: kindEl ? kindEl.value : "session",
    mediaType: typeEl ? typeEl.value : "photo",
    athleteIds: ids,
  };
}

/* The host re-renders everything on state change, which would steal the
   caret out of the caption box. So the gate, the counter, and the
   shareable checkbox repaint in place. */
function paintGate(){
  const form = document.getElementById("mdUploadForm");
  if (!form) return;
  const draft = readDraft(form);
  const v = evaluate(draft);
  const gate = document.getElementById("mdGate");
  if (gate){
    gate.innerHTML = gateHTML(draft);
    gate.classList.toggle("block", !v.canShare || !v.canPublish);
  }
  const cb = document.getElementById("mdShareable");
  const why = document.getElementById("mdShareWhy");
  if (cb){
    const allowed = v.canShare;
    if (!allowed) cb.checked = false;
    cb.disabled = !allowed;
    if (why){
      why.textContent = allowed
        ? "The tagged families can receive this in their own thread."
        : (draft.athleteIds.length ? v.shareReason : "Tag at least one athlete with consent to enable this.");
    }
  }
}
function paintCount(taEl, outEl){
  if (!taEl || !outEl) return;
  const n = taEl.value.length;
  outEl.textContent = n + " / " + RULE.captionMax;
  outEl.classList.toggle("over", n > RULE.captionMax);
}

function wire(){
  ensureCSS();
  const q = s => document.querySelectorAll(s);

  /* ── local Media tabs + library filters ─────────────────────── */
  const paneKeys = ["profile", "library", "consent", "performance"];
  q("[data-md-pane]").forEach(b => b.onclick = () => {
    mediaPane = paneKeys.indexOf(b.dataset.mdPane) >= 0 ? b.dataset.mdPane : "profile";
    if (window.COACH_UI && window.COACH_UI.writeTab) window.COACH_UI.writeTab(mediaPane);
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
    requestAnimationFrame(() => {
      const active = document.querySelector('.mfmt-tab[data-md-pane="' + mediaPane + '"]');
      if (active) active.focus({ preventScroll: true });
    });
  });
  const paneTabs = Array.from(q(".mfmt-tab[data-md-pane]"));
  paneTabs.forEach((b, index) => b.onkeydown = e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowLeft") next = (index - 1 + paneTabs.length) % paneTabs.length;
    if (e.key === "ArrowRight") next = (index + 1) % paneTabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = paneTabs.length - 1;
    paneTabs[next].click();
  });
  q("[data-md-filter]").forEach(b => b.onclick = () => {
    mediaFilter = ["all", "photos", "video", "profile", "held", "unused"].indexOf(b.dataset.mdFilter) >= 0
      ? b.dataset.mdFilter : "all";
    render();
  });

  /* ── library actions ──────────────────────────────────────────── */
  q("[data-md-upload]").forEach(b => b.onclick = () => {
    S.modal = { type: "upload", mdSlot: b.dataset.mdUpload };
    render();
  });
  q("[data-md-group]").forEach(b => b.onclick = () => {
    grouping = b.dataset.mdGroup === "athlete" ? "athlete" : "session";
    render();
  });

  /* Video viewing + AI analysis. Playback and REAL analysis need durable video
     files (the RED media/coach-media store) and the Gemini video path (RED
     provider). Until those land: Play explains the store is being wired; Analyze
     shows a clearly-labelled demo breakdown so the flow is testable. */
  q("[data-md-play]").forEach(b => b.onclick = () =>
    toast("Playback opens once your videos are stored — that store is being wired (Gemini video analysis rides on it)."));
  q("[data-md-analyze]").forEach(b => b.onclick = () => {
    if (!itemById(b.dataset.mdAnalyze)) return;
    analyzedVid = b.dataset.mdAnalyze; render();
    toast("Analyzed (demo) — the real per-frame breakdown runs on Gemini once connected.");
  });
  q("[data-md-trim]").forEach(b => b.onclick = () => {
    if (!itemById(b.dataset.mdTrim)) return;
    toast("Trim controls open once the durable video store is connected.");
  });

  q("[data-md-display-name]").forEach(input => input.onchange = () => {
    const value = input.value.trim();
    if (!value){ input.value = SEED.providerProfile.businessName || ""; return; }
    SEED.providerProfile.businessName = value;
    if (window.SporveCoach && window.SporveCoach.save){
      try { window.SporveCoach.save({ business_name: value }); } catch (e) {}
    }
    toast("Display name updated");
  });
  q("[data-md-headline]").forEach(input => input.onchange = () => {
    headlineText = input.value.trim() || profileHeadlineValue();
    input.value = headlineText;
    toast("Headline updated");
  });
  const bioBox = document.getElementById("mdBio");
  if (bioBox) bioBox.oninput = () => {
    bioText = bioBox.value;
    bioLive = false;
    const count = document.getElementById("mdBioCount");
    if (count) count.textContent = bioBox.value.length + " / 400";
    const live = document.querySelector(".mfmt-live");
    if (live) live.classList.remove("on");
  };

  /* Org-bio drafter. "Write it for me" types the fact-drafted bio into the box
     (no render mid-animation, so keystrokes aren't lost); Approve reads the box
     (the coach's edits win), SAVES it, and shows the live line. Demo save is the
     module var; a real coach also PATCHes providers.bio via SporveCoach.save. */
  q("[data-md-biodraft]").forEach(b => b.onclick = () => {
    const box = document.getElementById("mdBio");
    if (!box) return;
    const full = bioDraft();
    bioLive = false;
    const live = document.querySelector(".md-biolive,.mfmt-live"); if (live) live.classList.remove("on");
    const write = value => {
      if ("value" in box) box.value = value; else box.textContent = value;
      const count = document.getElementById("mdBioCount");
      if (count) count.textContent = value.length + " / 400";
    };
    write(""); let i = 0;
    const t = setInterval(() => {
      write(full.slice(0, i += 6));
      if (i >= full.length) { clearInterval(t); write(full); bioText = full; }
    }, 16);
  });
  q("[data-md-bioapprove]").forEach(b => b.onclick = () => {
    const box = document.getElementById("mdBio");
    const text = box ? String("value" in box ? box.value : box.textContent).trim() : "";
    if (!text) { toast("Write or draft a bio first."); return; }
    bioText = text; bioLive = true;
    if (window.SporveCoach && window.SporveCoach.save) { try { window.SporveCoach.save({ bio: text }); } catch (e) {} }
    render();
    toast("Bio approved and saved to your public surfaces.");
  });

  /* Every outbound path re-checks the gate. The disabled attribute is
     a courtesy to the coach; this is the actual rule. */
  q("[data-md-share]").forEach(b => b.onclick = () => {
    const it = itemById(b.dataset.mdShare);
    if (!it) return;
    const v = evaluate(it);
    if (!v.canShare){ toast(v.shareReason); return; }
    S.modal = { type: "sharemedia", itemId: it.id };
    render();
  });
  q("[data-md-publish]").forEach(b => b.onclick = () => {
    const it = itemById(b.dataset.mdPublish);
    if (!it) return;
    const v = evaluate(it);
    if (!v.canPublish){ toast(v.publishReason); return; }
    it.published = true;
    render();
    toast("Published to your profile");
  });
  q("[data-md-unpublish]").forEach(b => b.onclick = () => {
    const it = itemById(b.dataset.mdUnpublish);
    if (!it) return;
    it.published = false;                       // taking something down is never gated
    render();
    toast("Removed from your public profile");
  });
  q("[data-md-del]").forEach(b => b.onclick = () => {
    const it = itemById(b.dataset.mdDel);
    if (!it) return;
    state.mediaItems = state.mediaItems.filter(x => x.id !== it.id);
    render();
    toast("Deleted from your library");
  });

  /* ── consent roster: ask, never grant ─────────────────────────── */
  q("[data-md-request]").forEach(b => b.onclick = () => {
    const a = athleteById(b.dataset.mdRequest);
    if (!a) return;
    consentRequests[a.id] = iso(NOW());
    render();
    toast("Consent request sent to " + a.parent + " — only they can grant it");
  });

  /* ── upload form ──────────────────────────────────────────────── */
  const uf = document.getElementById("mdUploadForm");
  if (uf){
    const cap = document.getElementById("mdCap");
    const cnt = document.getElementById("mdCnt");
    const durWrap = document.getElementById("mdDurWrap");
    const typeEl = document.getElementById("mdType");
    const profWrap = document.getElementById("mdProfileWrap");
    const sessWrap = document.getElementById("mdSessionWrap");
    const slotEl = document.getElementById("mdSlot");

    const syncKind = () => {
      const d = readDraft(uf);
      if (profWrap) profWrap.classList.toggle("hide", d.kind !== "profile");
      if (sessWrap) sessWrap.classList.toggle("hide", d.kind !== "session");
      paintGate();
    };
    uf.querySelectorAll('input[name="kind"]').forEach(r => r.onchange = syncKind);
    uf.querySelectorAll("[data-md-tag]").forEach(c => c.onchange = paintGate);
    if (typeEl) typeEl.onchange = () => {
      if (durWrap) durWrap.classList.toggle("hide", typeEl.value !== "video");
      paintGate();
    };
    if (slotEl) slotEl.onchange = () => {
      const sl = slotRow(slotEl.value);
      if (typeEl){ typeEl.value = sl.format; }
      if (durWrap) durWrap.classList.toggle("hide", sl.format !== "video");
      paintGate();
    };
    if (cap) cap.oninput = () => paintCount(cap, cnt);
    paintCount(cap, cnt);
    paintGate();

    uf.onsubmit = ev => {
      ev.preventDefault();
      const err = document.getElementById("mdUpErr");
      const show = msg => { if (err){ err.textContent = msg; err.classList.remove("hide"); } return false; };
      const d = Object.fromEntries(new FormData(uf));
      const draft = readDraft(uf);
      const caption = String(d.caption || "").trim();

      if (!caption) return show("Write a caption — the family reads it before they look at the photo.");
      if (caption.length > RULE.captionMax)
        return show("Captions are limited to " + RULE.captionMax + " characters — yours is " + caption.length + ".");
      if (draft.kind === "session"){
        if (!d.sessionId) return show("Pick the session this came from.");
        if (!draft.athleteIds.length)
          return show("Tag at least one athlete — session media is always attached to the athletes in it.");
      }
      let dur = null;
      if (draft.mediaType === "video"){
        dur = Number(d.durationSec);
        if (!isFinite(dur) || dur < 1) return show("Enter how many seconds the video runs.");
        dur = Math.round(dur);
        if (draft.kind === "profile" && d.slot === "intro_video" && (dur < RULE.introMin || dur > RULE.introMax))
          return show("An intro video has to run " + RULE.introMin + "–" + RULE.introMax + " seconds — this one is " + dur + "s.");
      }
      if (err) err.classList.add("hide");

      const sess = draft.kind === "session" ? sessionById(String(d.sessionId)) : null;
      const item = {
        id: "md_" + Date.now(),
        kind: draft.kind,
        slot: draft.kind === "profile" ? String(d.slot || "action") : null,
        mediaType: draft.mediaType,
        durationSec: dur,
        sessionId: sess ? sess.id : null,
        programId: sess ? sess.programId : null,
        athleteIds: draft.athleteIds.slice(),
        caption: caption,
        createdAt: iso(NOW()),
        published: false,
        shareable: false,
        sharedWith: [],
      };
      /* The gate decides, not the checkbox: a tampered or stale DOM
         cannot mark a blocked item shareable. */
      const v = evaluate(item);
      item.shareable = v.canShare && !!d.shareable;

      state.mediaItems = state.mediaItems.concat([item]);
      S.modal = null;
      S.coachTab = "media";
      render();
      toast(v.blockKind === "consent"
        ? "Added — held by consent, visible only to you for now"
        : item.shareable ? "Added and ready to send" : "Added to your library");
    };
  }

  /* ── share form ───────────────────────────────────────────────── */
  const sf = document.getElementById("mdShareForm");
  if (sf){
    const note = document.getElementById("mdShareNote");
    const cnt2 = document.getElementById("mdShareCnt");
    if (note) note.oninput = () => paintCount(note, cnt2);
    paintCount(note, cnt2);

    sf.onsubmit = ev => {
      ev.preventDefault();
      const err = document.getElementById("mdShareErr");
      const show = msg => { if (err){ err.textContent = msg; err.classList.remove("hide"); } return false; };
      const it = itemById(S.modal && S.modal.itemId);
      if (!it){ S.modal = null; render(); return; }
      const d = Object.fromEntries(new FormData(sf));
      const noteTxt = String(d.note || "").trim();
      if (noteTxt.length > RULE.captionMax)
        return show("Notes are limited to " + RULE.captionMax + " characters — yours is " + noteTxt.length + ".");

      /* Re-check at the moment of sending — consent can have changed
         between opening this dialog and pressing the button. */
      const v = evaluate(it);
      if (!v.canShare){
        S.modal = null;
        render();
        toast(v.shareReason);
        return;
      }
      const at = iso(NOW());
      it.athleteIds.forEach(id => it.sharedWith.push({ athleteId: id, at: at }));
      it.shareable = true;
      it.note = noteTxt || null;
      S.modal = null;
      render();
      toast("Sent to " + countOf(it.athleteIds.length, "family thread"));
    };
  }
}

/* ═══════════════════ EXPORT ═══════════════════ */
/* AI video-analysis panel (rendered from state so a re-render keeps it). Demo
   breakdown today; the real per-frame technique read runs on Gemini video once
   the provider is connected (RED). */
function vidAnalysisHTML(id){
  const it=itemById(id); if(!it) return "";
  const first=((it.athleteIds&&it.athleteIds[0]&&(ROSTER.find(a=>a.id===it.athleteIds[0])||{}).name)||"The athlete").split(" ")[0];
  return `<div class="md-vidanalysis">
    <div class="eyebrow">AI analysis · ${esc(it.caption)}</div>
    <p style="font-size:var(--text-sm);line-height:1.6;color:var(--ink)">${esc(first)}'s technique reads well overall — balance and first touch look controlled. The plant foot lands slightly late on the weak-side pass, which shortens the follow-through. Suggested drill: 10 minutes of two-touch weak-foot passing against a wall, planting early and pointing the toe at the target.</p>
    <p style="font-size:var(--text-xs);color:var(--faint);margin-top:8px">Demo analysis. The real per-frame technique breakdown runs on Gemini video once the provider is connected.</p>
  </div>`;
}

window.MOD_MEDIA = {
  css: CSS,
  tabs: { media: "Media" },
  views: { media: mediaView },
  modals: { upload: uploadModal, consent: consentModal, sharemedia: shareMediaModal },
  wire: wire,
  state: state,
  strength: strength,
};

/* exposed for the stub-DOM harness; harmless in the browser */
window.MOD_MEDIA._test = { evaluate: evaluate, consentOf: consentOf, itemById: itemById,
  ROSTER: ROSTER, SESSIONS: SESSIONS, RULE: RULE, TODAY: TODAY };

})();
