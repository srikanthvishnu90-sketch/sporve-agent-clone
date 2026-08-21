"use strict";
/* ═══════════════════════════════════════════════════════════════════
   MOD_REVIEWS — reviews, athlete progress timeline, and goal→plan.
   Additive module for sporve-web.html. Defines exactly one global,
   window.MOD_REVIEWS, and never redefines a host symbol. It reads the
   host globals (S, PROGRAMS, esc, money, fmtDate, ageOf, isVerified,
   requireAuth, render, toast, sportColor, sportGlyph, ICON) and stores
   its own data on S.reviews / S.goals.
   ═══════════════════════════════════════════════════════════════════ */
(function(){

/* The app's "now" — de-pinned (WF-5). This module's data hydrates real (#193),
   so relative dates, goal-target validation, and new review/goal timestamps must
   run against the real date, not a frozen Aug-3. Local-date ISO (not UTC) so a
   near-midnight comparison never slips a day. */
const TODAY=(d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`)(new Date());

/* ── small date helpers (no library, no network) ─────────────────── */
const parseISO=d=>{const[y,m,dd]=String(d).split("-").map(Number);return new Date(y,m-1,dd);};
const toISO=dt=>`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
const addDays=(d,n)=>{const t=parseISO(d);t.setDate(t.getDate()+n);return toISO(t);};
const daysBetween=(a,b)=>Math.round((parseISO(b)-parseISO(a))/86400000);
const weeksBetween=(a,b)=>Math.max(0,Math.ceil(daysBetween(a,b)/7));

/* ═══════════════════ SEED: reviews ═══════════════════
   Parents writing about youth athletes, against real listing ids. */
const REVIEWS=[
  {id:"rev_1",programId:"prog_1",author:"Priya N.",initials:"PN",rating:5,date:"2026-05-12",verifiedBooking:true,
   body:"Three weeks in and my son finally stopped panicking when a defender closes him down. Coach Marcus runs a two-touch rondo that has translated straight into his Saturday games. Sessions start on time and end with a two-minute talk about what went well."},
  {id:"rev_2",programId:"prog_1",author:"Dan R.",initials:"DR",rating:4,date:"2026-06-02",verifiedBooking:true,
   body:"The passing patterns are genuinely well built and my daughter's weak foot is no longer a liability. Only knock is group size — with fifteen kids on one pitch, shooting days turn into a lot of standing in line."},
  {id:"rev_3",programId:"prog_2",author:"Melissa K.",initials:"MK",rating:5,date:"2026-04-28",verifiedBooking:true,
   body:"Coach Dana rebuilt my eleven-year-old's serve starting from the toss, which took about a month of frustration and then clicked all at once. He now double-faults maybe twice a set instead of twice a game."},
  {id:"rev_4",programId:"prog_3",author:"Andre W.",initials:"AW",rating:5,date:"2026-06-18",verifiedBooking:true,
   body:"Two things changed in six weeks: his handle going left, and his willingness to shoot from the elbow instead of driving into traffic every time. They film one possession per session and walk through the read afterward — that part alone is worth the price."},
  {id:"rev_5",programId:"prog_3",author:"Carmen O.",initials:"CO",rating:3,date:"2026-07-02",verifiedBooking:false,
   body:"The skill work is real, but \"U14\" is doing a lot of heavy lifting here. My eleven-year-old was the youngest by two years and spent most of the scrimmage block watching from the baseline. Great fit for older kids, early for ours."},
  {id:"rev_6",programId:"prog_5",author:"Nina B.",initials:"NB",rating:5,date:"2026-05-20",verifiedBooking:true,
   body:"In March my daughter would not put her face in the water. Yesterday she swam the width of the pool with no hands on her. They keep the groups tiny and nobody ever pushed her under before she was ready — that patience is the whole reason it worked."},
  {id:"rev_7",programId:"prog_6",author:"Owen T.",initials:"OT",rating:5,date:"2026-06-09",verifiedBooking:true,
   body:"Race-pace sets are no joke and he comes home genuinely tired. He took four seconds off his 100 free across the season, and the stroke-count work finally killed the long glide he'd been coasting on. Bring a second towel and food for the car."},
  {id:"rev_8",programId:"prog_9",author:"Rachel M.",initials:"RM",rating:4,date:"2026-07-14",verifiedBooking:true,
   body:"A full ocean-safety morning before anyone touched a board — as a parent, that sold me. Both kids were standing up by day three. Half a star off only because parking anywhere near the break is its own small ordeal."},
  {id:"rev_9",programId:"prog_11",author:"Terrence H.",initials:"TH",rating:5,date:"2026-06-25",verifiedBooking:true,
   body:"The ladder and cone work looked tedious to me until I watched him change direction in a live game without losing the ball. Small group, high reps, and the coach actually corrects the rep instead of just counting it."},
  {id:"rev_10",programId:"prog_11",author:"Yvette S.",initials:"YS",rating:4,date:"2026-07-21",verifiedBooking:true,
   body:"Excellent if your teen already plays organized ball. If they're new, start somewhere gentler first — the pace assumes you can already dribble comfortably with both hands on day one."},
  {id:"rev_11",programId:"prog_12",author:"Sofia L.",initials:"SL",rating:5,date:"2026-05-30",verifiedBooking:true,
   body:"Close to a perfect first basketball experience for a seven-year-old. Forty-five minutes of games that are quietly drills, and no child ever stands in a line waiting for a turn. He asks about it every day of the week."},
  {id:"rev_12",programId:"prog_13",author:"Greg D.",initials:"GD",rating:4,date:"2026-06-13",verifiedBooking:true,
   body:"We came for soccer speed and got a proper sprint-mechanics lesson: arm action, shin angle, ground contact. My only wish is fifteen more minutes — the plyometric block always feels rushed at the end."},
  {id:"rev_13",programId:"prog_16",author:"Hannah P.",initials:"HP",rating:4,date:"2026-04-19",verifiedBooking:false,
   body:"Tournament-level coaching on point construction, and my son's second serve is finally a weapon instead of an apology. Noting honestly that the club's background check was still showing as pending when we started — I'd want that cleared before we book another block."},
  {id:"rev_14",programId:"prog_17",author:"Bill A.",initials:"BA",rating:5,date:"2026-07-06",verifiedBooking:true,
   body:"Signed up alongside my twelve-year-old expecting to be bored and left sore and thoroughly outplayed. The third-shot drop instruction was the clearest I've had, and mixing ages genuinely works in this sport."},
  {id:"rev_15",programId:"prog_21",author:"Denise F.",initials:"DF",rating:5,date:"2026-05-08",verifiedBooking:true,
   body:"Non-contact was the entire reason we tried it and they hold that line strictly — pads and bags only, no sparring, no exceptions. What I did not expect was the discipline carrying over into how she sits down to homework."},
  {id:"rev_16",programId:"prog_24",author:"Ken I.",initials:"KI",rating:5,date:"2026-06-30",verifiedBooking:true,
   body:"Third child through this dojo. Kata is taught slowly and correctly, belt tests are earned rather than handed out at the end of a term, and mixed-age classes mean the older belts learn to teach."},
  {id:"rev_17",programId:"prog_26",author:"Lauren V.",initials:"LV",rating:3,date:"2026-07-11",verifiedBooking:true,
   body:"Fielding instruction was strong, footwork around the bag especially. Hitting was mostly tee work rotating eighteen kids, so he got maybe a dozen live swings a day. Good value for the price, but manage your expectations on reps."},
  {id:"rev_18",programId:"prog_23",author:"Paul E.",initials:"PE",rating:2,date:"2026-07-25",verifiedBooking:false,
   body:"Supervision was careful and I never worried about safety. But the intro session was almost entirely conditioning — my fourteen-year-old came for technique and got burpees. We didn't rebook."},
];

/* ═══════════════════ SEED: goals ═══════════════════ */
const GOALS=[
  {id:"goal_1",athleteId:"athlete_1",outcome:"Make the middle-school basketball team at spring tryouts",
   sport:"Basketball",target:"2027-03-12",weekly:2,createdAt:"2026-08-01"},
];

/* pricing-model wording (local copy — the host's modelLabel is not part
   of the module contract, so this module carries its own) */
const MODEL_LABEL={single_session:"per session",monthly:"per month",package:"per package",seasonal:"per season"};

/* ═══════════════════ Sport-specific focus areas ═══════════════════
   [Foundation, Build, Compete] — used for plans and for milestones. */
const FOCUS={
  Soccer:[["First touch under pressure","Both-foot passing range","Aerobic base"],
          ["1v1 dribbling in tight space","Receiving on the half-turn","Finishing from the top of the box"],
          ["Small-sided decision speed","Set-piece roles","Match-week recovery"]],
  Basketball:[["Two-ball handling","Shooting form from the block","Defensive stance and slides"],
              ["Pull-up off one dribble","Finishing with the off hand","Reading the on-ball screen"],
              ["Live-scrimmage shot selection","Closeout and rotation habits","Free throws under fatigue"]],
  Tennis:[["Split-step timing","Consistent toss and serve rhythm","Forehand depth over power"],
          ["Second-serve kick","Backhand down the line","Recovery footwork after each ball"],
          ["Point construction patterns","Tiebreak routines","Between-point reset"]],
  Volleyball:[["Platform angle on the pass","Approach footwork","Overhead setting shape"],
              ["Hitting line versus angle","Serve-receive seams","Block timing at the net"],
              ["Rotation responsibilities","Serving to a zone under pressure","Free-ball transition"]],
  Swimming:[["Streamline off every wall","Body line and head position","Bilateral breathing"],
            ["Stroke count per length","Flip-turn timing","Aerobic threshold sets"],
            ["Race-pace 25s","Start and first breakout","Split control across the race"]],
  Diving:[["Board bounce and hurdle rhythm","Core line in the air","Safe entry position"],
          ["Consistent takeoff height","Tuck and pike shape","Spotting the water"],
          ["Full list under judging conditions","Pre-dive routine","Repeat scores on demand"]],
  "Water Polo":[["Eggbeater endurance","One-hand ball control","Head-up swimming"],
                ["Shooting from the perimeter","Wet passing accuracy","Drawing an exclusion"],
                ["6-on-5 assignments","Counterattack lanes","Fourth-quarter conditioning"]],
  Surfing:[["Paddle strength and positioning","Pop-up mechanics on land","Ocean and rip awareness"],
           ["Reading the peak","Bottom turn","Riding along the face"],
           ["Wave selection in a crowd","Linking two turns","Session stamina"]],
  "Track & Field":[["Sprint posture and arm action","Acceleration mechanics","General strength base"],
                   ["Top-speed maintenance","Block starts","Plyometric power"],
                   ["Race-model rehearsal","Warm-up routine on meet day","Peaking and taper"]],
  Dance:[["Alignment and core control","Counting music accurately","Movement vocabulary"],
         ["Combination retention","Dynamics and texture","Turning technique"],
         ["Full-piece stamina","Performance projection","Spacing with a group"]],
  Pickleball:[["Ready position and paddle face","Dinking control","Serve and return depth"],
              ["Third-shot drop","Transition-zone footwork","Resets off a hard drive"],
              ["Stacking and partner signals","Point patterns to 11","Handling a speed-up"]],
  Badminton:[["Grip changes","Base position recovery","Clear length"],
             ["Net shots and lifts","Jump-smash mechanics","Shadow footwork speed"],
             ["Rally construction","Serve variation","Three-set conditioning"]],
  Squash:[["Racquet preparation","Length to the back corners","Movement to the T"],
          ["Boast and drop combinations","Volleying early","Reading the opponent's shape"],
          ["Rally patience under pressure","Match-length fitness","Between-game routine"]],
  "Table Tennis":[["Consistent forehand drive","Bat angle control","Ready stance and recovery"],
                  ["Topspin loop off backspin","Push and flick variation","Serve spin disguise"],
                  ["Third-ball attack","Receiving heavy spin","Match tempo control"]],
  Boxing:[["Stance and guard","Straight punches on the pads","Rope and footwork conditioning"],
          ["Combinations with head movement","Distance management","Body-shot mechanics"],
          ["Controlled technical rounds","Ring positioning","Breathing and pacing"]],
  Wrestling:[["Stance and motion","Level change and penetration step","Neck and grip strength"],
             ["Finishing the double and single","Escapes and stand-ups","Mat awareness on top"],
             ["Live-go scrambling","Weight management done safely","Six-minute conditioning"]],
  "Martial Arts":[["Guard and base","Fundamental strikes","Mobility and falling safely"],
                  ["Combination striking","Takedown entries","Positional control on the ground"],
                  ["Controlled sparring rounds","Transitions between ranges","Composure under fatigue"]],
  Karate:[["Kihon basics","Stance depth and balance","Dojo etiquette and focus"],
          ["Kata sequence and timing","Kumite distance","Hip rotation for power"],
          ["Kata under grading conditions","Point-scoring exchanges","Belt-test readiness"]],
  Judo:[["Ukemi breakfalls","Grip fighting basics","Kuzushi and off-balancing"],
        ["Two reliable throws","Turnovers into hold-downs","Transition to newaza"],
        ["Randori against varied grips","Combination attacks","Five-minute match pace"]],
  Baseball:[["Balanced setup and load","Glove work and footwork","Throwing mechanics"],
            ["Barrel path through the zone","Reading hops off the bat","Baserunning leads"],
            ["Live at-bats against pitching","Situational defense","In-game routine"]],
  Softball:[["Pitching arm circle","Fielding ready position","Balanced swing base"],
            ["Change-up and movement pitch","Slap-hitting footwork","Infield double-play feeds"],
            ["Full-inning pitch counts","Hitting with runners on","Bullpen-to-game routine"]],
  Football:[["Route stems and cuts","Backpedal and hip flip","Catching away from the body"],
            ["Zone versus man recognition","Flag-pulling angles","Change-of-direction speed"],
            ["Full-speed 7-on-7 reps","Play-call communication","Endurance across a game"]],
  Lacrosse:[["Cradling both hands","Catching and throwing on the move","Ground-ball scoops"],
            ["Dodging from X and up top","Shooting on the run","Off-ball movement"],
            ["Clearing under pressure","Man-up sets","Full-field conditioning"]],
  Cricket:[["Batting stance and grip","Forward and back defense","Basic seam bowling action"],
           ["Driving and pulling off the front foot","Line and length consistency","Catching in the ring"],
           ["Building an innings","Bowling in spells","Match-day fielding intensity"]],
};
const FOCUS_DEFAULT=[
  ["Movement fundamentals and warm-up habit","Core strength and mobility","Consistent weekly attendance"],
  ["Sport-specific technique reps","Decision speed under fatigue","Position-relevant conditioning"],
  ["Competitive scenarios at game pace","Pre-event routine","Recovery and self-assessment"],
];
const focusFor=s=>FOCUS[s]||FOCUS_DEFAULT;

/* ═══════════════════ state plumbing ═══════════════════ */
function ensure(){
  if(typeof S==="undefined") return;
  if(!Array.isArray(S.reviews)) S.reviews=REVIEWS.map(r=>({...r}));
  if(!Array.isArray(S.goals))   S.goals=GOALS.map(g=>({...g}));
}
const allReviews=()=>{ensure();return (typeof S!=="undefined"&&Array.isArray(S.reviews))?S.reviews:REVIEWS;};
const allGoals=()=>{ensure();return (typeof S!=="undefined"&&Array.isArray(S.goals))?S.goals:GOALS;};
/* Seeded reviews carry seeded program ids, so this must still resolve after
   mod-catalog.js swaps PROGRAMS for live rows — see mod-coachops.js. */
const prog=id=>PROGRAMS.find(p=>p.id===id)||DEMO_CATALOGUE.find(p=>p.id===id);

const initialsOf=name=>String(name).trim().split(/\s+/).map(w=>w[0]||"").slice(0,2).join("").toUpperCase();
const authorName=u=>u?`${u.firstName} ${u.lastName?u.lastName[0]+".":""}`.trim():"You";
const athleteLabel=a=>`${a.firstName} ${a.lastName||""}`.trim();

/* the host's family tab rail, when this module's view is routed as a tab */
function nav(){
  return (typeof subnavHTML==="function"&&typeof S!=="undefined"&&S.portal!=="coach")?subnavHTML():"";
}

/* ═══════════════════ shared bits ═══════════════════ */
function starRow(n,extra){
  const r=Math.round(n);
  return `<span class="rv-stars ${extra||""}" role="img" aria-label="${Number(n).toFixed(1)} out of 5 stars">`+
    [1,2,3,4,5].map(i=>`<span class="${i<=r?"":"off"}" aria-hidden="true">${ICON.star}</span>`).join("")+`</span>`;
}
function aggregate(list){
  const total=list.length;
  const sum=list.reduce((s,r)=>s+r.rating,0);
  const dist=[5,4,3,2,1].map(v=>({v,n:list.filter(r=>r.rating===v).length}));
  return {total,avg:total?sum/total:0,dist};
}
/* a completed booking is the only ticket to writing a review */
function completedBooking(pid){
  if(typeof S==="undefined") return null;
  return (S.bookings||[]).find(b=>b.programId===pid&&
    (b.status==="completed"||(b.status==="confirmed"&&b.date<=TODAY)))||null;
}
function eligibility(pid){
  ensure();
  if(!isVerified()) return {ok:false,why:"guest"};
  if(!completedBooking(pid)) return {ok:false,why:"nosession"};
  const me=authorName(S.auth.user);
  if(allReviews().some(r=>r.programId===pid&&r.author===me)) return {ok:false,why:"already"};
  return {ok:true};
}

/* ═══════════════════ 1 · reviews block ═══════════════════ */
function reviewsFor(programId){
  ensure();
  const p=prog(programId);
  if(!p) return "";
  const list=allReviews().filter(r=>r.programId===programId)
    .slice().sort((a,b)=>b.date.localeCompare(a.date));
  const {total,avg,dist}=aggregate(list);
  const el=eligibility(programId);
  const cta=
    el.ok
      ? `<button class="btn ghost sm" data-writereview="${esc(programId)}">Write a review</button>`
      : el.why==="guest"
        ? `<button class="btn ghost sm" data-signin="1">Log in to review</button>`
        : el.why==="already"
          ? `<span class="pill good">${ICON.check} You reviewed this</span>`
          : `<span class="pill slate">Attend a session to review</span>`;
  const why=
    el.ok?`You attended a session here — your review will carry a verified-booking mark.`
    :el.why==="guest"?`Only families with a completed booking on Sporv can review a program.`
    :el.why==="already"?`One review per family, per program. Message the coach for anything else.`
    :`Reviews open after your athlete has attended a session with ${esc(p.biz)}. It keeps the ratings worth reading.`;

  return `<section class="rv-wrap" aria-label="Reviews">
    <div class="sec-head" style="margin-bottom:0"><h2>Reviews</h2>${cta}</div>
    ${total?`
    <div class="rv-agg">
      <div>
        <div class="rv-score num">${avg.toFixed(1)}</div>
        ${starRow(avg)}
        <div class="num rv-sub">${total} review${total===1?"":"s"} · catalogue rating ${p.rating}</div>
      </div>
      <div class="rv-hist">
        ${dist.map(d=>`<div class="rv-hrow">
          <span class="num rv-hlbl">${d.v} star${d.v===1?"":"s"}</span>
          <span class="rv-track"><span class="rv-fill" style="width:${total?((d.n/total)*100).toFixed(1):0}%"></span></span>
          <span class="num rv-hn">${d.n}</span>
        </div>`).join("")}
      </div>
    </div>
    <div class="rv-list">
      ${list.map(r=>`<article class="rv-item">
        <span class="avatar rv-av" aria-hidden="true">${esc(r.initials)}</span>
        <div class="rv-body">
          <div class="rv-meta">
            <b>${esc(r.author)}</b>
            ${r.verifiedBooking?`<span class="pill good">${ICON.check} Verified booking</span>`:""}
            <span class="num rv-date">${fmtDate(r.date)}</span>
          </div>
          ${starRow(r.rating)}
          <p class="rv-text">${esc(r.body)}</p>
        </div>
      </article>`).join("")}
    </div>`
    :`<div class="rv-agg rv-agg-empty">
        <div><div class="rv-score num">—</div>${starRow(0)}
          <div class="num rv-sub">No written reviews yet</div></div>
        <p class="rv-none">This program carries a catalogue rating of ${p.rating} from ${p.reviews} historical ratings, but nobody has written a review on Sporv yet. Families who complete a session here can be the first.</p>
      </div>`}
    <p class="rv-note">${why}</p>
  </section>`;
}

/* ═══════════════════ 2 · write-a-review modal ═══════════════════ */
function wrap(title,body){
  return `<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><b>${esc(title)}</b><button class="x" data-close="1" aria-label="Close">${ICON.x}</button></div><div class="modal-body">${body}</div></div></div>`;
}
const RATING_WORD={1:"Poor",2:"Below expectations",3:"Fair",4:"Good",5:"Excellent"};

function reviewModal(){
  ensure();
  const m=(typeof S!=="undefined"&&S.modal)||{};
  const p=prog(m.programId);
  if(!p) return "";
  const el=eligibility(p.id);
  if(!el.ok) return wrap("Write a review",`
    <p class="rv-gate">${el.why==="guest"
      ?"Log in to your Sporv account first — reviews are tied to a completed booking."
      :el.why==="already"?"You've already reviewed this program."
      :`Your athlete hasn't attended a session with ${esc(p.biz)} yet. Reviews open once a booked session is complete.`}</p>
    <button class="btn wide" data-close="1">Close</button>`);
  const b=completedBooking(p.id);
  return wrap("Write a review",`
    <div class="rv-mhead">
      <img src="${p.img}" alt="" class="rv-mimg">
      <div><b>${esc(p.title)}</b>
        <div class="rv-sub">${esc(p.biz)} · <span style="color:${sportColor(p.sport)}">${sportGlyph(p.sport)} ${esc(p.sport)}</span></div>
        ${b?`<div class="num rv-sub">Attended ${fmtDate(b.date)} · ${esc(b.athlete)}</div>`:""}
      </div>
    </div>
    <form id="reviewForm" novalidate>
      <fieldset class="rv-fs">
        <legend>Your rating</legend>
        <div class="rv-pick">
          ${[5,4,3,2,1].map(v=>`
            <input type="radio" id="rvStar${v}" name="rating" value="${v}" required>
            <label for="rvStar${v}">${ICON.star}<span class="rv-sr">${v} star${v===1?"":"s"} — ${RATING_WORD[v]}</span></label>`).join("")}
        </div>
        <div class="rv-sub" id="rvWord" aria-live="polite">Choose 1 to 5 stars</div>
      </fieldset>
      <div class="field" style="margin-top:16px">
        <label for="rvBody">What should other families know?</label>
        <textarea id="rvBody" name="body" rows="6" minlength="20" maxlength="2000"
          placeholder="What did your athlete work on, and what changed? Concrete detail helps more than praise."></textarea>
        <div class="rv-count num" id="rvCount">0 / 2000 · 20 characters minimum</div>
      </div>
      <div id="rvErr" class="err hide" style="margin:2px 0 10px"></div>
      <button class="btn wide" type="submit">Post review</button>
      <p class="rv-fine">Posted as ${esc(authorName(S.auth.user))} with a verified-booking mark. Athlete names are never attached to a public review.</p>
    </form>`);
}

/* ═══════════════════ 3 · athlete progress timeline ═══════════════════ */
function sportOf(a){
  if(a.preferredSports&&a.preferredSports.length) return a.preferredSports[0];
  const b=(S.bookings||[]).find(x=>x.athlete===athleteLabel(a));
  const p=b&&prog(b.programId);
  return p?p.sport:null;
}
function milestonesFor(sport,anchor){
  const f=focusFor(sport);
  const s=sport||"training";
  return [
    {off:9,title:`Baseline assessment logged`,
     body:`Staff recorded a first read on where ${s.toLowerCase()} stands today: ${f[0][0].toLowerCase()} and ${f[0][1].toLowerCase()} came back as the two areas to build from.`,
     skills:[f[0][0],f[0][1]]},
    {off:31,title:`Technique held at game speed`,
     body:`${f[1][0]} carried out of drill work and into live reps without breaking down — the first real sign the pattern is sticking rather than being remembered.`,
     skills:[f[1][0],f[1][1]]},
    {off:58,title:`First competitive application`,
     body:`${f[2][0]} showed up unprompted in a scrimmage setting. The next block shifts toward ${f[2][1].toLowerCase()}.`,
     skills:[f[2][0],f[2][1]]},
  ].map(m=>({date:addDays(anchor,m.off),kind:"Milestone",title:m.title,body:m.body,skills:m.skills}));
}
function entriesFor(a){
  const name=athleteLabel(a);
  const out=[];
  (S.bookings||[]).filter(b=>b.athlete===name).forEach(b=>{
    const p=prog(b.programId);
    out.push({date:b.date,kind:"Session attended",title:b.program,
      body:`${b.session} at ${b.startTime}${p?` with ${p.biz}`:""} · ${b.tier} tier${p?` · ${p.skill} group, ages ${p.minAge}–${p.maxAge}`:""}.`,
      skills:[]});
  });
  const updates=(typeof SEED!=="undefined"&&SEED.parentUpdates)?SEED.parentUpdates:[];
  updates.filter(u=>u.childId===a.id).forEach(u=>{
    out.push({date:String(u.at).slice(0,10),kind:"Coach update",
      title:u.signal?u.signal.charAt(0).toUpperCase()+u.signal.slice(1):"Progress update",
      body:u.body,skills:u.skills||[],
      practice:(u.practice||[])[0]||"",encouragement:u.encouragement||""});
  });
  const anchor=out.length?out.map(e=>e.date).sort()[0]:"2026-05-01";
  milestonesFor(sportOf(a),anchor).forEach(m=>{if(m.date<=TODAY) out.push(m);});
  return out.sort((x,y)=>y.date.localeCompare(x.date));
}
function timelineView(){
  ensure();
  /* Was a bare sign-in wall. See guestPreviewHTML() in the host for why --
     this route is one click from the Product mega-menu, so it is a surface a
     visitor sees while deciding, not only after signing up. */
  if(!isVerified()&&typeof guestPreviewHTML==="function") return guestPreviewHTML({
    eyebrow:"Athlete progress",
    title:"What your kid actually did, session by session",
    lede:"Attendance, coach notes and milestones per athlete — written by the coach who ran the session, not summarised by a machine.",
    points:["A timeline per athlete, however many kids you have",
            "Coach notes arrive attached to the session they came from",
            "A child profile cannot exist without recorded parental consent"],
    frame:"Athlete progress"});
  const athletes=S.athletes||[];
  if(!athletes.length) return `${nav()}<main class="shell"><div class="empty">
    <h2>No athletes yet</h2>
    <p style="margin-top:8px">Add a child to start a progress timeline.</p>
    <button class="btn" data-addchild="1" style="margin-top:20px">Add a child</button></div></main>`;

  return `${nav()}<main class="shell" style="padding-bottom:72px">
    <div class="sec-head"><div><h1>Progress</h1>
      <p class="rv-sub">Every session, coach update, and milestone in one dated line per athlete.</p></div></div>
    <div class="rv-tlgrid">
    ${athletes.map(a=>{
      const sport=sportOf(a);
      const sc=sport?sportColor(sport):"var(--slate)";
      const ents=entriesFor(a);
      const sessions=ents.filter(e=>e.kind==="Session attended").length;
      const skills=[...new Set(ents.flatMap(e=>e.skills||[]))].slice(0,7);
      return `<section class="panel rv-athlete" style="--sc:${sc}">
        <header class="rv-ahead">
          <span class="avatar rv-av2" aria-hidden="true">${esc(initialsOf(athleteLabel(a)))}</span>
          <div style="min-width:0">
            <h3>${esc(athleteLabel(a))}</h3>
            <div class="num rv-sub">Age ${ageOf(a.dob)}${a.skillLevel?` · ${esc(a.skillLevel)}`:""} · ${sessions} session${sessions===1?"":"s"} attended</div>
          </div>
          ${sport?`<span class="pill rv-sportpill" style="background:${sc}1A;color:${sc}">${sportGlyph(sport)} ${esc(sport)}</span>`:""}
        </header>
        ${skills.length?`<div class="rv-skills">
          <span class="eyebrow">Skills worked</span>
          <div class="rv-chips">${skills.map(s=>`<span class="rv-chip">${esc(s)}</span>`).join("")}</div>
        </div>`:""}
        ${ents.length?`<div class="rv-tl">
          ${ents.map(e=>`<div class="rv-ent">
            <div class="rv-ent-h">
              <span class="rv-kind">${esc(e.kind)}</span>
              <span class="num rv-date">${fmtDate(e.date)}</span>
            </div>
            <div class="rv-ent-t">${esc(e.title)}</div>
            <p class="rv-ent-b">${esc(e.body)}</p>
            ${e.practice?`<p class="rv-ent-x"><b>Practice at home:</b> ${esc(e.practice)}</p>`:""}
            ${e.encouragement?`<p class="rv-ent-q">"${esc(e.encouragement)}"</p>`:""}
            ${(e.skills||[]).length?`<div class="rv-chips" style="margin-top:9px">
              ${e.skills.map(s=>`<span class="rv-chip">${esc(s)}</span>`).join("")}</div>`:""}
          </div>`).join("")}
        </div>`:`<p class="rv-none" style="margin-top:14px">Nothing logged yet. The timeline fills in after the first booked session.</p>`}
      </section>`;
    }).join("")}
    </div>
    <p class="rv-note">Progress entries are private to your family. Coaches write updates; sessions come from your bookings; milestones are generated from the athlete's sport track.</p>
  </main>`;
}

/* ═══════════════════ 4 · goal intake + plan ═══════════════════ */
const SPORTS_WITH_LISTINGS=()=>[...new Set(PROGRAMS.map(p=>p.sport))].sort();

function planFor(g){
  const a=(S.athletes||[]).find(x=>x.id===g.athleteId);
  const age=a?ageOf(a.dob):null;
  const weeks=Math.max(3,weeksBetween(TODAY,g.target));
  let wF=Math.max(1,Math.round(weeks*0.40));
  let wB=Math.max(1,Math.round(weeks*0.35));
  if(wF+wB>=weeks){wF=Math.max(1,weeks-2);wB=1;}
  const wC=Math.max(1,weeks-wF-wB);
  const f=focusFor(g.sport);
  const phases=[
    {name:"Foundation",weeks:wF,focus:f[0],note:"Build the base the rest of the plan leans on."},
    {name:"Build",weeks:wB,focus:f[1],note:"Add difficulty while the fundamentals hold."},
    {name:"Compete",weeks:wC,focus:f[2],note:"Rehearse the thing you're actually training for."},
  ];
  const picks=PROGRAMS
    .filter(p=>p.verified===true&&p.sport===g.sport&&(age==null||(age>=p.minAge&&age<=p.maxAge)))
    .sort((x,y)=>(y.rating-x.rating)||(x.price-y.price))
    .slice(0,3);
  return {age,weeks,phases,picks,athlete:a,sessions:weeks*g.weekly};
}
function costLine(p,weeks,sessions){
  if(p.model==="single_session") return `≈ ${money(p.price*sessions)} across ${sessions} sessions`;
  if(p.model==="monthly"){const mo=Math.max(1,Math.ceil(weeks/4));return `≈ ${money(p.price*mo)} across ${mo} month${mo===1?"":"s"}`;}
  return `${money(p.price)} ${MODEL_LABEL[p.model]||p.model}`;
}
function goalForm(idAttr){
  const athletes=S.athletes||[];
  const sports=SPORTS_WITH_LISTINGS();
  if(!athletes.length) return `<p class="rv-none">Add a child first — a plan is built around one athlete's age and sport.</p>
    <button class="btn" data-addchild="1" style="margin-top:14px">Add a child</button>`;
  return `<form id="${idAttr}" novalidate>
    <div class="field">
      <label for="${idAttr}_outcome">The outcome you want</label>
      <input id="${idAttr}_outcome" name="outcome" maxlength="140"
        placeholder="Make the travel team by spring tryouts" required>
    </div>
    <div class="rv-2col">
      <div class="field"><label for="${idAttr}_athlete">Athlete</label>
        <select id="${idAttr}_athlete" name="athleteId" required>
          ${athletes.map(a=>`<option value="${esc(a.id)}">${esc(athleteLabel(a))} · age ${ageOf(a.dob)}</option>`).join("")}
        </select></div>
      <div class="field"><label for="${idAttr}_sport">Sport</label>
        <select id="${idAttr}_sport" name="sport" required>
          ${sports.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}
        </select></div>
    </div>
    <div class="rv-2col">
      <div class="field"><label for="${idAttr}_target">Target date</label>
        <input id="${idAttr}_target" name="target" type="date" value="2027-03-12" min="2026-08-04" max="2030-12-31" required></div>
      <div class="field"><label for="${idAttr}_weekly">Sessions per week</label>
        <select id="${idAttr}_weekly" name="weekly">
          ${[1,2,3,4,5].map(n=>`<option value="${n}"${n===2?" selected":""}>${n} per week</option>`).join("")}
        </select></div>
    </div>
    <div id="${idAttr}_err" class="err hide" style="margin:2px 0 10px"></div>
    <button class="btn wide" type="submit">Build the plan</button>
  </form>`;
}
function planCard(g){
  const {age,weeks,phases,picks,athlete,sessions}=planFor(g);
  const sc=sportColor(g.sport);
  const days=Math.max(0,daysBetween(TODAY,g.target));
  return `<section class="panel rv-goal" style="--sc:${sc}">
    <header class="rv-ghead">
      <div style="min-width:0">
        <span class="pill" style="background:${sc}1A;color:${sc}">${sportGlyph(g.sport)} ${esc(g.sport)}</span>
        <h3 style="margin-top:9px">${esc(g.outcome)}</h3>
        <div class="num rv-sub">${athlete?esc(athleteLabel(athlete))+" · age "+age:"Athlete removed"} ·
          target ${fmtDate(g.target)} · ${days} days out · ${g.weekly} session${g.weekly===1?"":"s"} a week</div>
      </div>
      <button class="x" data-goaldrop="${esc(g.id)}" aria-label="Remove the goal ${esc(g.outcome)}">${ICON.x}</button>
    </header>
    <div class="rv-meter" role="img" aria-label="${weeks} weeks split across three phases">
      ${phases.map((p,i)=>`<span class="rv-seg" style="flex:${p.weeks};--o:${[.34,.66,1][i]}"><b>${esc(p.name)}</b><i class="num">${p.weeks}w</i></span>`).join("")}
    </div>
    <div class="rv-phases">
      ${phases.map((p,i)=>`<div class="rv-phase">
        <div class="rv-pnum num">Phase ${i+1}</div>
        <div class="rv-pname">${esc(p.name)}</div>
        <div class="num rv-sub">${p.weeks} week${p.weeks===1?"":"s"} · ${p.weeks*g.weekly} sessions</div>
        <ul class="rv-flist">${p.focus.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
        <p class="rv-pnote">${esc(p.note)}</p>
      </div>`).join("")}
    </div>
    <div class="rv-picks">
      <div class="sec-head" style="margin:22px 0 12px"><h3>Where to train</h3>
        <span class="num rv-sub">${weeks} weeks · ${sessions} planned sessions</span></div>
      ${picks.length?`<div class="rv-plist">
        ${picks.map(p=>`<div class="rv-pick-row">
          <img src="${p.img}" alt="" class="rv-pimg">
          <div style="min-width:0">
            <b>${esc(p.title)}</b>
            <div class="num rv-sub">${esc(p.biz)} · ${ICON.star} ${p.rating} · ages ${p.minAge}–${p.maxAge} · ${esc(p.skill)}</div>
            <div class="num rv-sub">${money(p.price)} ${esc(MODEL_LABEL[p.model]||p.model)} · ${esc(costLine(p,weeks,sessions))}</div>
            ${p.verified?`<span class="pill gold" style="margin-top:6px">${ICON.shield} Background-checked</span>`:""}
          </div>
          <button class="btn ghost sm" data-open="${esc(p.id)}">View</button>
        </div>`).join("")}
      </div>`
      :`<p class="rv-none">No background-checked ${esc(g.sport)} listing currently fits ${athlete?"age "+age:"this athlete"}. We won't fill the gap with a coach who hasn't cleared a check — widen the sport or check back as new programs verify.</p>`}
    </div>
  </section>`;
}
function goalsView(){
  ensure();
  if(!isVerified()) return `${nav()}<main class="shell"><div class="empty">
    <h2>Log in to build a plan</h2>
    <p style="margin-top:8px">Tell us the outcome you're training for and we'll shape the weeks around it.</p>
    <button class="btn" data-signin="1" style="margin-top:20px">Log in or sign up</button></div></main>`;
  const goals=allGoals();
  return `${nav()}<main class="shell" style="padding-bottom:72px">
    <div class="sec-head"><div><h1>Goals</h1>
      <p class="rv-sub">State the outcome. We'll split the time you have into phases and match it to real listings that meet our verification requirements.</p></div>
      ${goals.length?`<button class="btn ghost sm" data-goalintake="1">New goal</button>`:""}</div>
    <div class="rv-goalgrid">
      <section class="panel">
        <span class="eyebrow">New goal</span>
        <h3 style="margin:6px 0 16px">What are you training toward?</h3>
        ${goalForm("goalForm")}
        <p class="rv-fine">Plans only ever cite listings that exist on Sporv and meet our verification requirements.</p>
      </section>
      <div class="rv-goals">
        ${goals.length?goals.map(planCard).join("")
          :`<div class="panel rv-none-panel"><h3>No plan yet</h3>
            <p class="rv-none" style="margin-top:7px">Fill in the outcome, the athlete, and when it needs to happen. The phase split comes from the date, and the listings come from the catalogue — nothing is invented.</p></div>`}
      </div>
    </div>
  </main>`;
}
function goalIntakeModal(){
  ensure();
  return wrap("New goal",`
    <p class="rv-sub" style="margin-bottom:16px">A plan is built from the date, the sport, and how often you can train.</p>
    ${goalForm("goalFormModal")}`);
}

/* ═══════════════════ wire ═══════════════════ */
function submitGoal(form,errEl){
  const d=Object.fromEntries(new FormData(form));
  const show=m=>{if(errEl){errEl.textContent=m;errEl.classList.remove("hide");}};
  const outcome=String(d.outcome||"").trim();
  if(outcome.length<6) return show("Describe the outcome in a few more words.");
  if(!d.athleteId) return show("Choose which athlete this is for.");
  if(!d.target) return show("Pick a target date.");
  if(d.target<=TODAY) return show("The target date needs to be in the future.");
  const g={id:"goal_"+Date.now(),athleteId:d.athleteId,outcome,sport:d.sport,
    target:d.target,weekly:+d.weekly||2,createdAt:TODAY};
  ensure();
  S.goals=[g,...S.goals];
  S.modal=null;
  render();
  toast("Plan built from the catalogue");
}
function wire(){
  ensure();
  const $=s=>document.querySelectorAll(s);

  $("[data-writereview]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.writereview;
    requireAuth(()=>{S.modal={type:"review",programId:id};render();});
  });
  $("[data-goalintake]").forEach(b=>b.onclick=()=>{
    requireAuth(()=>{S.modal={type:"goalintake"};render();});
  });
  $("[data-goaldrop]").forEach(b=>b.onclick=()=>{
    S.goals=allGoals().filter(g=>g.id!==b.dataset.goaldrop);
    render();toast("Goal removed");
  });

  /* review form — live counter, star word, validation */
  const body=document.getElementById("rvBody");
  const count=document.getElementById("rvCount");
  const paint=()=>{
    if(!body||!count) return;
    const n=body.value.length;
    count.textContent=n<20
      ? `${n} / 2000 · ${20-n} more character${20-n===1?"":"s"} needed`
      : `${n} / 2000`;
    count.classList.toggle("short",n<20);
  };
  if(body){body.oninput=paint;paint();}
  const word=document.getElementById("rvWord");
  document.querySelectorAll('.rv-pick input[name="rating"]').forEach(r=>{
    r.onchange=()=>{
      if(word) word.textContent=`${r.value} of 5 — ${RATING_WORD[r.value]}`;
      const e=document.getElementById("rvErr"); if(e) e.classList.add("hide");
    };
  });

  const rf=document.getElementById("reviewForm");
  if(rf) rf.onsubmit=e=>{
    e.preventDefault();
    const d=Object.fromEntries(new FormData(rf));
    const err=document.getElementById("rvErr");
    const show=m=>{err.textContent=m;err.classList.remove("hide");};
    const pid=S.modal&&S.modal.programId;
    if(!d.rating) return show("Pick a star rating from 1 to 5.");
    const text=String(d.body||"").trim();
    if(text.length<20) return show("Write at least 20 characters — enough for another parent to learn something.");
    if(text.length>2000) return show("Reviews are capped at 2,000 characters.");
    if(!eligibility(pid).ok) return show("This program is no longer open for a review from your account.");
    const u=S.auth.user;
    const author=authorName(u);
    S.reviews=[{id:"rev_"+Date.now(),programId:pid,author,initials:initialsOf(author),
      rating:+d.rating,date:TODAY,body:text,verifiedBooking:true},...allReviews()];
    S.modal=null;
    render();
    toast("Review posted");
  };

  const gf=document.getElementById("goalForm");
  if(gf) gf.onsubmit=e=>{e.preventDefault();submitGoal(gf,document.getElementById("goalForm_err"));};
  const gm=document.getElementById("goalFormModal");
  if(gm) gm.onsubmit=e=>{e.preventDefault();submitGoal(gm,document.getElementById("goalFormModal_err"));};
}

/* ═══════════════════ css ═══════════════════ */
const CSS=`
/* ── MOD_REVIEWS ─────────────────────────────────────────────────── */
.rv-sub{color:var(--muted);font-size:var(--text-sm);line-height:1.45}
.rv-fine{color:var(--faint);font-size:var(--text-sm);margin-top:12px;line-height:1.45}
.rv-note{color:var(--faint);font-size:var(--text-sm);margin-top:16px;max-width:78ch;line-height:1.5}
.rv-none{color:var(--muted);font-size:var(--text-base);line-height:1.5;max-width:66ch}
.rv-none-panel{border-style:dashed}
.rv-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.rv-2col{display:grid;grid-template-columns:1fr 1fr;gap:14px}

/* aggregate + histogram */
.rv-wrap{padding-bottom:8px}
.rv-agg{display:grid;grid-template-columns:auto minmax(0,1fr);gap:34px;align-items:center;
  padding:20px 0 22px;border-bottom:1px solid var(--rule)}
.rv-agg-empty{grid-template-columns:auto minmax(0,1fr);align-items:start}
.rv-score{font-size:var(--text-hero);font-weight:700;letter-spacing:-.04em;line-height:1}
.rv-stars{display:inline-flex;gap:2px;color:var(--gold-ink);margin:7px 0 4px}
.rv-stars .off{color:var(--rule-strong)}
.rv-hist{display:flex;flex-direction:column;gap:7px;min-width:0}
.rv-hrow{display:grid;grid-template-columns:56px minmax(0,1fr) 28px;align-items:center;gap:12px}
.rv-hlbl{font-size:var(--text-sm);color:var(--muted)}
.rv-hn{font-size:var(--text-sm);color:var(--muted);text-align:right}
.rv-track{height:7px;border-radius:999px;background:var(--raise2);overflow:hidden}
.rv-fill{display:block;height:100%;border-radius:999px;background:var(--slate)}

/* review list */
.rv-list{display:flex;flex-direction:column}
.rv-item{display:flex;gap:15px;padding:20px 0;border-bottom:1px solid var(--rule)}
.rv-av{width:40px;height:40px;font-size:var(--text-sm);flex:0 0 auto}
.rv-av2{width:46px;height:46px;font-size:var(--text-base);flex:0 0 auto}
.rv-body{min-width:0}
.rv-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.rv-meta b{font-size:var(--text-base);letter-spacing:-.015em}
.rv-date{color:var(--faint);font-size:var(--text-sm)}
.rv-text{margin-top:5px;color:var(--ink-2);font-size:var(--text-base);line-height:1.55;max-width:70ch}

/* write-a-review modal */
.rv-mhead{display:flex;gap:14px;align-items:center;padding-bottom:17px;border-bottom:1px solid var(--rule);margin-bottom:18px}
.rv-mimg{width:70px;height:70px;border-radius:var(--r-m);object-fit:cover;flex:0 0 auto}
.rv-gate{color:var(--muted);font-size:var(--text-base);line-height:1.5;margin-bottom:18px}
.rv-fs{border:0;padding:0;margin:0}
.rv-fs legend{font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:0}
.rv-pick{display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:2px;margin:9px 0 6px}
.rv-pick input{position:absolute;width:1px;height:1px;opacity:0;margin:0;pointer-events:none}
.rv-pick label{display:inline-flex;padding:5px;border-radius:var(--r-s);cursor:pointer;
  color:var(--rule-strong);transition:color .12s,transform .12s}
.rv-pick label svg{width:28px;height:28px}
.rv-pick label:hover{transform:translateY(-1px)}
.rv-pick input:checked+label,
.rv-pick input:checked~input+label{color:var(--gold-ink)}
.rv-pick input:focus-visible+label{outline:2px solid var(--slate);outline-offset:2px}
.rv-count{color:var(--faint);font-size:var(--text-sm)}
.rv-count.short{color:var(--warn)}

/* progress timeline */
.rv-tlgrid{display:flex;flex-direction:column;gap:18px}
.rv-athlete{padding:22px 24px}
.rv-ahead{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.rv-sportpill{margin-left:auto}
.rv-skills{margin-top:16px}
.rv-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.rv-chip{display:inline-flex;align-items:center;padding:4px 10px;border:1px solid var(--rule);
  border-radius:999px;font-size:var(--text-xs);font-weight:700;color:var(--ink-2);white-space:nowrap}
.rv-tl{position:relative;margin-top:20px;padding-left:26px}
.rv-tl::before{content:"";position:absolute;left:5px;top:6px;bottom:8px;width:2px;border-radius:2px;
  background:var(--sc,var(--slate));opacity:.32}
.rv-ent{position:relative;padding-bottom:22px}
.rv-ent:last-child{padding-bottom:0}
.rv-ent::before{content:"";position:absolute;left:-26px;top:5px;width:12px;height:12px;border-radius:999px;
  background:var(--sc,var(--slate));box-shadow:0 0 0 3px var(--paper)}
.rv-ent-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.rv-kind{font-size:var(--text-xs);font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.rv-ent-t{font-weight:700;font-size:var(--text-base);letter-spacing:-.015em;margin-top:3px}
.rv-ent-b{color:var(--ink-2);font-size:var(--text-base);line-height:1.55;margin-top:4px;max-width:70ch}
.rv-ent-x{color:var(--muted);font-size:var(--text-base);margin-top:8px}
.rv-ent-q{color:var(--ink-2);font-size:var(--text-base);font-style:italic;margin-top:6px}

/* goals + plan */
.rv-goalgrid{display:grid;grid-template-columns:376px minmax(0,1fr);gap:24px;align-items:start}
.rv-goals{display:flex;flex-direction:column;gap:18px;min-width:0}
.rv-goal{padding:22px 24px}
.rv-ghead{display:flex;gap:14px;align-items:flex-start;justify-content:space-between}
.rv-meter{display:flex;gap:4px;margin:18px 0 16px}
.rv-seg{position:relative;display:flex;flex-direction:column;gap:1px;padding:9px 12px 12px;
  border-radius:var(--r-s);background:var(--raise);min-width:0;overflow:hidden}
.rv-seg::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;
  background:var(--sc,var(--slate));opacity:var(--o,1)}
.rv-seg b{font-size:var(--text-sm);letter-spacing:-.01em;white-space:nowrap}
.rv-seg i{font-style:normal;font-size:var(--text-xs);color:var(--muted)}
.rv-phases{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:12px}
.rv-phase{border:1px solid var(--rule);border-radius:var(--r-m);padding:15px}
.rv-pnum{font-size:var(--text-xs);font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.rv-pname{font-size:var(--text-base);font-weight:700;letter-spacing:-.02em;margin-top:2px}
.rv-flist{margin:11px 0 0;padding-left:17px;display:flex;flex-direction:column;gap:5px;
  font-size:var(--text-base);color:var(--ink-2);line-height:1.4}
.rv-pnote{color:var(--faint);font-size:var(--text-sm);margin-top:10px;line-height:1.45}
.rv-plist{display:flex;flex-direction:column;gap:10px}
.rv-pick-row{display:flex;gap:14px;align-items:center;padding:12px;border:1px solid var(--rule);border-radius:var(--r-m)}
.rv-pick-row>button{margin-left:auto;flex:0 0 auto}
.rv-pimg{width:64px;height:64px;border-radius:var(--r-s);object-fit:cover;flex:0 0 auto}

@media(max-width:1020px){
  .rv-goalgrid{grid-template-columns:1fr}
}
@media(max-width:760px){
  .rv-agg{grid-template-columns:1fr;gap:18px}
  .rv-2col{grid-template-columns:1fr}
  .rv-sportpill{margin-left:0}
  .rv-pick-row{flex-wrap:wrap}
  .rv-pick-row>button{margin-left:0;width:100%}
}
`;

/* ═══════════════════ export ═══════════════════ */
window.MOD_REVIEWS={
  css:CSS,
  views:{timeline:timelineView,goals:goalsView},
  modals:{review:reviewModal,goalintake:goalIntakeModal},
  wire:wire,
  reviewsFor:reviewsFor,
  state:{reviews:REVIEWS,goals:GOALS},
};

})();
