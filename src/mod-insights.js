"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_INSIGHTS — demand, funnel, and client retention for the coach.

   One tab (Insights) plus three card renderers the coach dashboard can
   embed: demandCard(), watchlistCard(), availabilityWarnings().

   Host contract used (never redefined here):
     S, render(), toast(), esc(), money(), fmtDate(), slotsFor(),
     modelLabel(), PROGRAMS, SEED, sportColor(), sportGlyph(), ICON.

   HONESTY RULE THAT SHAPES THIS WHOLE FILE
   This is a pre-launch account. Nothing in the app measures search
   impressions or profile views, so those numbers cannot be real. They
   are seeded once, in state, and every surface that shows them carries
   a "Sample data" badge. Everything else — price positioning against
   the catalogue, open availability, rebooking cadence off real booking
   dates — is computed from state at render time and badged "Derived".
   The two are never mixed inside one sentence.

   The demo clock is pinned to the app's seeded "today" (2026-08-03) so
   gaps and week windows stay coherent with the seeded bookings instead
   of drifting against the real wall clock.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* ── clock ───────────────────────────────────────────────────────── */
const TODAY = "2026-08-03";
const NOW = () => new Date(2026, 7, 3, 9, 30);          // Mon 3 Aug 2026, 9:30am
const iso = d => d.toISOString();

