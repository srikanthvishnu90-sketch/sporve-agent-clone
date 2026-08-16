"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_MEDIA — the coach's media library, and the consent that governs it.

   Mounts one tab inside the existing coach dash (left rail + body):
   "Media". Two halves:
     · Profile media  — headshot, intro video, facility, action shots.
     · Session media  — clips and photos attached to a real session,
                        grouped by session or by athlete.

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
      caption: "Head coach, Apex Performance Club", createdAt: "2026-06-02T14:00:00.000Z",
      published: true }),
    mk({ id: "md_2", kind: "profile", slot: "intro_video", mediaType: "video", durationSec: 72,
      sessionId: null, programId: null, athleteIds: [],
      caption: "Who we coach and how a session runs", createdAt: "2026-06-02T14:20:00.000Z",
      published: true }),
    mk({ id: "md_3", kind: "profile", slot: "facility", mediaType: "photo", durationSec: null,
      sessionId: null, programId: (myListings()[0] || DEMO_CATALOGUE[0]).id, athleteIds: [],
      caption: "Main pitch, Lincoln Park — shaded parent seating along the east side",
      createdAt: "2026-06-09T16:10:00.000Z", published: true }),
    mk({ id: "md_4", kind: "profile", slot: "action", mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1"],
      caption: "First touch under pressure", createdAt: "2026-07-14T18:05:00.000Z",
      published: true, shareable: true }),
    /* mixed tagging: one athlete has profile consent, one does not */
    mk({ id: "md_5", kind: "profile", slot: "action", mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1", "athlete_2"],
      caption: "Small-sided game, final ten minutes", createdAt: "2026-07-14T18:22:00.000Z" }),

    /* ── session ──────────────────────────────────────────────── */
    mk({ id: "md_6", kind: "session", slot: null, mediaType: "video", durationSec: 24,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1"],
      caption: "Wall-pass drill — six clean reps in a row", createdAt: "2026-07-14T18:40:00.000Z",
      shareable: true, sharedWith: [{ athleteId: "athlete_1", at: "2026-07-14T19:02:00.000Z" }] }),
    mk({ id: "md_7", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_2"],
      caption: "Receiving on the half-turn", createdAt: "2026-07-14T18:44:00.000Z",
      shareable: true }),
    mk({ id: "md_8", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s1.id, programId: s1.programId, athleteIds: ["athlete_3"],
      caption: "Shooting form from the elbow", createdAt: "2026-07-21T17:30:00.000Z" }),
    mk({ id: "md_9", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s0.id, programId: s0.programId, athleteIds: ["athlete_1", "athlete_2"],
      caption: "Partner rondo before the scrimmage", createdAt: "2026-07-14T18:51:00.000Z",
      shareable: true }),
    mk({ id: "md_10", kind: "session", slot: null, mediaType: "video", durationSec: 31,
      sessionId: s2.id, programId: s2.programId, athleteIds: ["athlete_5"],
      caption: "Serve toss, slow motion", createdAt: "2026-07-28T16:15:00.000Z",
      shareable: true }),
    mk({ id: "md_11", kind: "session", slot: null, mediaType: "photo", durationSec: null,
      sessionId: s3.id, programId: s3.programId, athleteIds: ["athlete_4"],
      caption: "Overhand serve, first clean landing", createdAt: "2026-07-30T17:05:00.000Z",
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
function mediaView(){
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

  /* ── library actions ──────────────────────────────────────────── */
  q("[data-md-upload]").forEach(b => b.onclick = () => {
    S.modal = { type: "upload", mdSlot: b.dataset.mdUpload };
    render();
  });
  q("[data-md-group]").forEach(b => b.onclick = () => {
    grouping = b.dataset.mdGroup === "athlete" ? "athlete" : "session";
    render();
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
