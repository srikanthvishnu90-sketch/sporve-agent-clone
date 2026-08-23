/* ═══════════════════════════════════════════════════════════════════
   MOD_COMPANIES — the six sample businesses as first-class entities,
   plus offering-type-aware booking.

   Thesis: a team, a camp and a private trainer are three different
   commercial objects, not three variants of one booking.

     private → BOOK    · scarce = a slot on one coach's clock
     camp    → RESERVE · scarce = a seat in a fixed week
     team    → APPLY   · scarce = a spot on a roster

   The catalogue has no offering-type field — pricingModel (single_session
   / monthly / package) is doing double duty as billing cadence AND product
   kind, and does it badly. OFFERING below supplies the missing axis for all
   thirty listings, keyed to the ids in lib/core/mock/mock_data.dart.

   Contract: registers window.MOD_COMPANIES and never redefines a host
   symbol. Every class is co-prefixed. Reads PROGRAMS / S / sportColor /
   PICON from the host, writes nothing outside its own state keys. The two
   public views are stacks of full-width `.band` sections, matching
   productHTML(); nothing here owns a page-level ground of its own.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

/* ── local helpers (shadow nothing, depend on little) ─────────────── */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const sc  = s => (typeof sportColor === "function" ? sportColor(s) : "#223140");
/* The host's stroke icon set, read the same defensive way as ICON. Nothing in
   this module draws an emoji any more; a missing PICON renders nothing rather
   than falling back to a colour-font glyph on a different optical baseline. */
const pic = k => (typeof PICON !== "undefined" && PICON[k]) || "";
const H   = () => S;
/* DEMO_CATALOGUE, not PROGRAMS. This module is ABOUT the six sample businesses
   declared below — every figure on its two views is counted by matching
   `p.biz` against a COMPANIES name. Once mod-catalog.js swaps PROGRAMS for live
   rows, no live listing carries one of those names, so this would count zero
   programmes and zero sports under six business headings and render a
   confidently wrong stat block. Pointing it at the seeded array keeps the
   surface internally consistent; Phase C3 replaces it with real providers. */
const CAT = () => (typeof DEMO_CATALOGUE !== "undefined" && DEMO_CATALOGUE
  ? DEMO_CATALOGUE
  : (typeof PROGRAMS !== "undefined" && PROGRAMS ? PROGRAMS : []));
const $$  = sel => Array.prototype.slice.call(document.querySelectorAll(sel));
const usd = n => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

const MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/* ISO in, "Jun 7" out. Parsed as UTC so the label never slips a day by zone. */
function fmt(iso){
  const p = String(iso).split("-");
  return MONTH[Number(p[1]) - 1] + " " + Number(p[2]);
}
function fmtY(iso){ return fmt(iso) + ", " + String(iso).split("-")[0]; }
/* Calendar maths without a Date round-trip through local time. */
function shift(iso, days){
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ═══════════════════ THE SIX BUSINESSES ═══════════════════
   Names, verification state and sport mix transcribed from
   mock_data.dart. Everglade and Sunset have NOT cleared background
   checks — they never render a trust badge, and their imagery is
   deliberately plainer so the photography agrees with the state. */
const COMPANIES = [
  {
    id:"apex", name:"Apex Performance Club", verified:true,
    tagline:"Elite training clinics for junior athletes",
    bio:"Dedicated sports academy providing training clinics for junior athletes. Five programmes across five sports, run out of a single campus in Lincoln Park.",
    hood:"Lincoln Park, Chicago", founded:2016, coaches:14, seed:"apex",
    look:"Multi-sport, sunlit — clean modern facility, branded kit, wide angle.",
  },
  {
    id:"coral", name:"Coral Reef Aquatics", verified:true,
    tagline:"Every way to be fast in water",
    bio:"Swim, dive, polo and surf under one roof — and one ocean break. Competitive squads share deck time with first-timers, which is the point.",
    hood:"Lakeview, Chicago", founded:2011, coaches:11, seed:"coral",
    look:"Water everywhere — lane lines, spray, sunrise pool decks, one ocean break. Cyan-dominant.",
  },
  {
    id:"hoops", name:"Downtown Hoops Academy", verified:true,
    tagline:"Hardwood, track and everything that moves",
    bio:"A basketball academy that grew into movement generally — speed work, indoor volleyball and a hip-hop programme now share the floor.",
    hood:"The Loop, Chicago", founded:2018, coaches:9, seed:"hoops",
    look:"Urban indoor — hardwood, gym lighting, painted city court, motion blur on movement.",
  },
  {
    id:"everglade", name:"Everglade Racquet Institute", verified:false,
    tagline:"Five racquets, one set of fundamentals",
    bio:"Tennis, pickleball, badminton, squash and table tennis taught as one family of skills. Small groups by design — no programme runs above twelve.",
    hood:"Oak Park, Chicago", founded:2021, coaches:6, seed:"everglade",
    look:"Courts and geometry — hard-court blue, net lines, racquet detail. Precise, low motion.",
  },
  {
    id:"ironside", name:"Ironside Combat Gym", verified:true,
    tagline:"Discipline first, contact later",
    bio:"Boxing, wrestling, MMA, karate and judo for young athletes. Every programme starts non-contact and stays there until the coach says otherwise.",
    hood:"Pilsen, Chicago", founded:2014, coaches:10, seed:"ironside",
    look:"Low-key lighting, mats, wraps, gi texture. Discipline over aggression — these are minors.",
  },
  {
    id:"sunset", name:"Sunset Field Athletics", verified:false,
    tagline:"Open grass, five sports, golden hour",
    bio:"Baseball, softball, flag football, lacrosse and cricket on shared fields in Hyde Park. The widest age spread of any operator on Sporv.",
    hood:"Hyde Park, Chicago", founded:2019, coaches:8, seed:"sunset",
    look:"Open grass at golden hour — long lenses, chalk lines, dust. Warm and wide.",
  },
];
const COMPANY_BY_NAME = {};
COMPANIES.forEach(c => { COMPANY_BY_NAME[c.name] = c; });

/* ═══════════════════ THE MISSING AXIS ═══════════════════
   offering_type for all thirty listings. Independent of pricingModel:
   a camp can bill monthly, a private coach can sell a package.
     team    — season-long, competitive, roster, evaluated entry
     camp    — fixed dates, finite seats, no recurrence
     private — a coach's time, 1:1 or small group, repeatable  */
const OFFERING = {
  prog_1:"team",    prog_2:"camp",    prog_3:"private", prog_4:"private", prog_5:"camp",
  prog_6:"team",    prog_7:"private", prog_8:"team",    prog_9:"camp",    prog_10:"private",
  prog_11:"private",prog_12:"camp",   prog_13:"private",prog_14:"camp",   prog_15:"camp",
  prog_16:"private",prog_17:"camp",   prog_18:"private",prog_19:"camp",   prog_20:"private",
  prog_21:"team",   prog_22:"team",   prog_23:"private",prog_24:"team",   prog_25:"private",
  prog_26:"camp",   prog_27:"team",   prog_28:"camp",   prog_29:"camp",   prog_30:"team",
};
const typeOf = p => OFFERING[p && p.id] || "private";

const TYPE = {
  private:{ label:"Private training", verb:"Book",    cta:"Book session",
            unit:"A slot on one coach's clock",  short:"Private" },
  camp:   { label:"Camp",             verb:"Reserve", cta:"Reserve seat",
            unit:"A seat in a fixed week",       short:"Camp"    },
  team:   { label:"Team",             verb:"Apply",   cta:"Register for tryout",
            unit:"A spot on a roster",           short:"Team"    },
};

/* ═══════════════════ IMAGE SYSTEM ═══════════════════
   Different counts AND different proportions per type. Placeholder seeds
   are deterministic so a real photograph can replace each one in place.
     private → 1 portrait 4:5   (you are buying a person's attention)
     camp    → 1 wide 16:9 + 6  (you are buying a place and a week)
     team    → 1 action 3:2 + 4 (you are buying an institution) */
const IMG_SPEC = {
  private:{ ratio:"4 / 5",  gallery:2, gRatio:"1 / 1", shots:["portrait","instruction","drill detail"] },
  camp:   { ratio:"16 / 9", gallery:6, gRatio:"3 / 2", shots:["facility wide","group activity","shade & lunch area","drop-off zone","equipment","end-of-day huddle"] },
  team:   { ratio:"3 / 2",  gallery:4, gRatio:"3 / 2", shots:["match action","squad photo","head coach","home venue"] },
};
/* Self-contained showcase art — a slate SVG data URI, never an external host
   (external image hosts violated the single-file + CSP rule, §9.11). Seed varies the
   tint slightly so a gallery is not flat. */
function shot(seed, w, h){
  var hue = 0; for (var i=0;i<String(seed).length;i++){ hue=(hue+String(seed).charCodeAt(i))%40; }
  var svg="<svg xmlns='http://www.w3.org/2000/svg' width='"+w+"' height='"+h+"'>"+
    "<rect width='"+w+"' height='"+h+"' fill='#EEF2F7'/>"+
    "<rect width='"+w+"' height='"+h+"' fill='hsl("+(205+hue)+",30%,55%)' opacity='0.10'/>"+
    "<circle cx='"+(w/2)+"' cy='"+(h/2)+"' r='"+(Math.min(w,h)*0.12)+"' fill='#64748B' opacity='0.4'/></svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/* ── real assets, with a placeholder underneath ──────────────────────
   Drop a file at the documented path and it appears — no rebuild, no
   manifest, no build.py change. Until then the external stock art seed stands in.

     assets/listings/<programId>-hero.jpg      e.g. prog_9-hero.jpg
     assets/listings/<programId>-g<n>.jpg      e.g. prog_9-g0.jpg … -g5.jpg
     assets/companies/<companyId>-hero.jpg     e.g. coral-hero.jpg

   The fallback is wired in wire() rather than an inline onerror, because
   an inline handler is exactly what a strict script-src blocks. */
const ASSET = {
  listing:(id, slot) => "assets/listings/" + id + "-" + slot + ".jpg",
  company:(id, slot) => "assets/companies/" + id + "-" + slot + ".jpg",
};
/* No real photo assets ship in this repo (assets/listings/* do not exist), so
   the src is the self-contained placeholder directly — trying the .jpg first
   only produced a guaranteed net::ERR_FILE_NOT_FOUND before falling back. When
   real assets land, restore the real-first src + data-cofb fallback. */
function imgTag(real, fallback, alt){
  return `<img src="${esc(fallback)}" alt="${esc(alt || "")}" loading="lazy">`;
}
function imagesFor(p){
  const spec = IMG_SPEC[typeOf(p)];
  const g = [];
  for(let i = 0; i < spec.gallery; i++){
    g.push({
      src:ASSET.listing(p.id, "g" + i),
      fallback:shot(p.id + "-g" + i, 600, 400),
      alt:(spec.shots[i] || "") + " — " + p.title,
    });
  }
  return {
    hero:ASSET.listing(p.id, "hero"),
    heroFallback:shot(p.id, 900, 700),
    ratio:spec.ratio, gRatio:spec.gRatio, gallery:g,
    /* what a photographer or generator needs to produce for this listing */
    brief:{ count:spec.gallery + 1, ratio:spec.ratio, shots:["hero"].concat(spec.shots.slice(0, spec.gallery)) },
  };
}

/* ═══════════════════ TYPE-SPECIFIC BOOKING DATA ═══════════════════ */

/* Private — the calendar is the product. Durations, packages, a window. */
function privateMeta(p){
  const base = Number(p.price) || 50;
  return {
    durations:[[30, .6],[45, .8],[60, 1],[90, 1.45]],
    packages:[[5, .95],[10, .9]],
    semiPrivate:.7,
    days:["Mon","Tue","Wed","Thu","Fri","Sat"],
    times:["7:00a","8:30a","3:30p","4:45p","6:00p"],
    leadHours:12,
    cancelHours:24,
    cancelPct:100,
    travelFee: p.id.charCodeAt(p.id.length - 1) % 2 ? 15 : 0,
    rate:base,
  };
}

/* Camp — one listing, MANY sessions. This one-to-many is the shape the
   flat listing model cannot express at all. */
function campSessions(p){
  const starts = ["2027-06-07","2027-06-14","2027-06-21"];
  const cap = Number(p.cap) || 16;
  const enrolled = Number(p.enrolled) || 0;
  return starts.map((s, i) => {
    const seats = Math.max(0, cap - enrolled - i * 2);
    return {
      id:p.id + "-s" + i,
      start:s, end:shift(s, 4),
      seats, cap,
      price:Number(p.price) || 60,
      earlyBird:i === 0,
    };
  });
}
function campMeta(p){
  return {
    sessions:campSessions(p),
    daily:[["8:30a","Drop-off opens"],["9:00a","Warm-up & skill blocks"],["11:30a","Small-sided games"],
           ["12:15p","Lunch & shade break"],["1:00p","Position work"],["2:45p","Cool-down"],["3:00p","Pickup"]],
    beforeCare:{ from:"7:30a", fee:45 },
    afterCare:{ to:"5:30p", fee:60 },
    bring:["Water bottle (labelled)","Sunscreen, applied before drop-off","Trainers plus a spare pair","Light snack"],
    lunch:"Bring your own — a shaded lunch area and cold water are provided.",
    ratio:"1 coach per 8 campers",
    depositPct:.3,
    weather:"Heat and lightning policy in force. Cancelled days are made up on the Friday of the same week.",
  };
}
/* The refund cliff, as dated rows rather than policy prose. Parents book
   camps months out; this is the single biggest hesitation. */
function refundRows(session){
  return [
    ["Full refund",      "through " + fmt(shift(session.start, -30)), "100%"],
    ["Partial refund",   fmt(shift(session.start, -29)) + " – " + fmt(shift(session.start, -14)), "50%"],
    ["No refund",        "from " + fmt(shift(session.start, -13)), "0%"],
  ];
}

/* Team — not a booking. Tryout, evaluation, roster offer, then money.
   The all-in season total leads; dues are a line item beneath it. */
function teamMeta(p){
  const dues = (Number(p.price) || 55) * 9;
  const kit = 165, tourn = 420, travel = 380, league = 95, ref = 110;
  return {
    tier:["Select","Travel","Premier","Academy"][p.id.length % 4],
    league:{ Soccer:"Illinois State Premier League", Basketball:"AAU Gold Circuit", Swimming:"USA Swimming — Illinois Swimming",
             "Water Polo":"USA Water Polo Junior Olympics", Boxing:"USA Boxing Youth", Wrestling:"Illinois Scholastic Series",
             Karate:"USA Karate Junior League", Softball:"USSSA Fastpitch", Cricket:"USA Cricket Youth" }[p.sport] || "Regional Youth League",
    tryouts:[{ date:"2026-08-22", time:"9:00a – 12:00p" },{ date:"2026-08-29", time:"9:00a – 12:00p" }],
    tryoutDeadline:"2026-08-19",
    tryoutFee:35,
    rosterAnnounced:"2026-09-02",
    seasonStart:"2026-09-14", seasonEnd:"2027-03-21",
    practicesPerWeek:3,
    practiceDays:"Tue / Thu / Sat",
    games:22,
    travelScope:["Local","Regional","National"][p.id.length % 3],
    tournaments:4,
    rosterSize:Number(p.cap) || 16,
    spots:Math.max(1, (Number(p.cap) || 16) - (Number(p.enrolled) || 0)),
    positions:{ Soccer:["Goalkeeper","Centre-back"], Basketball:["Point guard"], Baseball:["Catcher","Left-handed pitcher"],
                Softball:["Pitcher"], Volleyball:["Setter"], Cricket:["Seam bowler"] }[p.sport] || [],
    costs:[["Season dues", dues, "Billed monthly over 9 months"],
           ["Uniform kit", kit, "Two jerseys, shorts, socks, training top"],
           ["Tournament fees", tourn, "Four tournaments, billed separately"],
           ["Travel estimate", travel, "Parent-borne — hotels and fuel"],
           ["League registration", league, "Once per season"],
           ["Referee fees", ref, "Split across the squad"]],
    aid:true,
    playingTime:"No guaranteed minutes. Selection is on form and attendance.",
  };
}
const teamTotal = m => m.costs.reduce((a, r) => a + r[1], 0);

/* ═══════════════════ ATHLETE, AGE GATE, CONSENT ═══════════════════
   The app pins "now" to 2026-08-03 (same constant MOD_PAYMENTS uses), so
   ages computed here agree with every other surface. */
const TODAY = "2026-08-03";
/* Fee comes from the host's FEE_RATE — single source, do not redeclare. */

function athletes(){
  const s = H();
  if(s.athletes && s.athletes.length) return s.athletes;
  return (typeof SEED !== "undefined" && SEED.athletes) || [];
}
function ageOn(dob, iso){
  if(!dob) return null;
  const b = String(dob).slice(0, 10).split("-").map(Number);
  const t = String(iso).slice(0, 10).split("-").map(Number);
  let a = t[0] - b[0];
  if(t[1] < b[1] || (t[1] === b[1] && t[2] < b[2])) a--;
  return a;
}
/* Which athlete, how old, and does the listing's own range admit them.
   Computed — never asserted as a string. */
function pickAthlete(p, m){
  const list = athletes();
  const sel = list.filter(a => a.id === (m || {}).athlete)[0] || list[0] || null;
  const age = sel ? ageOn(sel.dob, TODAY) : null;
  const fits = !sel ? false : (age == null ? true : age >= p.minAge && age <= p.maxAge);
  return { list:list, sel:sel, age:age, fits:fits };
}
function athleteBlock(p, m){
  const a = pickAthlete(p, m);
  if(!a.sel) return fg("Athlete", "", `<div class="co-note"><b>No athlete on this account.</b>
    Add a child profile from Profile first — creating one requires parental consent,
    which is captured with a version and a timestamp.</div>`);
  return fg("Athlete &amp; consent", "5 fields", `
    <div class="co-opts" style="margin-bottom:12px">
      ${a.list.map(x => {
        const ag = ageOn(x.dob, TODAY);
        return `<button class="co-opt ${a.sel.id === x.id ? "on" : ""}" data-coath="${esc(x.id)}">
          ${esc(x.firstName + " " + x.lastName)}${ag == null ? "" : " · " + ag}</button>`;
      }).join("")}
    </div>
    ${a.fits
      ? `<div class="co-note plain">${esc(a.sel.firstName)} is ${a.age} — inside this listing's ${p.minAge}–${p.maxAge} range.</div>`
      : `<div class="co-note"><b>Outside the age range.</b> ${esc(a.sel.firstName)} is ${a.age};
         this listing takes ${p.minAge}–${p.maxAge}. Booking is blocked.</div>`}
    <div class="co-checks" style="margin-top:14px">
      <label class="co-check"><input type="checkbox" data-cock="1">
        <span>Parental consent for a minor to train with this coach</span></label>
      <label class="co-check"><input type="checkbox" data-cock="1">
        <span>Medical conditions and emergency contact are current</span></label>
    </div>
    <div class="co-note plain">Photo and video consent is <b>not</b> collected here. It is held per
      athlete in the media library, where only a parent can change it — a coach can request it and
      never grant it. Asking again on this screen would imply a decision this sheet cannot record.</div>`);
}

/* ═══════════════════ ONE PRICE, ONE SOURCE ═══════════════════
   The sheet footer and the committed booking read the same quote, so what
   is displayed is by construction what is written. */
function quote(kind, p, m){
  m = m || {};
  if(kind === "camp"){
    const meta = campMeta(p);
    const sel = meta.sessions.filter(s => s.id === m.ses)[0] || meta.sessions[0];
    const care = m.care || {};
    const extras = (care.before ? meta.beforeCare.fee : 0) + (care.after ? meta.afterCare.fee : 0);
    const total = Math.round(sel.price * (sel.earlyBird ? .9 : 1) + extras);
    const due = Math.round(total * meta.depositPct);
    return { kind:kind, meta:meta, session:sel, total:total, due:due, balance:total - due };
  }
  if(kind === "team"){
    const meta = teamMeta(p);
    return { kind:kind, meta:meta, total:teamTotal(meta), due:meta.tryoutFee, balance:0 };
  }
  const meta = privateMeta(p);
  const dur = m.dur || 60;
  const mult = (meta.durations.filter(d => d[0] === dur)[0] || [60, 1])[1];
  const pack = m.pack || 1;
  const packMult = pack === 1 ? 1 : (meta.packages.filter(x => x[0] === pack)[0] || [1, 1])[1];
  const unit = Math.round(meta.rate * mult * packMult);
  const total = unit * pack + (m.travel ? meta.travelFee : 0);
  return { kind:kind, meta:meta, dur:dur, pack:pack, unit:unit, total:total, due:total, balance:0 };
}

/* ═══════════════════ COMMIT ═══════════════════
   Writes a real booking and a real ledger row. A confirmation that leaves
   no record is worse than no confirmation at all. */
function commit(kind, p, m){
  const h = H();
  const q = quote(kind, p, m);
  const a = pickAthlete(p, m);
  const n = ((h.bookings && h.bookings.length) || 0) + 1;
  const bookId = "book_co" + n, txId = "tx_co" + n;
  const cents = v => Math.round(v * 100);

  const rec = {
    id:bookId,
    athlete:a.sel ? a.sel.firstName + " " + a.sel.lastName : "",
    athleteId:a.sel ? a.sel.id : null,
    programId:p.id, program:p.title, offeringType:kind,
    createdAt:TODAY,
    price:q.due,
    totalCents:cents(q.total), dueCents:cents(q.due), balanceCents:cents(q.balance),
    /* the policy in force at purchase, captured now — a later change by the
       operator must not move this booking's refund terms */
    cancellationPolicy:p.cancellationPolicy || "moderate",
    policySnapshotAt:TODAY,
    /* versioned + timestamped, matching the child-profile consent path */
    consent:{ version:"v1", at:TODAY, kind:"booking_parental" },
  };

  if(kind === "team"){
    /* An application, not a purchase. The roster offer has not happened, so
       this is never "confirmed" and no season cost is charged. */
    rec.tryoutDate = m.tryout || q.meta.tryouts[0].date;
    rec.date = rec.tryoutDate;
    rec.session = "Tryout — " + fmt(rec.tryoutDate);
    rec.status = "applied";
    rec.paymentStatus = "tryout_fee_paid";
    rec.seasonCost = q.total;
  } else if(kind === "camp"){
    rec.date = q.session.start;
    rec.session = "Week of " + fmt(q.session.start) + "–" + fmt(q.session.end);
    rec.status = "confirmed";
    rec.paymentStatus = q.balance ? "deposit_paid" : "paid";
    rec.balanceDueBy = shift(q.session.start, -21);
    q.session.seats = Math.max(0, q.session.seats - 1);
  } else {
    rec.date = TODAY;
    rec.session = (m.day || "Tue") + " " + (m.slot || "4:45p") + " · " + q.dur + " min";
    rec.status = "confirmed";
    rec.paymentStatus = "paid";
    rec.sessions = q.pack;
  }

  if(!h.bookings) h.bookings = [];
  h.bookings.unshift(rec);

  /* keep MOD_PAYMENTS' ledger consistent: one row per movement, fee itemized */
  if(h.transactions){
    h.transactions.unshift({
      id:txId, at:TODAY,
      kind:kind === "team" ? "tryout_fee" : kind === "camp" ? "deposit" : "booking",
      bookingId:bookId, programId:p.id,
      desc:p.title + " · " + rec.session,
      grossCents:rec.dueCents,
      feeCents:Math.round(rec.dueCents * FEE_RATE),
      totalCents:rec.dueCents,
    });
  }
  return rec;
}

/* ═══════════════════ CSS ═══════════════════ */
const CSS = `
/* every selector co-prefixed so nothing collides with the host or MOD_SEARCH */
.co-rail{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:0 0 22px}
.co-rail .co-lbl{font-size:var(--text-xs);font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);margin-right:2px}
.co-tpill{
  display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;
  border:1px solid var(--rule-strong);background:var(--paper);font-size:var(--text-sm);font-weight:700;
  color:var(--muted);transition:.15s;
}
.co-tpill:hover{border-color:var(--ink);color:var(--ink)}
.co-tpill.on{background:var(--ink);border-color:var(--ink);color:#fff}
.co-tpill .co-n{font-variant-numeric:tabular-nums;opacity:.65;font-size:var(--text-sm)}
.co-tpill.on .co-n{opacity:.8}

.co-badge{
  display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;
  font-size:var(--text-xs);font-weight:700;letter-spacing:.07em;text-transform:uppercase;
}
.co-badge.private{background:#E4F2F6;color:#0E7490}
.co-badge.camp{background:#FAEEE0;color:#B45309}
.co-badge.team{background:#EEE9F8;color:#4C1D95}
:root[data-theme="dark"] .co-badge.private{background:#0C2830;color:#5FC4DC}
:root[data-theme="dark"] .co-badge.camp{background:#2C1D0D;color:#EBA45C}
:root[data-theme="dark"] .co-badge.team{background:#1D1533;color:#B49CF0}

/* ── company index ──────────────────────────────────────────────────
   Both views are now stacks of full-width .band sections, so the vertical
   rhythm belongs to the band (74px) and these blocks carry only their own
   internal gaps. Nothing below sets a font-size for a heading: the hero uses
   the host's bare h1 + .lede and the section heads use h2 + .co-sub, which
   are already on the locked scale. .co-head is gone for the same reason --
   it existed to hand-size an h1 that the host already sizes correctly.

   NB: this whole block is a template literal. No backticks in these comments. */
.co-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(324px,1fr));gap:20px;margin-top:30px}
.co-card{
  text-align:left;display:flex;flex-direction:column;border:1px solid var(--rule);
  border-radius:var(--r-l);overflow:hidden;background:var(--paper);transition:.17s;
}
.co-card:hover{border-color:var(--ink);transform:translateY(-2px);box-shadow:var(--shadow-lift)}
.co-card .co-shot{aspect-ratio:3/2;overflow:hidden;background:var(--raise2);position:relative}
.co-card .co-shot img{width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.2,.7,.3,1)}
.co-card:hover .co-shot img{transform:scale(1.04)}
/* unverified operators get no hero polish — the treatment agrees with the state */
.co-card.co-pending .co-shot img{filter:saturate(.55) contrast(.96)}
.co-card .co-body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:7px}
.co-card .co-nm{font-size:var(--text-lg);font-weight:700;letter-spacing:-.025em}
.co-card .co-tag{color:var(--muted);font-size:var(--text-base);line-height:1.45}
.co-mix{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}
.co-dot{width:9px;height:9px;border-radius:3px;display:block}
.co-stats{display:flex;gap:16px;margin-top:10px;padding-top:13px;border-top:1px solid var(--rule);font-size:var(--text-sm);color:var(--faint)}
.co-stats b{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}

.co-trust{display:flex;align-items:center;gap:6px;font-size:var(--text-sm);font-weight:700}
.co-trust.ok{color:var(--gold-ink)}
.co-trust.no{color:var(--warn)}

/* ── figures on the dark ground ─────────────────────────────────────
   White cards on black, not text on black. Everything inside a card is
   --ink / --muted, which is the same construction the host already uses for
   .band.dark .prodcard -- nothing here paints type directly onto #000. */
.co-figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:14px;margin-top:30px}
.co-fig{
  display:flex;flex-direction:column;gap:3px;padding:20px;background:var(--paper);
  color:var(--ink);border:1px solid var(--rule);border-radius:var(--r-l);
}
.co-fig .v{font-family:var(--serif);font-size:var(--text-xl);font-weight:400;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.co-fig .k{font-size:var(--text-xs);font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.band.dark .co-fig{border-color:#232A34;box-shadow:0 24px 60px -24px rgba(0,0,0,.9)}

/* ── trust rows on the slate ground ─────────────────────────────── */
.co-trows{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:20px 30px;margin-top:28px}
.co-trow{display:flex;gap:12px;align-items:flex-start}
.co-trow .ic{
  width:34px;height:34px;border-radius:var(--r-m);flex:0 0 auto;display:grid;place-items:center;
  background:var(--paper);border:1px solid var(--rule);color:var(--slate);
}
.co-trow b{display:block;font-size:var(--text-base);letter-spacing:-.022em}
.co-trow span{display:block;color:var(--muted);font-size:var(--text-base);line-height:1.5;margin-top:3px}

/* ── company profile ────────────────────────────────────────────── */
.co-hero{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:44px;align-items:start}
/* --text-base, not --text-md: md is reserved for a one-line lead under a
   headline. This is a 60ch operator bio at line-height 1.6 -- body copy that
   happens to sit under an h1. */
.co-hero .co-bio{color:var(--muted);font-size:var(--text-base);line-height:1.6;margin-top:16px;max-width:60ch}
.co-heroshot{border-radius:var(--r-l);overflow:hidden;aspect-ratio:4/3;background:var(--raise2)}
.co-heroshot img{width:100%;height:100%;object-fit:cover}
.co-facts{display:flex;gap:26px;flex-wrap:wrap;margin-top:22px;padding-top:20px;border-top:1px solid var(--rule)}
.co-fact .k{font-size:var(--text-xs);font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.co-fact .v{font-family:var(--serif);font-size:var(--text-lg);font-weight:400;letter-spacing:-.025em;margin-top:3px;font-variant-numeric:tabular-nums}

/* No font-size/letter-spacing override here: an h2 takes the scale's h2 step
   and the display face's tracking from the host base rule. The old -.03em was
   tuned for a face this page no longer loads. */
.co-sub{color:var(--muted);font-size:var(--text-base);margin-top:8px;max-width:62ch;line-height:1.55}

.co-list{display:flex;flex-direction:column;gap:12px;margin-top:26px}
.co-row{
  display:grid;grid-template-columns:132px minmax(0,1fr) auto;gap:20px;align-items:center;
  border:1px solid var(--rule);border-radius:var(--r-l);padding:14px;background:var(--paper);transition:.15s;
}
.co-row:hover{border-color:var(--rule-strong);box-shadow:var(--shadow)}
.co-row .co-thumb{border-radius:var(--r-m);overflow:hidden;background:var(--raise2)}
.co-row .co-thumb img{width:100%;height:100%;object-fit:cover}
.co-row h3{font-size:var(--text-base);letter-spacing:-.015em;margin-top:7px}
.co-row .co-meta{color:var(--faint);font-size:var(--text-sm);margin-top:4px;font-variant-numeric:tabular-nums}
.co-row .co-act{display:flex;flex-direction:column;align-items:flex-end;gap:9px;flex:0 0 auto}
.co-row .co-px{font-size:var(--text-base);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.co-row .co-px span{font-weight:500;color:var(--muted);font-size:var(--text-sm)}
@media(max-width:820px){
  .co-hero{grid-template-columns:1fr;gap:26px}
  .co-row{grid-template-columns:92px minmax(0,1fr);gap:14px}
  .co-row .co-act{grid-column:1/-1;flex-direction:row;align-items:center;justify-content:space-between}
}

/* ── booking sheet ──────────────────────────────────────────────── */
.co-sheet{max-width:600px}
.co-kick{
  display:flex;align-items:center;gap:10px;padding:14px 22px;
  border-bottom:1px solid var(--rule);background:var(--raise);
}
.co-kick .co-unit{color:var(--muted);font-size:var(--text-sm)}
.co-fg{margin-top:22px}
.co-fg:first-child{margin-top:0}
.co-fg > .co-fgh{
  display:flex;align-items:baseline;gap:10px;padding-bottom:8px;margin-bottom:12px;
  border-bottom:1px solid var(--rule);
}
.co-fg > .co-fgh b{font-size:var(--text-base);letter-spacing:-.015em}
.co-fg > .co-fgh .co-ct{margin-left:auto;font-size:var(--text-xs);color:var(--faint);font-variant-numeric:tabular-nums}

.co-opts{display:flex;gap:8px;flex-wrap:wrap}
.co-opt{
  padding:9px 14px;border:1px solid var(--rule-strong);border-radius:var(--r-m);
  font-size:var(--text-sm);font-weight:700;background:var(--paper);transition:.14s;
  font-variant-numeric:tabular-nums;
}
.co-opt:hover{border-color:var(--ink-2)}
.co-opt.on{border-color:var(--slate);background:var(--slate-tint);box-shadow:0 0 0 1px var(--slate)}
.co-opt:disabled{opacity:.38;cursor:not-allowed}

.co-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:7px}

/* camp session picker — dates and seats, not a calendar */
.co-sess{display:flex;flex-direction:column;gap:8px}
.co-sesrow{
  display:flex;align-items:center;gap:14px;width:100%;text-align:left;
  padding:13px 15px;border:1px solid var(--rule-strong);border-radius:var(--r-m);transition:.14s;
}
.co-sesrow:hover{border-color:var(--ink-2);background:var(--raise)}
.co-sesrow.on{border-color:var(--slate);background:var(--slate-tint);box-shadow:0 0 0 1px var(--slate)}
.co-sesrow:disabled{opacity:.45;cursor:not-allowed}
.co-sesrow .co-dt{font-weight:700;font-size:var(--text-base);font-variant-numeric:tabular-nums}
.co-sesrow .co-seats{margin-left:auto;font-size:var(--text-sm);font-weight:700;font-variant-numeric:tabular-nums;flex:0 0 auto}
.co-sesrow .co-seats.low{color:var(--danger)}
.co-sesrow .co-seats.out{color:var(--faint)}
.co-eb{font-size:var(--text-xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--good)}

.co-tbl{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
.co-tbl th{
  text-align:left;font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;
  color:var(--faint);font-weight:700;padding:0 10px 8px 0;
}
.co-tbl td{padding:8px 10px 8px 0;border-top:1px solid var(--rule);vertical-align:top}
.co-tbl td:last-child{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700}
.co-tbl tr.co-tot td{border-top:1.5px solid var(--rule-strong);font-weight:700;font-size:var(--text-base);padding-top:11px}
.co-tbl .co-why{display:block;color:var(--faint);font-size:var(--text-sm);font-weight:400;margin-top:2px}

.co-sched{display:flex;flex-direction:column;gap:0}
.co-schedrow{display:flex;gap:14px;padding:7px 0;border-top:1px solid var(--rule);font-size:var(--text-sm)}
.co-schedrow:first-child{border-top:0}
.co-schedrow .t{font-variant-numeric:tabular-nums;color:var(--faint);flex:0 0 62px;font-weight:700}

.co-checks{display:flex;flex-direction:column;gap:9px}
.co-check{display:flex;gap:10px;align-items:flex-start;font-size:var(--text-sm);color:var(--ink-2);line-height:1.45}
.co-check input{margin:3px 0 0;flex:0 0 auto;accent-color:var(--slate)}
.co-ul{margin:0;padding-left:18px;color:var(--ink-2);font-size:var(--text-sm);line-height:1.6}

.co-note{
  border-left:3px solid var(--warn);background:var(--warn-tint);color:var(--ink-2);
  padding:12px 14px;border-radius:0 var(--r-s) var(--r-s) 0;font-size:var(--text-sm);line-height:1.5;margin-top:14px;
}
.co-note.plain{border-left-color:var(--rule-strong);background:var(--raise)}
.co-note b{color:var(--ink)}

.co-foot{
  display:flex;align-items:center;gap:14px;margin-top:24px;padding-top:18px;border-top:1px solid var(--rule);
}
.co-foot .co-tot{flex:1;min-width:0}
.co-foot .co-tot .k{font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.co-foot .co-tot .v{font-family:var(--serif);font-size:var(--text-xl);font-weight:400;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.co-foot .co-tot .d{font-size:var(--text-sm);color:var(--muted);margin-top:1px}
`;

/* ═══════════════════ VIEWS ═══════════════════ */

function progsOf(company){ return CAT().filter(p => p.biz === company.name); }
function sportsOf(company){ return Array.from(new Set(progsOf(company).map(p => p.sport))); }
function mixOf(company){
  const m = { private:0, camp:0, team:0 };
  progsOf(company).forEach(p => { m[typeOf(p)]++; });
  return m;
}

/* Both branches used to read "Verification pending" — the `ok` class carrying
   the `no` copy — so a background-checked operator was labelled unverified in
   positive styling. Same defect as the eight sites in the host; this was the
   ninth. The class was always right; only the words were wrong. */
function trustLine(company){
  return company.verified
    ? `<span class="co-trust ok">${(typeof ICON !== "undefined" && ICON.shield) || "✓"} Background-checked</span>`
    : `<span class="co-trust no">Verification pending</span>`;
}

/* — index of all six — */
function companiesView(){
  const cards = COMPANIES.map(c => {
    const ps = progsOf(c), mix = mixOf(c), sports = sportsOf(c);
    const avg = ps.length ? (ps.reduce((a, p) => a + Number(p.rating || 0), 0) / ps.length).toFixed(1) : "—";
    return `<button class="co-card ${c.verified ? "" : "co-pending"}" data-company="${esc(c.id)}">
      <div class="co-shot">${imgTag(ASSET.company(c.id, "hero"), shot(c.seed + "-hero", 900, 600), c.name)}</div>
      <div class="co-body">
        <div class="co-nm">${esc(c.name)}</div>
        <div class="co-tag">${esc(c.tagline)}</div>
        <div class="co-mix">${sports.map(s => `<i class="co-dot" style="background:${sc(s)}" title="${esc(s)}"></i>`).join("")}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">
          ${["private","camp","team"].filter(t => mix[t]).map(t =>
            `<span class="co-badge ${t}">${mix[t]} ${esc(TYPE[t].short)}${mix[t] > 1 ? "s" : ""}</span>`).join("")}
        </div>
        <div class="co-stats">
          <span><b>${ps.length}</b> programmes</span>
          <span><b>${sports.length}</b> sports</span>
          <span><b>${avg}</b> avg rating</span>
        </div>
        <div style="margin-top:9px">${trustLine(c)}</div>
      </div></button>`;
  }).join("");

  /* Every figure below is COUNTED, never asserted. If a business is added to
     COMPANIES or a programme to the catalogue, the hero line and the stat
     block move with it rather than going quietly stale. */
  const nBiz     = COMPANIES.length;
  const nProg    = COMPANIES.reduce((a, c) => a + progsOf(c).length, 0);
  const nSport   = new Set(COMPANIES.reduce((a, c) => a.concat(sportsOf(c)), [])).size;
  const nChecked = COMPANIES.filter(c => c.verified).length;
  const nCoach   = COMPANIES.reduce((a, c) => a + c.coaches, 0);

  const figs = [
    [String(nBiz),             "Businesses"],
    [String(nProg),            "Programmes"],
    [String(nSport),           "Sports"],
    [String(nCoach),           "Coaches"],
    [nChecked + " of " + nBiz, "Checked"],
  ];

  const rows = [
    [pic("shield"), "Checks are per person", "An approved business vouches for nobody on its roster."],
    [pic("list"),   "Three things to book",  "A roster spot, a camp week and a coach's hour differ."],
    [pic("search"), "Pending stays visible", "An unverified operator is listed, unbadged, and never quietly dropped."],
  ];

  /* Rhythm: slate -> white -> black -> slate -> white. Same construction as
     productHTML(): a slate hero, the readable grid on white, one black proof
     block, the rules back on slate, a white close. The black band carries the
     verification split because that is the page's actual claim -- the honest
     4-of-6 is the proof, so it gets the one dark ground. */
  return `
  <section class="band alt" style="padding:64px 0 56px">
    <div class="shell">
      <div class="eyebrow" data-rev>Examples</div>
      <h1 style="margin-top:16px;max-width:18ch" data-rev>Six sample businesses in Chicago.</h1>
      <p class="lede" style="margin:16px 0 0;max-width:56ch;text-align:left" data-rev>${nProg} programmes,
        ${/* COUNTED, not asserted — the same rule as every other figure on this
             page. "Verification is pending across the roster" was stated flatly
             while four of the six operators had cleared their checks, so the
             sentence contradicted the badges rendered directly beneath it. */""}
        ${nSport} sports across ${nBiz} operators. ${nChecked === nBiz
          ? `All ${nBiz} have cleared background checks.`
          : nChecked === 0
            ? `Verification is pending across the roster.`
            : `${nChecked} of ${nBiz} have cleared background checks.`}</p>
    </div>
  </section>

  <section class="band">
    <div class="shell">
      <div data-rev>
        <h2>Every listing belongs to an operator</h2>
        <p class="co-sub">Open one to see its programmes and how each is booked.</p>
      </div>
      <div class="co-grid" data-rev>${cards}</div>
    </div>
  </section>

  <section class="band dark">
    <div class="shell">
      <div data-rev>
        <div class="eyebrow">Verification</div>
        <h2 style="margin-top:10px">${nChecked} of ${nBiz} have cleared.</h2>
        <p class="sub" style="margin-top:8px">Checks are held per person, never per business.
          The other ${nBiz - nChecked} stay listed, and stay unbadged.</p>
      </div>
      <div class="co-figs" data-rev>
        ${figs.map(([v, k]) => `<div class="co-fig"><span class="v">${esc(v)}</span><span class="k">${esc(k)}</span></div>`).join("")}
      </div>
    </div>
  </section>

  <section class="band alt">
    <div class="shell">
      <div class="eyebrow" data-rev>What the six prove</div>
      <div class="co-trows" data-rev>
        ${rows.map(([ic, t, d]) => `<div class="co-trow">
          <span class="ic" aria-hidden="true">${ic}</span>
          <div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")}
      </div>
    </div>
  </section>

  <section class="band finalcta">
    <div class="shell ctr">
      <h2 data-rev>Browse the whole catalogue</h2>
      <div class="ctarow" data-rev>
        <button class="btn" data-nav="explore">Find a coach</button>
        <button class="btn ghost" data-nav="map">See the map</button>
      </div>
    </div>
  </section>`;
}

/* — one company — */
function companyView(){
  const c = COMPANIES.filter(x => x.id === H().companyId)[0] || COMPANIES[0];
  const ps = progsOf(c), mix = mixOf(c), sports = sportsOf(c);
  const avg = ps.length ? (ps.reduce((a, p) => a + Number(p.rating || 0), 0) / ps.length).toFixed(1) : "—";
  const reviews = ps.reduce((a, p) => a + Number(p.reviews || 0), 0);

  const rows = ps.map(p => {
    const t = typeOf(p), im = imagesFor(p);
    return `<div class="co-row">
      <div class="co-thumb" style="aspect-ratio:${im.ratio}">${imgTag(im.hero, im.heroFallback, p.title)}</div>
      <div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="co-badge ${t}">${esc(TYPE[t].label)}</span>
          <span style="font-size:var(--text-sm);color:var(--faint);display:inline-flex;align-items:center;gap:6px">
            <i class="co-dot" style="background:${sc(p.sport)}"></i>${esc(p.sport)}</span>
        </div>
        <h3>${esc(p.title)}</h3>
        <div class="co-meta">Ages ${p.minAge}–${p.maxAge} · ${esc(p.skill)} · ${p.rating} ★ (${p.reviews})</div>
      </div>
      <div class="co-act">
        <div class="co-px">${usd(p.price)} <span>${t === "team" ? "/mo dues" : t === "camp" ? "/week" : "/session"}</span></div>
        <button class="btn ghost sm" data-cobook="${esc(p.id)}">${esc(TYPE[t].cta)}</button>
      </div>
    </div>`;
  }).join("");

  /* The offering axis, stated once on the dark ground before the listing rows
     use it. Only the types this operator actually runs are shown -- an empty
     "0 Camps" card would be a claim about a product they do not sell. */
  const axis = ["team","camp","private"].filter(t => mix[t]).map(t =>
    `<div class="prodcard" style="cursor:default">
      <span class="ic" aria-hidden="true">${pic(t === "team" ? "users" : t === "camp" ? "calendar" : "clock")}</span>
      <b>${esc(TYPE[t].label)} · ${mix[t]}</b>
      <span>${esc(TYPE[t].unit)}. ${esc(TYPE[t].verb)} to take one.</span>
    </div>`).join("");

  /* Rhythm: slate -> black -> white. The identity block leads on slate, the
     one dark band states how this operator sells, and the listing rows -- the
     readable, scannable content -- land on white where they belong. */
  return `
  <section class="band alt" style="padding:40px 0 56px">
    <div class="shell">
      <button class="btn ghost sm" data-nav="companies" style="margin-bottom:26px">← All businesses</button>
      <div class="co-hero" data-rev>
        <div>
          <h1>${esc(c.name)}</h1>
          <div style="margin-top:12px">${trustLine(c)}</div>
          <p class="co-bio">${esc(c.bio)}</p>
          <div class="co-facts">
            <div class="co-fact"><div class="k">Programmes</div><div class="v">${ps.length}</div></div>
            <div class="co-fact"><div class="k">Sports</div><div class="v">${sports.length}</div></div>
            <div class="co-fact"><div class="k">Coaches</div><div class="v">${c.coaches}</div></div>
            <div class="co-fact"><div class="k">Rating</div><div class="v">${avg}</div></div>
            <div class="co-fact"><div class="k">Reviews</div><div class="v">${reviews}</div></div>
            <div class="co-fact"><div class="k">Since</div><div class="v">${c.founded}</div></div>
          </div>
          ${c.verified ? "" : `<div class="co-note"><b>Verification pending.</b>
            No coach here carries a trust badge until their own check clears.</div>`}
        </div>
        <div class="co-heroshot">${imgTag(ASSET.company(c.id, "hero"), shot(c.seed + "-hero", 900, 700), c.name)}</div>
      </div>
    </div>
  </section>

  <section class="band dark">
    <div class="shell">
      <div data-rev>
        <div class="eyebrow">How they sell</div>
        <h2 style="margin-top:10px">Three things to book.</h2>
        <p class="sub" style="margin-top:8px">A roster spot, a camp week and a coach's hour
          price and cancel differently.</p>
      </div>
      <div class="prodgrid" data-rev style="margin-top:30px">${axis}</div>
    </div>
  </section>

  <section class="band">
    <div class="shell">
      <div data-rev>
        <h2>Everything they run</h2>
        <p class="co-sub">${ps.length} programmes, each priced the way its type is sold.</p>
      </div>
      <div class="co-list" data-rev>${rows}</div>
    </div>
  </section>`;
}

/* ═══════════════════ BOOKING SHEET ═══════════════════
   Called with no args by the host's modalHTML(); returns its own scrim.
   One entry point, three genuinely different flows. */
function bookModal(){
  const m = H().modal || {};
  const p = CAT().filter(x => x.id === m.pid)[0];
  if(!p) return "";
  const t = typeOf(p);
  const body = t === "camp" ? campSheet(p, m) : t === "team" ? teamSheet(p, m) : privateSheet(p, m);

  return `<div class="scrim" data-scrim="1"><div class="modal co-sheet" role="dialog" aria-modal="true"
      aria-label="${esc(TYPE[t].cta)} — ${esc(p.title)}">
    <div class="modal-head">
      <b>${esc(p.title)}</b>
      <button class="x" data-close="1" aria-label="Close">${(typeof ICON !== "undefined" && ICON.x) || "✕"}</button>
    </div>
    <div class="co-kick">
      <span class="co-badge ${t}">${esc(TYPE[t].label)}</span>
      <span class="co-unit">${esc(TYPE[t].unit)}</span>
    </div>
    <div class="modal-body">${body}</div>
  </div></div>`;
}

const fg = (title, count, inner) => `<div class="co-fg">
  <div class="co-fgh"><b>${title}</b>${count ? `<span class="co-ct">${count}</span>` : ""}</div>${inner}</div>`;

/* — PRIVATE: the calendar is the page — */
function privateSheet(p, m){
  const q = quote("private", p, m), meta = q.meta;
  const dur = q.dur, pack = q.pack, unit = q.unit, total = q.total;
  const a = pickAthlete(p, m);

  return `
  ${fg("Session length", "4 options", `<div class="co-opts">
    ${meta.durations.map(([mins]) => `<button class="co-opt ${dur === mins ? "on" : ""}" data-codur="${mins}">${mins} min</button>`).join("")}
  </div>`)}

  ${fg("Pick a time", meta.days.length + " days open", `
    <div class="co-opts" style="margin-bottom:10px">
      ${meta.days.map(d => `<button class="co-opt ${(m.day || "Tue") === d ? "on" : ""}" data-coday="${esc(d)}">${esc(d)}</button>`).join("")}
    </div>
    <div class="co-slots">
      ${meta.times.map(tm => `<button class="co-opt ${m.slot === tm ? "on" : ""}" data-coslot="${esc(tm)}">${esc(tm)}</button>`).join("")}
    </div>
    <div class="co-note plain">Bookable from ${meta.leadHours} hours out. Slots hold for 10 minutes once selected.</div>`)}

  ${fg("Where", "3 modes", `<div class="co-opts">
    <button class="co-opt ${!m.travel ? "on" : ""}" data-cotravel="0">At their facility</button>
    <button class="co-opt ${m.travel ? "on" : ""}" data-cotravel="1">They travel to you${meta.travelFee ? ` · +${usd(meta.travelFee)}` : ""}</button>
  </div>`)}

  ${fg("Buy more than one", "2 packages", `<div class="co-opts">
    <button class="co-opt ${pack === 1 ? "on" : ""}" data-copack="1">Single session</button>
    ${meta.packages.map(([n, mu]) => `<button class="co-opt ${pack === n ? "on" : ""}" data-copack="${n}">${n}-pack · ${Math.round((1 - mu) * 100)}% off</button>`).join("")}
  </div>`)}

  ${athleteBlock(p, m)}

  <div class="co-note">Free cancellation up to ${meta.cancelHours} hours before. Inside that window
    the session is charged in full — the coach has held the slot.</div>

  <div class="co-foot">
    <div class="co-tot">
      <div class="k">Total</div>
      <div class="v">${usd(total)}</div>
      <div class="d">${pack > 1 ? `${pack} sessions · ${usd(unit)} each` : `${dur} min · charged now`}</div>
    </div>
    <button class="btn" data-coconfirm="private" ${a.fits ? "" : "disabled"}>${esc(TYPE.private.cta)}</button>
  </div>`;
}

/* — CAMP: which week, how many seats, what happens if we pull out — */
function campSheet(p, m){
  const q = quote("camp", p, m), meta = q.meta, sel = q.session;
  const care = m.care || {};
  const total = q.total, deposit = q.due;
  const a = pickAthlete(p, m);

  return `
  ${fg("Which week", meta.sessions.length + " sessions", `<div class="co-sess">
    ${meta.sessions.map(s => {
      const out = s.seats <= 0, low = s.seats > 0 && s.seats <= 3;
      return `<button class="co-sesrow ${sel.id === s.id ? "on" : ""}" data-coses="${esc(s.id)}" ${out ? "disabled" : ""}>
        <span>
          <span class="co-dt">${fmt(s.start)} – ${fmt(s.end)}</span>
          ${s.earlyBird ? `<span class="co-eb" style="margin-left:8px">Early bird · 10% off</span>` : ""}
          <span style="display:block;color:var(--faint);font-size:var(--text-sm);margin-top:2px">Mon–Fri · ${meta.daily[0][0]}–${meta.daily[meta.daily.length - 1][0]}</span>
        </span>
        <span class="co-seats ${out ? "out" : low ? "low" : ""}">${out ? "Waitlist" : s.seats + " of " + s.cap + " left"}</span>
      </button>`;
    }).join("")}
  </div>`)}

  ${fg("A day at this camp", meta.daily.length + " blocks", `<div class="co-sched">
    ${meta.daily.map(([tm, what]) => `<div class="co-schedrow"><span class="t">${esc(tm)}</span><span>${esc(what)}</span></div>`).join("")}
  </div>
  <div class="co-note plain">Supervision is <b>${esc(meta.ratio)}</b>. Every staff member on site must clear their own background check.</div>`)}

  ${fg("Extended care", "2 add-ons", `<div class="co-opts">
    <button class="co-opt ${care.before ? "on" : ""}" data-cocare="before">Before care from ${esc(meta.beforeCare.from)} · +${usd(meta.beforeCare.fee)}</button>
    <button class="co-opt ${care.after ? "on" : ""}" data-cocare="after">After care to ${esc(meta.afterCare.to)} · +${usd(meta.afterCare.fee)}</button>
  </div>`)}

  ${fg("Drop-off, pickup &amp; what to bring", "8 fields", `
    <ul class="co-ul">${meta.bring.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
    <div class="co-note plain" style="margin-top:12px"><b>Lunch.</b> ${esc(meta.lunch)}</div>
    <div class="co-checks" style="margin-top:14px">
      <label class="co-check"><input type="checkbox" data-cock="1">
        <span>I have listed everyone authorised to collect my child</span></label>
      <label class="co-check"><input type="checkbox" data-cock="1">
        <span>Medical form, allergies and any medication authorisation are complete</span></label>
    </div>
    <div class="co-note" style="margin-top:12px"><b>Weather.</b> ${esc(meta.weather)}</div>`)}

  ${athleteBlock(p, m)}

  ${fg("If you need to cancel", "dated", `<table class="co-tbl">
    <thead><tr><th>Window</th><th>Dates</th><th>Refund</th></tr></thead>
    <tbody>${refundRows(sel).map(r => `<tr><td>${esc(r[0])}</td><td style="color:var(--muted)">${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join("")}</tbody>
  </table>
  <div class="co-note">This schedule is snapshotted at purchase. If the operator changes their policy later,
    yours does not move.</div>`)}

  <div class="co-foot">
    <div class="co-tot">
      <div class="k">Due today</div>
      <div class="v">${usd(deposit)}</div>
      <div class="d">${usd(total)} total · balance ${usd(total - deposit)} by ${fmt(shift(sel.start, -21))}</div>
    </div>
    <button class="btn" data-coconfirm="camp" ${sel.seats <= 0 || !a.fits ? "disabled" : ""}>${sel.seats <= 0 ? "Join waitlist" : esc(TYPE.camp.cta)}</button>
  </div>`;
}

/* — TEAM: not a booking. A tryout registration. — */
function teamSheet(p, m){
  const q = quote("team", p, m), meta = q.meta, total = q.total;
  const tryout = m.tryout || meta.tryouts[0].date;
  const a = pickAthlete(p, m);

  return `
  <div class="co-note plain"><b>This is an application, not a purchase.</b>
    You are registering for a tryout. ${esc(p.biz)} evaluates the athlete and announces
    the roster on ${fmtY(meta.rosterAnnounced)}. Nothing beyond the tryout fee is charged unless a spot is offered.</div>

  ${fg("The programme", "8 fields", `<table class="co-tbl"><tbody>
    <tr><td>Tier</td><td>${esc(meta.tier)}</td></tr>
    <tr><td>League</td><td>${esc(meta.league)}</td></tr>
    <tr><td>Season</td><td>${fmt(meta.seasonStart)} – ${fmtY(meta.seasonEnd)}</td></tr>
    <tr><td>Training</td><td>${meta.practicesPerWeek}× weekly · ${esc(meta.practiceDays)}</td></tr>
    <tr><td>Fixtures</td><td>${meta.games} games · ${meta.tournaments} tournaments</td></tr>
    <tr><td>Travel</td><td>${esc(meta.travelScope)}</td></tr>
    <tr><td>Roster</td><td>${meta.spots} of ${meta.rosterSize} spots open${meta.positions.length ? " · recruiting " + esc(meta.positions.join(", ").toLowerCase()) : ""}</td></tr>
    <tr><td>Playing time</td><td>${esc(meta.playingTime)}</td></tr>
  </tbody></table>`)}

  ${fg("Pick a tryout", meta.tryouts.length + " dates", `<div class="co-opts">
    ${meta.tryouts.map(t => `<button class="co-opt ${tryout === t.date ? "on" : ""}" data-cotry="${esc(t.date)}">${fmt(t.date)} · ${esc(t.time)}</button>`).join("")}
  </div>
  <div class="co-note">Registration closes ${fmtY(meta.tryoutDeadline)}. Tryout fee ${usd(meta.tryoutFee)},
    charged now and non-refundable — it covers the evaluation session itself.</div>`)}

  ${fg("What a season actually costs", meta.costs.length + " lines", `
    <table class="co-tbl">
      <tbody>
        ${meta.costs.map(([k, v, why]) => `<tr><td>${esc(k)}<span class="co-why">${esc(why)}</span></td><td>${usd(v)}</td></tr>`).join("")}
        <tr class="co-tot"><td>All-in, per athlete</td><td>${usd(total)}</td></tr>
      </tbody>
    </table>
    <div class="co-note"><b>The advertised figure is the dues line only.</b> Sporv shows the whole number
      because kit, tournaments and travel land on you regardless.${meta.aid ? " Financial aid is available — ask before tryouts, not after." : ""}</div>`)}

  ${athleteBlock(p, m)}

  ${fg("Commitment", "4 fields", `<div class="co-checks">
    <label class="co-check"><input type="checkbox" data-cock="1">
      <span>We can meet ${meta.practicesPerWeek} sessions a week from ${fmt(meta.seasonStart)} to ${fmt(meta.seasonEnd)}</span></label>
    <label class="co-check"><input type="checkbox" data-cock="1">
      <span>I understand a mid-season withdrawal is non-refundable under the commitment contract</span></label>
    <label class="co-check"><input type="checkbox" data-cock="1">
      <span>I have read the player and parent code of conduct</span></label>
    <label class="co-check"><input type="checkbox">
      <span>Medical clearance and insurance details are on file</span></label>
  </div>`)}

  <div class="co-foot">
    <div class="co-tot">
      <div class="k">Charged today</div>
      <div class="v">${usd(meta.tryoutFee)}</div>
      <div class="d">Tryout only · ${usd(total)} season cost applies if selected</div>
    </div>
    <button class="btn" data-coconfirm="team" ${a.fits ? "" : "disabled"}>${esc(TYPE.team.cta)}</button>
  </div>`;
}

/* ═══════════════════ WIRE ═══════════════════
   Called by the host on every render, inside a try/catch. Everything here
   is defensive: if an anchor the host owns has moved, we bail rather than
   throw. Nothing in the host file is modified. */
function wire(){
  const h = H();

  /* offering-type rail, injected into explore the way MOD_SEARCH injects
     its toolbar — no host edit, and it self-heals if the anchor moves. */
  injectRail();

  /* Real asset first, placeholder underneath. Wired here rather than as an
     inline onerror, which a strict script-src would block. The complete/
     naturalWidth check catches images that already failed before this ran. */
  $$("img[data-cofb]").forEach(im => {
    const fb = im.dataset.cofb;
    if(!fb) return;
    const swap = () => { im.onerror = null; im.removeAttribute("data-cofb"); im.src = fb; };
    im.onerror = swap;
    if(im.complete && im.naturalWidth === 0) swap();
  });

  $$("[data-cotype]").forEach(b => b.onclick = () => {
    h.coType = b.dataset.cotype === h.coType ? null : b.dataset.cotype;
    render();
  });
  /* The rail is injected AFTER the host has wired [data-nav], so its own
     nav button would otherwise be dead. Wire it here. */
  $$("#coRail [data-nav]").forEach(b => b.onclick = () => {
    h.route = { name:b.dataset.nav, arg:null };
    window.scrollTo(0, 0);
    render();
  });
  $$("[data-company]").forEach(b => b.onclick = () => {
    h.companyId = b.dataset.company;
    h.route = { name:"company", arg:null };
    window.scrollTo(0, 0);
    render();
  });
  $$("[data-cobook]").forEach(b => b.onclick = () => {
    const id = b.dataset.cobook;
    const open = () => { h.modal = { type:"cobook", pid:id }; render(); };
    (typeof requireAuth === "function") ? requireAuth(open) : open();
  });

  /* sheet controls — each repaints through the host's render() */
  const set = (k, v) => { h.modal = Object.assign({}, h.modal, { [k]:v }); render(); };
  $$("[data-codur]").forEach(b => b.onclick = () => set("dur", Number(b.dataset.codur)));
  $$("[data-coday]").forEach(b => b.onclick = () => set("day", b.dataset.coday));
  $$("[data-coslot]").forEach(b => b.onclick = () => set("slot", b.dataset.coslot));
  $$("[data-copack]").forEach(b => b.onclick = () => set("pack", Number(b.dataset.copack)));
  $$("[data-cotravel]").forEach(b => b.onclick = () => set("travel", b.dataset.cotravel === "1"));
  $$("[data-coses]").forEach(b => b.onclick = () => set("ses", b.dataset.coses));
  $$("[data-cotry]").forEach(b => b.onclick = () => set("tryout", b.dataset.cotry));
  $$("[data-cocare]").forEach(b => b.onclick = () => {
    const cur = (h.modal && h.modal.care) || {};
    const k = b.dataset.cocare;
    set("care", Object.assign({}, cur, { [k]: !cur[k] }));
  });

  $$("[data-coath]").forEach(b => b.onclick = () => set("athlete", b.dataset.coath));

  $$("[data-coconfirm]").forEach(b => b.onclick = () => {
    const kind = b.dataset.coconfirm;
    const m = h.modal || {};
    const p = CAT().filter(x => x.id === m.pid)[0];
    if(!p) return;

    const sheet = b.closest(".modal");
    const missing = sheet && Array.prototype.slice.call(sheet.querySelectorAll('[data-cock="1"]'))
      .filter(c => !c.checked).length;
    if(missing){
      if(typeof toast === "function") toast("Please confirm the required items first");
      return;
    }
    const a = pickAthlete(p, m);
    if(!a.fits){
      if(typeof toast === "function") toast("That athlete is outside this listing's age range");
      return;
    }

    /* write the record BEFORE reporting it — the toast describes what the
       ledger now says, not what we hoped it would say */
    const rec = commit(kind, p, m);
    h.modal = null;
    render();

    if(typeof toast === "function"){
      toast(kind === "team"
          ? `Tryout registered for ${fmt(rec.tryoutDate)} · sample flow, nothing charged`
          : kind === "camp"
          ? `Seat reserved · ${usd(rec.price)} deposit${rec.balanceCents ? ` · ${usd(rec.balanceCents / 100)} due by ${fmt(rec.balanceDueBy)}` : ""}`
          : `Session booked · sample flow, nothing charged`);
    }
  });
}

function injectRail(){
  const h = H();
  if(h.route && h.route.name !== "explore") return;
  if(document.getElementById("coRail")) return;
  const grid = document.querySelector(".grid");
  if(!grid || !grid.parentElement) return;

  const counts = { private:0, camp:0, team:0 };
  CAT().forEach(p => { if(counts[typeOf(p)] != null) counts[typeOf(p)]++; });

  const rail = document.createElement("div");
  rail.id = "coRail";
  rail.className = "co-rail";
  rail.innerHTML = `<span class="co-lbl">What kind</span>
    ${["private","camp","team"].map(t => `<button class="co-tpill ${h.coType === t ? "on" : ""}" data-cotype="${t}">
      ${esc(TYPE[t].label)} <span class="co-n">${counts[t]}</span></button>`).join("")}
    <button class="co-tpill" data-nav="companies" style="margin-left:auto">Browse by business →</button>`;
  grid.parentElement.insertBefore(rail, grid);

  /* Filter the already-rendered grid rather than fighting the host's own
     visiblePrograms() — same approach MOD_SEARCH takes for sorting. */
  if(h.coType){
    Array.prototype.slice.call(grid.querySelectorAll(".card")).forEach(card => {
      const open = card.querySelector("[data-open]");
      const p = open && CAT().filter(x => x.id === open.dataset.open)[0];
      if(p && typeOf(p) !== h.coType) card.style.display = "none";
    });
  }
}

/* ═══════════════════ export ═══════════════════ */
window.MOD_COMPANIES = {
  css:CSS,
  views:{ companies:companiesView, company:companyView },
  modals:{ cobook:bookModal },
  wire:wire,
  state:{ companyId:null, coType:null },
  /* read by anything that needs the missing axis */
  typeOf:typeOf,
  imagesFor:imagesFor,
  OFFERING:OFFERING,
  /* booking internals, exposed so other modules (and tests) can reason about
     offering-type bookings without duplicating the pricing rules */
  quote:quote,
  commit:commit,
  pickAthlete:pickAthlete,
};

})();