/* ── date helpers — plain "YYYY-MM-DD" arithmetic, no timezone drift ─ */
const dnum = s => {
  const parts = String(s).slice(0, 10).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
};
const isDate = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || ""));
const daysBetween = (a, b) => Math.round((dnum(b) - dnum(a)) / 86400000);
const daysSince = s => daysBetween(s, TODAY);
function addDays(s, n){
  const d = dnum(s);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayOf = s => dnum(s).getDay();

/* ── number helpers ──────────────────────────────────────────────── */
const n0 = n => Number(n).toLocaleString("en-US");
const pct1 = (a, b) => (b > 0 ? (a / b * 100) : 0).toFixed(1) + "%";
function median(list){
  const a = list.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const money2 = n => (Number(n) % 1 === 0 ? money(n) : "$" + Number(n).toFixed(2));

/* ── catalogue helpers ───────────────────────────────────────────── */
/* Live catalogue first, seeded second — see the note in mod-coachops.js. */
const prog = id => PROGRAMS.find(p => p.id === id) ||
                   DEMO_CATALOGUE.find(p => p.id === id) || null;
const myListings = () => DEMO_CATALOGUE.filter(p => S.listings.indexOf(p.id) >= 0);
const mySports = () => {
  const out = [];
  myListings().forEach(p => { if (out.indexOf(p.sport) < 0) out.push(p.sport); });
  return out;
};
const firstName = s => String(s || "").trim().split(/\s+/)[0] || String(s || "");
function coachName(){
  const u = S.auth && S.auth.user;
  if (u && u.role === "provider" && u.firstName) return (u.firstName + " " + (u.lastName || "")).trim();
  return (typeof coachBusinessName==="function")?coachBusinessName():SEED.providerProfile.businessName;
}

/* ── phrasing ────────────────────────────────────────────────────── */
function gapPhrase(days){
  if (days < 1) return "less than a day";
  if (days === 1) return "1 day";
  if (days < 14) return days + " days";
  const w = Math.round(days / 7);
  return w + (w === 1 ? " week" : " weeks");
}
function cadenceShort(d){
  if (d == null) return null;
  if (d >= 6 && d <= 8) return "weekly";
  if (d >= 13 && d <= 15) return "every two weeks";
  if (d >= 27 && d <= 31) return "monthly";
  return "every " + d + " days";
}
function cadenceLong(d){
  if (d == null) return null;
  if (d >= 6 && d <= 8) return "about once a week";
  if (d >= 13 && d <= 15) return "about every two weeks";
  if (d >= 27 && d <= 31) return "about once a month";
  return "about every " + d + " days";
}

/* ═══════════════════ STATE ═══════════════════
   demand + funnel are seeded sample figures for a pre-launch account.
   watchlist holds only the seeded demo families; families with real
   bookings are derived from S.bookings at render time and merged in. */
const state = {
  demand: {
    /* Sample. Nothing in this app measures searches. */
    radiusMiles: 10,
    windowLabel: "the last 7 days",
    searches: { Basketball: 14, Soccer: 22, Tennis: 9, Volleyball: 6, Swimming: 11 },
    unmet: { weekday: 6, timeLabel: "9:00 – 11:00 AM", requests: 8 },
  },
  funnel: {
    /* Sample. A 30-day window for a comparable Chicago coach, used to show
       the shape of the funnel — not a measurement of this account. */
    windowLabel: "a 30-day window",
    stages: [
      { key: "appearances", label: "Search appearances", n: 1240,
        note: "times a listing of yours appeared in a family's search results" },
      { key: "views",       label: "Profile views",      n: 186,
        note: "families who opened a listing after seeing it" },
      { key: "requests",    label: "Booking requests",   n: 24,
        note: "families who started checkout on a session" },
      { key: "completed",   label: "Completed bookings", n: 17,
        note: "requests that were paid and confirmed" },
    ],
  },
  watchlist: [
    { id: "in_wl_1", family: "Renata Okafor", athlete: "Nia Okafor",
      programId: "prog_3", lastSessionDate: "2026-07-13", typicalGapDays: 7, sessions: 9 },
    { id: "in_wl_2", family: "Daniel Whitfield", athlete: "Cole Whitfield",
      programId: "prog_2", lastSessionDate: "2026-06-29", typicalGapDays: 14, sessions: 6 },
    { id: "in_wl_3", family: "Priya Raman", athlete: "Aarav Raman",
      programId: "prog_5", lastSessionDate: "2026-07-06", typicalGapDays: 14, sessions: 11 },
    { id: "in_wl_4", family: "Marisol Ibarra", athlete: "Sofia Ibarra",
      programId: "prog_4", lastSessionDate: "2026-07-27", typicalGapDays: 7, sessions: 5 },
  ],
};
/* rows the coach has already reached out to, this session */
const checkedIn = {};

/* ═══════════════════ DERIVED — PRICE POSITIONING ═══════════════════
   Genuinely computable: every listing in PROGRAMS carries a price and a
   billing model. Comparing a monthly price against a per-session price
   would be a lie, so the peer set is same sport AND same billing model. */
function pricePosition(listing){
  const peers = PROGRAMS.filter(p => p.sport === listing.sport && p.model === listing.model);
  const others = peers.filter(p => p.id !== listing.id);
  const prices = peers.map(p => p.price);
  const min = Math.min.apply(null, prices);
  const max = Math.max.apply(null, prices);
  const med = median(prices);
  const dearer = others.filter(p => p.price > listing.price).length;
  const cheaper = others.filter(p => p.price < listing.price).length;

  let read;
  if (!others.length){
    read = "The only " + listing.sport.toLowerCase() + " listing priced " + modelLabel(listing.model) +
      " in the catalogue — there is no local range to sit inside yet.";
  } else if (listing.price <= min){
    read = "The lowest of " + peers.length + " comparable listings. " +
      dearer + " of " + others.length + " cost more.";
  } else if (listing.price >= max){
    read = "The highest of " + peers.length + " comparable listings. " +
      cheaper + " of " + others.length + " cost less.";
  } else if (listing.price === med){
    read = "Exactly at the median of " + peers.length + " comparable listings.";
  } else if (listing.price < med){
    read = "Below the median of " + peers.length + " comparable listings. " +
      dearer + " of " + others.length + " cost more.";
  } else {
    read = "Above the median of " + peers.length + " comparable listings. " +
      cheaper + " of " + others.length + " cost less.";
  }

  return {
    listing: listing, peers: peers.length, others: others.length,
    min: min, max: max, median: med, cheaper: cheaper, dearer: dearer,
    comparable: others.length > 0, read: read,
    /* marker position along the min→max track, in percent */
    at: max > min ? Math.max(0, Math.min(100, (listing.price - min) / (max - min) * 100)) : 50,
    medAt: max > min ? Math.max(0, Math.min(100, (med - min) / (max - min) * 100)) : 50,
  };
}
const myPricePositions = () => myListings().map(pricePosition);

/* ═══════════════════ DERIVED — AVAILABILITY ═══════════════════
   A slot is bookable only if it falls inside the window AND its program
   still has room. Both facts come from state. */
function openSlots(days){
  const from = TODAY, to = addDays(TODAY, days);
  const out = [];
  myListings().forEach(p => {
    if (p.enrolled >= p.cap) return;
    (slotsFor(p.id) || []).forEach(s => {
      if (isDate(s.date) && s.date >= from && s.date <= to) out.push({ p: p, s: s });
    });
  });
  return out.sort((a, b) => a.s.date.localeCompare(b.s.date));
}
function futureSlots(){
  const out = [];
  myListings().forEach(p => {
    (slotsFor(p.id) || []).forEach(s => {
      if (isDate(s.date) && s.date >= TODAY) out.push({ p: p, s: s });
    });
  });
  return out.sort((a, b) => a.s.date.localeCompare(b.s.date));
}
function lastSlotOverall(){
  let last = null;
  myListings().forEach(p => {
    (slotsFor(p.id) || []).forEach(s => {
      if (isDate(s.date) && (!last || s.date > last.s.date)) last = { p: p, s: s };
    });
  });
  return last;
}
/* how many of the coach's slots ever land on a given weekday (0=Sun) */
function slotsOnWeekday(wd){
  let n = 0;
  myListings().forEach(p => {
    (slotsFor(p.id) || []).forEach(s => { if (isDate(s.date) && weekdayOf(s.date) === wd) n++; });
  });
  return n;
}

function availabilityWarnings(){
  const out = [];
  const mine = myListings();
  const open = openSlots(7);
  const windowText = fmtDate(TODAY) + " and " + fmtDate(addDays(TODAY, 7));

  if (!mine.length){
    out.push({ level: "warn",
      text: "You have no published listings, so nothing of yours can appear in a family's search.",
      action: "Create a listing" });
    return out;
  }

  if (!open.length){
    const next = futureSlots()[0];
    const last = lastSlotOverall();
    let tail;
    if (next) tail = " Your next bookable session is " + fmtDate(next.s.date) + ", " +
      daysBetween(TODAY, next.s.date) + " days out.";
    else if (last) tail = " There is no future session on your calendar at all — the last one was " +
      fmtDate(last.s.date) + ".";
    else tail = " There is no session on your calendar at all.";
    out.push({ level: "warn",
      text: "No bookable session across your " + mine.length + " listing" + (mine.length === 1 ? "" : "s") +
        " between " + windowText + ". Parents searching for you see nothing bookable." + tail,
      action: "Open this week and add slots" });
  } else {
    const progs = [];
    open.forEach(o => { if (progs.indexOf(o.p.id) < 0) progs.push(o.p.id); });
    out.push({ level: "good",
      text: open.length + " bookable session" + (open.length === 1 ? "" : "s") + " across " +
        progs.length + " listing" + (progs.length === 1 ? "" : "s") + " between " + windowText +
        ". The earliest is " + fmtDate(open[0].s.date) + " at " + open[0].s.startTime + ".",
      action: "Review the week" });
  }

  /* Capacity — only raised when a listing is genuinely full. */
  const full = mine.filter(p => p.enrolled >= p.cap);
  if (full.length){
    out.push({ level: "warn",
      text: full.map(p => p.title).join(", ") + (full.length === 1 ? " is" : " are") +
        " at capacity, so every slot on " + (full.length === 1 ? "it" : "them") + " reads as unbookable.",
      action: "Raise the cap or open a waitlist" });
  }

  /* Retention — derived rows only. Sample families never raise an alert. */
  const lapsed = watchlistRows().filter(r => r.source === "booked" && r.broken);
  if (lapsed.length){
    out.push({ level: "warn",
      text: lapsed.length + " famil" + (lapsed.length === 1 ? "y has" : "ies have") +
        " not rebooked since " + fmtDate(lapsed[0].lastSessionDate) + " (" +
        gapPhrase(lapsed[0].gap) + " for " + firstName(lapsed[0].athlete) + ").",
      action: "Send a check-in" });
  }

  return out;
}

/* ═══════════════════ DERIVED — CLIENT WATCHLIST ═══════════════════ */

/* Parent name for an athlete who appears in real bookings. The athlete
   record carries an emergency contact — that is the family. */
function familyFor(athleteName){
  const a = (S.athletes || []).find(x =>
    ((x.firstName || "") + " " + (x.lastName || "")).trim() === String(athleteName).trim());
  if (a && a.emergency && a.emergency.name) return a.emergency.name;
  const u = S.auth && S.auth.user;
  if (u && u.role !== "provider" && u.firstName) return (u.firstName + " " + (u.lastName || "")).trim();
  const parts = String(athleteName).trim().split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0]) + " family";
}

/* One row per athlete who has real bookings, cadence measured from the
   actual session dates. A single session yields no cadence — the row
   says so rather than inventing one. */
function bookedRows(){
  const byAthlete = {};
  (S.bookings || []).forEach(b => {
    if (!b || !isDate(b.date)) return;
    (byAthlete[b.athlete] = byAthlete[b.athlete] || []).push(b);
  });
  return Object.keys(byAthlete).map(name => {
    const list = byAthlete[name].slice().sort((a, b) => a.date.localeCompare(b.date));
    const dates = [];
    list.forEach(b => { if (dates.indexOf(b.date) < 0) dates.push(b.date); });
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const typical = gaps.length ? Math.round(median(gaps)) : null;
    return {
      id: "in_bk_" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      source: "booked",
      family: familyFor(name),
      athlete: name,
      programId: list[list.length - 1].programId,
      lastSessionDate: dates[dates.length - 1],
      typicalGapDays: typical,
      sessions: dates.length,
    };
  });
}

/* Cadence is "broken" at 1.5x the family's own usual gap. Where there is
   no usual gap to compare against, a single session older than 30 days
   is flagged as never-rebooked — a different claim, worded differently. */
function assess(row){
  const gap = daysSince(row.lastSessionDate);
  const typ = row.typicalGapDays;
  const ratio = typ ? gap / typ : null;
  let broken, statusLabel, statusTone, why;
  if (typ){
    broken = gap >= typ * 1.5;
    statusLabel = broken ? "Cadence broken" : "On cadence";
    statusTone = broken ? "warn" : "good";
    why = gapPhrase(gap) + " since last session, usually books " + cadenceShort(typ);
  } else if (gap >= 30){
    broken = true;
    statusLabel = "Never rebooked";
    statusTone = "warn";
    why = gapPhrase(gap) + " since the only session on record";
  } else {
    broken = false;
    statusLabel = "One session so far";
    statusTone = "slate";
    why = gapPhrase(gap) + " since the only session on record — too early to read a cadence";
  }
  return Object.assign({}, row, {
    gap: gap, ratio: ratio, broken: broken,
    statusLabel: statusLabel, statusTone: statusTone, why: why,
    score: ratio == null ? gap / 30 : ratio,
  });
}
function watchlistRows(){
  const sample = state.watchlist.map(r => Object.assign({ source: "sample" }, r));
  return sample.concat(bookedRows()).map(assess).sort((a, b) => b.score - a.score);
}
const rowById = id => watchlistRows().find(r => r.id === id) || null;

/* ═══════════════════ CHECK-IN DRAFT ═══════════════════
   Written from the row's own numbers. It never promises availability the
   calendar cannot back: a specific slot is named only when one exists. */
function draftCheckin(row){
  const p = prog(row.programId);
  const a = firstName(row.athlete), f = firstName(row.family);
  const open = openSlots(7);
  const lines = [];

  lines.push("Hi " + f + " — it's been " + gapPhrase(row.gap) + " since " + a + "'s last session" +
    (p ? " of " + p.title : "") + " on " + fmtDate(row.lastSessionDate) + ".");

  if (row.typicalGapDays){
    lines.push("You were booking " + cadenceLong(row.typicalGapDays) +
      " before that, so I wanted to check in rather than assume anything.");
  } else {
    lines.push("That is still the only session on the books, so I wanted to check in rather than assume anything.");
  }

  if (open.length){
    lines.push("If " + a + " wants back on the schedule, I have " + fmtDate(open[0].s.date) +
      " at " + open[0].s.startTime + " open and can hold it — just reply here.");
  } else {
    lines.push("If " + a + " wants back on the schedule, tell me which days work and I'll put a session on the calendar.");
  }

  lines.push("— " + coachName());
  return lines.join("\n\n");
}

/* Sending appends to the family's thread. Match an existing thread by
   name first, then by program, and only open a new one if neither hits. */
function threadFor(row){
  S.conversations = S.conversations || [];
  S.messages = S.messages || {};
  let c = S.conversations.find(x => x.with === row.family);
  if (!c) c = S.conversations.find(x => x.programId === row.programId);
  if (!c){
    c = { id: "conv_" + Date.now(), with: row.family, programId: row.programId,
      last: "", at: iso(NOW()) };
    S.conversations = [c].concat(S.conversations);
    S.messages[c.id] = [];
  }
  if (!S.messages[c.id]) S.messages[c.id] = [];
  return c;
}
function sendCheckin(row, text){
  const c = threadFor(row);
  const at = iso(NOW());
  /* me:false is the coach's side of the thread — the same convention the
     host inbox uses when it flips the bubble for the coach portal. */
  S.messages[c.id] = S.messages[c.id].concat([
    { id: "msg_in_" + Date.now(), me: false, text: text, at: at },
  ]);
  c.last = text.split("\n")[0];
  c.at = at;
  checkedIn[row.id] = at;
  return c;
}

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
/* ── band architecture ───────────────────────────────────────────────
   The page is a vertical stack of full-width <section class="band"> blocks,
   same as the marketing surfaces. This tab renders inside the coach chrome
   (main.shell.dash > div), so each band spans the dashboard column rather
   than the viewport — the ground still changes under the whole block, which
   is the point. Band padding is retuned: 74px is a landing-page rhythm and
   inside a column it reads as a hole. */
.in-band{padding:34px 0}
.in-band:first-child{padding-top:24px}
.in-sec{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
  flex-wrap:wrap;margin:0 0 18px}
.in-sec h2{max-width:22ch}
/* Section subs are the host's .sub, not a private class: .sub already carries
   muted / --text-base / 60ch AND the host's dark-ground repaint, so the black
   bands need no colour of their own here. */
.in-sec .sub{margin-top:7px;max-width:62ch}
.in-sec>.pill{flex:0 0 auto;margin-top:7px}
.in-lede{color:var(--ink-2);font-size:var(--text-md);max-width:52ch;margin-top:14px;line-height:1.5}
.in-prov{font-size:var(--text-base);color:var(--muted);line-height:1.55;max-width:64ch;margin-top:14px}
.in-tagtxt{font-size:var(--text-sm);color:var(--muted)}
.in-tags{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
/* Dark ground. Headings and section prose are the host's own dark-layer
   values (white / #AEB8C4 via .band.dark h2 and .band.dark .sub). What needs
   saying here is the opposite: nothing may leak INTO the white cards sitting
   on the black. Those are cards, not text on black, so they keep ink on
   paper — but .band.dark p and .band.dark .eyebrow are (0,2,0) and would
   otherwise repaint every card paragraph to slate-on-white. */
.band.dark .in-card p,.band.dark .in-card .in-big{color:var(--ink-2)}
.band.dark .in-card h2,.band.dark .in-card h3,.band.dark .in-card h4{color:var(--ink)}
.band.dark .in-card .in-sub{color:var(--muted)}
.band.dark .in-card .in-note,.band.dark .in-card .in-fnote,
.band.dark .in-card .eyebrow{color:var(--faint)}
/* Same trap for controls: the host paints ghost buttons white-on-transparent
   inside a dark band, which is invisible on a white card. */
.band.dark .in-card .btn.ghost{background:var(--paper);color:var(--ink);border-color:var(--rule-strong)}
.band.dark .in-card .btn.ghost:hover{background:var(--raise);border-color:var(--ink)}
.in-note{font-size:var(--text-sm);color:var(--faint);margin-top:10px;line-height:1.5;max-width:78ch}
.in-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start;margin-top:16px}
.in-card{border:1px solid var(--rule);border-radius:var(--r-l);padding:20px;background:var(--paper)}
/* wrap + don't shrink the pill: without these the "Sample data" badge was
   squeezed past the card's padding at narrow widths (.in-sec already wraps) */
.in-cardhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.in-cardhead>.pill{flex:0 0 auto}
.in-big{font-size:var(--text-base);color:var(--ink);line-height:1.5;letter-spacing:-.012em}
.in-big b{font-weight:700}
.in-sub{font-size:var(--text-sm);color:var(--muted);margin-top:4px;line-height:1.5}

.in-funnel{margin-top:6px}
.in-frow{display:grid;grid-template-columns:minmax(132px,1.1fr) minmax(0,3fr) minmax(96px,auto);
  gap:14px;align-items:center;padding:13px 0;border-top:1px solid var(--rule)}
.in-frow:first-child{border-top:0}
.in-fname{font-size:var(--text-base);font-weight:700;color:var(--ink);letter-spacing:-.01em}
.in-fnote{font-size:var(--text-sm);color:var(--faint);margin-top:2px;line-height:1.45}
.in-ftrack{position:relative;height:24px;border-radius:var(--r-s);background:var(--raise2)}
.in-ffill{height:100%;min-width:3px;border-radius:var(--r-s);background:var(--slate)}
.in-fnum{text-align:right;font-size:var(--text-base);font-weight:700;color:var(--ink);letter-spacing:-.02em}
.in-fconv{font-size:var(--text-sm);color:var(--muted);margin-top:2px;text-align:right}
.in-step{display:grid;grid-template-columns:minmax(132px,1.1fr) minmax(0,3fr) minmax(96px,auto);
  gap:14px;align-items:center;padding:0 0 2px}
.in-steptxt{grid-column:2/4;font-size:var(--text-sm);color:var(--faint);display:flex;align-items:center;gap:8px}
.in-steptxt i{display:block;width:1px;height:12px;background:var(--rule-strong);margin-left:6px}

.in-plist{display:flex;flex-direction:column;gap:14px;margin-top:4px}
.in-prow{border-top:1px solid var(--rule);padding-top:14px}
.in-prow:first-child{border-top:0;padding-top:0}
.in-phead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.in-ptrack{position:relative;height:8px;border-radius:999px;background:var(--raise2);margin:16px 0 8px}
.in-pmed{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--rule-strong)}
.in-pyou{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:999px;
  background:var(--slate);border:2.5px solid var(--paper)}
.in-pends{display:flex;justify-content:space-between;font-size:var(--text-sm);color:var(--faint)}
.in-pread{font-size:var(--text-sm);color:var(--ink-2);margin-top:7px;line-height:1.5}

.in-warns{display:flex;flex-direction:column;gap:10px;margin-top:6px}
.in-warn{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--rule);
  border-radius:var(--r-m);padding:13px 15px}
.in-warn.in-lv-warn{border-color:var(--warn);background:var(--warn-tint)}
.in-warn.in-lv-good{border-color:var(--good);background:var(--good-tint)}
.in-warn p{font-size:var(--text-sm);color:var(--ink-2);line-height:1.5}
.in-warn .in-act{font-size:var(--text-sm);font-weight:700;color:var(--ink);margin-top:5px}
.in-dot{width:9px;height:9px;border-radius:999px;flex:0 0 auto;margin-top:6px}
.in-dot.in-lv-warn{background:var(--warn)}
.in-dot.in-lv-good{background:var(--good)}

.in-wl{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.in-wlrow{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;
  border-top:1px solid var(--rule);padding-top:12px;flex-wrap:wrap}
.in-wlrow:first-child{border-top:0;padding-top:0}
.in-who{font-size:var(--text-base);font-weight:700;letter-spacing:-.015em}
.in-swatch{display:inline-block;width:8px;height:8px;border-radius:2px;vertical-align:1px;margin-right:7px}
.in-draft{width:100%;font-family:inherit;font-size:var(--text-base);line-height:1.55}
.in-preface{background:var(--raise);border-radius:var(--r-m);padding:13px 15px;font-size:var(--text-sm);
  color:var(--ink-2);line-height:1.5;margin-bottom:16px}
@media(max-width:1020px){.in-two{grid-template-columns:1fr}}
@media(max-width:620px){
  .in-frow,.in-step{grid-template-columns:1fr}
  .in-fnum,.in-fconv{text-align:left}
  .in-steptxt{grid-column:1/2}
}
`;

/* ═══════════════════ SMALL VIEW PARTS ═══════════════════ */
const SAMPLE_PILL  = `<span class="pill gold">Sample data</span>`;
const DERIVED_PILL = `<span class="pill slate">Derived from your data</span>`;

function sportDot(sport){
  return `<span class="in-swatch" style="background:${sportColor(sport)}" aria-hidden="true"></span>`;
}

/* ── funnel ─────────────────────────────────────────────────────── */
function funnelHTML(){
  const st = state.funnel.stages;
  const top = st[0] ? st[0].n : 0;
  const bars = st.map((s, i) => {
    const prev = i > 0 ? st[i - 1] : null;
    const w = top > 0 ? (s.n / top * 100) : 0;
    const label = s.label + ": " + n0(s.n) + " — " + pct1(s.n, top) + " of " + st[0].label.toLowerCase() +
      (prev ? ", " + pct1(s.n, prev.n) + " of " + prev.label.toLowerCase() : "");
    return `${prev ? `<div class="in-step"><div class="in-steptxt"><i></i>
        <span class="num">${esc(pct1(s.n, prev.n))}</span> of ${esc(prev.label.toLowerCase())} continue</div></div>` : ""}
      <div class="in-frow">
        <div><div class="in-fname">${esc(s.label)}</div><div class="in-fnote">${esc(s.note)}</div></div>
        <div class="in-ftrack" role="img" aria-label="${esc(label)}">
          <div class="in-ffill" style="width:${w.toFixed(2)}%"></div>
        </div>
        <div><div class="in-fnum num">${esc(n0(s.n))}</div>
          <div class="in-fconv num">${esc(pct1(s.n, top))} of top</div></div>
      </div>`;
  }).join("");

  const last = st[st.length - 1];
  return `<div class="in-funnel">${bars}</div>
    <p class="in-note">Bars scale against ${esc(st[0].label.toLowerCase())}. End to end,
      <span class="num">${esc(pct1(last.n, top))}</span> became a paid booking.</p>

    <div class="tblwrap" style="margin-top:14px"><table class="tbl">
      <caption style="text-align:left;font-size:var(--text-sm);color:var(--faint);padding-bottom:8px">
        The same figures as numbers.</caption>
      <thead><tr><th>Stage</th><th>Count</th><th>Of previous stage</th><th>Of ${esc(st[0].label.toLowerCase())}</th></tr></thead>
      <tbody>${st.map((s, i) => `<tr>
        <td><b style="font-weight:600">${esc(s.label)}</b>
          <div style="color:var(--muted);font-size:var(--text-sm)">${esc(s.note)}</div></td>
        <td class="num">${esc(n0(s.n))}</td>
        <td class="num">${i === 0 ? "—" : esc(pct1(s.n, st[i - 1].n))}</td>
        <td class="num">${esc(pct1(s.n, top))}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

/* ── price positioning ──────────────────────────────────────────── */
function priceRowHTML(pp){
  const p = pp.listing;
  const bar = pp.comparable
    ? `<div class="in-ptrack" role="img" aria-label="${esc(
        p.title + " is priced " + money(p.price) + " " + modelLabel(p.model) +
        ". Comparable listings run from " + money(pp.min) + " to " + money(pp.max) +
        ", median " + money2(pp.median) + ".")}">
         <div class="in-pmed" style="left:${pp.medAt.toFixed(2)}%"></div>
         <div class="in-pyou" style="left:${pp.at.toFixed(2)}%"></div>
       </div>
       <div class="in-pends num"><span>${esc(money(pp.min))} lowest</span>
         <span>median ${esc(money2(pp.median))}</span>
         <span>${esc(money(pp.max))} highest</span></div>`
    : "";
  return `<div class="in-prow">
    <div class="in-phead">
      <div><b style="font-weight:700">${sportDot(p.sport)}${esc(p.title)}</b>
        <div class="in-sub">${esc(p.sport)} · ${esc(modelLabel(p.model))}</div></div>
      <div class="num" style="font-size:var(--text-base);font-weight:700">${esc(money(p.price))}</div>
    </div>
    ${bar}
    <p class="in-pread">${esc(pp.read)}</p>
  </div>`;
}

/* ── availability ───────────────────────────────────────────────── */
function warningsHTML(){
  const rows = availabilityWarnings();
  if (!rows.length) return "";
  return `<div class="in-warns">${rows.map(w => `
    <div class="in-warn in-lv-${esc(w.level)}">
      <span class="in-dot in-lv-${esc(w.level)}" aria-hidden="true"></span>
      <div><p>${esc(w.text)}</p><div class="in-act">${esc(w.action)}</div></div>
    </div>`).join("")}</div>`;
}

/* ═══════════════════ CARD RENDERERS (dashboard embeds these) ═══════════════════ */

function demandCard(){
  const d = state.demand;
  const sports = mySports();
  const counted = sports
    .map(s => ({ sport: s, n: Object.prototype.hasOwnProperty.call(d.searches, s) ? d.searches[s] : null }))
    .sort((a, b) => (b.n == null ? -1 : b.n) - (a.n == null ? -1 : a.n));
  const top = counted.find(c => c.n != null);
  const positions = myPricePositions().filter(p => p.comparable)
    .sort((a, b) => Math.abs(b.at - 50) - Math.abs(a.at - 50)).slice(0, 2);

  const wdName = WEEKDAY[d.unmet.weekday];
  const onThatDay = slotsOnWeekday(d.unmet.weekday);

  return `<div class="in-card">
    <div class="in-cardhead">
      <div><div class="eyebrow">Demand near you</div>
        <div class="in-sub">Within ${esc(String(d.radiusMiles))} miles · ${esc(d.windowLabel)}</div></div>
      ${SAMPLE_PILL}
    </div>

    ${top
      ? `<p class="in-big"><b class="num">${esc(n0(top.n))} parents</b> searched for
           ${esc(top.sport.toLowerCase())} coaching within
           <span class="num">${esc(String(d.radiusMiles))}</span> miles in ${esc(d.windowLabel)}.</p>
         <p class="in-sub">${counted.filter(c => c !== top).map(c =>
             esc(c.sport) + " " + (c.n == null ? "—" : `<span class="num">${esc(n0(c.n))}</span>`)).join(" · ")}
           ${counted.some(c => c.n == null) ? " · — means no sample figure was seeded for that sport" : ""}</p>`
      : `<p class="in-big">No sample search figures are seeded for the sports you list.</p>`}

    <p class="in-note">Search volume is illustrative. This build measures no impressions, so treating
      these as live analytics would be a lie.</p>

    <div style="border-top:1px solid var(--rule);margin:16px 0 0;padding-top:14px">
      <div class="in-tags"><span class="eyebrow" style="margin-right:2px">Price positioning</span>${DERIVED_PILL}</div>
      ${positions.length
        ? positions.map(pp => `<p class="in-sub" style="margin-top:8px">
            ${sportDot(pp.listing.sport)}<b style="color:var(--ink)">${esc(pp.listing.title)}</b> —
            <span class="num">${esc(money(pp.listing.price))}</span> ${esc(modelLabel(pp.listing.model))}.
            ${esc(pp.read)} Local range
            <span class="num">${esc(money(pp.min))}–${esc(money(pp.max))}</span>.</p>`).join("")
        : `<p class="in-sub" style="margin-top:8px">None of your listings has a comparable listing in the
             catalogue yet, so there is no local range to sit inside.</p>`}
    </div>

    <div style="border-top:1px solid var(--rule);margin:16px 0 0;padding-top:14px">
      <div class="in-tags"><span class="eyebrow" style="margin-right:2px">Most-requested time you don't offer</span>${SAMPLE_PILL}</div>
      <p class="in-sub" style="margin-top:8px">
        <b style="color:var(--ink)">${esc(wdName)}, ${esc(d.unmet.timeLabel)}</b> —
        <span class="num">${esc(n0(d.unmet.requests))}</span> requests in ${esc(d.windowLabel)} (sample).
        ${onThatDay === 0
          ? `Your calendar has no ${esc(wdName)} sessions at all — that part is real.`
          : `You run <span class="num">${onThatDay}</span> ${esc(wdName)} session${onThatDay === 1 ? "" : "s"},
             none of them in that window — that part is real.`}</p>
    </div>

    <button class="btn ghost sm" data-in-goto="1" style="margin-top:16px">Open Insights</button>
  </div>`;
}

function watchlistCard(){
  /* Guest gate lives HERE, not at the call site.
     The Insights TAB is locked for a signed-out coach, but this same widget is
     also embedded directly on the dashboard, and that second path was not
     gated — a guest saw real client names on the first screen after entering
     the coach portal. Gating the renderer covers every embed, present and
     future; gating the navigation only covered the one route someone thought
     of. Verified by sweeping rendered text on 11 coach surfaces for seeded
     names. */
  if (typeof isCoachGuest === "function" && isCoachGuest()) {
    return `<div class="in-card"><div class="in-cardhead">
        <b>Clients to follow up</b></div>
      <p style="color:var(--muted);font-size:var(--text-sm);margin-top:8px">
        Sign in to see which families have stopped booking.</p></div>`;
  }
  const rows = watchlistRows().filter(r => r.broken).slice(0, 3);
  const total = watchlistRows().filter(r => r.broken).length;
  return `<div class="in-card">
    <div class="in-cardhead">
      <div><div class="eyebrow">Client watchlist</div>
        <div class="in-sub">Families whose rebooking rhythm has broken</div></div>
      <span class="pill ${total ? "warn" : "good"} num">${total}</span>
    </div>
    ${rows.length ? `<div class="in-wl">${rows.map(r => {
      const p = prog(r.programId);
      return `<div class="in-wlrow">
        <div style="min-width:0">
          <div class="in-who">${esc(r.athlete)}
            ${r.source === "sample" ? `<span class="pill gold" style="margin-left:6px">Sample</span>` : ""}</div>
          <div class="in-sub">${esc(r.why)}.</div>
          <div class="in-sub">${p ? sportDot(p.sport) + esc(p.title) : esc(r.programId)} ·
            last on ${esc(fmtDate(r.lastSessionDate))}</div>
        </div>
        <button class="btn sm" data-in-checkin="${esc(r.id)}">
          ${checkedIn[r.id] ? "Send another" : "Draft check-in"}</button>
      </div>`;
    }).join("")}</div>
    ${total > rows.length ? `<p class="in-note">${total - rows.length} more on the full watchlist.</p>` : ""}`
    : `<p class="in-sub">Every family on the books is inside their usual booking gap. Nothing to chase.</p>`}
    <button class="btn ghost sm" data-in-goto="1" style="margin-top:16px">Open the watchlist</button>
  </div>`;
}

/* ═══════════════════ VIEW ═══════════════════ */
function insightsView(){
  /* The Insights tab is hidden from a signed-out coach's Operations menu, but
     hiding a control is not a guard. S.coachTab is persisted to sessionStorage,
     so a coach who viewed Insights and then signed out is restored straight
     onto this view as a guest. The watchlist names real families, so the view
     refuses to render rather than relying on nobody finding the route. */
  if (typeof isCoachGuest === "function" && isCoachGuest()) {
    return typeof coachLockHTML === "function"
      ? coachLockHTML("Insights", "demand, retention and the families to follow up")
      : `<div class="empty" style="margin-top:18px"><h3>Sign in to see Insights</h3></div>`;
  }
  const rows = watchlistRows();
  const positions = myPricePositions();
  const d = state.demand;
  const sports = mySports();

  /* Six full-width bands, slate → white → black → black → slate → white.
     The two blacks are one chapter, not a checkerboard beat: the seeded
     funnel and the seeded demand figures are the two blocks on this page
     that are NOT measurements, and they belong together under one ground.
     Every metric inside them sits on a white card, so no figure is ever
     grey text on black, and both keep their "Sample data" badge. */
  return `
  <section class="band alt in-band">
    <div class="shell" data-rev>
      <div class="eyebrow">Insights</div>
      <h2 style="margin-top:12px;max-width:20ch">Where families find you.</h2>
      <p class="in-lede">Demand, funnel, pricing, and the families who stopped coming back.</p>
      <div class="in-tags" style="margin-top:16px">
        ${SAMPLE_PILL}<span class="in-tagtxt">funnel and search volume</span>
        ${DERIVED_PILL}<span class="in-tagtxt">pricing, availability, cadence</span></div>
      <p class="in-prov">This account has not launched, so nothing here is measured. Sample blocks are
        seeded. Derived blocks are computed from your listings, calendar and bookings.</p>
    </div>
  </section>

  <section class="band in-band">
    <div class="shell" data-rev>
      <div class="in-sec"><div>
        <h2>Availability check</h2>
        <p class="sub">Your open slots across the next seven days.</p></div>
        ${DERIVED_PILL}</div>
      ${warningsHTML()}
    </div>
  </section>

  <section class="band dark in-band">
    <div class="shell" data-rev>
      <div class="in-sec"><div>
        <h2>Booking funnel</h2>
        <p class="sub">Four stages over ${esc(state.funnel.windowLabel)}, seeded from a comparable coach — not
          your account.</p></div>
        ${SAMPLE_PILL}</div>
      <div class="in-card">${funnelHTML()}</div>
    </div>
  </section>

  <section class="band dark in-band">
    <div class="shell" data-rev>
      <div class="in-sec"><div>
        <h2>Demand near you</h2>
        <p class="sub">Search volume is seeded. Price positioning is computed from the catalogue.</p></div></div>
      <div class="in-two">
        ${demandCard()}
        <div class="in-card">
          <div class="in-cardhead">
            <div><div class="eyebrow">Searches by sport</div>
              <div class="in-sub">Your ${esc(String(sports.length))} sport${sports.length === 1 ? "" : "s"},
                within ${esc(String(d.radiusMiles))} miles</div></div>
            ${SAMPLE_PILL}
          </div>
          <div class="tblwrap"><table class="tbl">
            <thead><tr><th>Sport</th><th>Your listings</th><th>Searches (sample)</th></tr></thead>
            <tbody>${sports.map(s => {
              const n = Object.prototype.hasOwnProperty.call(d.searches, s) ? d.searches[s] : null;
              const mine = myListings().filter(p => p.sport === s);
              return `<tr>
                <td>${sportDot(s)}<b style="font-weight:600">${esc(s)}</b></td>
                <td class="num">${mine.length}</td>
                <td class="num">${n == null ? "—" : esc(n0(n))}</td></tr>`;
            }).join("")}</tbody></table></div>
          <p class="in-note">A dash means no sample figure was seeded — not zero searches.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="band alt in-band">
    <div class="shell" data-rev>
      <div class="in-sec"><div>
        <h2>Price positioning</h2>
        <p class="sub">Your price against catalogue listings in the same sport, on the same billing model.</p></div>
        ${DERIVED_PILL}</div>
      <div class="panel"><div class="in-plist">${positions.map(priceRowHTML).join("")}</div></div>
      <div class="tblwrap panel" style="padding:18px;margin-top:14px"><table class="tbl">
        <thead><tr><th>Listing</th><th>Sport</th><th>Billed</th><th>Your price</th>
          <th>Lowest</th><th>Median</th><th>Highest</th><th>Comparable listings</th></tr></thead>
        <tbody>${positions.map(pp => `<tr>
          <td><b style="font-weight:600">${esc(pp.listing.title)}</b></td>
          <td>${sportDot(pp.listing.sport)}${esc(pp.listing.sport)}</td>
          <td>${esc(modelLabel(pp.listing.model))}</td>
          <td class="num"><b>${esc(money(pp.listing.price))}</b></td>
          <td class="num">${pp.comparable ? esc(money(pp.min)) : "—"}</td>
          <td class="num">${pp.comparable ? esc(money2(pp.median)) : "—"}</td>
          <td class="num">${pp.comparable ? esc(money(pp.max)) : "—"}</td>
          <td class="num">${pp.others}</td></tr>`).join("")}
        </tbody></table></div>
    </div>
  </section>

  <section class="band in-band">
    <div class="shell" data-rev>
      <div class="in-sec"><div>
        <h2>Client watchlist</h2>
        <p class="sub">Flagged once the silence runs half again as long as a family's own usual gap.</p></div></div>
      ${rows.length ? `<div class="tblwrap panel" style="padding:18px"><table class="tbl">
        <thead><tr><th>Athlete</th><th>Family</th><th>Program</th><th>Last session</th>
          <th>Usual gap</th><th>Silent for</th><th>Status</th><th>Source</th><th>Action</th></tr></thead>
        <tbody>${rows.map(r => {
          const p = prog(r.programId);
          return `<tr>
            <td><b>${esc(r.athlete)}</b>
              <div style="color:var(--muted);font-size:var(--text-sm)">${esc(r.why)}</div></td>
            <td>${esc(r.family)}</td>
            <td>${p ? `${sportDot(p.sport)}<b style="font-weight:600">${esc(p.title)}</b>` : esc(r.programId)}</td>
            <td class="num">${esc(fmtDate(r.lastSessionDate))}</td>
            <td class="num">${r.typicalGapDays ? esc(r.typicalGapDays + " days") : "—"}
              ${r.typicalGapDays ? `<div style="color:var(--muted);font-size:var(--text-sm)">${esc(cadenceShort(r.typicalGapDays))}</div>` : ""}</td>
            <td class="num">${esc(String(r.gap))} days
              ${r.ratio ? `<div style="color:var(--muted);font-size:var(--text-sm)">${esc(r.ratio.toFixed(1))}× usual</div>` : ""}</td>
            <td><span class="pill ${esc(r.statusTone)}">${esc(r.statusLabel)}</span></td>
            <td>${r.source === "booked"
              ? `<span class="pill slate">Booking history</span>`
              : `<span class="pill gold">Sample family</span>`}</td>
            ${/* ghost, not filled: one row per family means the filled accent
                  would paint the whole column orange, and the accent is the
                  page's single primary CTA, not a table control. */""}
            <td><button class="btn ghost sm" data-in-checkin="${esc(r.id)}">
                ${checkedIn[r.id] ? "Send another" : "Draft check-in"}</button>
              ${checkedIn[r.id] ? `<div style="color:var(--muted);font-size:var(--text-sm);margin-top:4px">Check-in sent</div>` : ""}</td>
          </tr>`;
        }).join("")}</tbody></table></div>`
      : `<div class="empty" style="border:1px solid var(--rule);border-radius:var(--r-l)">
          <p>No families on the books yet. The watchlist fills itself from booking dates.</p></div>`}
      <p class="in-note"><b>Booking history</b> rows come from real session dates. <b>Sample family</b>
        rows are seeded and never raise an alert.</p>
    </div>
  </section>`;
}

/* ═══════════════════ MODAL ═══════════════════ */
const wrap = (title, body) =>
  `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div>
    <div class="modal-body">${body}</div></div></div>`;

function checkinModal(){
  const r = rowById(S.modal && S.modal.rowId);
  if (!r) return wrap("Check in", `<p style="color:var(--muted)">That family is no longer on the watchlist.</p>`);
  const p = prog(r.programId);
  const draft = draftCheckin(r);
  return wrap("Check in with " + firstName(r.family), `
    <div class="in-preface">
      <b>${esc(r.athlete)}</b> · ${esc(r.family)}${p ? " · " + esc(p.title) : ""}<br>
      ${esc(r.why)}. Last session ${esc(fmtDate(r.lastSessionDate))}.
      ${r.source === "sample"
        ? " These dates are seeded sample data for this demo family."
        : " These dates come from real bookings in this account."}
    </div>
    <p style="color:var(--muted);font-size:var(--text-sm);margin-bottom:14px">
      Drafted from that gap and nothing else — no claim about availability the calendar cannot back.
      Read it, change anything, then send. It goes to your existing thread with the family.</p>
    <form id="inCheckinForm">
      <div class="field">
        <label for="inDraft">Message</label>
        <textarea id="inDraft" class="in-draft" name="body" rows="10">${esc(draft)}</textarea>
      </div>
      <div id="inCheckinErr" class="err hide" style="margin-bottom:10px"></div>
      <button class="btn wide" type="submit">${ICON.send} Send check-in</button>
      <button class="btn ghost wide" type="button" data-in-restore="1" style="margin-top:9px">Restore the draft</button>
    </form>`);
}

/* ═══════════════════ WIRING ═══════════════════ */
function ensureCSS(){
  if (document.getElementById("mod-insights-css")) return;
  const el = document.createElement("style");
  el.id = "mod-insights-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

function wire(){
  ensureCSS();
  const q = s => document.querySelectorAll(s);

  q("[data-in-goto]").forEach(b => b.onclick = () => {
    setCoachTab("insights");
    window.scrollTo(0, 0);
    render();
  });

  q("[data-in-checkin]").forEach(b => b.onclick = () => {
    S.modal = { type: "checkin", rowId: b.dataset.inCheckin };
    render();
  });

  /* The textarea is never re-rendered while it is being typed into —
     the draft is read once, on submit. */
  q("[data-in-restore]").forEach(b => b.onclick = () => {
    const r = rowById(S.modal && S.modal.rowId);
    const ta = document.getElementById("inDraft");
    if (!r || !ta) return;
    ta.value = draftCheckin(r);
    ta.focus();
  });

  const cf = document.getElementById("inCheckinForm");
  if (cf) cf.onsubmit = ev => {
    ev.preventDefault();
    const r = rowById(S.modal && S.modal.rowId);
    const err = document.getElementById("inCheckinErr");
    const ta = document.getElementById("inDraft");
    if (!r || !ta) { S.modal = null; render(); return; }
    const text = String(ta.value || "").trim();
    if (!text){
      if (err){ err.textContent = "The message is empty — write something before sending."; err.classList.remove("hide"); }
      return;
    }
    sendCheckin(r, text);
    S.modal = null;
    render();
    toast("Check-in sent to " + firstName(r.family));
  };
}

/* ═══════════════════ EXPORT ═══════════════════ */
window.MOD_INSIGHTS = {
  css: CSS,
  /* Rendered as a sub-tab of the host Operations tab; no rail entry of its own. */
  tabs: {},
  views: { insights: insightsView },
  modals: { checkin: checkinModal },
  wire: wire,
  state: state,
  /* card renderers the dashboard embeds — each returns an HTML string */
  demandCard: demandCard,
  watchlistCard: watchlistCard,
  availabilityWarnings: availabilityWarnings,
};

})();
